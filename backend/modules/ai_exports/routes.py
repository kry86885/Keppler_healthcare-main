import io
import csv
from ai.service import extract_text_from_image, patient_history_search
from core.export import generate_pdf, generate_word
from core.storage import ObjectStorage
from flask import Blueprint, jsonify, request, g, send_file
from werkzeug.exceptions import BadRequest
import os
import uuid
import time
from datetime import datetime
from io import BytesIO

from app import (
    require_permissions,
    log_audit_event,
    validate_required_fields,
    current_hospital_id,
    row_to_dict,
    rows_to_dicts,
)

from utils.database import get_all_patients, search_patients

ai_exports_bp = Blueprint("ai_exports", __name__)


@ai_exports_bp.post("/api/ai/patient-history-search")
@require_permissions("patients.read")
def ai_patient_history_search():
    payload = request.get_json(force=True)
    query = (payload.get("query") or "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    patient_id = payload.get("patient_id")
    k = payload.get("k", 5)
    try:
        k = max(1, min(int(k), 20))
    except (TypeError, ValueError):
        k = 5
    result = patient_history_search(
        query, hospital_id=current_hospital_id(), patient_id=patient_id, k=k
    )
    return jsonify(result)


@ai_exports_bp.post("/api/ocr")
@require_permissions("symptom_ai.use")
def ocr_extract():
    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    uploaded_file = request.files["file"]
    language = request.form.get("language", "en")
    doc_type = request.form.get("doc_type", "document")
    content = uploaded_file.read()
    text = extract_text_from_image(
        content, language, doc_type, filename=uploaded_file.filename
    )
    return jsonify({"text": text})


@ai_exports_bp.post("/api/export/pdf")
@require_permissions("symptom_ai.use")
def export_pdf():
    payload = request.get_json(force=True)
    pdf_bytes = generate_pdf(
        payload.get("patient_name", ""),
        payload.get("doc_type", "document"),
        payload.get("ocr_text", ""),
        payload.get("date"),
    )
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="document.pdf",
    )


@ai_exports_bp.post("/api/export/word")
@require_permissions("symptom_ai.use")
def export_word():
    payload = request.get_json(force=True)
    word_bytes = generate_word(
        payload.get("patient_name", ""),
        payload.get("doc_type", "document"),
        payload.get("ocr_text", ""),
        payload.get("date"),
    )
    return send_file(
        io.BytesIO(word_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name="document.docx",
    )


@ai_exports_bp.get("/api/export/patients/csv")
@require_permissions("patients.read")
def export_patients_csv():
    query = (request.args.get("q") or "").strip()
    hospital_id = current_hospital_id()
    patients = (
        search_patients(query, hospital_id=hospital_id)
        if query
        else get_all_patients(hospital_id=hospital_id)
    )

    csv_stream = io.StringIO()
    writer = csv.writer(csv_stream)
    headers = [
        "patient_id",
        "name",
        "middle_name",
        "last_name",
        "dob",
        "age",
        "weight",
        "height",
        "gender",
        "pregnant",
        "allergies",
        "symptoms",
        "phone",
        "created_at",
        "updated_at",
    ]
    writer.writerow(headers)
    for row in patients:
        item = row_to_dict(row)
        writer.writerow(
            [
                item.get(header, "") if item.get(header) is not None else ""
                for header in headers
            ]
        )

    filename_suffix = datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        io.BytesIO(csv_stream.getvalue().encode("utf-8-sig")),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"patients_{filename_suffix}.csv",
    )
