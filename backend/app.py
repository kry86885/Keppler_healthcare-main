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

from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from utils.auth import (
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
from utils.export import generate_pdf, generate_word
from utils.ocr import LANGUAGE_NAMES, extract_text_from_image
from utils.storage import ObjectStorage
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

app = Flask(__name__)
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
        "X-Platform-Admin-Username",
        "X-Platform-Admin-Password",
    ],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if is_allowed_origin(origin):
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With, X-Hospital-Code, X-Platform-Admin-Username, X-Platform-Admin-Password",
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


PLATFORM_ADMIN_USERNAME = (os.getenv("PLATFORM_ADMIN_USERNAME") or "").strip()
PLATFORM_ADMIN_PASSWORD = (os.getenv("PLATFORM_ADMIN_PASSWORD") or "").strip()
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
    if not PLATFORM_ADMIN_USERNAME or not PLATFORM_ADMIN_PASSWORD:
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
    if username != PLATFORM_ADMIN_USERNAME or password != PLATFORM_ADMIN_PASSWORD:
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


@app.route("/api/auth/login", methods=["POST", "OPTIONS"])
def login():
    if request.method == "OPTIONS":
        return ("", 204)
    payload = request.get_json(force=True)
    hospital_id = request_hospital_id()
    user = authenticate(
        payload.get("username", ""),
        payload.get("password", ""),
        hospital_id=hospital_id,
    )
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    if "error" in user:
        return jsonify(user), 403
    session_token, _expires_at = create_session(
        user_id=user["id"],
        hospital_id=user["hospital_id"],
        ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        user_agent=request.headers.get("User-Agent"),
    )
    response = jsonify({"user": {k: v for k, v in user.items() if k != "id"}})
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        SESSION_COOKIE_NAME, session_token, **_session_cookie_settings()
    )
    return response


@app.post("/api/auth/signup")
def signup():
    payload = request.get_json(force=True)
    result = signup_employee(payload, allow_admin_creation=False)
    status = 201 if result.get("success") else 400
    return jsonify(result), status


@app.get("/api/auth/check-username")
def check_username():
    username = request.args.get("username")
    if not username:
        return jsonify({"available": False, "error": "username required"}), 400
    available = not check_username_exists(username, hospital_id=request_hospital_id())
    return jsonify({"available": available})


@app.route("/api/auth/setup-admin", methods=["POST", "OPTIONS"])
def setup_hospital_admin():
    if request.method == "OPTIONS":
        return ("", 204)
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    hospital_id = request_hospital_id()
    payload = request.get_json(force=True)
    result = signup_hospital_admin(payload, hospital_id=hospital_id)
    if not result.get("success"):
        message = (result.get("message") or "").lower()
        status = 409 if "already configured" in message else 400
        return jsonify(result), status

    user = authenticate(
        payload.get("username", ""),
        payload.get("password", ""),
        hospital_id=hospital_id,
    )
    if not user:
        return jsonify(
            {"success": False, "message": "Admin created but automatic login failed."}
        ), 500

    session_token, _expires_at = create_session(
        user_id=user["id"],
        hospital_id=user["hospital_id"],
        ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        user_agent=request.headers.get("User-Agent"),
    )
    response = jsonify(
        {
            "success": True,
            "message": result["message"],
            "user": {k: v for k, v in user.items() if k != "id"},
        }
    )
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        SESSION_COOKIE_NAME, session_token, **_session_cookie_settings()
    )
    return response, 201


@app.get("/api/platform/hospitals")
def platform_hospitals_list():
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    hospitals = list_hospitals()
    return jsonify({"hospitals": rows_to_dicts(hospitals)})


@app.post("/api/platform/hospitals")
def platform_hospitals_create():
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    payload = request.get_json(force=True)
    hospital_code = validate_hospital_code(payload.get("hospital_code", ""))
    hospital_name = payload.get("name")
    hospital_id, created = create_hospital(hospital_code, hospital_name)
    hospital = get_hospital_by_code(hospital_code)
    status = 201 if created else 200
    return jsonify(
        {
            "created": created,
            "hospital_id": hospital_id,
            "hospital": row_to_dict(hospital),
        }
    ), status


