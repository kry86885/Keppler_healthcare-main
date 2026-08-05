import json
import re

from flask import Blueprint, g, jsonify, request
from werkzeug.utils import secure_filename

from app import (
    require_permissions,
    current_hospital_id,
    log_audit_event,
    save_uploaded_file,
)
from ai.service import translate_patient_filter_prompt, answer_bulk_document_prompt
from utils.database import (
    create_bulk_import_job,
    get_bulk_import_job,
    query_bulk_patients,
    update_bulk_import_job,
    BULK_IMPORT_PATIENT_FIELDS,
)

from .tasks import (
    suggest_mapping_task,
    import_rows_task,
    extract_document_task,
    is_document_file,
    DOCUMENT_EXTENSIONS,
)

bulk_import_bp = Blueprint("bulk_import", __name__)

ALLOWED_EXTENSIONS = (".xlsx", ".csv") + DOCUMENT_EXTENSIONS

# Prompt-derived filters are never interpolated into SQL directly -- only
# (field, op, value) tuples that pass these allow-lists are ever used to build
# a parameterized WHERE clause. See translate_patient_filter_prompt() in ai/service.py.
ALLOWED_FIELDS = set(BULK_IMPORT_PATIENT_FIELDS) | {"phone"}
FALLBACK_SEARCH_FIELDS = ["name", "last_name", "phone", "medical_condition", "area"]
# "age" is the only numeric field among ALLOWED_FIELDS -- every other field is
# free text, where case and word-form (diabetic/diabetes, cough/coughing) vary
# between what a user types and what's actually stored.
_TEXT_FIELDS = ALLOWED_FIELDS - {"age"}

# Words that carry no filtering intent by themselves -- used to detect a bare
# "list everyone" prompt (see _deterministic_filter_clause) and to break a
# prompt into individual search terms for the keyword fallback (see
# bulk_import_query) when the LLM path doesn't apply.
_LIST_FILLER_WORDS = {
    "list", "show", "display", "get", "all", "every", "everyone", "patient",
    "patients", "full", "the", "me", "of", "a", "an", "please", "with", "in",
    "who", "that", "are", "is", "having", "for", "and", "or", "find", "search",
    "data", "record", "records", "row", "rows", "table", "details", "info", "information"
}
OP_SQL = {
    "eq": "= ?",
    "contains": "LIKE ?",
    "gt": "> ?",
    "lt": "< ?",
    "gte": ">= ?",
    "lte": "<= ?",
}


def _stem_term(word):
    """Strip common English suffixes so related word forms match each other in
    LIKE searches -- e.g. a prompt saying "diabetic" and a record storing
    "diabetes" both stem to "diabet", so either one finds the other. Without
    this, "contains" filters only ever match the exact word form the LLM (or
    user) happened to phrase the prompt with, which real medical records
    rarely match verbatim."""
    w = (word or "").strip().lower()
    for suffix in ("ically", "ication", "ical", "ation", "itis", "osis", "emia", "tic", "ic", "ing", "es", "ed", "s"):
        if len(w) - len(suffix) >= 3 and w.endswith(suffix):
            return w[: -len(suffix)]
    return w


def _job_scope_clause(job_id):
    if not job_id:
        return "", []
    try:
        numeric_job_id = int(job_id)
    except (TypeError, ValueError):
        return "", []
    if numeric_job_id <= 0:
        return "", []
    # bulk_import_job_id (not a patient_id prefix match) so a phone number
    # re-uploaded under a later job correctly shows up in that job's search --
    # see upsert_bulk_import_patients_batch for why patient_id itself is never
    # reassigned on re-import.
    return " AND bulk_import_job_id = ?", [numeric_job_id]


