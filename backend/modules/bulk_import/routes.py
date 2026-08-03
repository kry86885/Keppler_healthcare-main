import json

from flask import Blueprint, g, jsonify, request
from werkzeug.utils import secure_filename

from app import require_permissions, current_hospital_id, log_audit_event, save_uploaded_file
from ai.service import translate_patient_filter_prompt, answer_bulk_document_prompt
from utils.database import (
    create_bulk_import_job,
    get_bulk_import_job,
    query_bulk_patients,
    update_bulk_import_job,
    BULK_IMPORT_PATIENT_FIELDS,
)

from .tasks import suggest_mapping_task, import_rows_task, extract_document_task, is_document_file, DOCUMENT_EXTENSIONS

bulk_import_bp = Blueprint("bulk_import", __name__)

ALLOWED_EXTENSIONS = (".xlsx", ".csv") + DOCUMENT_EXTENSIONS

# Prompt-derived filters are never interpolated into SQL directly -- only
# (field, op, value) tuples that pass these allow-lists are ever used to build
# a parameterized WHERE clause. See translate_patient_filter_prompt() in ai/service.py.
ALLOWED_FIELDS = set(BULK_IMPORT_PATIENT_FIELDS) | {"phone"}
OP_SQL = {
    "eq": "= ?",
    "contains": "LIKE ?",
    "gt": "> ?",
    "lt": "< ?",
    "gte": ">= ?",
    "lte": "<= ?",
}


@bulk_import_bp.post("/api/bulk-import/upload")
@require_permissions("patients.bulk_ai.write")
def bulk_import_upload():
    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    uploaded_file = request.files["file"]
    filename = secure_filename(uploaded_file.filename or "") or "upload"
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        return jsonify({"error": "Only .xlsx, .csv, .pdf, or .docx files are supported. Please re-save .xls files as .xlsx, or .doc files as .docx."}), 400

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
    response["kind"] = "document" if is_document_file(job.get("original_filename") or "") else "spreadsheet"
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
        return jsonify({"error": f"Job is not awaiting a mapping (status: {job['status']})"}), 409

    payload = request.get_json(silent=True) or {}
    mapping = payload.get("mapping") or {}
    # "phone" is a valid mapping target even though it's not in BULK_IMPORT_PATIENT_FIELDS --
    # that list is specifically the upsert `fields` dict columns, with phone deliberately
    # kept separate since it's its own column (and the dedup/contact key) in the upsert.
    valid_targets = set(BULK_IMPORT_PATIENT_FIELDS) | {"phone"}
    invalid_targets = set(mapping.values()) - valid_targets
    if invalid_targets:
        return jsonify({"error": f"Unknown target field(s): {sorted(invalid_targets)}"}), 400
    if "phone" not in mapping.values():
        return jsonify({"error": "At least one column must be mapped to 'phone' -- it's required to contact or dedupe patients."}), 400

    update_bulk_import_job(job_id, status="IMPORTING")
    import_rows_task.delay(job_id, mapping)
    return jsonify({"status": "IMPORTING"})


def _build_filter_clause(conditions, logic):
    clauses = []
    params = []
    for condition in conditions:
        field = condition.get("field")
        op = condition.get("op")
        value = condition.get("value")
        if field not in ALLOWED_FIELDS or field == "phone":
            continue  # phone is excluded from prompt-filterable fields (contact key, not a search facet)
        if op == "in":
            values = value if isinstance(value, list) else [value]
            values = [v for v in values if v is not None]
            if not values:
                continue
            placeholders = ", ".join(["?"] * len(values))
            clauses.append(f"{field} IN ({placeholders})")
            params.extend(values)
        elif op in OP_SQL:
            if op == "contains":
                params.append(f"%{value}%")
            else:
                params.append(value)
            clauses.append(f"{field} {OP_SQL[op]}")
        # Unknown ops are silently dropped rather than raising -- an LLM producing
        # an unexpected op shouldn't 500 the whole search, just skip that condition.

    if not clauses:
        return "", []
    joiner = " OR " if (logic or "AND").upper() == "OR" else " AND "
    return f" AND ({joiner.join(clauses)})", params


@bulk_import_bp.post("/api/bulk-import/query")
@require_permissions("patients.bulk_ai.write")
def bulk_import_query():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    page = max(int(payload.get("page") or 1), 1)
    page_size = min(max(int(payload.get("page_size") or 150), 1), 500)

    hospital_id = current_hospital_id()

    if not prompt:
        rows, total = query_bulk_patients(hospital_id, "", [], page=page, page_size=page_size)
        return jsonify({"results": rows, "total": total, "page": page, "page_size": page_size})

    filter_result = translate_patient_filter_prompt(prompt, list(ALLOWED_FIELDS))
    if not filter_result:
        return jsonify({"error": "Could not understand that prompt. Try rephrasing with specific area/condition terms."}), 422

    where_clause, params = _build_filter_clause(filter_result.get("conditions") or [], filter_result.get("logic"))
    rows, total = query_bulk_patients(hospital_id, where_clause, params, page=page, page_size=page_size)
    return jsonify({"results": rows, "total": total, "page": page, "page_size": page_size})


@bulk_import_bp.post("/api/bulk-import/jobs/<int:job_id>/ask")
@require_permissions("patients.bulk_ai.write")
def bulk_import_ask_document(job_id):
    hospital_id = current_hospital_id()
    job = get_bulk_import_job(job_id, hospital_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "AWAITING_PROMPT":
        return jsonify({"error": f"This document isn't ready to answer questions yet (status: {job['status']})"}), 409

    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Prompt is required."}), 400

    answer_result = answer_bulk_document_prompt(prompt, job.get("extracted_text") or "")
    if not answer_result:
        return jsonify({"error": "Could not understand that prompt. Try rephrasing it."}), 422

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

    return jsonify({
        "results": results,
        "total": len(results),
        "answer": answer_result.get("answer") or "",
    })