@app.post("/api/platform/hospitals/<hospital_code>/disable")
def platform_hospital_disable(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    payload = request.get_json(silent=True) or {}
    code = validate_hospital_code(hospital_code)
    changed = set_hospital_status(code, "inactive", reason=payload.get("reason"))
    if not changed:
        return jsonify({"error": "Hospital not found"}), 404
    return jsonify(
        {"success": True, "hospital": row_to_dict(get_hospital_by_code(code))}
    )


@app.post("/api/platform/hospitals/<hospital_code>/enable")
def platform_hospital_enable(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    code = validate_hospital_code(hospital_code)
    changed = set_hospital_status(code, "active")
    if not changed:
        return jsonify({"error": "Hospital not found"}), 404
    return jsonify(
        {"success": True, "hospital": row_to_dict(get_hospital_by_code(code))}
    )


@app.post("/api/platform/hospitals/<hospital_code>/admin/reset-password")
def platform_admin_reset_password(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate

    code = validate_hospital_code(hospital_code)
    hospital = get_hospital_by_code(code)
    if not hospital:
        return jsonify({"error": "Hospital not found"}), 404

    payload = request.get_json(force=True)
    username = payload.get("username", "")
    new_password = payload.get("new_password", "")
    result = reset_hospital_admin_password(hospital["id"], username, new_password)
    status = 200 if result.get("success") else 400
    return jsonify(result), status


@app.get("/api/auth/session")
def auth_session():
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user = get_session_user(token)
    if not user:
        return jsonify({"error": "Authentication required"}), 401
    response = jsonify({"user": user})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/auth/logout")
def auth_logout():
    token = request.cookies.get(SESSION_COOKIE_NAME)
    delete_session(token)
    response = jsonify({"success": True})
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(ADMIN_ROUTE_AUTH_COOKIE_NAME, path="/")
    return response


def require_admin_route_auth(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(ADMIN_ROUTE_AUTH_COOKIE_NAME)
        if not verify_admin_route_auth_token(token):
            return jsonify({"error": "Admin route authentication required"}), 403
        return view(*args, **kwargs)

    return wrapper


@app.get("/api/admin/auth/session")
def admin_route_auth_session():
    token = request.cookies.get(ADMIN_ROUTE_AUTH_COOKIE_NAME)
    authorized = verify_admin_route_auth_token(token)
    return jsonify(
        {"authorized": authorized, "configured": is_admin_route_auth_configured()}
    )


@app.post("/api/admin/auth/login")
def admin_route_auth_login():
    if not is_admin_route_auth_configured():
        return jsonify(
            {"error": "ADMIN_ROUTE_PASSWORD is not configured on the server."}
        ), 503

    payload = request.get_json(force=True)
    password = payload.get("password", "")
    if not verify_admin_route_password(password):
        return jsonify({"error": "Invalid admin route password."}), 403

    token = create_admin_route_auth_token()
    response = jsonify({"success": True, "authorized": True})
    response.set_cookie(
        ADMIN_ROUTE_AUTH_COOKIE_NAME,
        token,
        httponly=True,
        secure=request.is_secure
        or os.getenv("SESSION_COOKIE_SECURE", "").lower() == "true",
        samesite=os.getenv("SESSION_COOKIE_SAMESITE", "Lax"),
        path="/",
        max_age=ADMIN_ROUTE_AUTH_TTL_SECONDS,
    )
    return response


@app.post("/api/admin/auth/logout")
def admin_route_auth_logout():
    response = jsonify({"success": True})
    response.delete_cookie(ADMIN_ROUTE_AUTH_COOKIE_NAME, path="/")
    return response


@app.post("/api/admin/create-account")
@require_admin_route_auth
def admin_create_account():
    payload = request.get_json(force=True) or {}
    forced_payload = {
        **payload,
        "user_type": "admin",
        "module_access": [
            "dashboard",
            "patients",
            "billing",
            "pharmacy",
            "lab",
            "hrms",
            "symptom_ai",
        ],
    }
    result = signup_employee(forced_payload, allow_admin_creation=True)
    status = 201 if result.get("success") else 400
    return jsonify(result), status


@app.get("/api/admin/users")
@require_admin_route_auth
def admin_users_list():
    return jsonify({"users": rows_to_dicts(get_all_employees())})


@app.post("/api/admin/users")
@require_admin_route_auth
def admin_users_create():
    payload = request.get_json(force=True) or {}
    requested_type = str(payload.get("user_type", "normal")).strip().lower()
    user_type = "admin" if requested_type == "admin" else "normal"
    module_access = (
        list(ASSIGNABLE_MODULES)
        if user_type == "admin"
        else payload.get("module_access", [])
    )

    created_payload = {
        **payload,
        "user_type": user_type,
        "module_access": module_access,
    }
    result = signup_employee(created_payload, allow_admin_creation=True)
    status = 201 if result.get("success") else 400
    return jsonify(result), status


@app.post("/api/admin/users/<employee_id>/promote")
@require_admin_route_auth
def admin_promote_user(employee_id):
    target = get_employee(employee_id=employee_id)
    if not target:
        return jsonify({"error": "Employee not found"}), 404

    promoted = update_employee(
        employee_id,
        {
            "user_type": "admin",
            "access_role": "owner",
            "module_access": list(ASSIGNABLE_MODULES),
        },
    )
    if not promoted:
        return jsonify({"error": "Employee not found"}), 404

    return jsonify({"success": True, "employee_id": employee_id, "user_type": "admin"})


@app.get("/api/languages")
def languages():
    return jsonify({"languages": LANGUAGE_NAMES})


@app.get("/api/reports/overview")
@require_permissions("reports.read")
def reports_overview():
    return jsonify(get_reports_overview())


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


@app.get("/api/reports/export/csv")
@require_permissions("reports.read")
def reports_export_csv():
    overview = get_reports_overview()
    csv_stream = io.StringIO()
    writer = csv.writer(csv_stream)
    writer.writerow(["section", "label", "value"])
    writer.writerow(["billing", "total_billed", overview["billing_summary"]["total_billed"]])
    writer.writerow(["billing", "total_collected", overview["billing_summary"]["total_collected"]])
    writer.writerow(["billing", "total_due", overview["billing_summary"]["total_due"]])
    writer.writerow(["accounts", "net_position", overview["accounts_summary"]["net_position"]])
    writer.writerow(["operations", "monthly_op", overview["hospital_summary"]["ip_op_counts"]["monthly_op"]])
    writer.writerow(["operations", "monthly_ip", overview["hospital_summary"]["ip_op_counts"]["monthly_ip"]])
    writer.writerow(["operations", "average_los_days", overview["alos_summary"]["average_los_days"]])
    for row in overview.get("clinic_income", []):
        writer.writerow(["clinic_income", row["label"], row["count"]])
    for row in overview.get("discount_by_module", []):
        writer.writerow(["discount_by_module", row["label"], row["count"]])
    for row in overview.get("payment_status_breakdown", []):
        writer.writerow(["payment_status", row["label"], row["count"]])

    payload = io.BytesIO(csv_stream.getvalue().encode("utf-8"))
    payload.seek(0)
    return send_file(
        payload,
        mimetype="text/csv",
        as_attachment=True,
        download_name="reports-overview.csv",
    )


@app.get("/api/reports/export/pdf")
@require_permissions("reports.read")
def reports_export_pdf():
    overview = get_reports_overview()
    pdf_bytes = generate_pdf(
        "Hospital Operations",
        "reports_overview",
        build_reports_export_text(overview),
        datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="reports-overview.pdf",
    )


@app.get("/api/reports/export/word")
@require_permissions("reports.read")
def reports_export_word():
    overview = get_reports_overview()
    word_bytes = generate_word(
        "Hospital Operations",
        "reports_overview",
        build_reports_export_text(overview),
        datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    return send_file(
        io.BytesIO(word_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name="reports-overview.docx",
    )


@app.get("/api/stats")
@require_permissions("patients.read")
def stats():
    return jsonify(get_patient_stats(hospital_id=current_hospital_id()))


@app.get("/api/dashboard/analytics")
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


@app.get("/api/dashboard/hospital-summary")
@require_permissions("patients.read")
def dashboard_hospital_summary():
    return jsonify(get_hospital_dashboard_summary())


@app.get("/api/patients")
@require_permissions("patients.read")
def patients_list():
    query = (request.args.get("q") or "").strip()
    hospital_id = current_hospital_id()
    patients = (
        search_patients(query, hospital_id=hospital_id)
        if query
        else get_all_patients(hospital_id=hospital_id)
    )
    return jsonify({"patients": rows_to_dicts(patients)})


@app.get("/api/appointments")
@require_permissions("patients.read")
def appointments_list():
    appointment_date = request.args.get("date")
    status = request.args.get("status")
    visit_type = request.args.get("visit_type")
    doctor_name = request.args.get("doctor_name")
    return jsonify(
        {
            "appointments": rows_to_dicts(
                list_appointments(
                    appointment_date=appointment_date,
                    status=status,
                    visit_type=visit_type,
                    doctor_name=doctor_name,
                )
            )
        }
    )


@app.post("/api/appointments")
@require_permissions("patients.write")
def appointments_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["patient_name", "visit_type", "appointment_date"]
    )
    if validation_error:
        return validation_error
    appointment_id, token_no = create_appointment(payload)
    log_audit_event(
        "create",
        "appointments",
        str(appointment_id),
        {"patient_name": payload.get("patient_name"), "token_no": token_no},
    )
    return jsonify({"appointment_id": appointment_id, "token_no": token_no})


@app.put("/api/appointments/<int:appointment_id>")
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


@app.post("/api/appointments/razorpay/order")
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


@app.post("/api/appointments/razorpay/verify")
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

    if not verify_razorpay_signature(
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
        }
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
        }
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


@app.get("/api/registration/departments")
@require_permissions("patients.read")
def registration_departments_list():
    return jsonify({"departments": rows_to_dicts(list_departments(hospital_id=current_hospital_id()))})


@app.post("/api/registration/departments")
@require_permissions("patients.write")
def registration_departments_create():
    payload = request.get_json(force=True)
    try:
        department_name = normalize_department_name(payload.get("department_name"))
    except BadRequest as error:
        return jsonify({"error": str(error)}), 400

    existing = next(
        (
            row
            for row in rows_to_dicts(list_departments(hospital_id=current_hospital_id()))
            if (row.get("department_name") or "").strip().lower() == department_name.lower()
        ),
        None,
    )
    if existing:
        return jsonify({"department_id": existing.get("id"), "department_name": existing.get("department_name"), "already_exists": True})

    department_id = create_department(
        {"department_name": department_name},
        hospital_id=current_hospital_id(),
    )
    log_audit_event(
        "create",
        "departments",
        str(department_id),
        {"department_name": department_name},
    )
    return jsonify({"department_id": department_id})


@app.get("/api/registration/consents")
@require_permissions("patients.read")
def registration_consents_list():
    patient_id = request.args.get("patient_id")
    return jsonify({"consents": rows_to_dicts(list_patient_consents(patient_id=patient_id))})


@app.post("/api/registration/consents")
@require_permissions("patients.write")
def registration_consents_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["patient_name", "consent_type", "signed_by"])
    if validation_error:
        return validation_error
    consent_id = create_patient_consent(payload)
    log_audit_event("create", "patient_consents", str(consent_id), {"patient_name": payload.get("patient_name")})
    return jsonify({"consent_id": consent_id})


@app.put("/api/registration/consents/<int:consent_id>")
@require_permissions("patients.write")
def registration_consents_update(consent_id):
    payload = request.get_json(force=True)
    updated = update_patient_consent(consent_id, payload)
    if not updated:
        return jsonify({"error": "Consent not found"}), 404
    log_audit_event("update", "patient_consents", str(consent_id), {"consent_id": consent_id})
    return jsonify({"status": "ok"})


@app.get("/api/registration/insurance")
@require_permissions("patients.read")
def registration_insurance_list():
    patient_id = request.args.get("patient_id")
    return jsonify({"verifications": rows_to_dicts(list_insurance_verifications(patient_id=patient_id))})


@app.post("/api/registration/insurance")
@require_permissions("patients.write")
def registration_insurance_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["patient_name", "insurer_name"])
    if validation_error:
        return validation_error
    verification_id = create_insurance_verification(payload)
    log_audit_event(
        "create",
        "insurance_verifications",
        str(verification_id),
        {"patient_name": payload.get("patient_name")},
    )
    return jsonify({"verification_id": verification_id})


@app.put("/api/registration/insurance/<int:verification_id>")
@require_permissions("patients.write")
def registration_insurance_update(verification_id):
    payload = request.get_json(force=True)
    updated = update_insurance_verification(verification_id, payload)
    if not updated:
        return jsonify({"error": "Insurance verification not found"}), 404
    log_audit_event(
        "update",
        "insurance_verifications",
        str(verification_id),
        {"verification_id": verification_id},
    )
    return jsonify({"status": "ok"})


@app.get("/api/op/summary")
@require_permissions("patients.read")
def op_summary():
    target_date = request.args.get("date")
    return jsonify(get_op_summary(target_date))


@app.get("/api/op/doctor-schedules")
@require_permissions("patients.read")
def op_doctor_schedules_list():
    schedule_date = request.args.get("date")
    doctor_name = request.args.get("doctor_name")
    return jsonify(
        {
            "schedules": rows_to_dicts(
                list_doctor_schedules(schedule_date=schedule_date, doctor_name=doctor_name)
            )
        }
    )


@app.post("/api/op/doctor-schedules")
@require_permissions("patients.write")
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


@app.put("/api/op/doctor-schedules/<int:schedule_id>")
@require_permissions("patients.write")
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


@app.delete("/api/op/doctor-schedules/<int:schedule_id>")
@require_permissions("patients.write")
def op_doctor_schedules_delete(schedule_id):
    deleted = delete_doctor_schedule(schedule_id)
    if not deleted:
        return jsonify({"error": "Doctor schedule not found"}), 404
    log_audit_event(
        "delete",
        "doctor_schedules",
        str(schedule_id),
        {"schedule_id": schedule_id},
    )
    return jsonify({"status": "ok"})


@app.get("/api/patients/next-id")
@require_permissions("patients.write")
def patients_next_id():
    return jsonify(
        {"patient_id": generate_patient_id(hospital_id=current_hospital_id())}
    )


@app.post("/api/patients")
@require_permissions("patients.write")
def patients_create():
    payload = request.get_json(force=True)
    hospital_id = current_hospital_id()
    patient_id = generate_patient_id(hospital_id=hospital_id)
    duplicate = check_duplicate_patient(
        payload.get("name"),
        payload.get("last_name"),
        payload.get("dob"),
        payload.get("phone"),
        hospital_id=hospital_id,
    )
    if duplicate:
        return (
            jsonify(
                {
                    "error": "Possible duplicate",
                    "duplicate": row_to_dict(duplicate),
                }
            ),
            409,
        )

    data = {
        "patient_id": patient_id,
        "name": payload.get("name"),
        "middle_name": payload.get("middle_name"),
        "last_name": payload.get("last_name"),
        "dob": payload.get("dob"),
        "age": payload.get("age"),
        "weight": payload.get("weight"),
        "height": payload.get("height"),
        "gender": payload.get("gender"),
        "pregnant": 1 if payload.get("pregnant") else 0,
        "allergies": payload.get("allergies"),
        "symptoms": payload.get("symptoms"),
        "phone": payload.get("phone"),
    }
    add_patient(data)
    admission_id = add_admission(patient_id, "Initial registration")
    log_audit_event("create", "patients", patient_id, {"admission_id": admission_id})
    return jsonify({"patient_id": patient_id, "admission_id": admission_id})


@app.get("/api/patients/<patient_id>")
@require_permissions("patients.read")
def patients_get(patient_id):
    patient = get_patient(patient_id, hospital_id=current_hospital_id())
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    return jsonify({"patient": row_to_dict(patient)})


@app.put("/api/patients/<patient_id>")
@require_permissions("patients.write")
def patients_update(patient_id):
    hospital_id = current_hospital_id()
    payload = request.get_json(force=True)
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    data = {
        "name": payload.get("name"),
        "middle_name": payload.get("middle_name"),
        "last_name": payload.get("last_name"),
        "dob": payload.get("dob"),
        "age": payload.get("age"),
        "weight": payload.get("weight"),
        "height": payload.get("height"),
        "gender": payload.get("gender"),
        "pregnant": 1 if payload.get("pregnant") else 0,
        "allergies": payload.get("allergies"),
        "symptoms": payload.get("symptoms"),
        "phone": payload.get("phone"),
    }
    update_patient(patient_id, data)
    log_audit_event("update", "patients", patient_id, {"fields": list(data.keys())})
    return jsonify({"status": "ok"})


@app.delete("/api/patients/<patient_id>")
@require_permissions("patients.delete")
def patients_delete(patient_id):
    deleted = delete_patient(patient_id, hospital_id=current_hospital_id())
    if not deleted:
        return jsonify({"error": "Patient not found"}), 404
    log_audit_event("delete", "patients", patient_id)
    return jsonify({"status": "ok"})


@app.get("/api/patients/<patient_id>/admissions")
@require_permissions("patients.read")
def admissions_list(patient_id):
    hospital_id = current_hospital_id()
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    admissions = get_admissions(patient_id, hospital_id=hospital_id)
    return jsonify({"admissions": rows_to_dicts(admissions)})


@app.post("/api/patients/<patient_id>/admissions")
@require_permissions("patients.write")
def admissions_create(patient_id):
    hospital_id = current_hospital_id()
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    payload = request.get_json(force=True)
    notes = payload.get("notes", "")
    admission_id = add_admission(patient_id, notes)
    log_audit_event(
        "create", "admissions", str(admission_id), {"patient_id": patient_id}
    )
    return jsonify({"admission_id": admission_id})


@app.get("/api/patients/<patient_id>/documents")
@require_permissions("patients.read")
def documents_list(patient_id):
    hospital_id = current_hospital_id()
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    documents = get_documents(patient_id, hospital_id=hospital_id)
    return jsonify({"documents": rows_to_dicts(documents)})


@app.post("/api/patients/<patient_id>/documents")
@require_permissions("patients.write")
def documents_create(patient_id):
    hospital_id = current_hospital_id()
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return jsonify({"error": "Patient not found"}), 404
    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    uploaded_file = request.files["file"]
    doc_type = request.form.get("doc_type", "document")
    admission_id = request.form.get("admission_id")
    ocr_text = request.form.get("ocr_text", "")
    ocr_language = request.form.get("ocr_language", "en")
    file_bytes = uploaded_file.read()
    uploaded_file.stream.seek(0)

    filepath = save_uploaded_file(uploaded_file, file_bytes, doc_type)
    document_id = add_document(
        patient_id,
        admission_id if admission_id else None,
        doc_type,
        filepath,
        ocr_text,
        ocr_language,
        file_name=uploaded_file.filename,
        mime_type=uploaded_file.mimetype,
        file_data=None,
        hospital_id=hospital_id,
    )
    return jsonify(
        {"document_id": document_id, "file_path": filepath, "stored_in_db": False}
    )


@app.get("/api/documents/<int:document_id>/file")
@require_permissions("patients.read")
def document_file(document_id):
    document = get_document(document_id, hospital_id=current_hospital_id())
    if not document:
        return jsonify({"error": "Document not found"}), 404

    mime_type = document["mime_type"] or "application/octet-stream"
    file_name = (
        document["file_name"]
        or os.path.basename(document["file_path"] or "")
        or "document.bin"
    )

    file_data = document["file_data"]
    if file_data:
        return send_file(
            io.BytesIO(file_data),
            mimetype=mime_type,
            as_attachment=False,
            download_name=file_name,
        )

    file_path = document["file_path"]
    file_bytes = STORAGE.read(file_path)
    if file_bytes:
        return send_file(
            io.BytesIO(file_bytes),
            mimetype=mime_type,
            as_attachment=False,
            download_name=file_name,
        )

    return jsonify({"error": "Document file content unavailable"}), 404


@app.delete("/api/documents/<int:document_id>")
@require_permissions("patients.write")
def document_delete(document_id):
    hospital_id = current_hospital_id()
    document = get_document(document_id, hospital_id=hospital_id)
    if not document:
        return jsonify({"error": "Document not found"}), 404

    deleted = delete_document(document_id, hospital_id=hospital_id)
    if not deleted:
        return jsonify({"error": "Document not found"}), 404

    STORAGE.delete(document["file_path"])

    return jsonify({"status": "ok"})


@app.post("/api/documents/<int:document_id>/ocr")
@require_permissions("patients.write")
def document_process_ocr(document_id):
    hospital_id = current_hospital_id()
    document = get_document(document_id, hospital_id=hospital_id)
    if not document:
        return jsonify({"error": "Document not found"}), 404

    payload = request.get_json(silent=True)
    payload = payload if isinstance(payload, dict) else {}
    requested_language = payload.get("language") or document["ocr_language"] or "en"
    file_name = (
        document["file_name"]
        or os.path.basename(document["file_path"] or "")
        or "document"
    )

    file_bytes = document["file_data"]
    if not file_bytes:
        file_path = document["file_path"]
        if not file_path:
            return jsonify({"error": "Document file content unavailable"}), 404
        file_bytes = STORAGE.read(file_path)
        if not file_bytes:
            return jsonify({"error": "Document file content unavailable"}), 404

    ocr_text = extract_text_from_image(
        file_bytes, requested_language, document["doc_type"], filename=file_name
    )
    if isinstance(ocr_text, str) and ocr_text.startswith("OCR Error:"):
        return jsonify({"error": ocr_text}), 400

    updated = update_document_ocr(
        document_id, ocr_text, requested_language, hospital_id=hospital_id
    )
    if not updated:
        return jsonify({"error": "Document not found"}), 404

    return jsonify(
        {
            "document_id": document_id,
            "ocr_text": ocr_text,
            "ocr_language": requested_language,
            "updated": True,
        }
    )


@app.post("/api/ocr")
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


@app.post("/api/export/pdf")
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


@app.post("/api/export/word")
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


@app.get("/api/export/patients/csv")
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


# ==================== Employee Management ====================


@app.get("/api/employees")
@require_permissions("admin.use")
def employees_list():
    employees = get_all_employees(hospital_id=current_hospital_id())
    return jsonify({"employees": rows_to_dicts(employees)})


@app.post("/api/employees")
@require_permissions("admin.use")
def employees_create():
    payload = request.get_json(force=True)
    result = signup_employee(payload, allow_admin_creation=True)
    status = 201 if result.get("success") else 400
    return jsonify(result), status


@app.get("/api/employees/stats")
@require_permissions("admin.use")
def employees_stats():
    return jsonify(get_employee_stats(hospital_id=current_hospital_id()))


@app.get("/api/employees/search")
@require_permissions("admin.use")
def employees_search():
    query = request.args.get("q")
    if not query:
        return jsonify({"employees": []})
    employees = search_employees(query, hospital_id=current_hospital_id())
    return jsonify({"employees": rows_to_dicts(employees)})


@app.route("/api/employees/<employee_id>", methods=["GET", "PUT", "DELETE"])
@require_permissions("admin.use")
def employees_detail(employee_id):
    hospital_id = current_hospital_id()
    if request.method == "GET":
        employee = get_employee(employee_id=employee_id, hospital_id=hospital_id)
        if not employee:
            return jsonify({"error": "Employee not found"}), 404
        return jsonify({"employee": row_to_dict(employee)})

    if request.method == "PUT":
        user_permissions = resolve_user_permissions(g.current_user)
        if "employees.write" not in user_permissions:
            return jsonify(
                {"error": "Forbidden", "required_permissions": ["employees.write"]}
            ), 403
        payload = request.get_json(force=True)
        updated = update_employee(employee_id, payload, hospital_id=hospital_id)
        if not updated:
            return jsonify({"error": "Employee not found"}), 404
        return jsonify({"status": "ok"})

    # DELETE
    user_permissions = resolve_user_permissions(g.current_user)
    if "employees.write" not in user_permissions:
        return jsonify(
            {"error": "Forbidden", "required_permissions": ["employees.write"]}
        ), 403
    deleted = delete_employee(employee_id)
    if not deleted:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "ok"})


