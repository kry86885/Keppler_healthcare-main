import csv
import io
import json
import logging
import re

from celery import shared_task

from core.storage import ObjectStorage
from utils.database import (
    get_bulk_import_job_internal,
    update_bulk_import_job,
    upsert_bulk_import_patients_batch,
    BULK_IMPORT_PATIENT_FIELDS,
)

logger = logging.getLogger(__name__)

SAMPLE_ROWS = 20
BATCH_SIZE = 1000

# "phone" is a valid mapping target even though it's not in BULK_IMPORT_PATIENT_FIELDS --
# that list is specifically the upsert `fields` dict columns, with phone kept separate
# since it's its own column (and the dedup/contact key) in the upsert.
MAPPABLE_FIELDS = BULK_IMPORT_PATIENT_FIELDS + ["phone"]

# Keyword hints used both for the LLM-suggestion prompt and as a fallback
# heuristic mapping when no LLM provider is configured.
_FIELD_KEYWORDS = {
    "phone": ["phone", "mobile", "contact", "whatsapp"],
    "name": ["first name", "name", "patient name", "full name"],
    "last_name": ["last name", "surname", "family name"],
    "age": ["age"],
    "gender": ["gender", "sex"],
    "area": ["area", "city", "location", "address", "locality"],
    "medical_condition": ["disease", "diagnosis", "condition", "ailment", "symptom", "illness"],
}


def _is_xlsx(filename: str) -> bool:
    # .xls (legacy binary) is deliberately not supported -- openpyxl can't read it,
    # and the only parser that can (old xlrd<=1.2.0) isn't streaming-safe at 200MB.
    # Upload validation in routes.py already rejects anything but .xlsx/.csv.
    return (filename or "").lower().endswith(".xlsx")


# PDF/DOCX uploads are unstructured documents -- they skip column mapping and import
# entirely, going straight from upload to "ask a question about this document".
DOCUMENT_EXTENSIONS = (".pdf", ".docx")
# Same cap ai/service.py's other document-context prompts use, to keep the LLM call
# fast/affordable even for a large scanned report -- long enough for any realistic
# single patient list/report, short of pasting an entire multi-hundred-page dump.
MAX_DOCUMENT_TEXT_CHARS = 120_000


def is_document_file(filename: str) -> bool:
    return (filename or "").lower().endswith(DOCUMENT_EXTENSIONS)


def _read_header_and_rows(file_bytes: bytes, filename: str, max_rows=None):
    """Yields (headers, row_iterator). `row_iterator` streams data rows as
    positional tuples aligned to `headers` -- for .xlsx via openpyxl's
    read_only mode (never materializes the whole sheet), for .csv via the
    stdlib csv module (also naturally streaming)."""
    if _is_xlsx(filename):
        import openpyxl

        workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        worksheet = workbook.active
        row_iter = worksheet.iter_rows(values_only=True)
        headers = [str(h).strip() if h is not None else "" for h in next(row_iter)]

        def _rows():
            count = 0
            for row in row_iter:
                if max_rows is not None and count >= max_rows:
                    break
                yield row
                count += 1

        return headers, _rows()

    text_stream = io.StringIO(file_bytes.decode("utf-8-sig", errors="replace"))
    reader = csv.reader(text_stream)
    headers = [h.strip() for h in next(reader)]

    def _rows():
        count = 0
        for row in reader:
            if max_rows is not None and count >= max_rows:
                break
            yield tuple(row)
            count += 1

    return headers, _rows()


def _heuristic_mapping(headers):
    mapping = {}
    for header in headers:
        normalized = re.sub(r"[_\-]+", " ", header).strip().lower()
        for field, keywords in _FIELD_KEYWORDS.items():
            if field in mapping.values():
                continue
            if any(keyword in normalized for keyword in keywords):
                mapping[header] = field
                break
    return mapping


def _suggest_mapping_via_llm(headers, sample_rows):
    from ai.service import llm_provider

    if not llm_provider.is_configured():
        return None
    sample_text = "\n".join(", ".join(str(v) for v in row) for row in sample_rows[:5])
    prompt = f"""You are mapping spreadsheet columns to a fixed set of patient-record fields.

Available target fields: {", ".join(MAPPABLE_FIELDS)}

Spreadsheet headers: {headers}
Sample data rows:
{sample_text}

Return ONLY valid JSON mapping each spreadsheet header that clearly corresponds to a target
field to that field name, e.g. {{"Patient Name": "name", "Mobile No": "phone"}}. Omit headers
that don't map to any target field. Do not invent target fields outside the list above.
"""
    try:
        raw = llm_provider.generate(prompt, json_mode=True)
        if not raw:
            return None
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        parsed = json.loads(raw)
        return {k: v for k, v in parsed.items() if v in MAPPABLE_FIELDS}
    except Exception:
        logger.exception("LLM column-mapping suggestion failed, falling back to heuristic")
        return None


