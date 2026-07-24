from flask import Blueprint, request, jsonify, g
from app import (
    require_permissions, log_audit_event, rows_to_dicts, validate_required_fields
)
from utils.database import (
    list_lab_vendors, create_lab_vendor, update_lab_vendor, delete_lab_vendor, list_diagnostics,
    create_diagnostic_record, update_diagnostic_record, delete_diagnostic_record, get_diagnostic_summary
)

diagnostics_bp = Blueprint('diagnostics', __name__)

@diagnostics_bp.get("/api/lab/vendors")
@require_permissions("lab.read")
def lab_vendors_list():
    return jsonify({"vendors": rows_to_dicts(list_lab_vendors())})



@diagnostics_bp.post("/api/lab/vendors")
@require_permissions("lab.write")
def lab_vendors_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["vendor_name"])
    if validation_error:
        return validation_error
    vendor_id = create_lab_vendor(payload)
    log_audit_event(
        "create",
        "lab_vendors",
        str(vendor_id),
        {"vendor_name": payload.get("vendor_name")},
    )
    return jsonify({"vendor_id": vendor_id})



@diagnostics_bp.put("/api/lab/vendors/<int:vendor_id>")
@require_permissions("lab.write")
def lab_vendors_update(vendor_id):
    payload = request.get_json(force=True)
    updated = update_lab_vendor(vendor_id, payload)
    if not updated:
        return jsonify({"error": "Vendor not found"}), 404
    log_audit_event("update", "lab_vendors", str(vendor_id), {"vendor_id": vendor_id})
    return jsonify({"status": "ok"})



@diagnostics_bp.delete("/api/lab/vendors/<int:vendor_id>")
@require_permissions("lab.write")
def lab_vendors_delete(vendor_id):
    deleted = delete_lab_vendor(vendor_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Vendor not found"}), 404
    log_audit_event("delete", "lab_vendors", str(vendor_id), {"vendor_id": vendor_id})
    return jsonify({"status": "ok"})



@diagnostics_bp.get("/api/lab/diagnostics")
@require_permissions("lab.read")
def lab_diagnostics_list():
    patient_id = request.args.get("patient_id")
    doctor_name = request.args.get("doctor_name")
    return jsonify(
        {
            "diagnostics": rows_to_dicts(
                list_diagnostics(patient_id=patient_id, doctor_name=doctor_name)
            )
        }
    )



@diagnostics_bp.post("/api/lab/diagnostics")
@require_permissions("lab.write")
def lab_diagnostics_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["test_name", "amount"])
    if validation_error:
        return validation_error
    diagnostic_id = create_diagnostic_record(payload)
    log_audit_event(
        "create",
        "diagnostics",
        str(diagnostic_id),
        {"test_name": payload.get("test_name")},
    )
    return jsonify({"diagnostic_id": diagnostic_id})



@diagnostics_bp.put("/api/lab/diagnostics/<int:diagnostic_id>")
@require_permissions("lab.write")
def lab_diagnostics_update(diagnostic_id):
    payload = request.get_json(force=True)
    updated = update_diagnostic_record(diagnostic_id, payload)
    if not updated:
        return jsonify({"error": "Diagnostic record not found"}), 404
    log_audit_event(
        "update", "diagnostics", str(diagnostic_id), {"diagnostic_id": diagnostic_id}
    )
    return jsonify({"status": "ok"})



@diagnostics_bp.delete("/api/lab/diagnostics/<int:diagnostic_id>")
@require_permissions("lab.write")
def lab_diagnostics_delete(diagnostic_id):
    deleted = delete_diagnostic_record(diagnostic_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Diagnostic record not found"}), 404
    log_audit_event(
        "delete", "diagnostics", str(diagnostic_id), {"diagnostic_id": diagnostic_id}
    )
    return jsonify({"status": "ok"})



@diagnostics_bp.get("/api/lab/summary")
@require_permissions("lab.read")
def lab_summary():
    return jsonify(get_diagnostic_summary())


