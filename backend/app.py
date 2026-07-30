from __future__ import annotations
import os
import sys
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

if __name__ == "__main__":
    # Blueprint modules do `from app import (...)`. When this file is executed directly
    # (`python app.py`), Python registers it as `__main__`, not `app`, so that internal
    # import re-executes this whole module under a second identity and crashes with a
    # circular-import error. Aliasing `app` to the in-progress `__main__` module here
    # (before the blueprint imports further down trigger) makes both names resolve to
    # the same module object, matching how it already works when imported as `import app`.
    sys.modules.setdefault("app", sys.modules[__name__])

import csv
import io
import json
import os
import re
import base64
import hashlib
import hmac
from datetime import datetime
from functools import wraps
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import Flask, g, jsonify, request, send_file, make_response
from flask_cors import CORS
import secrets
from core.limiter import limiter
from core.auth import (
    ADMIN_ROUTE_AUTH_COOKIE_NAME,
    ADMIN_ROUTE_AUTH_TTL_SECONDS,
    ASSIGNABLE_MODULES,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    authenticate,
    check_username_exists,
    create_admin_route_auth_token,
    create_default_users,
    create_session,
    delete_session,
    get_session_user,
    is_admin_route_auth_configured,
    reset_hospital_admin_password,
    resolve_user_permissions,
    signup_employee,
    signup_hospital_admin,
    verify_admin_route_auth_token,
    verify_admin_route_password,
)
from core.export import generate_pdf, generate_word
from utils.ocr import LANGUAGE_NAMES
from core.storage import ObjectStorage
from ai.service import extract_text_from_image, classify_and_extract_entities, patient_history_search
from werkzeug.exceptions import BadRequest
from werkzeug.utils import secure_filename

from utils.database import (
    activate_employee,
    add_admission,
    add_audit_log,
    add_document,
    add_medication_schedule,
    add_observation_note,
    add_patient,
    add_patient_movement,
    assign_bed,
    check_duplicate_patient,
    create_account_ledger_entry,
    create_attendance,
    create_appointment,
    create_certificate,
    create_department,
    create_diagnostic_record,
    create_doctor_schedule,
    create_doctor_payout,
    create_encounter,
    create_hospital,
    create_insurance_verification,
    create_insurance_claim,
    create_invoice,
    create_lab_vendor,
    create_leave_request,
    create_ot_surgery,
    create_ot_theatre,
    create_patient_consent,
    create_payroll_record,
    create_pharmacy_purchase,
    create_pharmacy_sale,
    create_pharmacy_supplier,
    create_vendor_payment,
    current_ist_datetime,
    delete_account_ledger_entry,
    deactivate_employee,
    delete_attendance_record,
    delete_certificate,
    delete_department,
    delete_diagnostic_record,
    delete_doctor_schedule,
    delete_doctor_payout,
    delete_document,
    delete_employee,
    delete_insurance_claim,
    delete_inventory_item,
    delete_invoice,
    delete_lab_vendor,
    delete_leave_request,
    delete_ot_surgery,
    delete_ot_theatre,
    delete_patient,
    delete_payroll_record,
    delete_pharmacy_purchase,
    delete_pharmacy_supplier,
    delete_vendor_payment,
    generate_patient_id,
    get_admissions,
    get_accounts_summary,
    get_all_employees,
    get_all_patients,
    get_audit_logs,
    get_dashboard_analytics,
    get_diagnostic_summary,
    get_document,
    get_documents,
    get_employee,
    get_employee_stats,
    get_hospital_by_code,
    get_hospital_dashboard_summary,
    get_invoice_by_id,
    get_op_summary,
    get_ot_summary,
    get_patient,
    get_patient_stats,
    get_pharmacy_summary,
    get_reports_overview,
    get_revenue_summary,
    init_database,
    list_account_ledger_entries,
    list_attendance,
    list_appointments,
    list_bed_allocations,
    list_certificates,
    list_departments,
    list_diagnostics,
    list_doctor_schedules,
    list_doctor_payouts,
    list_insurance_claims,
    list_insurance_verifications,
    list_pharmacy_purchases,
    list_pharmacy_sales,
    list_pharmacy_suppliers,
    list_encounters,
    list_hospitals,
    list_inventory_items,
    list_invoices,
    list_lab_vendors,
    list_leave_requests,
    list_medication_schedules,
    list_observation_notes,
    list_ot_surgeries,
    list_ot_theatres,
    list_patient_consents,
    list_patient_movements,
    list_payroll,
    list_vendor_payments,
    record_invoice_payment,
    resolve_hospital_id,
    search_employees,
    search_patients,
    set_hospital_status,
    update_account_ledger_entry,
    update_attendance_record,
    update_appointment,
    update_department,
    update_diagnostic_record,
    update_doctor_schedule,
    update_doctor_payout,
    update_document_ocr,
    update_employee,
    update_insurance_verification,
    update_insurance_claim,
    update_invoice,
    update_lab_vendor,
    update_leave_status,
    update_ot_surgery,
    update_ot_theatre,
    update_patient_consent,
    update_patient,
    update_payroll_record,
    update_pharmacy_purchase,
    update_pharmacy_supplier,
    update_vendor_payment,
    upsert_inventory_item,
)

