from flask import Blueprint, request, jsonify, g
from datetime import datetime
import app

from app import (
    require_permissions, 
    log_audit_event, 
    validate_required_fields, 
    rows_to_dicts, 
    to_amount_paise, 
    create_razorpay_order, 
    require_razorpay_configured, 
    current_hospital_id, 
    RAZORPAY_KEY_ID,
    normalize_payment_mode
)

from utils.database import (
    list_appointments,
    create_appointment,
    update_appointment,
    create_invoice,
    record_invoice_payment
)

appointments_bp = Blueprint('appointments', __name__)

# NOTE: Add your utils.database imports here after extraction.

@appointments_bp.get("/api/appointments")
@require_permissions("patients.read")
def appointments_list():
    appointment_date = request.args.get("date")
    status = request.args.get("status")
    visit_type = request.args.get("visit_type")
    doctor_name = request.args.get("doctor_name")
    patient_id = request.args.get("patient_id")
    return jsonify(
        {
            "appointments": rows_to_dicts(
                list_appointments(
                    appointment_date=appointment_date,
                    status=status,
                    visit_type=visit_type,
                    doctor_name=doctor_name,
                    patient_id=patient_id,
                    hospital_id=current_hospital_id(),
                )
            )
        }
    )



@appointments_bp.post("/api/appointments")
@require_permissions("patients.write")
def appointments_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["patient_name", "visit_type", "appointment_date"]
    )
    if validation_error:
        return validation_error
    appointment_id, token_no = create_appointment(payload, hospital_id=current_hospital_id())
    log_audit_event(
        "create",
        "appointments",
        str(appointment_id),
        {"patient_name": payload.get("patient_name"), "token_no": token_no},
    )
    return jsonify({"appointment_id": appointment_id, "token_no": token_no})



@appointments_bp.put("/api/appointments/<int:appointment_id>")
@require_permissions("patients.write")
def appointments_update(appointment_id):
    payload = request.get_json(force=True)
    updated = update_appointment(appointment_id, payload)
    if not updated:
        return jsonify({"error": "Appointment not found"}), 404
    log_audit_event(
        "update",
        "appointments",
        str(appointment_id),
        {"status": payload.get("status")},
    )
    return jsonify({"status": "ok"})



@appointments_bp.post("/api/appointments/razorpay/order")
@require_permissions("patients.write")
def appointments_razorpay_order():
    config_error = require_razorpay_configured()
    if config_error:
        return config_error
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["amount"])
    if validation_error:
        return validation_error

    amount_paise = to_amount_paise(payload.get("amount"))
    if amount_paise is None:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    receipt = payload.get("receipt") or f"appt-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    notes = payload.get("notes") if isinstance(payload.get("notes"), dict) else {}
    notes = {
        **notes,
        "hospital_id": str(current_hospital_id()),
        "created_by": g.current_user.get("username") or "",
    }
    try:
        order = create_razorpay_order(
            amount_paise=amount_paise,
            currency=payload.get("currency", "INR"),
            receipt=receipt,
            notes=notes,
        )
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502

    return jsonify(
        {
            "key_id": RAZORPAY_KEY_ID,
            "order_id": order.get("id"),
            "amount": order.get("amount"),
            "currency": order.get("currency"),
            "receipt": order.get("receipt"),
        }
    )



@appointments_bp.post("/api/appointments/razorpay/verify")
@require_permissions("patients.write")
def appointments_razorpay_verify():
    config_error = require_razorpay_configured()
    if config_error:
        return config_error
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload,
        [
            "razorpay_order_id",
            "razorpay_payment_id",
            "razorpay_signature",
            "amount",
            "appointment",
        ],
    )
    if validation_error:
        return validation_error

    if not app.verify_razorpay_signature(
        payload.get("razorpay_order_id"),
        payload.get("razorpay_payment_id"),
        payload.get("razorpay_signature"),
    ):
        return jsonify({"error": "Invalid Razorpay signature."}), 400

    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    appointment_payload = payload.get("appointment")
    if not isinstance(appointment_payload, dict):
        return jsonify({"error": "appointment must be an object."}), 400

    appointment_validation = validate_required_fields(
        appointment_payload, ["patient_name", "visit_type", "appointment_date"]
    )
    if appointment_validation:
        return appointment_validation

    appointment_id, token_no = create_appointment(
        {
            "patient_id": appointment_payload.get("patient_id"),
            "patient_name": appointment_payload.get("patient_name"),
            "visit_type": appointment_payload.get("visit_type", "OP"),
            "department": appointment_payload.get("department"),
            "doctor_name": appointment_payload.get("doctor_name"),
            "appointment_date": appointment_payload.get("appointment_date"),
            "status": appointment_payload.get("status", "scheduled"),
            "appointment_kind": appointment_payload.get("appointment_kind", "new"),
            "follow_up_for": appointment_payload.get("follow_up_for"),
            "notes": appointment_payload.get("notes"),
        },
        hospital_id=current_hospital_id(),
    )
    invoice_no = f"INV-OP-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    invoice_id = create_invoice(
        {
            "invoice_no": invoice_no,
            "patient_id": appointment_payload.get("patient_id"),
            "module": "OP",
            "doctor_name": appointment_payload.get("doctor_name"),
            "total_amount": amount,
            "paid_amount": 0,
            "advance_amount": 0,
            "refunded_amount": 0,
            "payment_status": "due",
            "created_by": g.current_user.get("username"),
        },
        hospital_id=current_hospital_id(),
    )
    payment_mode = normalize_payment_mode(payload.get("payment_mode"))
    payment_id = record_invoice_payment(
        invoice_id,
        {
            "amount": amount,
            "payment_mode": payment_mode,
            "gateway_ref": payload.get("razorpay_payment_id"),
            "converted_from_mode": payload.get("converted_from_mode"),
            "converted_to_mode": payload.get("converted_to_mode"),
        },
    )
    log_audit_event(
        "create",
        "appointments",
        str(appointment_id),
        {
            "patient_name": appointment_payload.get("patient_name"),
            "token_no": token_no,
            "invoice_id": invoice_id,
            "invoice_payment_id": payment_id,
            "gateway_ref": payload.get("razorpay_payment_id"),
        },
    )
    return jsonify(
        {
            "appointment_id": appointment_id,
            "token_no": token_no,
            "invoice_id": invoice_id,
            "payment_id": payment_id,
        }
    )