@bulk_import_bp.post("/api/bulk-import/upload")
@require_permissions("patients.bulk_ai.write")
def bulk_import_upload():
    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    uploaded_file = request.files["file"]
    filename = secure_filename(uploaded_file.filename or "") or "upload"
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        return (
            jsonify(
                {
                    "error": "Only .xlsx, .csv, .pdf, or .docx files are supported. Please re-save .xls files as .xlsx, or .doc files as .docx."
                }
            ),
            400,
        )

    file_bytes = uploaded_file.read()
    if not file_bytes:
        return jsonify({"error": "Uploaded file is empty."}), 400

    storage_path = save_uploaded_file(uploaded_file, file_bytes, "bulk_import")

    hospital_id = current_hospital_id()
    username = g.current_user.get("username")
    job_id = create_bulk_import_job(hospital_id, username, filename, storage_path)

    if is_document_file(filename):
        extract_document_task.delay(job_id)
    else:
        suggest_mapping_task.delay(job_id)
    log_audit_event("create", "bulk_import_jobs", str(job_id), {"filename": filename})

    return jsonify({"job_id": job_id})


@bulk_import_bp.get("/api/bulk-import/jobs/<int:job_id>")
@require_permissions("patients.bulk_ai.write")
def bulk_import_job_status(job_id):
    hospital_id = current_hospital_id()
    job = get_bulk_import_job(job_id, hospital_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    response = dict(job)
    # The full document text is only ever needed server-side (by /ask) -- it can be up
    # to 120k characters, far more than the frontend's polling loop needs to render.
    response.pop("extracted_text", None)
    response["kind"] = (
        "document"
        if is_document_file(job.get("original_filename") or "")
        else "spreadsheet"
    )
    for field in ("detected_columns", "suggested_mapping", "confirmed_mapping"):
        if response.get(field):
            try:
                response[field] = json.loads(response[field])
            except (TypeError, ValueError):
                pass
    return jsonify(response)


@bulk_import_bp.post("/api/bulk-import/jobs/<int:job_id>/mapping")
@require_permissions("patients.bulk_ai.write")
def bulk_import_confirm_mapping(job_id):
    hospital_id = current_hospital_id()
    job = get_bulk_import_job(job_id, hospital_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "AWAITING_MAPPING":
        return (
            jsonify(
                {"error": f"Job is not awaiting a mapping (status: {job['status']})"}
            ),
            409,
        )

    payload = request.get_json(silent=True) or {}
    mapping = payload.get("mapping") or {}
    # "phone" is a valid mapping target even though it's not in BULK_IMPORT_PATIENT_FIELDS --
    # that list is specifically the upsert `fields` dict columns, with phone deliberately
    # kept separate since it's its own column (and the dedup/contact key) in the upsert.
    valid_targets = set(BULK_IMPORT_PATIENT_FIELDS) | {"phone"}
    invalid_targets = set(mapping.values()) - valid_targets
    if invalid_targets:
        return (
            jsonify({"error": f"Unknown target field(s): {sorted(invalid_targets)}"}),
            400,
        )
    if "phone" not in mapping.values():
        return (
            jsonify(
                {
                    "error": "At least one column must be mapped to 'phone' -- it's required to contact or dedupe patients."
                }
            ),
            400,
        )

    update_bulk_import_job(job_id, status="IMPORTING")
    import_rows_task.delay(job_id, mapping)
    return jsonify({"status": "IMPORTING"})


def _build_filter_clause(conditions, logic):
    # Grouped by field: the local LLM sometimes hedges a single concept as
    # multiple conditions on the *same* field (e.g. medical_condition contains
    # "fever" AND medical_condition contains "feverish"). Combined with AND
    # logic, that can never match a real row since one text value can't
    # contain both substrings unless one implies the other -- what the model
    # actually means is "matches any of these phrasings", i.e. OR within a
    # field, even when the overall logic across *different* fields is AND.
    by_field = {}
    field_order = []
    for condition in conditions:
        field = condition.get("field")
        op = condition.get("op")
        value = condition.get("value")
        if field not in ALLOWED_FIELDS or field == "phone":
            continue  # phone is excluded from prompt-filterable fields (contact key, not a search facet)
        is_text = field in _TEXT_FIELDS
        clause = None
        param_values = []
        if op == "in":
            values = value if isinstance(value, list) else [value]
            values = [v for v in values if v is not None]
            if not values:
                continue
            placeholders = ", ".join(["?"] * len(values))
            if is_text:
                clause = f"LOWER({field}) IN ({placeholders})"
                param_values = [str(v).lower() for v in values]
            else:
                clause = f"{field} IN ({placeholders})"
                param_values = list(values)
        elif op == "contains" and is_text:
            # ILIKE (case-insensitive) plus stemming so "diabetic" in the prompt
            # matches a record stored as "diabetes" and vice versa.
            clause = f"{field} ILIKE ?"
            param_values = [f"%{_stem_term(value)}%"]
        elif op == "eq" and is_text:
            clause = f"LOWER({field}) = LOWER(?)"
            param_values = [value]
        elif op in OP_SQL:
            clause = f"{field} {OP_SQL[op]}"
            param_values = [f"%{value}%"] if op == "contains" else [value]
        # Unknown ops are silently dropped rather than raising -- an LLM producing
        # an unexpected op shouldn't 500 the whole search, just skip that condition.
        if clause is None:
            continue
        if field not in by_field:
            by_field[field] = []
            field_order.append(field)
        by_field[field].append((clause, param_values))

    if not by_field:
        return "", []

    clauses = []
    params = []
    for field in field_order:
        entries = by_field[field]
        if len(entries) == 1:
            clause, param_values = entries[0]
            clauses.append(clause)
            params.extend(param_values)
        else:
            clauses.append("(" + " OR ".join(clause for clause, _ in entries) + ")")
            for _, param_values in entries:
                params.extend(param_values)

    joiner = " OR " if (logic or "AND").upper() == "OR" else " AND "
    return f" AND ({joiner.join(clauses)})", params


def _keyword_fallback_clause(prompt):
    """Best-effort keyword search used when neither the deterministic heuristic nor the
    LLM could derive a structured filter. Requires each significant word in the prompt to
    appear somewhere across FALLBACK_SEARCH_FIELDS (AND across words, OR across fields per
    word) -- matching the whole raw prompt as a single substring, as this used to do,
    essentially never matches real data for anything but a one-word prompt, since it
    requires that exact multi-word phrase to appear verbatim in a single field."""
    words = re.findall(r"[a-z0-9]+", (prompt or "").lower())
    significant_words = [w for w in words if w not in _LIST_FILLER_WORDS and len(w) > 1]
    if not significant_words:
        significant_words = [prompt.strip().lower()] if (prompt or "").strip() else []
    if not significant_words:
        return "", []

    clauses = []
    params = []
    for word in significant_words:
        field_clauses = [f"{field} ILIKE ?" for field in FALLBACK_SEARCH_FIELDS]
        clauses.append(f"({' OR '.join(field_clauses)})")
        params.extend([f"%{_stem_term(word)}%"] * len(FALLBACK_SEARCH_FIELDS))
    return f" AND ({' AND '.join(clauses)})", params


def _deterministic_filter_clause(prompt):
    text = (prompt or "").strip().lower()
    if not text:
        return "", []

    age_matchers = [
        (r"\b(?:above|over|older than|greater than|more than)\s+(\d{1,3})\b", ">"),
        (r"\b(?:below|under|younger than|less than)\s+(\d{1,3})\b", "<"),
        (r"\b(?:age|aged)\s*(>=|>|<=|<|=)\s*(\d{1,3})\b", None),
    ]
    for pattern, implied_op in age_matchers:
        match = re.search(pattern, text)
        if match:
            if implied_op:
                return f" AND age {implied_op} ?", [int(match.group(1))]
            return f" AND age {match.group(1)} ?", [int(match.group(2))]

    between_match = re.search(
        r"\b(?:between|from)\s+(\d{1,3})\s+(?:and|to)\s+(\d{1,3})\b", text
    )
    if between_match and "age" in text:
        low, high = sorted([int(between_match.group(1)), int(between_match.group(2))])
        return " AND age BETWEEN ? AND ?", [low, high]

    # Only short-circuit to "no filter, list everyone" when nothing substantive
    # remains after stripping generic list/filler words -- e.g. "list all
    # patients" or "show me every patient". This used to instead check for a
    # tiny hardcoded set of "filter words" (just age terms and literally
    # "diabetes"/"diabetic"/"area"/"city") and treat ANY OTHER condition as "no
    # filter" -- so "patients with fever" or "cold and cough patients" silently
    # ignored the condition and returned the entire unfiltered list. Checking
    # for leftover substantive words instead of a fixed vocabulary means any
    # real condition/place name correctly falls through to the LLM translator
    # below instead of being discarded.
    words = re.findall(r"[a-z]+", text)
    substantive_words = [word for word in words if word not in _LIST_FILLER_WORDS]
    if not substantive_words:
        return "", []

    return None, None


@bulk_import_bp.post("/api/bulk-import/query")
@require_permissions("patients.bulk_ai.write")
def bulk_import_query():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    job_id = payload.get("job_id")
    page = max(int(payload.get("page") or 1), 1)
    page_size = min(max(int(payload.get("page_size") or 150), 1), 500)

    hospital_id = current_hospital_id()
    scope_clause, scope_params = _job_scope_clause(job_id)

    if not prompt:
        rows, total = query_bulk_patients(
            hospital_id, scope_clause, scope_params, page=page, page_size=page_size
        )
        return jsonify(
            {"results": rows, "total": total, "page": page, "page_size": page_size}
        )

    where_clause, params = _deterministic_filter_clause(prompt)
    if where_clause is not None:
        where_clause = scope_clause + where_clause
        params = scope_params + params
        rows, total = query_bulk_patients(
            hospital_id, where_clause, params, page=page, page_size=page_size
        )
        return jsonify(
            {"results": rows, "total": total, "page": page, "page_size": page_size}
        )

    filter_result = translate_patient_filter_prompt(prompt, list(ALLOWED_FIELDS))
    if not filter_result or not filter_result.get("conditions"):
        fallback_where, fallback_params = _keyword_fallback_clause(prompt)
        where_clause = scope_clause + fallback_where
        params = scope_params + fallback_params
    else:
        where_clause, params = _build_filter_clause(
            filter_result.get("conditions") or [], filter_result.get("logic")
        )
        if not where_clause:
            where_clause, params = _keyword_fallback_clause(prompt)
        where_clause = scope_clause + where_clause
        params = scope_params + params

    rows, total = query_bulk_patients(
        hospital_id, where_clause, params, page=page, page_size=page_size
    )
    return jsonify(
        {"results": rows, "total": total, "page": page, "page_size": page_size}
    )


@bulk_import_bp.post("/api/bulk-import/jobs/<int:job_id>/ask")
@require_permissions("patients.bulk_ai.write")
def bulk_import_ask_document(job_id):
    hospital_id = current_hospital_id()
    job = get_bulk_import_job(job_id, hospital_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "AWAITING_PROMPT":
        return (
            jsonify(
                {
                    "error": f"This document isn't ready to answer questions yet (status: {job['status']})"
                }
            ),
            409,
        )

    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Prompt is required."}), 400

    answer_result = answer_bulk_document_prompt(prompt, job.get("extracted_text") or "")
    if not answer_result:
        return (
            jsonify({"error": "Could not understand that prompt. Try rephrasing it."}),
            422,
        )

    raw_entries = answer_result.get("entries") or []
    results = []
    for index, entry in enumerate(raw_entries):
        if not isinstance(entry, dict):
            continue
        results.append(
            {
                "patient_id": f"doc-{job_id}-{index}",
                "name": str(entry.get("name") or ""),
                "last_name": "",
                "phone": str(entry.get("phone") or ""),
                "area": str(entry.get("area") or ""),
                "medical_condition": str(entry.get("medical_condition") or ""),
                "age": entry.get("age"),
                "gender": str(entry.get("gender") or ""),
            }
        )

    return jsonify(
        {
            "results": results,
            "total": len(results),
            "answer": answer_result.get("answer") or "",
        }
    )
