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
    rows_to_dicts
)

from utils.database import (
    create_ot_surgery,
    create_ot_theatre,
    delete_ot_surgery,
    delete_ot_theatre,
    get_ot_summary,
    list_ot_surgeries,
    list_ot_theatres,
    update_ot_surgery,
    update_ot_theatre
)


ot_bp = Blueprint('ot', __name__)
@ot_bp.get("/api/ot/theatres")
@require_permissions("ot.read")
def ot_theatres_list():
    return jsonify({"theatres": rows_to_dicts(list_ot_theatres())})



@ot_bp.post("/api/ot/theatres")
@require_permissions("ot.theatres.write")
def ot_theatres_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["theatre_code", "theatre_name"])
    if validation_error:
        return validation_error
    theatre_id = create_ot_theatre(payload)
    log_audit_event("create", "ot_theatres", str(theatre_id), {"theatre_code": payload.get("theatre_code")})
    return jsonify({"theatre_id": theatre_id})



@ot_bp.put("/api/ot/theatres/<int:theatre_id>")
@require_permissions("ot.theatres.write")
def ot_theatres_update(theatre_id):
    payload = request.get_json(force=True)
    updated = update_ot_theatre(theatre_id, payload)
    if not updated:
        return jsonify({"error": "Theatre not found"}), 404
    log_audit_event("update", "ot_theatres", str(theatre_id), {"theatre_id": theatre_id})
    return jsonify({"status": "ok"})



@ot_bp.delete("/api/ot/theatres/<int:theatre_id>")
@require_permissions("ot.theatres.write")
def ot_theatres_delete(theatre_id):
    deleted = delete_ot_theatre(theatre_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Theatre not found"}), 404
    log_audit_event("delete", "ot_theatres", str(theatre_id), {"theatre_id": theatre_id})
    return jsonify({"status": "ok"})



@ot_bp.get("/api/ot/surgeries")
@require_permissions("ot.read")
def ot_surgeries_list():
    theatre_id = request.args.get("theatre_id", type=int)
    status = request.args.get("status")
    return jsonify({"surgeries": rows_to_dicts(list_ot_surgeries(theatre_id=theatre_id, status=status))})



@ot_bp.post("/api/ot/surgeries")
@require_permissions("ot.surgeries.write")
def ot_surgeries_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["theatre_id", "procedure_name", "surgeon_name", "scheduled_start"])
    if validation_error:
        return validation_error
    surgery_id = create_ot_surgery(payload)
    log_audit_event("create", "ot_surgeries", str(surgery_id), {"procedure_name": payload.get("procedure_name")})
    return jsonify({"surgery_id": surgery_id})



@ot_bp.put("/api/ot/surgeries/<int:surgery_id>")
@require_permissions("ot.surgeries.write")
def ot_surgeries_update(surgery_id):
    payload = request.get_json(force=True)
    updated = update_ot_surgery(surgery_id, payload)
    if not updated:
        return jsonify({"error": "Surgery not found"}), 404
    log_audit_event("update", "ot_surgeries", str(surgery_id), {"surgery_id": surgery_id})
    return jsonify({"status": "ok"})



@ot_bp.delete("/api/ot/surgeries/<int:surgery_id>")
@require_permissions("ot.surgeries.write")
def ot_surgeries_delete(surgery_id):
    deleted = delete_ot_surgery(surgery_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Surgery not found"}), 404
    log_audit_event("delete", "ot_surgeries", str(surgery_id), {"surgery_id": surgery_id})
    return jsonify({"status": "ok"})



@ot_bp.get("/api/ot/summary")
@require_permissions("ot.read")
def ot_summary():
    return jsonify(get_ot_summary())