@app.post("/api/employees/<employee_id>/activate")
@require_permissions("admin.use")
def employees_activate(employee_id):
    activated = activate_employee(employee_id, hospital_id=current_hospital_id())
    if not activated:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "active"})


@app.post("/api/employees/<employee_id>/deactivate")
@require_permissions("admin.use")
def employees_deactivate(employee_id):
    deactivated = deactivate_employee(employee_id, hospital_id=current_hospital_id())
    if not deactivated:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "inactive"})


# ==================== Extended Patient Management ====================


@app.get("/api/patients/<patient_id>/encounters")
@require_permissions("patients.read")
def patient_encounters(patient_id):
    return jsonify(
        {"encounters": rows_to_dicts(list_encounters(patient_id=patient_id))}
    )


@app.post("/api/patients/<patient_id>/encounters")
@require_permissions("patients.write")
def patient_encounter_create(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["encounter_type"])
    if validation_error:
        return validation_error
    encounter_id = create_encounter(
        {
            "patient_id": patient_id,
            "encounter_type": payload.get("encounter_type", "OP"),
            "insurance_provider": payload.get("insurance_provider"),
            "insurance_policy_no": payload.get("insurance_policy_no"),
            "is_accident": payload.get("is_accident", False),
            "referral_source": payload.get("referral_source"),
            "referral_name": payload.get("referral_name"),
            "status": payload.get("status", "active"),
            "created_by": g.current_user.get("username"),
        }
    )
    log_audit_event(
        "create", "encounters", str(encounter_id), {"patient_id": patient_id}
    )
    return jsonify({"encounter_id": encounter_id})


