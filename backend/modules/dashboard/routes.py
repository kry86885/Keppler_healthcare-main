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

from core.auth import resolve_user_permissions

from utils.database import (
    get_dashboard_analytics,
    get_hospital_dashboard_summary,
    get_patient_stats
)


dashboard_bp = Blueprint('dashboard', __name__)
@dashboard_bp.get("/api/stats")
@require_permissions("patients.read")
def stats():
    return jsonify(get_patient_stats(hospital_id=current_hospital_id()))



@dashboard_bp.get("/api/dashboard/analytics")
@require_permissions("patients.read")
def dashboard_analytics():
    requested_days = request.args.get("days", default=14, type=int)
    permissions = resolve_user_permissions(g.current_user)
    include_employee = "admin.use" in permissions
    try:
        payload = get_dashboard_analytics(
            days=requested_days,
            include_employee=include_employee,
            hospital_id=current_hospital_id(),
        )
    except TypeError as error:
        # Backward compatibility for stale runtime modules that still expose
        # get_dashboard_analytics(days, include_employee) without hospital_id.
        if "unexpected keyword argument 'hospital_id'" not in str(error):
            raise
        payload = get_dashboard_analytics(
            days=requested_days,
            include_employee=include_employee,
        )
    return jsonify(payload)



@dashboard_bp.get("/api/dashboard/hospital-summary")
@require_permissions("patients.read")
def dashboard_hospital_summary():
    return jsonify(get_hospital_dashboard_summary())


