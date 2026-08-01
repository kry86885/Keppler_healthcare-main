import json
import os
import secrets
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

import bcrypt
from utils.database import (
    get_connection,
    add_employee,
    generate_employee_id,
    check_if_first_user,
    resolve_hospital_id,
    normalize_hospital_code,
)

SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "hospai_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "12"))
SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60
SESSION_PEPPER = os.getenv("SESSION_PEPPER", "")
ADMIN_ROUTE_PASSWORD = os.getenv("ADMIN_ROUTE_PASSWORD", "")
ADMIN_ROUTE_AUTH_COOKIE_NAME = os.getenv("ADMIN_ROUTE_AUTH_COOKIE_NAME", "hospai_admin_route_auth")
ADMIN_ROUTE_AUTH_TTL_SECONDS = int(os.getenv("ADMIN_ROUTE_AUTH_TTL_SECONDS", "3600"))
ADMIN_ROUTE_AUTH_SECRET = os.getenv("ADMIN_ROUTE_AUTH_SECRET", "") or SESSION_PEPPER or "hospai-admin-route-auth"

USER_TYPES = ("admin", "normal")
ASSIGNABLE_MODULES = ("dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "ot", "accounts", "reports", "symptom_ai", "emergency", "icu", "ambulance", "nurse", "queue", "beds")
DEFAULT_NORMAL_MODULES = ("dashboard", "patients", "symptom_ai")

MODULE_PERMISSION_MAP = {
    "dashboard": {"patients.read"},
    "patients": {"patients.read", "patients.write"},
    "billing": {"billing.read", "billing.write"},
    "pharmacy": {"pharmacy.read", "pharmacy.write"},
    "lab": {"lab.read", "lab.write"},
    "hrms": {"hr.read", "hr.write"},
    "ot": {"ot.read", "ot.write"},
    "accounts": {"accounts.read", "accounts.write"},
    "reports": {"reports.read"},
    "symptom_ai": {"symptom_ai.use"},
    "emergency": {"emergency.read", "emergency.write"},
    "icu": {"icu.read", "icu.write"},
    "ambulance": {"ambulance.read", "ambulance.write"},
    "nurse": {"nurse.read", "nurse.write"},
    "queue": {"queue.read", "queue.write"},
    "beds": {"beds.read", "beds.write"},
}

ADMIN_PERMISSIONS = {
    "patients.read",
    "patients.write",
    "patients.delete",
    "symptom_ai.use",
    "employees.read",
    "employees.write",
    "billing.read",
    "billing.write",
    "pharmacy.read",
    "pharmacy.write",
    "lab.read",
    "lab.write",
    "hr.read",
    "hr.write",
    "ot.read",
    "ot.write",
    "accounts.read",
    "accounts.write",
    "emergency.read",
    "emergency.write",
    "icu.read",
    "icu.write",
    "ambulance.read",
    "ambulance.write",
    "nurse.read",
    "nurse.write",
    "queue.read",
    "queue.write",
    "beds.read",
    "beds.write",
    "reports.read",
    "audit.read",
    "admin.use",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _format_ts(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse_ts(value: Union[str, datetime]) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _hash_session_token(token: str) -> str:
    token_bytes = f"{token}{SESSION_PEPPER}".encode()
    return hashlib.sha256(token_bytes).hexdigest()


def is_admin_route_auth_configured() -> bool:
    return bool(ADMIN_ROUTE_PASSWORD)


def verify_admin_route_password(password: str) -> bool:
    if not is_admin_route_auth_configured():
        return False
    return hmac.compare_digest(password or "", ADMIN_ROUTE_PASSWORD)


def create_admin_route_auth_token() -> str:
    nonce = secrets.token_urlsafe(18)
    expires_at = int(_now_utc().timestamp()) + ADMIN_ROUTE_AUTH_TTL_SECONDS
    payload = f"{nonce}:{expires_at}"
    signature = hmac.new(ADMIN_ROUTE_AUTH_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{nonce}.{expires_at}.{signature}"


def verify_admin_route_auth_token(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    nonce, expires_str, signature = parts
    try:
        expires_at = int(expires_str)
    except ValueError:
        return False
    if int(_now_utc().timestamp()) >= expires_at:
        return False
    payload = f"{nonce}:{expires_at}"
    expected_signature = hmac.new(ADMIN_ROUTE_AUTH_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected_signature)


def normalize_user_type(user_type: Optional[str], access_role: Optional[str] = None, legacy_role: Optional[str] = None) -> str:
    normalized = (user_type or "").strip().lower()
    if normalized in USER_TYPES:
        return normalized

    normalized_access_role = (access_role or "").strip().lower()
    if normalized_access_role in {"owner", "hr_manager"}:
        return "admin"

    normalized_legacy_role = (legacy_role or "").strip().lower()
    if normalized_legacy_role == "employee":
        return "admin"

    return "normal"


def _parse_modules(raw_modules) -> list[str]:
    if raw_modules is None:
        return []
    if isinstance(raw_modules, list):
        candidates = raw_modules
    elif isinstance(raw_modules, str):
        text = raw_modules.strip()
        if not text:
            candidates = []
        else:
            try:
                decoded = json.loads(text)
                candidates = decoded if isinstance(decoded, list) else [text]
            except json.JSONDecodeError:
                candidates = [part.strip() for part in text.split(",") if part.strip()]
    else:
        candidates = []

    normalized = []
    allowed = set(ASSIGNABLE_MODULES)
    for module_name in candidates:
        module_key = str(module_name).strip().lower()
        if module_key in allowed and module_key not in normalized:
            normalized.append(module_key)
    return normalized


def default_modules_for_legacy(access_role: Optional[str], legacy_role: Optional[str]) -> list[str]:
    normalized_access_role = (access_role or "").strip().lower()
    normalized_legacy_role = (legacy_role or "").strip().lower()

    if normalized_access_role in {"owner", "hr_manager"} or normalized_legacy_role == "employee":
        return list(ASSIGNABLE_MODULES)
    if normalized_access_role == "clinician":
        return ["dashboard", "patients", "lab", "pharmacy", "symptom_ai"]
    if normalized_access_role == "receptionist":
        return ["dashboard", "patients", "billing", "symptom_ai"]

    if normalized_legacy_role == "staff":
        return ["dashboard", "patients", "billing", "symptom_ai"]

    return list(DEFAULT_NORMAL_MODULES)


def normalize_module_access(raw_modules, user_type: Optional[str] = None, access_role: Optional[str] = None, legacy_role: Optional[str] = None) -> list[str]:
    normalized_type = normalize_user_type(user_type, access_role, legacy_role)
    if normalized_type == "admin":
        return list(ASSIGNABLE_MODULES)

    parsed = _parse_modules(raw_modules)
    if parsed:
        return parsed

    # Default deny for normal users when module access is missing or invalid.
    return []


def modules_to_storage(modules: list[str]) -> str:
    return json.dumps(modules, separators=(",", ":"))


def get_permissions(user_type: Optional[str], module_access=None, access_role: Optional[str] = None, legacy_role: Optional[str] = None) -> list[str]:
    normalized_type = normalize_user_type(user_type, access_role, legacy_role)
    if normalized_type == "admin":
        return sorted(ADMIN_PERMISSIONS)

    permissions: set[str] = set()
    for module_name in normalize_module_access(module_access, normalized_type, access_role, legacy_role):
        permissions.update(MODULE_PERMISSION_MAP.get(module_name, set()))

    return sorted(permissions)


def resolve_user_profile(user_row) -> dict:
    user_type = normalize_user_type(user_row.get("user_type"), user_row.get("access_role"), user_row.get("role"))
    module_access = normalize_module_access(
        user_row.get("module_access"),
        user_type,
        user_row.get("access_role"),
        user_row.get("role"),
    )

    return {
        "username": user_row.get("username"),
        "role": user_row.get("role"),
        "access_role": user_row.get("access_role"),
        "user_type": user_type,
        "module_access": module_access,
        "permissions": get_permissions(user_type, module_access, user_row.get("access_role"), user_row.get("role")),
        "full_name": user_row.get("full_name"),
        "email": user_row.get("email"),
        "phone": user_row.get("phone"),
        "employee_id": user_row.get("employee_id"),
        "status": user_row.get("status"),
        "hospital_code": user_row.get("hospital_code"),
    }


def resolve_user_permissions(user: dict) -> set[str]:
    explicit_permissions = user.get("permissions")
    if explicit_permissions:
        return set(explicit_permissions)

    return set(
        get_permissions(
            user.get("user_type"),
            user.get("module_access"),
            user.get("access_role"),
            user.get("role"),
        )
    )


def validate_password(password: str) -> Optional[str]:
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    return None


def create_default_users():
    """Seed starter accounts so the API is usable out of the box."""
    hospital_id = resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT username FROM users WHERE username IN ('employee', 'staff') AND hospital_id = ?",
                (hospital_id,),
            )
            existing_scoped = {row[0] for row in cursor.fetchall()}
        except Exception:
            existing_scoped = set()

        cursor.execute("SELECT username FROM users WHERE username IN ('employee', 'staff')")
        existing_any = {row[0] for row in cursor.fetchall()}

        if "employee" in existing_any:
            cursor.execute(
                """
                UPDATE users
                SET role = 'employee',
                    access_role = 'owner',
                    user_type = 'admin',
                    module_access = ?,
                    status = 'active'
                WHERE username = 'employee'
                """,
                (modules_to_storage(list(ASSIGNABLE_MODULES)),),
            )

        if "staff" in existing_any:
            cursor.execute(
                """
                UPDATE users
                SET role = 'staff',
                    access_role = 'receptionist',
                    user_type = 'normal',
                    module_access = ?,
                    status = 'active'
                WHERE username = 'staff'
                """,
                (modules_to_storage(list(DEFAULT_NORMAL_MODULES)),),
            )

        defaults = [
            {
                "username": "employee",
                "password_hash": hash_password("employee123"),
                "role": "employee",
                "access_role": "owner",
                "user_type": "admin",
                "module_access": list(ASSIGNABLE_MODULES),
                "job_role": "Employee",
                "full_name": "Default Employee",
                "email": "employee@hospital.com",
                "phone": "+1-234-567-8900",
                "department": "General",
                "status": "active",
                "address": "",
                "emergency_contact": "",
            },
            {
                "username": "staff",
                "password_hash": hash_password("staff123"),
                "role": "staff",
                "access_role": "receptionist",
                "user_type": "normal",
                "module_access": list(DEFAULT_NORMAL_MODULES),
                "job_role": "Staff",
                "full_name": "Staff User",
                "email": "",
                "phone": "",
                "department": "Ops",
                "status": "active",
                "address": "",
                "emergency_contact": "",
            },
        ]

        for user in defaults:
            if user["username"] in existing_any or user["username"] in existing_scoped:
                continue
            user["employee_id"] = generate_employee_id(hospital_id=hospital_id)
            try:
                add_employee(user, hospital_id=hospital_id)
            except Exception as exc:
                message = str(exc).lower()
                if "unique constraint failed: users.username" in message or "duplicate key value violates unique constraint" in message:
                    # Concurrent startup workers may race to seed default users.
                    continue
                raise


def authenticate(username: str, password: str, hospital_id: Optional[int] = None):
    """Authenticate user and return rich profile or error."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT u.id, u.hospital_id, u.password_hash, u.role, u.access_role, u.user_type,
                       u.module_access, u.full_name, u.email, u.phone, u.employee_id, u.status,
                       h.code as hospital_code, h.status as hospital_status
                FROM users u
                LEFT JOIN hospitals h ON h.id = u.hospital_id
                WHERE u.username = ? AND u.hospital_id = ?
            """,
                (username, scoped_hospital_id),
            )
        except Exception as exc:
            # Backward compatibility for stale/legacy schemas or stale runtime modules.
            msg = str(exc).lower()
            if "no such column: hospital_id" in msg or "incorrect number of bindings supplied" in msg:
                cursor.execute(
                    """
                    SELECT id, password_hash, role, access_role, user_type, module_access, full_name, email, phone, employee_id, status
                    FROM users WHERE username = ?
                """,
                    (username,),
                )
            else:
                raise
        user = cursor.fetchone()
        if not user:
            return None
        user_map = dict(user)
        if verify_password(password, user_map.get("password_hash", "")):
            if user_map.get("status") == "inactive":
                return {"error": "Account is inactive. Please contact administrator."}
            if user_map.get("hospital_status") not in (None, "active"):
                return {"error": "Hospital account is disabled. Please contact administrator."}
            profile = resolve_user_profile(
                {
                    "username": username,
                    "role": user_map.get("role"),
                    "access_role": user_map.get("access_role"),
                    "user_type": user_map.get("user_type"),
                    "module_access": user_map.get("module_access"),
                    "full_name": user_map.get("full_name"),
                    "email": user_map.get("email"),
                    "phone": user_map.get("phone"),
                    "employee_id": user_map.get("employee_id"),
                    "status": user_map.get("status"),
                    "hospital_code": user_map.get("hospital_code"),
                }
            )
            profile["id"] = user_map.get("id")
            profile["hospital_id"] = user_map.get("hospital_id") or scoped_hospital_id
            return profile
    return None


def signup_employee(data: dict, allow_admin_creation: bool = True, hospital_id: Optional[int] = None) -> dict:
    """Register a new employee account."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    password_error = validate_password(data.get("password", ""))
    if password_error:
        return {"success": False, "message": password_error}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ? AND hospital_id = ?", (data["username"], scoped_hospital_id))
        if cursor.fetchone():
            return {"success": False, "message": "Username already exists"}

    employee_id = generate_employee_id(hospital_id=scoped_hospital_id)
    is_first = check_if_first_user(hospital_id=scoped_hospital_id)
    requested_user_type = normalize_user_type(data.get("user_type"), data.get("access_role"), data.get("role"))
    user_type = requested_user_type if allow_admin_creation else "normal"
    module_access = normalize_module_access(
        data.get("module_access"),
        user_type,
        data.get("access_role"),
        data.get("role"),
    )

    employee_data = {
        "username": data["username"],
        "password_hash": hash_password(data["password"]),
        "role": "employee",
        "access_role": "owner" if user_type == "admin" else "receptionist",
        "user_type": user_type,
        "module_access": module_access,
        "job_role": data.get("job_role"),
        "full_name": data.get("full_name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "department": data.get("department"),
        "employee_id": employee_id,
        "status": "active",
        "address": data.get("address", ""),
        "emergency_contact": data.get("emergency_contact", ""),
    }

    try:
        add_employee(employee_data, hospital_id=scoped_hospital_id)
        return {
            "success": True,
            "message": f"Registration successful! Employee ID: {employee_id}",
            "is_first_user": is_first,
            "employee_id": employee_id,
            "username": data["username"],
            "user_type": user_type,
            "module_access": module_access,
        }
    except Exception as exc:  # pragma: no cover - defensive
        return {"success": False, "message": f"Registration failed: {exc}"}


def signup_hospital_admin(data: dict, hospital_id: Optional[int] = None) -> dict:
    """Create the first admin user for a hospital (one-time bootstrap)."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    if not check_if_first_user(hospital_id=scoped_hospital_id):
        return {"success": False, "message": "Admin already configured for this hospital."}

    password_error = validate_password(data.get("password", ""))
    if password_error:
        return {"success": False, "message": password_error}

    username = (data.get("username") or "").strip()
    if not username:
        return {"success": False, "message": "Username is required."}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ? AND hospital_id = ?", (username, scoped_hospital_id))
        if cursor.fetchone():
            return {"success": False, "message": "Username already exists"}

    employee_id = generate_employee_id(hospital_id=scoped_hospital_id)
    employee_data = {
        "username": username,
        "password_hash": hash_password(data["password"]),
        "role": "employee",
        "access_role": "owner",
        "user_type": "admin",
        "job_role": data.get("job_role") or "Hospital Admin",
        "full_name": data.get("full_name") or "Hospital Admin",
        "email": data.get("email"),
        "phone": data.get("phone"),
        "department": data.get("department") or "Administration",
        "employee_id": employee_id,
        "status": "active",
        "address": data.get("address", ""),
        "emergency_contact": data.get("emergency_contact", ""),
    }

    try:
        add_employee(employee_data, hospital_id=scoped_hospital_id)
        return {
            "success": True,
            "message": f"Hospital admin created. Employee ID: {employee_id}",
            "employee_id": employee_id,
            "username": username,
        }
    except Exception as exc:  # pragma: no cover - defensive
        return {"success": False, "message": f"Admin setup failed: {exc}"}


def reset_hospital_admin_password(hospital_id: int, username: str, new_password: str) -> dict:
    password_error = validate_password(new_password)
    if password_error:
        return {"success": False, "message": password_error}

    user_name = (username or "").strip()
    if not user_name:
        return {"success": False, "message": "Username is required."}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, access_role, status
            FROM users
            WHERE username = ? AND hospital_id = ?
            """,
            (user_name, hospital_id),
        )
        user = cursor.fetchone()
        if not user:
            return {"success": False, "message": "Admin account not found."}
        if user["access_role"] != "owner":
            return {"success": False, "message": "Target account is not a hospital admin."}

        cursor.execute(
            "UPDATE users SET password_hash = ?, status = 'active', password_changed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (hash_password(new_password), user["id"]),
        )
        cursor.execute("DELETE FROM sessions WHERE user_id = ? AND hospital_id = ?", (user["id"], hospital_id))
        conn.commit()
        return {"success": True, "message": "Admin password reset successfully."}


def check_username_exists(username: str, hospital_id: Optional[int] = None) -> bool:
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ? AND hospital_id = ?", (username, scoped_hospital_id))
        return cursor.fetchone() is not None


def purge_expired_sessions():
    now = _format_ts(_now_utc())
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.commit()


def create_session(user_id: int, hospital_id: int, ip_address: Optional[str] = None, user_agent: Optional[str] = None):
    purge_expired_sessions()
    expires_at = _now_utc() + timedelta(hours=SESSION_TTL_HOURS)
    expires_at_str = _format_ts(expires_at)

    with get_connection() as conn:
        cursor = conn.cursor()
        for _attempt in range(5):
            token = secrets.token_urlsafe(32)
            token_hash = _hash_session_token(token)
            try:
                cursor.execute(
                    """
                    INSERT INTO sessions (user_id, hospital_id, token_hash, expires_at, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                    (user_id, hospital_id, token_hash, expires_at_str, ip_address, user_agent),
                )
                conn.commit()
                return token, expires_at
            except Exception:  # pragma: no cover - extremely rare token collisions
                conn.rollback()
                continue

    raise RuntimeError("Failed to create session")


def get_session_user(token: Optional[str]):
    if not token:
        return None

    token_hash = _hash_session_token(token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT s.id as session_id,
                   s.expires_at as expires_at,
                   s.created_at as session_created_at,
                   s.hospital_id as hospital_id,
                   u.id as user_id,
                   u.username,
                   u.role,
                   u.access_role,
                   u.user_type,
                   u.module_access,
                   u.full_name,
                   u.email,
                   u.phone,
                   u.employee_id,
                   u.status,
                   u.password_changed_at,
                   h.code as hospital_code,
                   h.status as hospital_status
            FROM sessions s
            JOIN users u ON s.user_id = u.id AND s.hospital_id = u.hospital_id
            JOIN hospitals h ON s.hospital_id = h.id
            WHERE s.token_hash = ?
        """,
            (token_hash,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        expires_at = _parse_ts(row["expires_at"])
        if expires_at <= _now_utc():
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["password_changed_at"]:
            session_created_at = _parse_ts(row["session_created_at"])
            password_changed_at = _parse_ts(row["password_changed_at"])
            if session_created_at < password_changed_at:
                cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
                conn.commit()
                return None

        if row["status"] == "inactive":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["hospital_status"] != "active":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        cursor.execute(
            "UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE id = ?",
            (row["session_id"],),
        )
        conn.commit()

    profile = resolve_user_profile(
        {
            "id": row["user_id"],
            "hospital_id": row["hospital_id"],
            "username": row["username"],
            "role": row["role"],
            "access_role": row["access_role"],
            "user_type": row["user_type"],
            "module_access": row["module_access"],
            "full_name": row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "employee_id": row["employee_id"],
            "status": row["status"],
            "hospital_code": row["hospital_code"],
        }
    )
    # resolve_user_profile() intentionally omits internal DB ids from the client-safe
    # profile shape; re-attach them here (mirroring authenticate()) since callers like
    # current_hospital_id() and the session-management routes need them server-side.
    # Routes that jsonify this profile directly must strip "id" before responding,
    # the same way the login/setup-admin routes already do.
    profile["id"] = row["user_id"]
    profile["hospital_id"] = row["hospital_id"]
    return profile


def delete_session(token: Optional[str]):
    if not token:
        return
    token_hash = _hash_session_token(token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        conn.commit()

def get_user_sessions(user_id: int) -> list[dict]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, created_at, last_seen, ip_address, user_agent FROM sessions WHERE user_id = ?", (user_id,))
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]

def delete_specific_session(session_id: int, user_id: int):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
        conn.commit()

def delete_other_sessions(user_id: int, current_token: str):
    token_hash = _hash_session_token(current_token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user_id, token_hash))
        conn.commit()

def delete_all_user_sessions(user_id: int):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