@app.get("/api/patients/<patient_id>/beds")
@require_permissions("patients.read")
def patient_beds(patient_id):
    active_only = request.args.get("active_only", "false").lower() == "true"
    return jsonify(
        {
            "beds": rows_to_dicts(
                list_bed_allocations(patient_id=patient_id, active_only=active_only)
            )
        }
    )


@app.post("/api/patients/<patient_id>/beds")
@require_permissions("patients.write")
def patient_bed_assign(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["admission_id", "ward", "room_no", "bed_no"]
    )
    if validation_error:
        return validation_error
    bed_id = assign_bed(
        {
            "admission_id": payload.get("admission_id"),
            "patient_id": patient_id,
            "ward": payload.get("ward"),
            "room_no": payload.get("room_no"),
            "bed_no": payload.get("bed_no"),
            "status": payload.get("status", "active"),
        }
    )
    log_audit_event(
        "create", "bed_allocations", str(bed_id), {"patient_id": patient_id}
    )
    return jsonify({"bed_allocation_id": bed_id})


@app.get("/api/patients/<patient_id>/medications")
@require_permissions("patients.read")
def patient_medications(patient_id):
    pending_only = request.args.get("pending_only", "false").lower() == "true"
    return jsonify(
        {
            "medications": rows_to_dicts(
                list_medication_schedules(patient_id, pending_only=pending_only)
            )
        }
    )


@app.post("/api/patients/<patient_id>/medications")
@require_permissions("patients.write")
def patient_medications_create(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["medicine_name"])
    if validation_error:
        return validation_error
    schedule_id = add_medication_schedule(
        {
            "patient_id": patient_id,
            "medicine_name": payload.get("medicine_name"),
            "dosage": payload.get("dosage"),
            "schedule_time": payload.get("schedule_time")
            or current_ist_datetime().isoformat(timespec="seconds"),
            "administered": payload.get("administered", False),
            "alert_enabled": payload.get("alert_enabled", True),
            "notes": payload.get("notes"),
        }
    )
    log_audit_event(
        "create", "medication_schedules", str(schedule_id), {"patient_id": patient_id}
    )
    return jsonify({"schedule_id": schedule_id})


@app.get("/api/patients/<patient_id>/notes")
@require_permissions("patients.read")
def patient_notes(patient_id):
    return jsonify({"notes": rows_to_dicts(list_observation_notes(patient_id))})