BASE_DIR = os.path.dirname(__file__)
STORAGE = ObjectStorage()

from core.celery_app import celery_init_app

app = Flask(__name__)
limiter.init_app(app)
celery = celery_init_app(app)
default_allowed_origins = {
    "https://app.hospai.ai",
    "https://staging-app.hospai.ai",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
env_allowed_origins = {
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}
is_development = os.getenv("FLASK_ENV", "").lower() == "development"
ALLOWED_ORIGINS = set(default_allowed_origins)
ALLOWED_ORIGINS.update(env_allowed_origins)


def is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    # Allow all HospAI HTTPS subdomains (staging/prod/custom app surfaces).
    if re.match(r"^https://([a-z0-9-]+\.)*hospai\.ai$", origin):
        return True
    # Allow localhost dev servers on any port (e.g. Vite 5173/5174/4173).
    return re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin) is not None


CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                r"^https://([a-z0-9-]+\.)*hospai\.ai$",
                r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
                *sorted(ALLOWED_ORIGINS),
            ]
        }
    },
    supports_credentials=True,
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Hospital-Code",
        "X-CSRF-Token",
        "X-Platform-Admin-Username",
        "X-Platform-Admin-Password",
    ],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)


CSRF_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/setup-admin"}


@app.before_request
def csrf_protect():
    if app.config.get("TESTING"):
        return
    if request.path in CSRF_EXEMPT_PATHS:
        # These establish a session rather than act within one, so a stale/leftover session
        # cookie from an earlier login (cookies aren't port-scoped, so this happens easily
        # across local dev restarts on different ports) must never block a fresh login.
        return
    if request.method not in ["GET", "HEAD", "OPTIONS", "TRACE"]:
        # Only enforce CSRF if a session cookie is present (public endpoints/webhooks don't use cookies).
        if SESSION_COOKIE_NAME in request.cookies or ADMIN_ROUTE_AUTH_COOKIE_NAME in request.cookies:
            token = request.cookies.get("csrf_token")
            header_token = request.headers.get("X-CSRF-Token")
            if not token or not header_token or not hmac.compare_digest(token, header_token):
                return jsonify({"error": "CSRF token missing or incorrect"}), 403

@app.after_request
def security_headers(response):
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    
    # Set CSRF cookie if not present
    if "csrf_token" not in request.cookies:
        response.set_cookie(
            "csrf_token",
            secrets.token_hex(32),
            secure=True,
            httponly=False,  # Must be readable by frontend JS
            samesite="Strict",
        )
    return response


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if is_allowed_origin(origin):
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With, X-Hospital-Code, X-CSRF-Token, X-Platform-Admin-Username, X-Platform-Admin-Password",
        )
        response.headers.setdefault(
            "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"
        )
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def preflight(_path):
    return ("", 204)


init_database()
create_default_users()


def row_to_dict(row):
    if row is None:
        return None
    data = dict(row)
    module_access = data.get("module_access")
    if isinstance(module_access, str):
        try:
            parsed = json.loads(module_access)
            if isinstance(parsed, list):
                data["module_access"] = parsed
        except json.JSONDecodeError:
            data["module_access"] = []
    return data


def rows_to_dicts(rows):
    return [row_to_dict(row) for row in rows]


