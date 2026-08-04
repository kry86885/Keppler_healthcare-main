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

from utils.database import (
    create_account_ledger_entry,
    create_doctor_payout,
    create_vendor_payment,
    delete_account_ledger_entry,
    delete_doctor_payout,
    delete_vendor_payment,
    get_accounts_summary,
    list_account_ledger_entries,
    list_doctor_payouts,
    list_vendor_payments,
    update_account_ledger_entry,
    update_doctor_payout,
    update_vendor_payment,
)

accounts_bp = Blueprint("accounts", __name__)


@accounts_bp.get("/api/accounts/summary")
@require_permissions("accounts.read")
def accounts_summary():
    return jsonify(get_accounts_summary())


@accounts_bp.get("/api/accounts/ledger")
@require_permissions("accounts.read")
def accounts_ledger_list():
    entry_type = request.args.get("entry_type")
    return jsonify(
        {"entries": rows_to_dicts(list_account_ledger_entries(entry_type=entry_type))}
    )


@accounts_bp.post("/api/accounts/ledger")
@require_permissions("accounts.ledger.write")
def accounts_ledger_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["entry_date", "entry_type", "category", "amount"]
    )
    if validation_error:
        return validation_error
    entry_id = create_account_ledger_entry(payload)
    log_audit_event(
        "create",
        "accounts_ledger",
        str(entry_id),
        {"category": payload.get("category")},
    )
    return jsonify({"entry_id": entry_id})


@accounts_bp.put("/api/accounts/ledger/<int:entry_id>")
@require_permissions("accounts.ledger.write")
def accounts_ledger_update(entry_id):
    payload = request.get_json(force=True)
    updated = update_account_ledger_entry(entry_id, payload)
    if not updated:
        return jsonify({"error": "Ledger entry not found"}), 404
    log_audit_event("update", "accounts_ledger", str(entry_id), {"entry_id": entry_id})
    return jsonify({"status": "ok"})


@accounts_bp.delete("/api/accounts/ledger/<int:entry_id>")
@require_permissions("accounts.ledger.write")
def accounts_ledger_delete(entry_id):
    deleted = delete_account_ledger_entry(
        entry_id, actor=g.current_user.get("username")
    )
    if not deleted:
        return jsonify({"error": "Ledger entry not found"}), 404
    log_audit_event("delete", "accounts_ledger", str(entry_id), {"entry_id": entry_id})
    return jsonify({"status": "ok"})


@accounts_bp.get("/api/accounts/vendors")
@require_permissions("accounts.read")
def accounts_vendor_payments_list():
    vendor_name = request.args.get("vendor_name")
    return jsonify(
        {"payments": rows_to_dicts(list_vendor_payments(vendor_name=vendor_name))}
    )


@accounts_bp.post("/api/accounts/vendors")
@require_permissions("accounts.vendors.write")
def accounts_vendor_payments_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["vendor_name", "amount", "payment_date"]
    )
    if validation_error:
        return validation_error
    payment_id = create_vendor_payment(payload)
    log_audit_event(
        "create",
        "vendor_payments",
        str(payment_id),
        {"vendor_name": payload.get("vendor_name")},
    )
    return jsonify({"payment_id": payment_id})


@accounts_bp.put("/api/accounts/vendors/<int:payment_id>")
@require_permissions("accounts.vendors.write")
def accounts_vendor_payments_update(payment_id):
    payload = request.get_json(force=True)
    updated = update_vendor_payment(payment_id, payload)
    if not updated:
        return jsonify({"error": "Vendor payment not found"}), 404
    log_audit_event(
        "update", "vendor_payments", str(payment_id), {"payment_id": payment_id}
    )
    return jsonify({"status": "ok"})


@accounts_bp.delete("/api/accounts/vendors/<int:payment_id>")
@require_permissions("accounts.vendors.write")
def accounts_vendor_payments_delete(payment_id):
    deleted = delete_vendor_payment(payment_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Vendor payment not found"}), 404
    log_audit_event(
        "delete", "vendor_payments", str(payment_id), {"payment_id": payment_id}
    )
    return jsonify({"status": "ok"})


@accounts_bp.get("/api/accounts/doctors")
@require_permissions("accounts.read")
def accounts_doctor_payouts_list():
    doctor_name = request.args.get("doctor_name")
    return jsonify(
        {"payouts": rows_to_dicts(list_doctor_payouts(doctor_name=doctor_name))}
    )


@accounts_bp.post("/api/accounts/doctors")
@require_permissions("accounts.doctors.write")
def accounts_doctor_payouts_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["doctor_name", "payout_month", "amount"]
    )
    if validation_error:
        return validation_error
    payout_id = create_doctor_payout(payload)
    log_audit_event(
        "create",
        "doctor_payouts",
        str(payout_id),
        {"doctor_name": payload.get("doctor_name")},
    )
    return jsonify({"payout_id": payout_id})


@accounts_bp.put("/api/accounts/doctors/<int:payout_id>")
@require_permissions("accounts.doctors.write")
def accounts_doctor_payouts_update(payout_id):
    payload = request.get_json(force=True)
    updated = update_doctor_payout(payout_id, payload)
    if not updated:
        return jsonify({"error": "Doctor payout not found"}), 404
    log_audit_event(
        "update", "doctor_payouts", str(payout_id), {"payout_id": payout_id}
    )
    return jsonify({"status": "ok"})


@accounts_bp.delete("/api/accounts/doctors/<int:payout_id>")
@require_permissions("accounts.doctors.write")
def accounts_doctor_payouts_delete(payout_id):
    deleted = delete_doctor_payout(payout_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Doctor payout not found"}), 404
    log_audit_event(
        "delete", "doctor_payouts", str(payout_id), {"payout_id": payout_id}
    )
    return jsonify({"status": "ok"})