@app.post("/api/patients/<patient_id>/notes")
@require_permissions("patients.write")
def patient_notes_create(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["note"])
    if validation_error:
        return validation_error
    note_id = add_observation_note(
        {
            "patient_id": patient_id,
            "admission_id": payload.get("admission_id"),
            "doctor_name": payload.get("doctor_name"),
            "note": payload.get("note"),
            "treatment_plan": payload.get("treatment_plan"),
        }
    )
    log_audit_event(
        "create", "observation_notes", str(note_id), {"patient_id": patient_id}
    )
    return jsonify({"note_id": note_id})


@app.get("/api/patients/<patient_id>/certificates")
@require_permissions("patients.read")
def patient_certificates(patient_id):
    return jsonify({"certificates": rows_to_dicts(list_certificates(patient_id))})


@app.post("/api/patients/<patient_id>/certificates")
@require_permissions("patients.write")
def patient_certificates_create(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["certificate_type", "title", "body"]
    )
    if validation_error:
        return validation_error
    certificate_id = create_certificate(
        {
            "patient_id": patient_id,
            "admission_id": payload.get("admission_id"),
            "certificate_type": payload.get("certificate_type"),
            "title": payload.get("title"),
            "body": payload.get("body"),
            "issued_by": g.current_user.get("username"),
        }
    )
    log_audit_event(
        "create",
        "certificates",
        str(certificate_id),
        {"patient_id": patient_id, "certificate_type": payload.get("certificate_type")},
    )
    return jsonify({"certificate_id": certificate_id})


@app.delete("/api/certificates/<int:certificate_id>")
@require_permissions("patients.write")
def patient_certificates_delete(certificate_id):
    deleted = delete_certificate(certificate_id)
    if not deleted:
        return jsonify({"error": "Certificate not found"}), 404
    log_audit_event("delete", "certificates", str(certificate_id), {"certificate_id": certificate_id})
    return jsonify({"status": "ok"})


@app.get("/api/patients/<patient_id>/movements")
@require_permissions("patients.read")
def patient_movements(patient_id):
    return jsonify({"movements": rows_to_dicts(list_patient_movements(patient_id))})


@app.post("/api/patients/<patient_id>/movements")
@require_permissions("patients.write")
def patient_movements_create(patient_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["to_department"])
    if validation_error:
        return validation_error
    movement_id = add_patient_movement(
        {
            "patient_id": patient_id,
            "admission_id": payload.get("admission_id"),
            "from_department": payload.get("from_department"),
            "to_department": payload.get("to_department"),
            "moved_by": g.current_user.get("username"),
        }
    )
    log_audit_event(
        "create", "patient_movements", str(movement_id), {"patient_id": patient_id}
    )
    return jsonify({"movement_id": movement_id})


# ==================== Billing ====================


@app.get("/api/billing/invoices")
@require_permissions("billing.read")
def billing_invoices():
    patient_id = request.args.get("patient_id")
    module = request.args.get("module")
    return jsonify(
        {"invoices": rows_to_dicts(list_invoices(patient_id=patient_id, module=module))}
    )


@app.post("/api/billing/invoices")
@require_permissions("billing.write")
def billing_create_invoice():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["module", "total_amount"])
    if validation_error:
        return validation_error
    invoice_no = (
        payload.get("invoice_no") or f"INV-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    invoice_id = create_invoice(
        {
            "invoice_no": invoice_no,
            "patient_id": payload.get("patient_id"),
            "module": payload.get("module", "OP"),
            "doctor_name": payload.get("doctor_name"),
            "clinic_name": payload.get("clinic_name"),
            "referral_source": payload.get("referral_source"),
            "subtotal": payload.get("subtotal", 0),
            "tax": payload.get("tax", 0),
            "discount": payload.get("discount", 0),
            "total_amount": payload.get("total_amount", 0),
            "paid_amount": payload.get("paid_amount", 0),
            "advance_amount": payload.get("advance_amount", 0),
            "refunded_amount": payload.get("refunded_amount", 0),
            "payment_status": payload.get("payment_status", "due"),
            "created_by": g.current_user.get("username"),
        }
    )
    log_audit_event(
        "create", "billing_invoices", str(invoice_id), {"invoice_no": invoice_no}
    )
    return jsonify({"invoice_id": invoice_id, "invoice_no": invoice_no})


@app.put("/api/billing/invoices/<int:invoice_id>")
@require_permissions("billing.write")
def billing_update_invoice(invoice_id):
    payload = request.get_json(force=True)
    updated = update_invoice(invoice_id, payload)
    if not updated:
        return jsonify({"error": "Invoice not found"}), 404
    log_audit_event(
        "update", "billing_invoices", str(invoice_id), {"invoice_id": invoice_id}
    )
    return jsonify({"status": "ok"})


@app.delete("/api/billing/invoices/<int:invoice_id>")
@require_permissions("billing.write")
def billing_delete_invoice(invoice_id):
    deleted = delete_invoice(invoice_id)
    if not deleted:
        return jsonify({"error": "Invoice not found"}), 404
    log_audit_event(
        "delete", "billing_invoices", str(invoice_id), {"invoice_id": invoice_id}
    )
    return jsonify({"status": "ok"})