RAZORPAY_KEY_ID = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
RAZORPAY_KEY_SECRET = (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()
RAZORPAY_API_BASE = "https://api.razorpay.com/v1"


def validate_hospital_code(value: str) -> str:
    code = (value or "").strip().lower()
    if not code:
        raise BadRequest("hospital_code is required")
    if not re.fullmatch(r"[a-z0-9-]{3,64}", code):
        raise BadRequest("hospital_code must contain only lowercase letters, numbers, and '-'")
    return code


def request_hospital_id() -> int:
    requested_code = request.headers.get("X-Hospital-Code", "")
    try:
        code = validate_hospital_code(requested_code) if requested_code else None
    except BadRequest:
        code = None
    return resolve_hospital_id(code)


def current_hospital_id() -> int:
    user = getattr(g, "current_user", None) or {}
    return int(user.get("hospital_id") or request_hospital_id())


def require_platform_admin():
    configured_username = (os.getenv("PLATFORM_ADMIN_USERNAME") or "").strip()
    configured_password = (os.getenv("PLATFORM_ADMIN_PASSWORD") or "").strip()
    if not configured_username or not configured_password:
        return jsonify({"error": "Platform admin credentials are not configured"}), 503
    username = (
        request.headers.get("X-Platform-Admin-Username")
        or request.args.get("platform_admin_username")
        or (request.get_json(silent=True) or {}).get("platform_admin_username")
        or ""
    ).strip()
    password = (
        request.headers.get("X-Platform-Admin-Password")
        or request.args.get("platform_admin_password")
        or (request.get_json(silent=True) or {}).get("platform_admin_password")
        or ""
    )
    if username != configured_username or password != configured_password:
        return jsonify({"error": "Platform admin authentication failed"}), 403
    return None


def _session_cookie_settings():
    secure_cookie = (
        request.is_secure or os.getenv("SESSION_COOKIE_SECURE", "").lower() == "true"
    )
    same_site = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    if same_site not in ("Lax", "Strict", "None"):
        same_site = "Lax"
    return {
        "httponly": True,
        "secure": secure_cookie,
        "samesite": same_site,
        "path": "/",
        "max_age": SESSION_TTL_SECONDS,
    }


def require_session(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(SESSION_COOKIE_NAME)
        user = get_session_user(token)
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        g.current_user = user
        return view(*args, **kwargs)

    return wrapper


def require_permissions(*required_permissions):
    def decorator(view):
        @wraps(view)
        @require_session
        def wrapper(*args, **kwargs):
            user_permissions = resolve_user_permissions(g.current_user)
            if not all(
                permission in user_permissions for permission in required_permissions
            ):
                return (
                    jsonify(
                        {
                            "error": "Forbidden",
                            "required_permissions": list(required_permissions),
                        }
                    ),
                    403,
                )
            return view(*args, **kwargs)

        return wrapper

    return decorator


def save_uploaded_file(uploaded_file, file_bytes, doc_type):
    original_name = secure_filename(uploaded_file.filename or "") or "document"
    return STORAGE.store(doc_type, original_name, file_bytes, uploaded_file.mimetype)


def log_audit_event(action, module_name, entity_key=None, payload=None):
    actor = (getattr(g, "current_user", None) or {}).get("username")
    serialized_payload = None
    if payload is not None:
        try:
            serialized_payload = json.dumps(payload, separators=(",", ":"), default=str)
        except Exception:
            serialized_payload = str(payload)
    add_audit_log(
        {
            "actor_username": actor,
            "action": action,
            "module_name": module_name,
            "entity_key": entity_key,
            "payload": serialized_payload,
            "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
        }
    )


def validate_required_fields(payload, fields):
    missing = [field for field in fields if payload.get(field) in (None, "")]
    if missing:
        return jsonify({"error": "Missing required fields", "missing": missing}), 400
    return None


def is_razorpay_configured():
    return bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)


def require_razorpay_configured():
    if is_razorpay_configured():
        return None
    return jsonify({"error": "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."}), 503


def to_amount_paise(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    return int(round(amount * 100))


def _razorpay_auth_header():
    encoded = base64.b64encode(f"{RAZORPAY_KEY_ID}:{RAZORPAY_KEY_SECRET}".encode("utf-8")).decode("ascii")
    return f"Basic {encoded}"


def create_razorpay_order(amount_paise, currency="INR", receipt=None, notes=None):
    payload = {
        "amount": int(amount_paise),
        "currency": currency or "INR",
    }
    if receipt:
        payload["receipt"] = str(receipt)
    if isinstance(notes, dict) and notes:
        payload["notes"] = notes

    req = urllib_request.Request(
        f"{RAZORPAY_API_BASE}/orders",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": _razorpay_auth_header(),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {}
        message = (
            payload.get("error", {}).get("description")
            or payload.get("error", {}).get("code")
            or body
            or "Razorpay order creation failed."
        )
        raise RuntimeError(message) from exc
    except Exception as exc:
        raise RuntimeError("Unable to reach Razorpay.") from exc


def verify_razorpay_signature(order_id, payment_id, signature):
    signed_payload = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, str(signature or ""))


def normalize_payment_mode(value):
    allowed_modes = {"cash", "card", "upi", "bank"}
    mode = (value or "").strip().lower()
    return mode if mode in allowed_modes else "upi"


def normalize_department_name(value):
    normalized = " ".join(str(value or "").strip().split())
    if not normalized:
        raise BadRequest("department_name is required")
    if len(normalized) > 120:
        raise BadRequest("department_name must be at most 120 characters")
    return normalized


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/payments/razorpay/config")
def razorpay_config():
    return jsonify(
        {
            "configured": is_razorpay_configured(),
            "key_id": RAZORPAY_KEY_ID if is_razorpay_configured() else "",
        }
    )


def require_admin_route_auth(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(ADMIN_ROUTE_AUTH_COOKIE_NAME)
        if not verify_admin_route_auth_token(token):
            return jsonify({"error": "Admin route authentication required"}), 403
        return view(*args, **kwargs)

    return wrapper


@app.get("/api/languages")
def languages():
    return jsonify({"languages": LANGUAGE_NAMES})


def build_reports_export_text(overview):
    lines = [
        "# HospAI Reports Overview",
        "",
        "## Financial Summary",
        f"- Total billed: INR {overview['billing_summary']['total_billed']:.2f}",
        f"- Total collected: INR {overview['billing_summary']['total_collected']:.2f}",
        f"- Total due: INR {overview['billing_summary']['total_due']:.2f}",
        f"- Net position: INR {overview['accounts_summary']['net_position']:.2f}",
        "",
        "## Operations",
        f"- Monthly OP: {overview['hospital_summary']['ip_op_counts']['monthly_op']}",
        f"- Monthly IP: {overview['hospital_summary']['ip_op_counts']['monthly_ip']}",
        f"- Average LOS: {overview['alos_summary']['average_los_days']} days",
        f"- Admissions counted: {overview['alos_summary']['admission_count']}",
        "",
        "## Clinic Income",
    ]

    for row in overview.get("clinic_income", []):
        lines.append(f"- {row['label']}: INR {float(row['count']):.2f}")

    lines.extend(["", "## Discounts by Module"])
    for row in overview.get("discount_by_module", []):
        lines.append(f"- {row['label']}: INR {float(row['count']):.2f}")

    lines.extend(["", "## Payment Status"])
    for row in overview.get("payment_status_breakdown", []):
        lines.append(f"- {row['label']}: {row['count']} invoice(s)")

    return "\n".join(lines)


# ==================== Employee Management ====================


# ==================== Extended Patient Management ====================


# ==================== Billing ====================


# ==================== Pharmacy ====================


# ==================== Lab & Diagnostics ====================


# ==================== OT ====================


# ==================== Accounts ====================


# ==================== HRMS ====================


# ==================== Audit ====================


from modules.reports.routes import reports_bp
app.register_blueprint(reports_bp)
from modules.dashboard.routes import dashboard_bp
app.register_blueprint(dashboard_bp)
from modules.op.routes import op_bp
app.register_blueprint(op_bp)
from modules.documents.routes import documents_bp
app.register_blueprint(documents_bp)
from modules.ai_exports.routes import ai_exports_bp
app.register_blueprint(ai_exports_bp)
from modules.ot.routes import ot_bp
app.register_blueprint(ot_bp)
from modules.accounts.routes import accounts_bp
app.register_blueprint(accounts_bp)

from modules.auth.routes import auth_bp
app.register_blueprint(auth_bp)

from modules.admin.routes import admin_bp
app.register_blueprint(admin_bp)

from modules.patients.routes import patients_bp
app.register_blueprint(patients_bp)

from modules.appointments.routes import appointments_bp
app.register_blueprint(appointments_bp)

from modules.billing.routes import billing_bp
app.register_blueprint(billing_bp)

from modules.pharmacy.routes import pharmacy_bp
app.register_blueprint(pharmacy_bp)

from modules.diagnostics.routes import diagnostics_bp
app.register_blueprint(diagnostics_bp)

from modules.hr.routes import hr_bp
app.register_blueprint(hr_bp)

from modules.emergency.routes import bp as emergency_bp
app.register_blueprint(emergency_bp)

from modules.icu.routes import bp as icu_bp
app.register_blueprint(icu_bp)

from modules.ambulance.routes import bp as ambulance_bp
app.register_blueprint(ambulance_bp)

from modules.nurse.routes import bp as nurse_bp
app.register_blueprint(nurse_bp)

from modules.queue.routes import bp as queue_bp
app.register_blueprint(queue_bp)

from modules.beds.routes import bp as beds_bp
app.register_blueprint(beds_bp)

from modules.symptom_ai.routes import symptom_ai_bp
app.register_blueprint(symptom_ai_bp)

from modules.ocr_portal.routes import ocr_portal_bp
app.register_blueprint(ocr_portal_bp)

from modules.whatsapp.routes import whatsapp_bp
app.register_blueprint(whatsapp_bp)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)


