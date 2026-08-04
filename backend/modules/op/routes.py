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
    require_session,
    log_audit_event,
    validate_required_fields,
    current_hospital_id,
    row_to_dict,
    rows_to_dicts,
)

from utils.database import (
    create_doctor_schedule,
    delete_doctor_schedule,
    get_op_summary,
    list_doctor_schedules,
    update_doctor_schedule,
    create_doctor,
    list_doctors,
    update_doctor,
    delete_doctor,
    get_suggested_doctors,
)

op_bp = Blueprint("op", __name__)


@op_bp.get("/api/op/summary")
@require_permissions("op.read")
def op_summary():
    target_date = request.args.get("date")
    return jsonify(get_op_summary(target_date, hospital_id=current_hospital_id()))


@op_bp.get("/api/op/doctor-schedules")
@require_permissions("op.read")
def op_doctor_schedules_list():
    schedule_date = request.args.get("date")
    doctor_name = request.args.get("doctor_name")
    return jsonify(
        {
            "schedules": rows_to_dicts(
                list_doctor_schedules(
                    schedule_date=schedule_date, doctor_name=doctor_name
                )
            )
        }
    )


@op_bp.post("/api/op/doctor-schedules")
@require_permissions("op.schedules.write")
def op_doctor_schedules_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["doctor_name", "schedule_date", "start_time", "end_time"]
    )
    if validation_error:
        return validation_error
    schedule_id = create_doctor_schedule(payload)
    log_audit_event(
        "create",
        "doctor_schedules",
        str(schedule_id),
        {"doctor_name": payload.get("doctor_name")},
    )
    return jsonify({"schedule_id": schedule_id})


@op_bp.put("/api/op/doctor-schedules/<int:schedule_id>")
@require_permissions("op.schedules.write")
def op_doctor_schedules_update(schedule_id):
    payload = request.get_json(force=True)
    updated = update_doctor_schedule(schedule_id, payload)
    if not updated:
        return jsonify({"error": "Doctor schedule not found"}), 404
    log_audit_event(
        "update",
        "doctor_schedules",
        str(schedule_id),
        {"schedule_id": schedule_id},
    )
    return jsonify({"status": "ok"})


@op_bp.delete("/api/op/doctor-schedules/<int:schedule_id>")
@require_permissions("op.schedules.write")
def op_doctor_schedules_delete(schedule_id):
    deleted = delete_doctor_schedule(schedule_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Doctor schedule not found"}), 404
    log_audit_event(
        "delete",
        "doctor_schedules",
        str(schedule_id),
        {"schedule_id": schedule_id},
    )
    return jsonify({"status": "ok"})


@op_bp.get("/api/op/doctors")
@require_session
def op_doctors_list():
    department = request.args.get("department")
    return jsonify({"doctors": list_doctors(department=department)})


@op_bp.post("/api/op/doctors")
@require_permissions("op.doctors.write")
def op_doctors_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["doctor_name", "department"])
    if validation_error:
        return validation_error
    doctor_id = create_doctor(payload)
    log_audit_event(
        "create", "doctors", str(doctor_id), {"doctor_name": payload.get("doctor_name")}
    )
    return jsonify({"doctor_id": doctor_id})


@op_bp.put("/api/op/doctors/<int:doctor_id>")
@require_permissions("op.doctors.write")
def op_doctors_update(doctor_id):
    payload = request.get_json(force=True)
    updated = update_doctor(doctor_id, payload)
    if not updated:
        return jsonify({"error": "Doctor not found"}), 404
    log_audit_event("update", "doctors", str(doctor_id), {"doctor_id": doctor_id})
    return jsonify({"status": "ok"})


@op_bp.delete("/api/op/doctors/<int:doctor_id>")
@require_permissions("op.doctors.write")
def op_doctors_delete(doctor_id):
    deleted = delete_doctor(doctor_id)
    if not deleted:
        return jsonify({"error": "Doctor not found"}), 404
    log_audit_event("delete", "doctors", str(doctor_id), {"doctor_id": doctor_id})
    return jsonify({"status": "ok"})


@op_bp.get("/api/op/doctors/suggest")
@require_session
def op_doctors_suggest():
    department = request.args.get("department")
    region = request.args.get("region")
    doctors = get_suggested_doctors(department=department, region=region)
    return jsonify({"doctors": doctors, "suggested_department": department or region})