@app.post("/api/billing/razorpay/order")
@require_permissions("billing.write")
def billing_razorpay_order():
    config_error = require_razorpay_configured()
    if config_error:
        return config_error
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["invoice_id", "amount"])
    if validation_error:
        return validation_error

    amount_paise = to_amount_paise(payload.get("amount"))
    if amount_paise is None:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    try:
        invoice_id = int(payload.get("invoice_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "invoice_id must be a valid number."}), 400
    if not get_invoice_by_id(invoice_id):
        return jsonify({"error": "Invoice not found"}), 404
    receipt = payload.get("receipt") or f"bill-{invoice_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    notes = payload.get("notes") if isinstance(payload.get("notes"), dict) else {}
    notes = {
        **notes,
        "invoice_id": str(invoice_id),
        "hospital_id": str(current_hospital_id()),
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


@app.post("/api/billing/razorpay/verify")
@require_permissions("billing.write")
def billing_razorpay_verify():
    config_error = require_razorpay_configured()
    if config_error:
        return config_error
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload,
        [
            "invoice_id",
            "amount",
            "razorpay_order_id",
            "razorpay_payment_id",
            "razorpay_signature",
        ],
    )
    if validation_error:
        return validation_error

    if not verify_razorpay_signature(
        payload.get("razorpay_order_id"),
        payload.get("razorpay_payment_id"),
        payload.get("razorpay_signature"),
    ):
        return jsonify({"error": "Invalid Razorpay signature."}), 400

    amount = float(payload.get("amount") or 0)
    if amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    try:
        invoice_id = int(payload.get("invoice_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "invoice_id must be a valid number."}), 400

    payment_id = record_invoice_payment(
        invoice_id,
        {
            "amount": amount,
            "payment_mode": normalize_payment_mode(payload.get("payment_mode")),
            "gateway_ref": payload.get("razorpay_payment_id"),
            "converted_from_mode": payload.get("converted_from_mode"),
            "converted_to_mode": payload.get("converted_to_mode"),
        },
    )
    if payment_id is None:
        return jsonify({"error": "Invoice not found"}), 404
    log_audit_event(
        "create",
        "billing_payments",
        str(payment_id),
        {
            "invoice_id": invoice_id,
            "gateway_ref": payload.get("razorpay_payment_id"),
            "razorpay_order_id": payload.get("razorpay_order_id"),
        },
    )
    return jsonify({"payment_id": payment_id})


@app.post("/api/billing/invoices/<int:invoice_id>/payments")
@require_permissions("billing.write")
def billing_record_payment(invoice_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["amount", "payment_mode"])
    if validation_error:
        return validation_error
    payment_id = record_invoice_payment(
        invoice_id,
        {
            "amount": payload.get("amount", 0),
            "payment_mode": payload.get("payment_mode", "cash"),
            "gateway_ref": payload.get("gateway_ref"),
            "converted_from_mode": payload.get("converted_from_mode"),
            "converted_to_mode": payload.get("converted_to_mode"),
        },
    )
    if payment_id is None:
        return jsonify({"error": "Invoice not found"}), 404
    log_audit_event(
        "create", "billing_payments", str(payment_id), {"invoice_id": invoice_id}
    )
    return jsonify({"payment_id": payment_id})


@app.get("/api/billing/revenue-summary")
@require_permissions("billing.read")
def billing_revenue_summary():
    return jsonify(get_revenue_summary())


@app.get("/api/billing/claims")
@require_permissions("billing.read")
def billing_claims():
    invoice_id = request.args.get("invoice_id", type=int)
    status = request.args.get("status")
    return jsonify(
        {"claims": rows_to_dicts(list_insurance_claims(invoice_id=invoice_id, status=status))}
    )


@app.post("/api/billing/claims")
@require_permissions("billing.write")
def billing_create_claim():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["invoice_id", "insurer_name", "claim_amount"])
    if validation_error:
        return validation_error
    claim_id = create_insurance_claim(payload)
    log_audit_event("create", "insurance_claims", str(claim_id), {"invoice_id": payload.get("invoice_id")})
    return jsonify({"claim_id": claim_id})


@app.put("/api/billing/claims/<int:claim_id>")
@require_permissions("billing.write")
def billing_update_claim(claim_id):
    payload = request.get_json(force=True)
    updated = update_insurance_claim(claim_id, payload)
    if not updated:
        return jsonify({"error": "Claim not found"}), 404
    log_audit_event("update", "insurance_claims", str(claim_id), {"claim_id": claim_id})
    return jsonify({"status": "ok"})


@app.delete("/api/billing/claims/<int:claim_id>")
@require_permissions("billing.write")
def billing_delete_claim(claim_id):
    deleted = delete_insurance_claim(claim_id)
    if not deleted:
        return jsonify({"error": "Claim not found"}), 404
    log_audit_event("delete", "insurance_claims", str(claim_id), {"claim_id": claim_id})
    return jsonify({"status": "ok"})


# ==================== Pharmacy ====================


@app.get("/api/pharmacy/inventory")
@require_permissions("pharmacy.read")
def pharmacy_inventory_list():
    return jsonify({"items": rows_to_dicts(list_inventory_items())})


@app.post("/api/pharmacy/inventory")
@require_permissions("pharmacy.write")
def pharmacy_inventory_upsert():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["medicine_name"])
    if validation_error:
        return validation_error
    item_id = upsert_inventory_item(payload)
    log_audit_event(
        "upsert",
        "pharmacy_inventory",
        str(item_id),
        {"medicine_name": payload.get("medicine_name")},
    )
    return jsonify({"item_id": item_id})


@app.delete("/api/pharmacy/inventory/<int:item_id>")
@require_permissions("pharmacy.write")
def pharmacy_inventory_delete(item_id):
    deleted = delete_inventory_item(item_id)
    if not deleted:
        return jsonify({"error": "Inventory item not found"}), 404
    log_audit_event("delete", "pharmacy_inventory", str(item_id), {"item_id": item_id})
    return jsonify({"status": "ok"})


@app.post("/api/pharmacy/sales")
@require_permissions("pharmacy.write")
def pharmacy_sale_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["medicine_name", "quantity", "unit_price"]
    )
    if validation_error:
        return validation_error
    sale_id = create_pharmacy_sale(payload)
    log_audit_event(
        "create",
        "pharmacy_sales",
        str(sale_id),
        {"medicine_name": payload.get("medicine_name")},
    )
    return jsonify({"sale_id": sale_id})


@app.get("/api/pharmacy/sales")
@require_permissions("pharmacy.read")
def pharmacy_sales_list():
    medicine_name = request.args.get("medicine_name")
    invoice_id = request.args.get("invoice_id")
    patient_id = request.args.get("patient_id")
    return jsonify(
        {
            "sales": rows_to_dicts(
                list_pharmacy_sales(medicine_name=medicine_name, invoice_id=invoice_id, patient_id=patient_id)
            )
        }
    )


@app.get("/api/pharmacy/suppliers")
@require_permissions("pharmacy.read")
def pharmacy_suppliers_list():
    return jsonify({"suppliers": rows_to_dicts(list_pharmacy_suppliers())})


@app.post("/api/pharmacy/suppliers")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["supplier_name"])
    if validation_error:
        return validation_error
    supplier_id = create_pharmacy_supplier(payload)
    log_audit_event("create", "pharmacy_suppliers", str(supplier_id), {"supplier_name": payload.get("supplier_name")})
    return jsonify({"supplier_id": supplier_id})


@app.put("/api/pharmacy/suppliers/<int:supplier_id>")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_update(supplier_id):
    payload = request.get_json(force=True)
    updated = update_pharmacy_supplier(supplier_id, payload)
    if not updated:
        return jsonify({"error": "Supplier not found"}), 404
    log_audit_event("update", "pharmacy_suppliers", str(supplier_id), {"supplier_id": supplier_id})
    return jsonify({"status": "ok"})


@app.delete("/api/pharmacy/suppliers/<int:supplier_id>")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_delete(supplier_id):
    deleted = delete_pharmacy_supplier(supplier_id)
    if not deleted:
        return jsonify({"error": "Supplier not found"}), 404
    log_audit_event("delete", "pharmacy_suppliers", str(supplier_id), {"supplier_id": supplier_id})
    return jsonify({"status": "ok"})


@app.get("/api/pharmacy/purchases")
@require_permissions("pharmacy.read")
def pharmacy_purchases_list():
    status = request.args.get("status")
    return jsonify({"purchases": rows_to_dicts(list_pharmacy_purchases(status=status))})


@app.post("/api/pharmacy/purchases")
@require_permissions("pharmacy.write")
def pharmacy_purchases_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["medicine_name", "quantity", "unit_cost"])
    if validation_error:
        return validation_error
    purchase_id = create_pharmacy_purchase(payload)
    log_audit_event("create", "pharmacy_purchases", str(purchase_id), {"medicine_name": payload.get("medicine_name")})
    return jsonify({"purchase_id": purchase_id})


@app.put("/api/pharmacy/purchases/<int:purchase_id>")
@require_permissions("pharmacy.write")
def pharmacy_purchases_update(purchase_id):
    payload = request.get_json(force=True)
    updated = update_pharmacy_purchase(purchase_id, payload)
    if not updated:
        return jsonify({"error": "Purchase not found"}), 404
    log_audit_event("update", "pharmacy_purchases", str(purchase_id), {"purchase_id": purchase_id})
    return jsonify({"status": "ok"})


@app.delete("/api/pharmacy/purchases/<int:purchase_id>")
@require_permissions("pharmacy.write")
def pharmacy_purchases_delete(purchase_id):
    deleted = delete_pharmacy_purchase(purchase_id)
    if not deleted:
        return jsonify({"error": "Purchase not found"}), 404
    log_audit_event("delete", "pharmacy_purchases", str(purchase_id), {"purchase_id": purchase_id})
    return jsonify({"status": "ok"})


@app.get("/api/pharmacy/summary")
@require_permissions("pharmacy.read")
def pharmacy_summary():
    return jsonify(get_pharmacy_summary())


# ==================== Lab & Diagnostics ====================


@app.get("/api/lab/vendors")
@require_permissions("lab.read")
def lab_vendors_list():
    return jsonify({"vendors": rows_to_dicts(list_lab_vendors())})


@app.post("/api/lab/vendors")
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


@app.put("/api/lab/vendors/<int:vendor_id>")
@require_permissions("lab.write")
def lab_vendors_update(vendor_id):
    payload = request.get_json(force=True)
    updated = update_lab_vendor(vendor_id, payload)
    if not updated:
        return jsonify({"error": "Vendor not found"}), 404
    log_audit_event("update", "lab_vendors", str(vendor_id), {"vendor_id": vendor_id})
    return jsonify({"status": "ok"})


@app.delete("/api/lab/vendors/<int:vendor_id>")
@require_permissions("lab.write")
def lab_vendors_delete(vendor_id):
    deleted = delete_lab_vendor(vendor_id)
    if not deleted:
        return jsonify({"error": "Vendor not found"}), 404
    log_audit_event("delete", "lab_vendors", str(vendor_id), {"vendor_id": vendor_id})
    return jsonify({"status": "ok"})