@shared_task
def suggest_mapping_task(job_id):
    """Guess the column mapping (LLM, falling back to keyword heuristics) and, as long as a
    phone column was found, import immediately -- no manual per-column review step. A file
    with hundreds/thousands of rows and unclear headers isn't something a user can usefully
    hand-check row by row anyway; they search/filter the imported data with a prompt afterward
    (see bulk_import_query), which is where "did this row actually match what I meant" is
    actually decidable."""
    job = get_bulk_import_job_internal(job_id)
    if not job:
        return
    try:
        file_bytes = ObjectStorage().read(job["storage_path"])
        if file_bytes is None:
            raise RuntimeError("Uploaded file could not be read from storage.")

        headers, row_iter = _read_header_and_rows(file_bytes, job["original_filename"], max_rows=SAMPLE_ROWS)
        sample_rows = list(row_iter)

        # Start from the keyword heuristic, then let the LLM's guess override per-header --
        # this way a partial/imperfect LLM response (e.g. it identifies name/area/condition
        # but misses an oddly-named phone column) still keeps the heuristic's match for
        # whatever it skipped, instead of an all-or-nothing choice between the two.
        suggested = dict(_heuristic_mapping(headers))
        suggested.update(_suggest_mapping_via_llm(headers, sample_rows) or {})

        update_bulk_import_job(
            job_id,
            detected_columns=json.dumps(headers, separators=(",", ":")),
            suggested_mapping=json.dumps(suggested, separators=(",", ":")),
        )

        if "phone" not in suggested.values():
            update_bulk_import_job(
                job_id,
                status="FAILED",
                error=(
                    "Could not automatically find a phone number column in this file. "
                    "Make sure it has a clearly labeled phone/mobile/contact column, then re-upload."
                ),
            )
            return

        import_rows_task(job_id, suggested)
    except Exception as exc:
        logger.exception("suggest_mapping_task failed for job %s", job_id)
        update_bulk_import_job(job_id, status="FAILED", error=str(exc))


@shared_task
def import_rows_task(job_id, confirmed_mapping):
    job = get_bulk_import_job_internal(job_id)
    if not job:
        return
    update_bulk_import_job(job_id, status="IMPORTING", confirmed_mapping=json.dumps(confirmed_mapping, separators=(",", ":")))

    try:
        file_bytes = ObjectStorage().read(job["storage_path"])
        if file_bytes is None:
            raise RuntimeError("Uploaded file could not be read from storage.")

        headers, row_iter = _read_header_and_rows(file_bytes, job["original_filename"])
        # Positional index -> target field, aligned to header order.
        index_to_field = [confirmed_mapping.get(header) for header in headers]

        hospital_id = job["hospital_id"]
        batch = []
        processed = imported = skipped = 0

        for row_index, row in enumerate(row_iter, start=1):
            fields = {f: None for f in BULK_IMPORT_PATIENT_FIELDS}
            phone = None
            for col_index, value in enumerate(row):
                if col_index >= len(index_to_field):
                    break
                field = index_to_field[col_index]
                if not field or value is None:
                    continue
                if field == "phone":
                    phone = re.sub(r"\D", "", str(value))
                elif field == "age":
                    try:
                        fields["age"] = int(float(value))
                    except (TypeError, ValueError):
                        pass
                else:
                    fields[field] = str(value).strip()

            processed += 1
            if not phone:
                skipped += 1
            else:
                fields["name"] = fields["name"] or ""
                fields["last_name"] = fields["last_name"] or ""
                patient_id = f"BULK-{job_id}-{row_index}"
                batch.append((patient_id, phone, fields))
                imported += 1

            if len(batch) >= BATCH_SIZE:
                upsert_bulk_import_patients_batch(hospital_id, batch)
                batch = []
                update_bulk_import_job(
                    job_id, processed_rows=processed, imported_count=imported, skipped_count=skipped
                )

        if batch:
            upsert_bulk_import_patients_batch(hospital_id, batch)

        update_bulk_import_job(
            job_id,
            status="DONE",
            processed_rows=processed,
            imported_count=imported,
            skipped_count=skipped,
            total_rows=processed,
        )
    except Exception as exc:
        logger.exception("import_rows_task failed for job %s", job_id)
        update_bulk_import_job(job_id, status="FAILED", error=str(exc))


@shared_task
def extract_document_task(job_id):
    job = get_bulk_import_job_internal(job_id)
    if not job:
        return
    try:
        file_bytes = ObjectStorage().read(job["storage_path"])
        if file_bytes is None:
            raise RuntimeError("Uploaded file could not be read from storage.")

        from ai.document_extraction import extract_document_text

        text = extract_document_text(file_bytes, job["original_filename"])
        update_bulk_import_job(
            job_id,
            status="AWAITING_PROMPT",
            extracted_text=text[:MAX_DOCUMENT_TEXT_CHARS],
            total_rows=1,
            processed_rows=1,
        )
    except Exception as exc:
        logger.exception("extract_document_task failed for job %s", job_id)
        update_bulk_import_job(job_id, status="FAILED", error=str(exc))