@app.get("/api/lab/diagnostics")
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


@app.post("/api/lab/diagnostics")
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


@app.put("/api/lab/diagnostics/<int:diagnostic_id>")
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


@app.delete("/api/lab/diagnostics/<int:diagnostic_id>")
@require_permissions("lab.write")
def lab_diagnostics_delete(diagnostic_id):
    deleted = delete_diagnostic_record(diagnostic_id)
    if not deleted:
        return jsonify({"error": "Diagnostic record not found"}), 404
    log_audit_event(
        "delete", "diagnostics", str(diagnostic_id), {"diagnostic_id": diagnostic_id}
    )
    return jsonify({"status": "ok"})


@app.get("/api/lab/summary")
@require_permissions("lab.read")
def lab_summary():
    return jsonify(get_diagnostic_summary())


# ==================== OT ====================


@app.get("/api/ot/theatres")
@require_permissions("ot.read")
def ot_theatres_list():
    return jsonify({"theatres": rows_to_dicts(list_ot_theatres())})


@app.post("/api/ot/theatres")
@require_permissions("ot.write")
def ot_theatres_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["theatre_code", "theatre_name"])
    if validation_error:
        return validation_error
    theatre_id = create_ot_theatre(payload)
    log_audit_event("create", "ot_theatres", str(theatre_id), {"theatre_code": payload.get("theatre_code")})
    return jsonify({"theatre_id": theatre_id})


@app.put("/api/ot/theatres/<int:theatre_id>")
@require_permissions("ot.write")
def ot_theatres_update(theatre_id):
    payload = request.get_json(force=True)
    updated = update_ot_theatre(theatre_id, payload)
    if not updated:
        return jsonify({"error": "Theatre not found"}), 404
    log_audit_event("update", "ot_theatres", str(theatre_id), {"theatre_id": theatre_id})
    return jsonify({"status": "ok"})


@app.delete("/api/ot/theatres/<int:theatre_id>")
@require_permissions("ot.write")
def ot_theatres_delete(theatre_id):
    deleted = delete_ot_theatre(theatre_id)
    if not deleted:
        return jsonify({"error": "Theatre not found"}), 404
    log_audit_event("delete", "ot_theatres", str(theatre_id), {"theatre_id": theatre_id})
    return jsonify({"status": "ok"})


@app.get("/api/ot/surgeries")
@require_permissions("ot.read")
def ot_surgeries_list():
    theatre_id = request.args.get("theatre_id", type=int)
    status = request.args.get("status")
    return jsonify({"surgeries": rows_to_dicts(list_ot_surgeries(theatre_id=theatre_id, status=status))})


@app.post("/api/ot/surgeries")
@require_permissions("ot.write")
def ot_surgeries_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["theatre_id", "procedure_name", "surgeon_name", "scheduled_start"])
    if validation_error:
        return validation_error
    surgery_id = create_ot_surgery(payload)
    log_audit_event("create", "ot_surgeries", str(surgery_id), {"procedure_name": payload.get("procedure_name")})
    return jsonify({"surgery_id": surgery_id})


@app.put("/api/ot/surgeries/<int:surgery_id>")
@require_permissions("ot.write")
def ot_surgeries_update(surgery_id):
    payload = request.get_json(force=True)
    updated = update_ot_surgery(surgery_id, payload)
    if not updated:
        return jsonify({"error": "Surgery not found"}), 404
    log_audit_event("update", "ot_surgeries", str(surgery_id), {"surgery_id": surgery_id})
    return jsonify({"status": "ok"})


@app.delete("/api/ot/surgeries/<int:surgery_id>")
@require_permissions("ot.write")
def ot_surgeries_delete(surgery_id):
    deleted = delete_ot_surgery(surgery_id)
    if not deleted:
        return jsonify({"error": "Surgery not found"}), 404
    log_audit_event("delete", "ot_surgeries", str(surgery_id), {"surgery_id": surgery_id})
    return jsonify({"status": "ok"})


@app.get("/api/ot/summary")
@require_permissions("ot.read")
def ot_summary():
    return jsonify(get_ot_summary())


# ==================== Accounts ====================


@app.get("/api/accounts/summary")
@require_permissions("accounts.read")
def accounts_summary():
    return jsonify(get_accounts_summary())


@app.get("/api/accounts/ledger")
@require_permissions("accounts.read")
def accounts_ledger_list():
    entry_type = request.args.get("entry_type")
    return jsonify({"entries": rows_to_dicts(list_account_ledger_entries(entry_type=entry_type))})


@app.post("/api/accounts/ledger")
@require_permissions("accounts.write")
def accounts_ledger_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["entry_date", "entry_type", "category", "amount"])
    if validation_error:
        return validation_error
    entry_id = create_account_ledger_entry(payload)
    log_audit_event("create", "accounts_ledger", str(entry_id), {"category": payload.get("category")})
    return jsonify({"entry_id": entry_id})


@app.put("/api/accounts/ledger/<int:entry_id>")
@require_permissions("accounts.write")
def accounts_ledger_update(entry_id):
    payload = request.get_json(force=True)
    updated = update_account_ledger_entry(entry_id, payload)
    if not updated:
        return jsonify({"error": "Ledger entry not found"}), 404
    log_audit_event("update", "accounts_ledger", str(entry_id), {"entry_id": entry_id})
    return jsonify({"status": "ok"})


@app.delete("/api/accounts/ledger/<int:entry_id>")
@require_permissions("accounts.write")
def accounts_ledger_delete(entry_id):
    deleted = delete_account_ledger_entry(entry_id)
    if not deleted:
        return jsonify({"error": "Ledger entry not found"}), 404
    log_audit_event("delete", "accounts_ledger", str(entry_id), {"entry_id": entry_id})
    return jsonify({"status": "ok"})


@app.get("/api/accounts/vendors")
@require_permissions("accounts.read")
def accounts_vendor_payments_list():
    vendor_name = request.args.get("vendor_name")
    return jsonify({"payments": rows_to_dicts(list_vendor_payments(vendor_name=vendor_name))})


@app.post("/api/accounts/vendors")
@require_permissions("accounts.write")
def accounts_vendor_payments_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["vendor_name", "amount", "payment_date"])
    if validation_error:
        return validation_error
    payment_id = create_vendor_payment(payload)
    log_audit_event("create", "vendor_payments", str(payment_id), {"vendor_name": payload.get("vendor_name")})
    return jsonify({"payment_id": payment_id})


@app.put("/api/accounts/vendors/<int:payment_id>")
@require_permissions("accounts.write")
def accounts_vendor_payments_update(payment_id):
    payload = request.get_json(force=True)
    updated = update_vendor_payment(payment_id, payload)
    if not updated:
        return jsonify({"error": "Vendor payment not found"}), 404
    log_audit_event("update", "vendor_payments", str(payment_id), {"payment_id": payment_id})
    return jsonify({"status": "ok"})


@app.delete("/api/accounts/vendors/<int:payment_id>")
@require_permissions("accounts.write")
def accounts_vendor_payments_delete(payment_id):
    deleted = delete_vendor_payment(payment_id)
    if not deleted:
        return jsonify({"error": "Vendor payment not found"}), 404
    log_audit_event("delete", "vendor_payments", str(payment_id), {"payment_id": payment_id})
    return jsonify({"status": "ok"})


@app.get("/api/accounts/doctors")
@require_permissions("accounts.read")
def accounts_doctor_payouts_list():
    doctor_name = request.args.get("doctor_name")
    return jsonify({"payouts": rows_to_dicts(list_doctor_payouts(doctor_name=doctor_name))})


@app.post("/api/accounts/doctors")
@require_permissions("accounts.write")
def accounts_doctor_payouts_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["doctor_name", "payout_month", "amount"])
    if validation_error:
        return validation_error
    payout_id = create_doctor_payout(payload)
    log_audit_event("create", "doctor_payouts", str(payout_id), {"doctor_name": payload.get("doctor_name")})
    return jsonify({"payout_id": payout_id})


@app.put("/api/accounts/doctors/<int:payout_id>")
@require_permissions("accounts.write")
def accounts_doctor_payouts_update(payout_id):
    payload = request.get_json(force=True)
    updated = update_doctor_payout(payout_id, payload)
    if not updated:
        return jsonify({"error": "Doctor payout not found"}), 404
    log_audit_event("update", "doctor_payouts", str(payout_id), {"payout_id": payout_id})
    return jsonify({"status": "ok"})


@app.delete("/api/accounts/doctors/<int:payout_id>")
@require_permissions("accounts.write")
def accounts_doctor_payouts_delete(payout_id):
    deleted = delete_doctor_payout(payout_id)
    if not deleted:
        return jsonify({"error": "Doctor payout not found"}), 404
    log_audit_event("delete", "doctor_payouts", str(payout_id), {"payout_id": payout_id})
    return jsonify({"status": "ok"})


# ==================== HRMS ====================


@app.get("/api/hr/departments")
@require_permissions("hr.read")
def hr_departments_list():
    return jsonify({"departments": rows_to_dicts(list_departments(hospital_id=current_hospital_id()))})


@app.post("/api/hr/departments")
@require_permissions("hr.write")
def hr_departments_create():
    payload = request.get_json(force=True)
    try:
        department_name = normalize_department_name(payload.get("department_name"))
    except BadRequest as error:
        return jsonify({"error": str(error)}), 400

    existing = next(
        (
            row
            for row in rows_to_dicts(list_departments(hospital_id=current_hospital_id()))
            if (row.get("department_name") or "").strip().lower() == department_name.lower()
        ),
        None,
    )
    if existing:
        return jsonify({"department_id": existing.get("id"), "department_name": existing.get("department_name"), "already_exists": True})

    department_id = create_department(
        {
            "department_name": department_name,
            "mapped_head_employee_id": payload.get("mapped_head_employee_id"),
        },
        hospital_id=current_hospital_id(),
    )
    log_audit_event(
        "create",
        "departments",
        str(department_id),
        {"department_name": department_name},
    )
    return jsonify({"department_id": department_id})


@app.put("/api/hr/departments/<int:department_id>")
@require_permissions("hr.write")
def hr_departments_update(department_id):
    payload = request.get_json(force=True)
    if "department_name" in payload:
        try:
            payload["department_name"] = normalize_department_name(payload.get("department_name"))
        except BadRequest as error:
            return jsonify({"error": str(error)}), 400

        duplicate = next(
            (
                row
                for row in rows_to_dicts(list_departments(hospital_id=current_hospital_id()))
                if row.get("id") != department_id
                and (row.get("department_name") or "").strip().lower() == payload["department_name"].lower()
            ),
            None,
        )
        if duplicate:
            return jsonify({"error": "Department already exists"}), 409

    updated = update_department(department_id, payload, hospital_id=current_hospital_id())
    if not updated:
        return jsonify({"error": "Department not found"}), 404
    log_audit_event(
        "update", "departments", str(department_id), {"department_id": department_id}
    )
    return jsonify({"status": "ok"})


@app.delete("/api/hr/departments/<int:department_id>")
@require_permissions("hr.write")
def hr_departments_delete(department_id):
    deleted = delete_department(department_id, hospital_id=current_hospital_id())
    if not deleted:
        return jsonify({"error": "Department not found"}), 404
    log_audit_event(
        "delete", "departments", str(department_id), {"department_id": department_id}
    )
    return jsonify({"status": "ok"})


@app.get("/api/hr/attendance")
@require_permissions("hr.read")
def hr_attendance_list():
    employee_id = request.args.get("employee_id")
    return jsonify(
        {"attendance": rows_to_dicts(list_attendance(employee_id=employee_id))}
    )


@app.post("/api/hr/attendance")
@require_permissions("hr.write")
def hr_attendance_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "attendance_date", "status"]
    )
    if validation_error:
        return validation_error
    attendance_id = create_attendance(payload)
    log_audit_event(
        "create",
        "attendance",
        str(attendance_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"attendance_id": attendance_id})


@app.put("/api/hr/attendance/<int:attendance_id>")
@require_permissions("hr.write")
def hr_attendance_update(attendance_id):
    payload = request.get_json(force=True)
    updated = update_attendance_record(attendance_id, payload)
    if not updated:
        return jsonify({"error": "Attendance record not found"}), 404
    log_audit_event(
        "update", "attendance", str(attendance_id), {"attendance_id": attendance_id}
    )
    return jsonify({"status": "ok"})


@app.delete("/api/hr/attendance/<int:attendance_id>")
@require_permissions("hr.write")
def hr_attendance_delete(attendance_id):
    deleted = delete_attendance_record(attendance_id)
    if not deleted:
        return jsonify({"error": "Attendance record not found"}), 404
    log_audit_event(
        "delete", "attendance", str(attendance_id), {"attendance_id": attendance_id}
    )
    return jsonify({"status": "ok"})


@app.get("/api/hr/payroll")
@require_permissions("hr.read")
def hr_payroll_list():
    employee_id = request.args.get("employee_id")
    return jsonify({"payroll": rows_to_dicts(list_payroll(employee_id=employee_id))})


@app.post("/api/hr/payroll")
@require_permissions("hr.write")
def hr_payroll_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "payroll_month", "basic_salary"]
    )
    if validation_error:
        return validation_error
    payroll_id = create_payroll_record(payload)
    log_audit_event(
        "create",
        "payroll",
        str(payroll_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"payroll_id": payroll_id})


@app.put("/api/hr/payroll/<int:payroll_id>")
@require_permissions("hr.write")
def hr_payroll_update(payroll_id):
    payload = request.get_json(force=True)
    updated = update_payroll_record(payroll_id, payload)
    if not updated:
        return jsonify({"error": "Payroll record not found"}), 404
    log_audit_event("update", "payroll", str(payroll_id), {"payroll_id": payroll_id})
    return jsonify({"status": "ok"})


@app.delete("/api/hr/payroll/<int:payroll_id>")
@require_permissions("hr.write")
def hr_payroll_delete(payroll_id):
    deleted = delete_payroll_record(payroll_id)
    if not deleted:
        return jsonify({"error": "Payroll record not found"}), 404
    log_audit_event("delete", "payroll", str(payroll_id), {"payroll_id": payroll_id})
    return jsonify({"status": "ok"})


@app.get("/api/hr/leaves")
@require_permissions("hr.read")
def hr_leaves_list():
    employee_id = request.args.get("employee_id")
    return jsonify(
        {"leaves": rows_to_dicts(list_leave_requests(employee_id=employee_id))}
    )


@app.post("/api/hr/leaves")
@require_permissions("hr.write")
def hr_leaves_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "leave_type", "start_date", "end_date"]
    )
    if validation_error:
        return validation_error
    leave_id = create_leave_request(payload)
    log_audit_event(
        "create",
        "leave_requests",
        str(leave_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"leave_id": leave_id})


@app.post("/api/hr/leaves/<int:leave_id>/status")
@require_permissions("hr.write")
def hr_leave_status_update(leave_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["status"])
    if validation_error:
        return validation_error
    updated = update_leave_status(
        leave_id, payload.get("status", "pending"), g.current_user.get("username")
    )
    if not updated:
        return jsonify({"error": "Leave request not found"}), 404
    log_audit_event(
        "update", "leave_requests", str(leave_id), {"status": payload.get("status")}
    )
    return jsonify({"status": "ok"})


@app.delete("/api/hr/leaves/<int:leave_id>")
@require_permissions("hr.write")
def hr_leaves_delete(leave_id):
    deleted = delete_leave_request(leave_id)
    if not deleted:
        return jsonify({"error": "Leave request not found"}), 404
    log_audit_event("delete", "leave_requests", str(leave_id), {"leave_id": leave_id})
    return jsonify({"status": "ok"})


# ==================== Audit ====================


@app.get("/api/audit/logs")
@require_permissions("audit.read")
def audit_logs_list():
    module_name = request.args.get("module")
    limit = request.args.get("limit", default=100, type=int)
    return jsonify(
        {"logs": rows_to_dicts(get_audit_logs(module_name=module_name, limit=limit))}
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
