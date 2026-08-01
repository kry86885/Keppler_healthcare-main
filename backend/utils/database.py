import os
import sqlite3
import json
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager

from .embeddings import generate_embedding, cosine_similarity, encode_vector, decode_vector, EMBEDDING_MODEL

from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import DictCursor
except Exception:  # pragma: no cover - optional when using sqlite only
    psycopg2 = None
    DictCursor = None

try:
    import psycopg
except Exception:  # pragma: no cover - optional fallback
    psycopg = None

# Use project-level database so Streamlit and Flask share data
DEFAULT_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "healthcare.db"))
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=False)
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
DB_PATH_ENV = os.getenv("DB_PATH")
DB_PATH = DB_PATH_ENV or DEFAULT_DB_PATH
DB_ENGINE = (os.getenv("DB_ENGINE") or "sqlite").strip().lower()
IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
DEFAULT_HOSPITAL_CODE = (os.getenv("DEFAULT_HOSPITAL_CODE") or "hosp-default").strip().lower()
IS_POSTGRES = not DB_PATH_ENV and (
    DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")
)


def current_ist_datetime():
    return datetime.now(IST_TIMEZONE)


def current_ist_timestamp():
    return current_ist_datetime().isoformat(timespec="seconds")


def normalize_hospital_code(code):
    value = (code or DEFAULT_HOSPITAL_CODE).strip().lower()
    return value or DEFAULT_HOSPITAL_CODE


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def _to_sql_params(sql: str):
    if IS_POSTGRES:
        return sql.replace("?", "%s")
    return sql


def _resolve_sqlite_db_path():
    preferred_path = os.path.abspath(DB_PATH)
    preferred_dir = os.path.dirname(preferred_path) or "."
    try:
        os.makedirs(preferred_dir, exist_ok=True)
        if os.access(preferred_dir, os.W_OK):
            return preferred_path
    except OSError:
        pass

    fallback_path = os.path.abspath(DEFAULT_DB_PATH)
    fallback_dir = os.path.dirname(fallback_path) or "."
    os.makedirs(fallback_dir, exist_ok=True)
    return fallback_path


@contextmanager
def get_connection():
    if IS_POSTGRES:
        if psycopg2 is not None:
            conn = psycopg2.connect(_normalize_database_url(DATABASE_URL), cursor_factory=DictCursor)
        elif psycopg is not None:
            conn = psycopg.connect(_normalize_database_url(DATABASE_URL))
        else:
            raise RuntimeError(
                "PostgreSQL driver missing for DATABASE_URL. "
                "Install dependencies with `pip install -r backend/requirements.txt` "
                "or install either `psycopg2-binary` or `psycopg[binary]`. "
                "If you want SQLite locally, set DB_ENGINE=sqlite."
            )
        try:
            yield _CompatConnection(conn, postgres=True)
        finally:
            conn.close()
        return

    sqlite_path = _resolve_sqlite_db_path()
    conn = sqlite3.connect(sqlite_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield _CompatConnection(conn, postgres=False)
    finally:
        conn.close()


class _CompatConnection:
    def __init__(self, conn, postgres=False):
        self._conn = conn
        self._postgres = postgres

    def cursor(self):
        return _CompatCursor(self._conn.cursor(), self._postgres)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def __getattr__(self, name):
        return getattr(self._conn, name)


class _CompatCursor:
    def __init__(self, cursor, postgres=False):
        self._cursor = cursor
        self._postgres = postgres

    def execute(self, query, params=None):
        sql = _to_sql_params(query)
        if params is None:
            return self._cursor.execute(sql)
        return self._cursor.execute(sql, params)

    def executemany(self, query, seq_of_params):
        sql = _to_sql_params(query)
        return self._cursor.executemany(sql, seq_of_params)

    def fetchone(self):
        return self._wrap_row(self._cursor.fetchone())

    def fetchall(self):
        return [self._wrap_row(row) for row in self._cursor.fetchall()]

    @property
    def lastrowid(self):
        if self._postgres:
            try:
                self._cursor.execute("SELECT lastval()")
                val = self._cursor.fetchone()
                return val[0] if val else None
            except Exception:
                # If lastval() fails (e.g. no sequence was touched), safely ignore
                pass
        return getattr(self._cursor, "lastrowid", None)

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def _wrap_row(self, row):
        if row is None or not self._postgres:
            return row
        if hasattr(row, "keys"):
            return row
        description = getattr(self._cursor, "description", None) or []
        columns = [col[0] for col in description]
        if not columns:
            return row
        return _RowProxy(row, columns)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _RowProxy:
    def __init__(self, values, columns):
        self._values = tuple(values)
        self._columns = tuple(columns)
        self._index = {name: idx for idx, name in enumerate(self._columns)}

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return self._values[self._index[key]]

    def get(self, key, default=None):
        if key not in self._index:
            return default
        return self._values[self._index[key]]

    def items(self):
        return [(name, self._values[idx]) for idx, name in enumerate(self._columns)]

    def keys(self):
        return self._columns

    def __iter__(self):
        return iter(self.items())


def resolve_hospital_id(hospital_code=None):
    code = normalize_hospital_code(hospital_code)
    hospital = get_hospital_by_code(code)
    if hospital:
        return hospital["id"]
    hospital_id, _created = create_hospital(code)
    return hospital_id


def get_hospital_by_code(hospital_code):
    code = normalize_hospital_code(hospital_code)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM hospitals WHERE code = ?", (code,))
        return cursor.fetchone()


def create_hospital(hospital_code, name=None):
    code = normalize_hospital_code(hospital_code)
    hospital_name = (name or code.replace("-", " ").title()).strip() or "Default Hospital"
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM hospitals WHERE code = ?", (code,))
        existing = cursor.fetchone()
        if existing:
            return existing["id"], False
        if IS_POSTGRES:
            cursor.execute(
                """
                INSERT INTO hospitals (code, name, status)
                VALUES (?, ?, 'active')
                RETURNING id
                """,
                (code, hospital_name),
            )
            hospital_id = cursor.fetchone()[0]
        else:
            cursor.execute(
                """
                INSERT INTO hospitals (code, name, status)
                VALUES (?, ?, 'active')
                """,
                (code, hospital_name),
            )
            hospital_id = cursor.lastrowid
        conn.commit()
        return hospital_id, True


def list_hospitals():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, code, name, status, disabled_at, disabled_reason, created_at
            FROM hospitals
            ORDER BY created_at DESC, id DESC
            """
        )
        return cursor.fetchall()


def set_hospital_status(hospital_code, status, reason=None):
    status_value = (status or "").strip().lower()
    if status_value not in ("active", "inactive"):
        raise ValueError("status must be 'active' or 'inactive'")
    code = normalize_hospital_code(hospital_code)
    with get_connection() as conn:
        cursor = conn.cursor()
        if status_value == "inactive":
            cursor.execute(
                """
                UPDATE hospitals
                SET status = ?, disabled_at = CURRENT_TIMESTAMP, disabled_reason = ?
                WHERE code = ?
                """,
                (status_value, reason, code),
            )
        else:
            cursor.execute(
                """
                UPDATE hospitals
                SET status = ?, disabled_at = NULL, disabled_reason = NULL
                WHERE code = ?
                """,
                (status_value, code),
            )
        changed = cursor.rowcount > 0
        if changed and status_value == "inactive":
            cursor.execute(
                """
                DELETE FROM sessions
                WHERE hospital_id = (SELECT id FROM hospitals WHERE code = ?)
                """,
                (code,),
            )
        conn.commit()
        return changed


def init_database():
    with get_connection() as conn:
        cursor = conn.cursor()

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS hospitals (
                    id SERIAL PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                    disabled_at TIMESTAMP,
                    disabled_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS hospitals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                    disabled_at TIMESTAMP,
                    disabled_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        if not IS_POSTGRES:
            migrate_users_table_if_needed(conn)

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('employee', 'staff')),
                    access_role TEXT DEFAULT 'receptionist' CHECK(access_role IN ('receptionist', 'clinician', 'hr_manager', 'owner')),
                    user_type TEXT DEFAULT 'normal' CHECK(user_type IN ('admin', 'normal')),
                    module_access TEXT DEFAULT '[]',
                    job_role TEXT,
                    full_name TEXT,
                    email TEXT,
                    phone TEXT,
                    department TEXT,
                    employee_id TEXT UNIQUE,
                    date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                    address TEXT,
                    emergency_contact TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('employee', 'staff')),
                    access_role TEXT DEFAULT 'receptionist' CHECK(access_role IN ('receptionist', 'clinician', 'hr_manager', 'owner')),
                    user_type TEXT DEFAULT 'normal' CHECK(user_type IN ('admin', 'normal')),
                    module_access TEXT DEFAULT '[]',
                    job_role TEXT,
                    full_name TEXT,
                    email TEXT,
                    phone TEXT,
                    department TEXT,
                    employee_id TEXT UNIQUE,
                    date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                    address TEXT,
                    emergency_contact TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
                """
            )

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS patients (
                    id SERIAL PRIMARY KEY,
                    patient_id TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    middle_name TEXT,
                    last_name TEXT NOT NULL,
                    dob DATE,
                    age INTEGER,
                    weight REAL,
                    height REAL,
                    gender TEXT,
                    pregnant INTEGER DEFAULT 0,
                    allergies TEXT,
                    symptoms TEXT,
                    phone TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS patients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    patient_id TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    middle_name TEXT,
                    last_name TEXT NOT NULL,
                    dob DATE,
                    age INTEGER,
                    weight REAL,
                    height REAL,
                    gender TEXT,
                    pregnant INTEGER DEFAULT 0,
                    allergies TEXT,
                    symptoms TEXT,
                    phone TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS admissions (
                    id SERIAL PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    admission_date TIMESTAMP NOT NULL,
                    discharge_date DATE,
                    notes TEXT,
                    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS admissions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    patient_id TEXT NOT NULL,
                    admission_date TIMESTAMP NOT NULL,
                    discharge_date DATE,
                    notes TEXT,
                    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
                )
                """
            )

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id SERIAL PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    admission_id INTEGER,
                    doc_type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_name TEXT,
                    mime_type TEXT,
                    file_data BYTEA,
                    ocr_text TEXT,
                    ocr_language TEXT DEFAULT 'en',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                    FOREIGN KEY (admission_id) REFERENCES admissions(id)
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    patient_id TEXT NOT NULL,
                    admission_id INTEGER,
                    doc_type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_name TEXT,
                    mime_type TEXT,
                    file_data BLOB,
                    ocr_text TEXT,
                    ocr_language TEXT DEFAULT 'en',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                    FOREIGN KEY (admission_id) REFERENCES admissions(id)
                )
                """
            )

        if IS_POSTGRES:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS whatsapp_media (
                    token TEXT PRIMARY KEY,
                    content BYTEA NOT NULL,
                    mime_type TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS whatsapp_media (
                    token TEXT PRIMARY KEY,
                    content BLOB NOT NULL,
                    mime_type TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        ensure_hospital_columns(conn)
        ensure_patient_columns(conn)
        ensure_user_columns(conn)
        ensure_document_columns(conn)
        ensure_hospai_module_tables(conn)
        ensure_financial_hospital_columns(conn)
        ensure_operational_audit_columns(conn)
        ensure_vector_store_tables(conn)
        ensure_symptom_ai_tables(conn)
        ensure_ocr_portal_tables(conn)
        ensure_pharmacy_prescriptions_tables(conn)
        ensure_emr_tables(conn)
        ensure_patient_bulk_columns(conn)
        ensure_bulk_import_jobs_table(conn)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hospitals_code ON hospitals(code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_id ON patients(patient_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_phone ON patients(phone)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_name ON patients(name, last_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")

        conn.commit()


def migrate_users_table_if_needed(conn):
    """Migrate legacy users table role constraint (doctor/staff) to employee/staff."""
    if IS_POSTGRES:
        return
    cursor = conn.cursor()
    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    )
    row = cursor.fetchone()
    if not row or not row[0]:
        return
    table_sql = row[0]
    if "role IN ('doctor', 'staff')" not in table_sql:
        return

    cursor.execute("PRAGMA table_info(users)")
    existing_cols = [r[1] for r in cursor.fetchall()]
    expected_cols = [
        "username",
        "password_hash",
        "role",
        "access_role",
        "user_type",
        "module_access",
        "job_role",
        "full_name",
        "email",
        "phone",
        "department",
        "employee_id",
        "date_joined",
        "status",
        "address",
        "emergency_contact",
        "created_at",
    ]

    def select_expr(col):
        if col == "role":
            return "CASE role WHEN 'doctor' THEN 'employee' ELSE role END AS role"
        if col == "access_role":
            return "CASE role WHEN 'doctor' THEN 'clinician' WHEN 'staff' THEN 'receptionist' ELSE 'owner' END AS access_role"
        if col == "user_type":
            return "CASE role WHEN 'staff' THEN 'normal' ELSE 'admin' END AS user_type"
        if col == "module_access":
            return "'[]' AS module_access"
        if col == "job_role":
            return "NULL AS job_role"
        if col == "status":
            return "COALESCE(status, 'active') AS status" if col in existing_cols else "'active' AS status"
        if col in ("date_joined", "created_at") and col not in existing_cols:
            return f"CURRENT_TIMESTAMP AS {col}"
        return col if col in existing_cols else "NULL AS " + col

    select_list = ", ".join(select_expr(c) for c in expected_cols)
    insert_cols = ", ".join(expected_cols)

    cursor.execute("ALTER TABLE users RENAME TO users_old")
    cursor.execute(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('employee', 'staff')),
            access_role TEXT DEFAULT 'receptionist' CHECK(access_role IN ('receptionist', 'clinician', 'hr_manager', 'owner')),
            user_type TEXT DEFAULT 'normal' CHECK(user_type IN ('admin', 'normal')),
            module_access TEXT DEFAULT '[]',
            job_role TEXT,
            full_name TEXT,
            email TEXT,
            phone TEXT,
            department TEXT,
            employee_id TEXT UNIQUE,
            date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            address TEXT,
            emergency_contact TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"INSERT INTO users ({insert_cols}) SELECT {select_list} FROM users_old"
    )
    cursor.execute("DROP TABLE users_old")


def ensure_hospital_columns(conn):
    cursor = conn.cursor()

    id_type = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS hospitals (
            id {id_type},
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            disabled_at TIMESTAMP,
            disabled_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    if IS_POSTGRES:
        cursor.execute(
            """
            INSERT INTO hospitals (code, name, status)
            VALUES (?, ?, 'active')
            ON CONFLICT (code) DO NOTHING
            """,
            (DEFAULT_HOSPITAL_CODE, "Default Hospital"),
        )
    else:
        cursor.execute(
            """
            INSERT OR IGNORE INTO hospitals (code, name, status)
            VALUES (?, ?, 'active')
            """,
            (DEFAULT_HOSPITAL_CODE, "Default Hospital"),
        )
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", (DEFAULT_HOSPITAL_CODE,))
    default_row = cursor.fetchone()
    if not default_row:
        return
    default_hospital_id = default_row[0]

    for table_name in ("users", "sessions", "patients", "admissions", "documents"):
        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = ? AND column_name = 'hospital_id'
                """,
                (table_name,),
            )
            has_hospital_col = cursor.fetchone() is not None
            if not has_hospital_col:
                cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN hospital_id INTEGER")
        else:
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = {row[1] for row in cursor.fetchall()}
            if "hospital_id" not in columns:
                cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN hospital_id INTEGER")

        cursor.execute(
            f"UPDATE {table_name} SET hospital_id = ? WHERE hospital_id IS NULL",
            (default_hospital_id,),
        )


# Tables that identify a patient only by their (per-hospital, not globally
# unique) patient_id string -- generate_patient_id() resets its sequence per
# hospital_id, so two different hospitals can produce the identical
# "PAT-YYYYMMDD-NNNN" on the same day. Without their own hospital_id, every
# aggregate/list query on these tables risks silently merging two different
# patients' billing/lab/pharmacy records if their hospitals collide on an id.
_FINANCIAL_TABLES_WITH_PATIENT_ID = ("appointments", "invoices", "diagnostics", "pharmacy_sales", "encounters")


def ensure_financial_hospital_columns(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", (DEFAULT_HOSPITAL_CODE,))
    default_row = cursor.fetchone()
    if not default_row:
        return
    default_hospital_id = default_row[0]

    for table_name in _FINANCIAL_TABLES_WITH_PATIENT_ID:
        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = ? AND column_name = 'hospital_id'
                """,
                (table_name,),
            )
            has_hospital_col = cursor.fetchone() is not None
        else:
            cursor.execute(f"PRAGMA table_info({table_name})")
            has_hospital_col = "hospital_id" in {row[1] for row in cursor.fetchall()}

        if not has_hospital_col:
            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN hospital_id INTEGER")

        # Backfill from the owning patient's hospital where possible -- a blind
        # default would silently mix data if this table already holds rows
        # from more than one hospital.
        cursor.execute(
            f"""
            UPDATE {table_name}
            SET hospital_id = (
                SELECT p.hospital_id FROM patients p WHERE p.patient_id = {table_name}.patient_id
            )
            WHERE hospital_id IS NULL
            """
        )
        cursor.execute(
            f"UPDATE {table_name} SET hospital_id = ? WHERE hospital_id IS NULL",
            (default_hospital_id,),
        )

    # invoice_payments has no patient_id of its own -- backfill through the invoice it belongs to.
    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'invoice_payments' AND column_name = 'hospital_id'
            """
        )
        payments_has_hospital_col = cursor.fetchone() is not None
    else:
        cursor.execute("PRAGMA table_info(invoice_payments)")
        payments_has_hospital_col = "hospital_id" in {row[1] for row in cursor.fetchall()}

    if not payments_has_hospital_col:
        cursor.execute("ALTER TABLE invoice_payments ADD COLUMN hospital_id INTEGER")

    cursor.execute(
        """
        UPDATE invoice_payments
        SET hospital_id = (
            SELECT i.hospital_id FROM invoices i WHERE i.id = invoice_payments.invoice_id
        )
        WHERE hospital_id IS NULL
        """
    )
    cursor.execute(
        "UPDATE invoice_payments SET hospital_id = ? WHERE hospital_id IS NULL",
        (default_hospital_id,),
    )

    conn.commit()


def ensure_department_master_scope(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM hospitals WHERE code = ?", (DEFAULT_HOSPITAL_CODE,))
    default_row = cursor.fetchone()
    if not default_row:
        return
    default_hospital_id = default_row[0]

    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'department_master'
            """
        )
        columns = {row[0] for row in cursor.fetchall()}
        if "hospital_id" not in columns:
            cursor.execute("ALTER TABLE department_master ADD COLUMN hospital_id INTEGER")
        cursor.execute(
            "UPDATE department_master SET hospital_id = ? WHERE hospital_id IS NULL",
            (default_hospital_id,),
        )
        cursor.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_department_master_hospital_name
            ON department_master(hospital_id, department_name)
            """
        )
        return

    cursor.execute("PRAGMA table_info(department_master)")
    columns_info = cursor.fetchall()
    columns = {row[1] for row in columns_info}
    cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='department_master'"
    )
    table_row = cursor.fetchone()
    table_sql = (table_row[0] or "").lower() if table_row else ""
    has_legacy_global_unique = "department_name text unique" in table_sql

    needs_rebuild = "hospital_id" not in columns or has_legacy_global_unique
    if needs_rebuild:
        old_hospital_expr = "hospital_id" if "hospital_id" in columns else "NULL"
        old_head_expr = "mapped_head_employee_id" if "mapped_head_employee_id" in columns else "NULL"
        old_created_expr = "created_at" if "created_at" in columns else "CURRENT_TIMESTAMP"
        id_type = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
        cursor.execute("ALTER TABLE department_master RENAME TO department_master_old")
        cursor.execute(
            f"""
            CREATE TABLE department_master (
                id {id_type},
                hospital_id INTEGER NOT NULL,
                department_name TEXT NOT NULL,
                mapped_head_employee_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(hospital_id, department_name)
            )
            """
        )
        insert_conflict = "ON CONFLICT DO NOTHING" if IS_POSTGRES else ""
        insert_prefix = "INSERT INTO" if IS_POSTGRES else "INSERT OR IGNORE INTO"
        cursor.execute(
            f"""
            {insert_prefix} department_master (
                id, hospital_id, department_name, mapped_head_employee_id, created_at
            )
            SELECT
                id,
                COALESCE({old_hospital_expr}, ?),
                department_name,
                {old_head_expr},
                {old_created_expr}
            FROM department_master_old
            {insert_conflict}
            """,
            (default_hospital_id,),
        )
        cursor.execute("DROP TABLE department_master_old")
    else:
        cursor.execute(
            "UPDATE department_master SET hospital_id = ? WHERE hospital_id IS NULL",
            (default_hospital_id,),
        )

    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_department_master_hospital ON department_master(hospital_id)"
    )
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_department_master_hospital_name ON department_master(hospital_id, department_name)"
    )


def ensure_patient_columns(conn):
    cursor = conn.cursor()
    _ensure_column(cursor, "patients", "address", "TEXT", "TEXT")
    _ensure_column(cursor, "patients", "blood_group", "TEXT", "TEXT")
    _ensure_column(cursor, "patients", "emergency_contact", "TEXT", "TEXT")
    _ensure_column(cursor, "patients", "aadhar_number", "TEXT", "TEXT")

def ensure_user_columns(conn):
    """Add any missing columns to users table for older databases."""
    cursor = conn.cursor()
    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'users'
            """
        )
        existing = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(users)")
        existing = {row[1] for row in cursor.fetchall()}
    expected = {
        "hospital_id": "INTEGER",
        "username": "TEXT",
        "password_hash": "TEXT",
        "role": "TEXT",
        "access_role": "TEXT DEFAULT 'receptionist'",
        "user_type": "TEXT DEFAULT 'normal'",
        "module_access": "TEXT DEFAULT '[]'",
        "job_role": "TEXT",
        "full_name": "TEXT",
        "email": "TEXT",
        "phone": "TEXT",
        "department": "TEXT",
        "employee_id": "TEXT",
        "date_joined": "TIMESTAMP",
        "status": "TEXT DEFAULT 'active'",
        "address": "TEXT",
        "emergency_contact": "TEXT",
        "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "password_changed_at": "TIMESTAMP",
    }
    for column, col_type in expected.items():
        if column not in existing:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {column} {col_type}")
    cursor.execute("UPDATE users SET status='active' WHERE status IS NULL")
    cursor.execute(
        """
        UPDATE users
        SET access_role = CASE
            WHEN role = 'employee' THEN 'owner'
            WHEN role = 'staff' THEN 'receptionist'
            ELSE 'receptionist'
        END
        WHERE access_role IS NULL OR TRIM(access_role) = ''
    """
    )
    cursor.execute(
        """
        UPDATE users
        SET user_type = CASE
            WHEN access_role IN ('owner', 'hr_manager') THEN 'admin'
            WHEN role = 'employee' THEN 'admin'
            ELSE 'normal'
        END
        WHERE user_type IS NULL OR TRIM(user_type) = ''
    """
    )
    default_modules_normal = json.dumps(["dashboard", "patients", "symptom_ai"], separators=(",", ":"))
    default_modules_admin = json.dumps(
        ["dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "ot", "accounts", "reports", "symptom_ai"],
        separators=(",", ":"),
    )
    cursor.execute(
        """
        UPDATE users
        SET module_access = CASE
            WHEN user_type = 'admin' THEN ?
            ELSE ?
        END
        WHERE module_access IS NULL OR TRIM(module_access) = '' OR TRIM(module_access) = '[]'
    """,
        (default_modules_admin, default_modules_normal),
    )


def ensure_document_columns(conn):
    """Add any missing document storage columns for older databases."""
    cursor = conn.cursor()
    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'documents'
            """
        )
        existing = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(documents)")
        existing = {row[1] for row in cursor.fetchall()}
    if "file_name" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN file_name TEXT")
    if "mime_type" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN mime_type TEXT")
    if "file_data" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN file_data BYTEA" if IS_POSTGRES else "ALTER TABLE documents ADD COLUMN file_data BLOB")
    if "structured_data" not in existing:
        cursor.execute("ALTER TABLE documents ADD COLUMN structured_data TEXT")


def ensure_hospai_module_tables(conn):
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS encounters (
            id {id_column},
            patient_id TEXT NOT NULL,
            encounter_type TEXT NOT NULL CHECK(encounter_type IN ('OP', 'IP')),
            arrival_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            insurance_provider TEXT,
            insurance_policy_no TEXT,
            is_accident INTEGER DEFAULT 0,
            referral_source TEXT,
            referral_name TEXT,
            status TEXT DEFAULT 'active',
            created_by TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bed_allocations (
            id {id_column},
            admission_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            ward TEXT,
            room_no TEXT,
            bed_no TEXT,
            allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            released_at TIMESTAMP,
            status TEXT DEFAULT 'active'
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS medication_schedules (
            id {id_column},
            patient_id TEXT NOT NULL,
            medicine_name TEXT NOT NULL,
            dosage TEXT,
            schedule_time TIMESTAMP NOT NULL,
            administered INTEGER DEFAULT 0,
            alert_enabled INTEGER DEFAULT 1,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS observation_notes (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            doctor_name TEXT,
            note TEXT NOT NULL,
            treatment_plan TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS patient_movements (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            from_department TEXT,
            to_department TEXT NOT NULL,
            moved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            moved_by TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS invoices (
            id {id_column},
            invoice_no TEXT UNIQUE NOT NULL,
            patient_id TEXT,
            module TEXT NOT NULL CHECK(module IN ('OP', 'IP', 'LAB', 'PHARMACY')),
            doctor_name TEXT,
            clinic_name TEXT,
            referral_source TEXT,
            subtotal REAL DEFAULT 0,
            tax REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            payment_status TEXT DEFAULT 'due' CHECK(payment_status IN ('paid', 'partial', 'due', 'refunded')),
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'invoices'
            """
        )
        invoice_columns = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(invoices)")
        invoice_columns = {row[1] for row in cursor.fetchall()}
    if "advance_amount" not in invoice_columns:
        cursor.execute("ALTER TABLE invoices ADD COLUMN advance_amount REAL DEFAULT 0")
    if "refunded_amount" not in invoice_columns:
        cursor.execute("ALTER TABLE invoices ADD COLUMN refunded_amount REAL DEFAULT 0")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS invoice_payments (
            id {id_column},
            invoice_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'card', 'upi', 'bank')),
            gateway_ref TEXT,
            converted_from_mode TEXT,
            converted_to_mode TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS insurance_claims (
            id {id_column},
            invoice_id INTEGER NOT NULL,
            patient_id TEXT,
            insurer_name TEXT NOT NULL,
            claim_amount REAL NOT NULL,
            approved_amount REAL DEFAULT 0,
            claim_status TEXT NOT NULL DEFAULT 'submitted' CHECK(claim_status IN ('submitted', 'under_review', 'approved', 'rejected', 'settled')),
            external_ref TEXT,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_inventory (
            id {id_column},
            medicine_name TEXT NOT NULL,
            batch_no TEXT,
            quantity INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER DEFAULT 10,
            unit_price REAL DEFAULT 0,
            expiry_date DATE,
            stock_condition TEXT DEFAULT 'proper' CHECK(stock_condition IN ('proper', 'damaged')),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_sales (
            id {id_column},
            invoice_id INTEGER,
            medicine_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            amount REAL NOT NULL,
            sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'pharmacy_sales'
            """
        )
        pharmacy_sales_columns = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(pharmacy_sales)")
        pharmacy_sales_columns = {row[1] for row in cursor.fetchall()}
    if "patient_id" not in pharmacy_sales_columns:
        cursor.execute("ALTER TABLE pharmacy_sales ADD COLUMN patient_id TEXT")
    if "prescription_ref" not in pharmacy_sales_columns:
        cursor.execute("ALTER TABLE pharmacy_sales ADD COLUMN prescription_ref TEXT")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_suppliers (
            id {id_column},
            supplier_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS pharmacy_purchases (
            id {id_column},
            supplier_id INTEGER,
            medicine_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_cost REAL NOT NULL,
            total_cost REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered', 'received', 'cancelled')),
            expected_date DATE,
            received_date DATE,
            stock_applied INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS lab_vendors (
            id {id_column},
            vendor_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            status TEXT DEFAULT 'active'
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS diagnostics (
            id {id_column},
            invoice_no TEXT,
            patient_id TEXT,
            vendor_id INTEGER,
            doctor_name TEXT,
            test_name TEXT NOT NULL,
            amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'due' CHECK(status IN ('paid', 'partial', 'due')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'diagnostics'
            """
        )
        diagnostic_columns = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(diagnostics)")
        diagnostic_columns = {row[1] for row in cursor.fetchall()}
    if "sample_barcode" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN sample_barcode TEXT")
    if "order_status" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN order_status TEXT DEFAULT 'ordered'")
    if "collected_at" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN collected_at TIMESTAMP")
    if "reported_at" not in diagnostic_columns:
        cursor.execute("ALTER TABLE diagnostics ADD COLUMN reported_at TIMESTAMP")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS department_master (
            id {id_column},
            hospital_id INTEGER,
            department_name TEXT NOT NULL,
            mapped_head_employee_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(hospital_id, department_name)
        )
        """
    )
    ensure_department_master_scope(conn)

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS attendance (
            id {id_column},
            employee_id TEXT NOT NULL,
            attendance_date DATE NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'leave')),
            in_time TEXT,
            out_time TEXT,
            notes TEXT
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS payroll (
            id {id_column},
            employee_id TEXT NOT NULL,
            payroll_month TEXT NOT NULL,
            basic_salary REAL NOT NULL,
            allowances REAL DEFAULT 0,
            deductions REAL DEFAULT 0,
            net_salary REAL NOT NULL,
            paid_status TEXT DEFAULT 'pending' CHECK(paid_status IN ('pending', 'paid')),
            paid_date DATE
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS leave_requests (
            id {id_column},
            employee_id TEXT NOT NULL,
            leave_type TEXT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            decided_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id {id_column},
            actor_username TEXT,
            action TEXT NOT NULL,
            module_name TEXT NOT NULL,
            entity_key TEXT,
            payload TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS appointments (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            visit_type TEXT NOT NULL CHECK(visit_type IN ('OP', 'IP')),
            department TEXT,
            doctor_name TEXT,
            appointment_date TIMESTAMP NOT NULL,
            token_no INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    if IS_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'appointments'
            """
        )
        appointment_columns = {row[0] for row in cursor.fetchall()}
    else:
        cursor.execute("PRAGMA table_info(appointments)")
        appointment_columns = {row[1] for row in cursor.fetchall()}
    if "appointment_kind" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN appointment_kind TEXT DEFAULT 'new'")
    if "follow_up_for" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN follow_up_for INTEGER")
    if "reminder_sent_at" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN reminder_sent_at TIMESTAMP")
    if "no_show_marked" not in appointment_columns:
        cursor.execute("ALTER TABLE appointments ADD COLUMN no_show_marked INTEGER DEFAULT 0")

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS doctor_schedules (
            id {id_column},
            doctor_name TEXT NOT NULL,
            department TEXT,
            schedule_date DATE NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            slot_capacity INTEGER DEFAULT 12,
            status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'full', 'leave')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS doctors (
            id {id_column},
            doctor_name TEXT NOT NULL,
            department TEXT,
            consultation_fee REAL DEFAULT 0,
            review_fee REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'leave')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS patient_consents (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            consent_type TEXT NOT NULL CHECK(consent_type IN ('general', 'procedure', 'privacy', 'insurance')),
            signed_by TEXT NOT NULL,
            relation_to_patient TEXT,
            status TEXT NOT NULL DEFAULT 'signed' CHECK(status IN ('signed', 'revoked')),
            notes TEXT,
            signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS insurance_verifications (
            id {id_column},
            patient_id TEXT,
            patient_name TEXT NOT NULL,
            insurer_name TEXT NOT NULL,
            policy_number TEXT,
            member_id TEXT,
            verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending', 'verified', 'rejected')),
            coverage_notes TEXT,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS certificates (
            id {id_column},
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            certificate_type TEXT NOT NULL CHECK(certificate_type IN ('discharge_summary', 'medical_certificate', 'insurance_document', 'fit_to_work')),
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            issued_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ot_theatres (
            id {id_column},
            theatre_code TEXT NOT NULL UNIQUE,
            theatre_name TEXT NOT NULL,
            equipment_notes TEXT,
            status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'maintenance', 'occupied')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ot_surgeries (
            id {id_column},
            theatre_id INTEGER NOT NULL,
            patient_id TEXT,
            procedure_name TEXT NOT NULL,
            surgeon_name TEXT NOT NULL,
            scheduled_start TIMESTAMP NOT NULL,
            estimated_duration_hours REAL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
            equipment_required TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS accounts_ledger (
            id {id_column},
            entry_date DATE NOT NULL,
            entry_type TEXT NOT NULL CHECK(entry_type IN ('income', 'expense', 'adjustment')),
            category TEXT NOT NULL,
            reference_no TEXT,
            counterparty_name TEXT,
            amount REAL NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS vendor_payments (
            id {id_column},
            vendor_name TEXT NOT NULL,
            invoice_ref TEXT,
            amount REAL NOT NULL,
            payment_date DATE NOT NULL,
            payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'card', 'upi', 'bank')),
            status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('pending', 'partial', 'paid')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS doctor_payouts (
            id {id_column},
            doctor_name TEXT NOT NULL,
            payout_month TEXT NOT NULL,
            amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            due_amount REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'paid')),
            paid_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_patient ON invoices(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoices(payment_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_payments_invoice ON invoice_payments(invoice_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_claims_invoice ON insurance_claims(invoice_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(claim_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_patient ON pharmacy_sales(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_pharmacy_purchases_supplier ON pharmacy_purchases(supplier_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_diagnostics_patient ON diagnostics(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leave_requests(employee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_schedules_date ON doctor_schedules(schedule_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor ON doctor_schedules(doctor_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_patient_consents_patient ON patient_consents(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_insurance_verifications_patient ON insurance_verifications(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_certificates_patient ON certificates(patient_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ot_surgeries_theatre ON ot_surgeries(theatre_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ot_surgeries_status ON ot_surgeries(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_ledger_type ON accounts_ledger(entry_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments(vendor_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_doctor_payouts_doctor ON doctor_payouts(doctor_name)")


# ==================== Schema hardening: uuid + audit/soft-delete columns ====================

# Every operational/domain table (system tables -- hospitals, users, sessions, audit_logs --
# are intentionally excluded; they have their own identity/audit semantics already).
OPERATIONAL_TABLES = (
    "patients", "admissions", "documents", "encounters", "bed_allocations",
    "medication_schedules", "observation_notes", "patient_movements",
    "invoices", "invoice_payments", "insurance_claims",
    "pharmacy_inventory", "pharmacy_sales", "pharmacy_suppliers", "pharmacy_purchases",
    "lab_vendors", "diagnostics", "department_master", "attendance", "payroll", "leave_requests",
    "appointments", "doctor_schedules", "patient_consents", "insurance_verifications", "certificates",
    "ot_theatres", "ot_surgeries", "accounts_ledger", "vendor_payments", "doctor_payouts",
)


def _table_columns(cursor, table_name: str) -> set:
    if IS_POSTGRES:
        cursor.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
            (table_name,),
        )
        return {row[0] for row in cursor.fetchall()}
    cursor.execute(f"PRAGMA table_info({table_name})")
    return {row[1] for row in cursor.fetchall()}


def _ensure_column(cursor, table_name: str, column_name: str, sqlite_type: str, postgres_type: str):
    existing = _table_columns(cursor, table_name)
    if column_name in existing:
        return
    column_type = postgres_type if IS_POSTGRES else sqlite_type
    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")


def soft_delete_row(cursor, table_name, id_column, id_value, hospital_id=None, actor=None):
    """Mark a row deleted_at/deleted_by instead of physically removing it.

    Returns True if a row was updated (i.e. existed and wasn't already deleted).
    """
    where = f"{id_column} = ? AND deleted_at IS NULL"
    params = [id_value]
    if hospital_id is not None:
        where += " AND hospital_id = ?"
        params.append(hospital_id)
    cursor.execute(
        f"UPDATE {table_name} SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE {where}",
        (actor, *params),
    )
    return cursor.rowcount > 0


def ensure_operational_audit_columns(conn):
    """Add uuid + created_by/updated_by/deleted_by/deleted_at to every operational table.

    Purely additive: existing integer primary keys, foreign keys, and API response shapes
    are untouched. uuid is populated for new rows via a DB-level default/trigger (Postgres
    gen_random_uuid(), SQLite AFTER INSERT trigger) so no INSERT call site needs to change.
    """
    cursor = conn.cursor()

    for table_name in OPERATIONAL_TABLES:
        _ensure_column(cursor, table_name, "uuid", "TEXT", "TEXT")
        _ensure_column(cursor, table_name, "created_by", "TEXT", "TEXT")
        _ensure_column(cursor, table_name, "updated_by", "TEXT", "TEXT")
        _ensure_column(cursor, table_name, "deleted_by", "TEXT", "TEXT")
        _ensure_column(cursor, table_name, "deleted_at", "TIMESTAMP", "TIMESTAMP")

        # Backfill uuid for any existing rows (idempotent: only touches NULLs).
        cursor.execute(f"SELECT id FROM {table_name} WHERE uuid IS NULL")
        missing_ids = [row[0] for row in cursor.fetchall()]
        for row_id in missing_ids:
            cursor.execute(
                f"UPDATE {table_name} SET uuid = ? WHERE id = ?",
                (str(uuid_lib.uuid4()), row_id),
            )

        cursor.execute(
            f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name}_uuid ON {table_name}(uuid)"
        )
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table_name}_deleted_at ON {table_name}(deleted_at)"
        )

        if IS_POSTGRES:
            # Native since Postgres 13, no pgcrypto/uuid-ossp extension required.
            cursor.execute(
                f"ALTER TABLE {table_name} ALTER COLUMN uuid SET DEFAULT gen_random_uuid()::text"
            )
        else:
            cursor.execute(
                f"""
                CREATE TRIGGER IF NOT EXISTS trg_{table_name}_uuid
                AFTER INSERT ON {table_name}
                WHEN NEW.uuid IS NULL
                BEGIN
                    UPDATE {table_name} SET uuid = (
                        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                        substr(lower(hex(randomblob(2))), 2) || '-' ||
                        substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
                        lower(hex(randomblob(6)))
                    )
                    WHERE rowid = NEW.rowid;
                END;
                """
            )

    # Composite indexes for common tenant-scoped dashboard/report lookups.
    composite_indexes = [
        ("idx_patients_hospital_created", "patients", "hospital_id, created_at"),
        ("idx_invoices_hospital_status", "invoices", "hospital_id, payment_status"),
        ("idx_invoices_hospital_created", "invoices", "hospital_id, created_at"),
        ("idx_diagnostics_hospital_created", "diagnostics", "hospital_id, created_at"),
        ("idx_pharmacy_sales_hospital_sold", "pharmacy_sales", "hospital_id, sold_at"),
        ("idx_appointments_hospital_date", "appointments", "hospital_id, appointment_date"),
        ("idx_attendance_hospital_date", "attendance", "hospital_id, attendance_date"),
        ("idx_admissions_hospital_date", "admissions", "hospital_id, admission_date"),
    ]
    for index_name, table_name, columns in composite_indexes:
        table_columns = _table_columns(cursor, table_name)
        required_columns = {c.strip() for c in columns.split(",")}
        if not required_columns.issubset(table_columns):
            continue
        cursor.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name}({columns})")

    conn.commit()


def ensure_vector_store_tables(conn):
    """RAG/vector store for clinical documents (Phase C).

    Vectors are stored as JSON-encoded float arrays and compared via cosine similarity
    in Python -- portable across SQLite and Postgres without requiring the Postgres
    `vector` extension to be pre-installed. See utils/embeddings.py for rationale.
    """
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS clinical_document_embeddings (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT,
            source_table TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            content_text TEXT NOT NULL,
            embedding TEXT,
            embedding_model TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_hospital "
        "ON clinical_document_embeddings(hospital_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_source "
        "ON clinical_document_embeddings(source_table, source_id)"
    )

    # Phase H Tables
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bed_master (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            ward TEXT NOT NULL,
            room_no TEXT NOT NULL,
            bed_no TEXT NOT NULL,
            status TEXT DEFAULT 'Available',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS icu_monitoring (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            heart_rate INTEGER,
            blood_pressure TEXT,
            spo2 INTEGER,
            ventilator_active BOOLEAN DEFAULT 0,
            critical_alerts TEXT,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS opd_queue (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            department TEXT NOT NULL,
            doctor_id TEXT,
            token_number INTEGER NOT NULL,
            status TEXT DEFAULT 'Waiting',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS emergency_triage (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            priority TEXT NOT NULL,
            chief_complaint TEXT NOT NULL,
            arrival_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'Pending'
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ambulances (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            vehicle_number TEXT NOT NULL,
            driver_name TEXT,
            driver_phone TEXT,
            status TEXT DEFAULT 'Available',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ambulance_dispatch (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            ambulance_id INTEGER NOT NULL,
            patient_id TEXT,
            pickup_location TEXT NOT NULL,
            drop_location TEXT NOT NULL,
            dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completion_time TIMESTAMP,
            status TEXT DEFAULT 'En Route'
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS nurse_shifts (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            nurse_id TEXT NOT NULL,
            ward TEXT NOT NULL,
            shift_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            shift_end TIMESTAMP,
            handover_notes TEXT
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS nursing_notes (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            nurse_id TEXT NOT NULL,
            note TEXT NOT NULL,
            vitals TEXT,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_patient "
        "ON clinical_document_embeddings(patient_id)"
    )
    conn.commit()


def ensure_symptom_ai_tables(conn):
    """Personal document vault + chat history for the Symptom AI 'Ask About Your
    Documents' tab -- scoped per hospital + username, independent of clinical
    patient records (this is a staff-user knowledge base, not part of a patient chart).
    """
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS symptom_ai_documents (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            filename TEXT NOT NULL,
            doc_category TEXT,
            raw_text TEXT,
            created_by TEXT,
            deleted_by TEXT,
            deleted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_symptom_ai_documents_owner "
        "ON symptom_ai_documents(hospital_id, username)"
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS symptom_ai_chat_messages (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_symptom_ai_chat_owner "
        "ON symptom_ai_chat_messages(hospital_id, username, session_id)"
    )
    conn.commit()


def create_symptom_ai_document(hospital_id, username, filename, doc_category, raw_text):
    with get_connection() as conn:
        cursor = conn.cursor()
        # cursor.lastrowid is not reliable under psycopg2 (always reads back 0) -- RETURNING
        # id works on both engines (SQLite 3.35+ / all supported Postgres versions), so use it
        # here rather than relying on the lastrowid convention most of this file still uses.
        cursor.execute(
            """
            INSERT INTO symptom_ai_documents (hospital_id, username, filename, doc_category, raw_text, created_by)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (hospital_id, username, filename, doc_category, raw_text, username),
        )
        document_id = cursor.fetchone()[0]
        conn.commit()
        return document_id


def list_symptom_ai_documents(hospital_id, username):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, filename, doc_category, created_at FROM symptom_ai_documents
            WHERE hospital_id = ? AND username = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (hospital_id, username),
        )
        return cursor.fetchall()


def get_symptom_ai_document(document_id, hospital_id, username):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM symptom_ai_documents
            WHERE id = ? AND hospital_id = ? AND username = ? AND deleted_at IS NULL
            """,
            (document_id, hospital_id, username),
        )
        return cursor.fetchone()


def delete_symptom_ai_document(document_id, hospital_id, username, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM symptom_ai_documents WHERE id = ? AND hospital_id = ? AND username = ? AND deleted_at IS NULL",
            (document_id, hospital_id, username),
        )
        if not cursor.fetchone():
            return False
        deleted = soft_delete_row(cursor, "symptom_ai_documents", "id", document_id, hospital_id=hospital_id, actor=actor)
        conn.commit()
        return deleted


def save_symptom_ai_chat_message(hospital_id, username, session_id, role, content):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO symptom_ai_chat_messages (hospital_id, username, session_id, role, content)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """,
            (hospital_id, username, session_id, role, content),
        )
        message_id = cursor.fetchone()[0]
        conn.commit()
        return message_id


def list_symptom_ai_chat_history(hospital_id, username, session_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if session_id:
            cursor.execute(
                """
                SELECT role, content, session_id, created_at FROM symptom_ai_chat_messages
                WHERE hospital_id = ? AND username = ? AND session_id = ?
                ORDER BY created_at ASC
                """,
                (hospital_id, username, session_id),
            )
        else:
            cursor.execute(
                """
                SELECT role, content, session_id, created_at FROM symptom_ai_chat_messages
                WHERE hospital_id = ? AND username = ?
                ORDER BY created_at ASC
                """,
                (hospital_id, username),
            )
        return cursor.fetchall()


def delete_symptom_ai_chat_history(hospital_id, username):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM symptom_ai_chat_messages WHERE hospital_id = ? AND username = ?",
            (hospital_id, username),
        )
        conn.commit()
        return cursor.rowcount > 0


def ensure_ocr_portal_tables(conn):
    """Maps each (hospital, username) to its own auto-provisioned account on the
    separate OCR/document-intelligence service (see backend/ai/ocr_portal_client.py)
    -- so every user gets their own isolated documents/jobs/chat history there
    instead of a shared account, without that service knowing anything about
    hospitals or Hosp AI sessions itself.
    """
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ocr_service_accounts (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            ocr_username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL,
            ocr_user_id INTEGER,
            access_token TEXT,
            token_expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_service_accounts_owner "
        "ON ocr_service_accounts(hospital_id, username)"
    )
    conn.commit()


def get_ocr_service_account(hospital_id, username):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT hospital_id, username, ocr_username, encrypted_password, ocr_user_id, "
            "access_token, token_expires_at FROM ocr_service_accounts "
            "WHERE hospital_id = ? AND username = ?",
            (hospital_id, username),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def create_ocr_service_account(hospital_id, username, ocr_username, encrypted_password, ocr_user_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO ocr_service_accounts "
            "(hospital_id, username, ocr_username, encrypted_password, ocr_user_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (hospital_id, username, ocr_username, encrypted_password, ocr_user_id),
        )
        conn.commit()


def update_ocr_service_account_token(hospital_id, username, access_token, token_expires_at):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE ocr_service_accounts SET access_token = ?, token_expires_at = ? "
            "WHERE hospital_id = ? AND username = ?",
            (access_token, token_expires_at, hospital_id, username),
        )
        conn.commit()


def store_document_embedding(source_table, source_id, content_text, hospital_id=None, patient_id=None):
    """Embed and store a clinical document/certificate chunk for later semantic search.

    Returns the new row id, or None if embeddings are unavailable (no GEMINI_API_KEY
    configured) -- callers should treat this as a soft failure, not an error, since
    OCR/document upload must keep working even when the embedding provider is unset.
    """
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    vector = generate_embedding(content_text)
    if vector is None:
        return None
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO clinical_document_embeddings (
                hospital_id, patient_id, source_table, source_id, content_text, embedding, embedding_model
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scoped_hospital_id,
                patient_id,
                source_table,
                source_id,
                content_text,
                encode_vector(vector),
                EMBEDDING_MODEL,
            ),
        )
        conn.commit()
        return cursor.lastrowid


def search_similar_documents(query_text, hospital_id=None, patient_id=None, k=5):
    """Return the top-k most semantically similar stored document chunks.

    Brute-force cosine similarity in Python -- fine at the row counts a single hospital's
    clinical documents realistically reach; a native pgvector index is a storage-layer
    optimization for later, not a change to this function's contract.
    """
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    query_vector = generate_embedding(query_text)
    if query_vector is None:
        return []
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                """
                SELECT id, patient_id, source_table, source_id, content_text, embedding
                FROM clinical_document_embeddings
                WHERE hospital_id = ? AND patient_id = ? AND embedding IS NOT NULL
                """,
                (scoped_hospital_id, patient_id),
            )
        else:
            cursor.execute(
                """
                SELECT id, patient_id, source_table, source_id, content_text, embedding
                FROM clinical_document_embeddings
                WHERE hospital_id = ? AND embedding IS NOT NULL
                """,
                (scoped_hospital_id,),
            )
        rows = cursor.fetchall()

    scored = []
    for row in rows:
        candidate_vector = decode_vector(row["embedding"])
        if not candidate_vector:
            continue
        similarity = cosine_similarity(query_vector, candidate_vector)
        scored.append(
            {
                "id": row["id"],
                "patient_id": row["patient_id"],
                "source_table": row["source_table"],
                "source_id": row["source_id"],
                "content_text": row["content_text"],
                "similarity": similarity,
            }
        )
    scored.sort(key=lambda item: item["similarity"], reverse=True)
    return scored[:k]


# ==================== Bulk AI patient import ====================

def ensure_patient_bulk_columns(conn):
    """Adds the columns a bulk Excel/CSV import needs on top of the core patients
    schema (area/medical_condition aren't collected by the normal registration
    flow), plus a partial-unique index on (hospital_id, phone) scoped to
    source='bulk_import' rows only -- so bulk import can upsert its own
    previously-imported patients on re-upload without colliding, while normal
    registration (source='registration') keeps allowing multiple patients to
    share one phone number (e.g. a family registered under one guardian's
    number), exactly as it does today."""
    cursor = conn.cursor()
    _ensure_column(cursor, "patients", "area", "TEXT", "TEXT")
    _ensure_column(cursor, "patients", "medical_condition", "TEXT", "TEXT")
    _ensure_column(cursor, "patients", "source", "TEXT DEFAULT 'registration'", "TEXT DEFAULT 'registration'")
    cursor.execute("UPDATE patients SET source = 'registration' WHERE source IS NULL")
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_bulk_import_phone "
        "ON patients(hospital_id, phone) WHERE phone IS NOT NULL AND phone <> '' AND source = 'bulk_import'"
    )
    conn.commit()


def ensure_bulk_import_jobs_table(conn):
    cursor = conn.cursor()
    id_column = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bulk_import_jobs (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            created_by TEXT,
            original_filename TEXT,
            storage_path TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING_MAPPING',
            detected_columns TEXT,
            suggested_mapping TEXT,
            confirmed_mapping TEXT,
            total_rows INTEGER DEFAULT 0,
            processed_rows INTEGER DEFAULT 0,
            imported_count INTEGER DEFAULT 0,
            updated_count INTEGER DEFAULT 0,
            skipped_count INTEGER DEFAULT 0,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_bulk_import_jobs_hospital ON bulk_import_jobs(hospital_id)"
    )
    # PDF/DOCX uploads skip column mapping entirely -- their extracted text is stored
    # here and answered against directly via /ask, never turned into patient rows.
    _ensure_column(cursor, "bulk_import_jobs", "extracted_text", "TEXT", "TEXT")
    conn.commit()


def create_bulk_import_job(hospital_id, created_by, original_filename, storage_path):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO bulk_import_jobs (hospital_id, created_by, original_filename, storage_path) "
            "VALUES (?, ?, ?, ?)",
            (hospital_id, created_by, original_filename, storage_path),
        )
        conn.commit()
        return cursor.lastrowid


def get_bulk_import_job(job_id, hospital_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bulk_import_jobs WHERE id = ? AND hospital_id = ?",
            (job_id, hospital_id),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def update_bulk_import_job(job_id, **fields):
    if not fields:
        return
    columns = list(fields.keys())
    set_clause = ", ".join(f"{col} = ?" for col in columns)
    values = [fields[col] for col in columns]
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE bulk_import_jobs SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (*values, job_id),
        )
        conn.commit()


def get_bulk_import_job_internal(job_id):
    """Unscoped lookup for use by the Celery worker, which has no per-request
    tenant context to check against -- the job's own hospital_id (set once at
    creation, from the authenticated upload request) is what tasks pass on to
    every subsequent DB write."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bulk_import_jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


BULK_IMPORT_PATIENT_FIELDS = ["name", "last_name", "age", "gender", "area", "medical_condition"]


def upsert_bulk_import_patients_batch(hospital_id, rows):
    """Batch insert/update patients keyed on (hospital_id, phone) via one
    executemany call -- opening a connection per row would be far too slow at
    100k-300k rows. Each item in `rows` is (patient_id, phone, fields) where
    fields is a dict with exactly the keys in BULK_IMPORT_PATIENT_FIELDS
    (missing ones as None). The ON CONFLICT target's WHERE clause must match
    idx_patients_bulk_import_phone's predicate exactly (both Postgres and
    SQLite require this to infer a partial unique index) -- this scopes the
    upsert to only collide with other bulk-imported rows, never with normal
    registration data that may legitimately share a phone number."""
    if not rows:
        return
    columns = ["hospital_id", "patient_id", "phone", "source"] + BULK_IMPORT_PATIENT_FIELDS
    placeholders = ", ".join(["?"] * len(columns))
    update_assignments = ", ".join(f"{col} = EXCLUDED.{col}" for col in BULK_IMPORT_PATIENT_FIELDS)
    param_rows = [
        (hospital_id, patient_id, phone, "bulk_import", *(fields.get(f) for f in BULK_IMPORT_PATIENT_FIELDS))
        for patient_id, phone, fields in rows
    ]
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.executemany(
            f"""
            INSERT INTO patients ({", ".join(columns)})
            VALUES ({placeholders})
            ON CONFLICT (hospital_id, phone) WHERE phone IS NOT NULL AND phone <> '' AND source = 'bulk_import'
            DO UPDATE SET {update_assignments}, updated_at = CURRENT_TIMESTAMP
            """,
            param_rows,
        )
        conn.commit()


def query_bulk_patients(hospital_id, where_clause, params, page=1, page_size=150):
    offset = (page - 1) * page_size
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT patient_id, name, last_name, phone, age, gender, area, medical_condition, source
            FROM patients
            WHERE hospital_id = ? AND deleted_at IS NULL AND source = 'bulk_import' {where_clause}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            (hospital_id, *params, page_size, offset),
        )
        rows = [dict(row) for row in cursor.fetchall()]
        cursor.execute(
            f"""
            SELECT COUNT(*) FROM patients
            WHERE hospital_id = ? AND deleted_at IS NULL AND source = 'bulk_import' {where_clause}
            """,
            (hospital_id, *params),
        )
        total = cursor.fetchone()[0]
        return rows, total


# ==================== Patient operations ====================

def generate_patient_id(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        # Find the highest continuous sequence id. Using a professional MRN-like sequence starting at 100001
        cursor.execute(
            "SELECT patient_id FROM patients WHERE hospital_id = ? AND patient_id LIKE ?",
            (scoped_hospital_id, 'PAT-1%')
        )
        ids = [row[0] for row in cursor.fetchall()]
        
        max_num = 100000
        for pid in ids:
            try:
                # Expecting format PAT-100001
                num = int(pid.split('-')[1])
                if num > max_num:
                    max_num = num
            except (IndexError, ValueError):
                continue
                
    return f"PAT-{max_num + 1}"



def check_duplicate_patient(name, last_name, dob, phone, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT patient_id, name, last_name FROM patients
            WHERE hospital_id = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
            AND (dob = ? OR phone = ?)
        """,
            (scoped_hospital_id, name, last_name, dob, phone),
        )
        return cursor.fetchone()


def add_patient(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patients (hospital_id, patient_id, name, middle_name, last_name, dob, age, weight, height, gender, pregnant, allergies, symptoms, phone, address, blood_group, emergency_contact, aadhar_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                scoped_hospital_id,
                data["patient_id"],
                data["name"],
                data.get("middle_name", ""),
                data["last_name"],
                data.get("dob"),
                data.get("age"),
                data.get("weight"),
                data.get("height"),
                data.get("gender"),
                data.get("pregnant", 0),
                data.get("allergies", ""),
                data.get("symptoms", ""),
                data.get("phone", ""),
                data.get("address", ""),
                data.get("blood_group", ""),
                data.get("emergency_contact", ""),
                data.get("aadhar_number", ""),
            ),
        )
        conn.commit()
        return data["patient_id"]


def get_patient(patient_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patients WHERE patient_id = ? AND hospital_id = ? AND deleted_at IS NULL",
            (patient_id, scoped_hospital_id),
        )
        return cursor.fetchone()


def get_all_patients(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """SELECT p.*, (SELECT status FROM appointments a WHERE a.patient_id = p.patient_id ORDER BY a.created_at DESC LIMIT 1) as status 
            FROM patients p WHERE p.hospital_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC""",
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def search_patients(query, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        if not query:
            return []
        search = f"%{query.strip().lower()}%"
        cursor.execute(
            """
            SELECT p.*, (SELECT status FROM appointments a WHERE a.patient_id = p.patient_id ORDER BY a.created_at DESC LIMIT 1) as status
            FROM patients p WHERE
            p.hospital_id = ? AND p.deleted_at IS NULL AND (
            LOWER(p.name) LIKE ? OR LOWER(p.last_name) LIKE ? OR LOWER(p.middle_name) LIKE ?
            OR LOWER(p.phone) LIKE ? OR LOWER(p.patient_id) LIKE ? OR LOWER(p.aadhar_number) LIKE ?
            OR LOWER(TRIM(p.name || ' ' || COALESCE(p.middle_name, '') || ' ' || p.last_name)) LIKE ?
            OR LOWER(TRIM(p.last_name || ' ' || p.name)) LIKE ?)
            ORDER BY p.created_at DESC
        """,
            (scoped_hospital_id, search, search, search, search, search, search, search, search),
        )
        return cursor.fetchall()


def update_patient(patient_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE patients SET name=?, middle_name=?, last_name=?, dob=?, age=?, weight=?, height=?,
            gender=?, pregnant=?, allergies=?, symptoms=?, phone=?, address=?, blood_group=?, emergency_contact=?, aadhar_number=?, updated_at=CURRENT_TIMESTAMP
            WHERE patient_id=?
        """,
            (
                data["name"],
                data.get("middle_name", ""),
                data["last_name"],
                data.get("dob"),
                data.get("age"),
                data.get("weight"),
                data.get("height"),
                data.get("gender"),
                data.get("pregnant", 0),
                data.get("allergies", ""),
                data.get("symptoms", ""),
                data.get("phone", ""),
                data.get("address", ""),
                data.get("blood_group", ""),
                data.get("emergency_contact", ""),
                data.get("aadhar_number", ""),
                patient_id,
            ),
        )
        conn.commit()


def add_admission(patient_id, notes="", hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        admission_timestamp = current_ist_timestamp()
        if IS_POSTGRES:
            cursor.execute(
                """
                INSERT INTO admissions (hospital_id, patient_id, admission_date, notes)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                (scoped_hospital_id, patient_id, admission_timestamp, notes),
            )
            admission_id = cursor.fetchone()[0]
        else:
            cursor.execute(
                """
                INSERT INTO admissions (hospital_id, patient_id, admission_date, notes)
                VALUES (?, ?, ?, ?)
            """,
                (scoped_hospital_id, patient_id, admission_timestamp, notes),
            )
            admission_id = cursor.lastrowid
        conn.commit()
        return admission_id


def get_admissions(patient_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM admissions WHERE patient_id = ? AND hospital_id = ? ORDER BY admission_date DESC",
            (patient_id, scoped_hospital_id),
        )
        return cursor.fetchall()


def add_document(
    patient_id,
    admission_id,
    doc_type,
    file_path,
    ocr_text="",
    ocr_language="en",
    file_name=None,
    mime_type=None,
    file_data=None,
    hospital_id=None,
):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        upload_timestamp = current_ist_timestamp()
        if IS_POSTGRES:
            cursor.execute(
                """
                INSERT INTO documents (
                    hospital_id, patient_id, admission_id, doc_type, file_path, file_name, mime_type, file_data, ocr_text, ocr_language, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    scoped_hospital_id,
                    patient_id,
                    admission_id,
                    doc_type,
                    file_path,
                    file_name,
                    mime_type,
                    file_data,
                    ocr_text,
                    ocr_language,
                    upload_timestamp,
                ),
            )
            document_id = cursor.fetchone()[0]
        else:
            cursor.execute(
                """
                INSERT INTO documents (
                    hospital_id, patient_id, admission_id, doc_type, file_path, file_name, mime_type, file_data, ocr_text, ocr_language, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    scoped_hospital_id,
                    patient_id,
                    admission_id,
                    doc_type,
                    file_path,
                    file_name,
                    mime_type,
                    file_data,
                    ocr_text,
                    ocr_language,
                    upload_timestamp,
                ),
            )
            document_id = cursor.lastrowid
        conn.commit()
        return document_id


def get_documents(patient_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                id,
                patient_id,
                admission_id,
                doc_type,
                file_path,
                file_name,
                mime_type,
                ocr_text,
                ocr_language,
                created_at,
                CASE WHEN file_data IS NOT NULL THEN 1 ELSE 0 END AS has_file_data
            FROM documents
            WHERE patient_id = ? AND hospital_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (patient_id, scoped_hospital_id),
        )
        return cursor.fetchall()


def get_document(document_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM documents WHERE id = ? AND hospital_id = ? AND deleted_at IS NULL",
            (document_id, scoped_hospital_id),
        )
        return cursor.fetchone()


def store_whatsapp_media(content: bytes, mime_type: str = "application/pdf") -> str:
    """Stash a generated file (e.g. a prescription PDF) under a random token so it
    can be served back over a short-lived, unauthenticated URL that WhatsApp's
    servers are able to fetch directly (they can't send session cookies)."""
    token = uuid_lib.uuid4().hex
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO whatsapp_media (token, content, mime_type) VALUES (?, ?, ?)",
            (token, content, mime_type),
        )
        conn.commit()
    return token


def get_whatsapp_media(token: str):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT content, mime_type FROM whatsapp_media WHERE token = ?", (token,))
        row = cursor.fetchone()
        return (row["content"], row["mime_type"]) if row else (None, None)


def delete_document(document_id, hospital_id=None, actor=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(
            cursor, "documents", "id", document_id, hospital_id=scoped_hospital_id, actor=actor
        )
        conn.commit()
        return deleted


def update_document_ocr(document_id, ocr_text, ocr_language="en", hospital_id=None, structured_data=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT patient_id FROM documents WHERE id = ? AND hospital_id = ?",
            (document_id, scoped_hospital_id),
        )
        existing = cursor.fetchone()
        structured_json = json.dumps(structured_data, separators=(",", ":")) if structured_data else None
        cursor.execute(
            "UPDATE documents SET ocr_text = ?, ocr_language = ?, structured_data = ? WHERE id = ? AND hospital_id = ?",
            (ocr_text, ocr_language, structured_json, document_id, scoped_hospital_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0

    if updated and existing:
        try:
            from core.tasks import process_document_embedding_task
            process_document_embedding_task.delay(
                "documents", document_id, ocr_text, hospital_id=scoped_hospital_id, patient_id=existing["patient_id"]
            )
        except Exception:
            # Embedding is a best-effort enrichment; OCR persistence must not fail if it errors.
            pass

    return updated


def get_patient_stats(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM patients WHERE hospital_id = ?", (scoped_hospital_id,))
        total = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM patients WHERE hospital_id = ? AND DATE(created_at) = CURRENT_DATE",
            (scoped_hospital_id,),
        )
        today = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM admissions WHERE hospital_id = ? AND discharge_date IS NULL",
            (scoped_hospital_id,),
        )
        active = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM documents WHERE hospital_id = ?", (scoped_hospital_id,))
        docs = cursor.fetchone()[0]
        cursor.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT patient_id
                FROM admissions
                WHERE hospital_id = ?
                GROUP BY patient_id
                HAVING COUNT(*) > 1
            )
            """
            ,
            (scoped_hospital_id,),
        )
        readmitted_patients = cursor.fetchone()[0]
    return {
        "total": total,
        "today": today,
        "active_admissions": active,
        "documents": docs,
        "readmitted_patients": readmitted_patients,
    }


def get_dashboard_analytics(days=14, include_employee=False, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    try:
        requested_days = int(days)
    except (TypeError, ValueError):
        requested_days = 14

    # Keep the window bounded so the dashboard stays fast and readable.
    window_days = max(7, min(requested_days, 60))
    start_date = current_ist_datetime().date() - timedelta(days=window_days - 1)
    day_range = [(start_date + timedelta(days=index)).isoformat() for index in range(window_days)]

    with get_connection() as conn:
        cursor = conn.cursor()

        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT DATE(created_at) AS day, COUNT(*) AS count
                FROM patients
                WHERE hospital_id = ? AND DATE(created_at) >= CURRENT_DATE - (%s * INTERVAL '1 day')
                GROUP BY DATE(created_at)
                ORDER BY day ASC
                """,
                (scoped_hospital_id, window_days - 1),
            )
        else:
            cursor.execute(
                """
                SELECT DATE(created_at) AS day, COUNT(*) AS count
                FROM patients
                WHERE hospital_id = ? AND DATE(created_at) >= DATE('now', ?)
                GROUP BY DATE(created_at)
                ORDER BY day ASC
                """,
                (scoped_hospital_id, f"-{window_days - 1} days"),
            )
        patient_trend_map = {row["day"]: row["count"] for row in cursor.fetchall()}

        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT DATE(created_at) AS day, COUNT(*) AS count
                FROM documents
                WHERE hospital_id = ? AND DATE(created_at) >= CURRENT_DATE - (%s * INTERVAL '1 day')
                GROUP BY DATE(created_at)
                ORDER BY day ASC
                """,
                (scoped_hospital_id, window_days - 1),
            )
        else:
            cursor.execute(
                """
                SELECT DATE(created_at) AS day, COUNT(*) AS count
                FROM documents
                WHERE hospital_id = ? AND DATE(created_at) >= DATE('now', ?)
                GROUP BY DATE(created_at)
                ORDER BY day ASC
                """,
                (scoped_hospital_id, f"-{window_days - 1} days"),
            )
        document_trend_map = {row["day"]: row["count"] for row in cursor.fetchall()}

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(gender), ''), 'Unknown') AS label, COUNT(*) AS count
            FROM patients
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        gender_distribution = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doc_type), ''), 'Unknown') AS label, COUNT(*) AS count
            FROM documents
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        doc_type_distribution = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT CASE WHEN discharge_date IS NULL THEN 'Active' ELSE 'Discharged' END AS label, COUNT(*) AS count
            FROM admissions
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """
            ,
            (scoped_hospital_id,),
        )
        admission_status_distribution = [dict(row) for row in cursor.fetchall()]

        analytics = {
            "window_days": window_days,
            "patients_trend": [{"date": day, "count": patient_trend_map.get(day, 0)} for day in day_range],
            "documents_trend": [{"date": day, "count": document_trend_map.get(day, 0)} for day in day_range],
            "gender_distribution": gender_distribution,
            "doc_type_distribution": doc_type_distribution,
            "admission_status_distribution": admission_status_distribution,
        }

        if include_employee:
            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(status), ''), 'unknown') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            employee_status_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(department), ''), 'Unassigned') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            department_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(user_type), ''), 'unknown') AS label, COUNT(*) AS count
                FROM users
                WHERE hospital_id = ?
                GROUP BY label
                ORDER BY count DESC, label ASC
                """
                ,
                (scoped_hospital_id,),
            )
            access_role_distribution = [dict(row) for row in cursor.fetchall()]

            cursor.execute(
                "SELECT COUNT(*) AS total FROM users WHERE hospital_id = ?",
                (scoped_hospital_id,),
            )
            employee_total = cursor.fetchone()["total"]

            analytics["employee"] = {
                "total": employee_total,
                "status_distribution": employee_status_distribution,
                "department_distribution": department_distribution,
                "access_role_distribution": access_role_distribution,
            }

    return analytics


def delete_patient(patient_id, hospital_id=None, actor=None):
    """Soft-delete a patient and all associated admissions/documents."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? "
            "WHERE patient_id = ? AND hospital_id = ? AND deleted_at IS NULL",
            (actor, patient_id, scoped_hospital_id),
        )
        cursor.execute(
            "UPDATE admissions SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? "
            "WHERE patient_id = ? AND hospital_id = ? AND deleted_at IS NULL",
            (actor, patient_id, scoped_hospital_id),
        )
        deleted = soft_delete_row(
            cursor, "patients", "patient_id", patient_id, hospital_id=scoped_hospital_id, actor=actor
        )
        conn.commit()
        return deleted


# ==================== Employee management ====================

def generate_employee_id(hospital_id=None):
    # employee_id has a global UNIQUE constraint (not scoped per hospital), so the
    # next-id counter must scan across all hospitals, not just the current one.
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT employee_id FROM users WHERE employee_id LIKE ?",
            ('EMP-%',)
        )
        ids = [row[0] for row in cursor.fetchall()]
        
        max_num = 0
        for emp_id in ids:
            try:
                num = int(emp_id.split('-')[1])
                if num > max_num:
                    max_num = num
            except (IndexError, ValueError):
                continue
                
    return f"EMP-{max_num + 1:05d}"


def add_employee(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        if IS_POSTGRES:
            cursor.execute(
                """
                INSERT INTO users (hospital_id, username, password_hash, role, job_role, full_name, email, phone,
                                   department, employee_id, status, address, emergency_contact, access_role, user_type, module_access)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    scoped_hospital_id,
                    data["username"],
                    data["password_hash"],
                    data.get("role", "employee"),
                    data.get("job_role"),
                    data.get("full_name"),
                    data.get("email"),
                    data.get("phone"),
                    data.get("department"),
                    data["employee_id"],
                    data.get("status", "active"),
                    data.get("address"),
                    data.get("emergency_contact"),
                    data.get("access_role", "receptionist"),
                    data.get("user_type", "normal"),
                    json.dumps(data.get("module_access", []), separators=(",", ":")),
                ),
            )
            employee_pk = cursor.fetchone()[0]
        else:
            cursor.execute(
                """
                INSERT INTO users (hospital_id, username, password_hash, role, job_role, full_name, email, phone,
                                   department, employee_id, status, address, emergency_contact, access_role, user_type, module_access)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    scoped_hospital_id,
                    data["username"],
                    data["password_hash"],
                    data.get("role", "employee"),
                    data.get("job_role"),
                    data.get("full_name"),
                    data.get("email"),
                    data.get("phone"),
                    data.get("department"),
                    data["employee_id"],
                    data.get("status", "active"),
                    data.get("address"),
                    data.get("emergency_contact"),
                    data.get("access_role", "receptionist"),
                    data.get("user_type", "normal"),
                    json.dumps(data.get("module_access", []), separators=(",", ":")),
                ),
            )
            employee_pk = cursor.lastrowid
        conn.commit()
        return employee_pk


def get_all_employees(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, username, role, job_role, full_name, email, phone, department,
                   employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
            FROM users
            WHERE hospital_id = ?
            ORDER BY date_joined DESC
        """
            ,
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def get_employee(employee_id=None, username=None, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                """
                SELECT id, username, role, job_role, full_name, email, phone, department,
                       employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
                FROM users WHERE employee_id = ? AND hospital_id = ?
            """,
                (employee_id, scoped_hospital_id),
            )
        elif username:
            cursor.execute(
                """
                SELECT id, username, role, job_role, full_name, email, phone, department,
                       employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
                FROM users WHERE username = ? AND hospital_id = ?
            """,
                (username, scoped_hospital_id),
            )
        else:
            return None
        return cursor.fetchone()


def update_employee(employee_id, data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE users SET full_name=?, email=?, phone=?, department=?,
                           status=?, address=?, emergency_contact=?, job_role=?, access_role=COALESCE(?, access_role),
                           user_type=COALESCE(?, user_type), module_access=COALESCE(?, module_access)
            WHERE employee_id=? AND hospital_id=?
        """,
            (
                data.get("full_name"),
                data.get("email"),
                data.get("phone"),
                data.get("department"),
                data.get("status"),
                data.get("address"),
                data.get("emergency_contact"),
                data.get("job_role"),
                data.get("access_role"),
                data.get("user_type"),
                json.dumps(data["module_access"], separators=(",", ":")) if "module_access" in data else None,
                employee_id,
                scoped_hospital_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def deactivate_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET status='inactive' WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def activate_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET status='active' WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_employee(employee_id, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM users WHERE employee_id=? AND hospital_id=?",
            (employee_id, scoped_hospital_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def get_employee_stats(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM users WHERE status='active' AND hospital_id = ?",
            (scoped_hospital_id,),
        )
        active = cursor.fetchone()[0]
        cursor.execute(
            "SELECT COUNT(*) FROM users WHERE status='inactive' AND hospital_id = ?",
            (scoped_hospital_id,),
        )
        inactive = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM users WHERE hospital_id = ?", (scoped_hospital_id,))
        total = cursor.fetchone()[0]
    return {"total": total, "active": active, "inactive": inactive}


def check_if_first_user(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM users WHERE hospital_id = ?", (scoped_hospital_id,))
        count = cursor.fetchone()[0]
    return count == 0


def search_employees(query, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        search = f"%{query}%"
        cursor.execute(
            """
            SELECT id, username, role, job_role, full_name, email, phone, department,
                   employee_id, date_joined, status, address, emergency_contact, created_at, access_role, user_type, module_access
            FROM users WHERE
            hospital_id = ? AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR employee_id LIKE ?)
            ORDER BY date_joined DESC
        """,
            (scoped_hospital_id, search, search, search, search),
        )
        return cursor.fetchall()


def create_appointment(data, hospital_id=None):
    appointment_date = data["appointment_date"]
    appointment_day = str(appointment_date).split("T")[0].split(" ")[0]
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(MAX(token_no), 0) AS value FROM appointments "
            "WHERE DATE(appointment_date) = DATE(?) AND hospital_id = ?",
            (appointment_day, scoped_hospital_id),
        )
        token_no = int((cursor.fetchone() or {"value": 0})["value"] or 0) + 1
        cursor.execute(
            """
            INSERT INTO appointments (
                patient_id, patient_name, visit_type, department, doctor_name,
                appointment_date, token_no, status, notes, appointment_kind, follow_up_for,
                reminder_sent_at, no_show_marked, hospital_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data.get("visit_type", "OP"),
                data.get("department"),
                data.get("doctor_name"),
                appointment_date,
                token_no,
                data.get("status", "scheduled"),
                data.get("notes"),
                data.get("appointment_kind", "new"),
                data.get("follow_up_for"),
                data.get("reminder_sent_at"),
                1 if data.get("no_show_marked") else 0,
                scoped_hospital_id,
            ),
        )
        appointment_id = cursor.lastrowid
        conn.commit()
        return appointment_id, token_no


def list_appointments(appointment_date=None, status=None, visit_type=None, doctor_name=None, patient_id=None, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if hospital_id:
            clauses.append("a.hospital_id = ?")
            params.append(hospital_id)
        if appointment_date:
            clauses.append("DATE(a.appointment_date) = DATE(?)")
            params.append(appointment_date)
        if status:
            clauses.append("a.status = ?")
            params.append(status)
        if visit_type:
            clauses.append("a.visit_type = ?")
            params.append(visit_type)
        if doctor_name:
            clauses.append("a.doctor_name = ?")
            params.append(doctor_name)
        if patient_id:
            clauses.append("a.patient_id = ?")
            params.append(patient_id)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT a.*, p.phone as patient_phone, p.symptoms as patient_symptoms FROM appointments a LEFT JOIN patients p ON a.patient_id = p.patient_id AND a.hospital_id = p.hospital_id{where_clause} ORDER BY a.appointment_date ASC, a.token_no ASC",
            tuple(params),
        )
        return cursor.fetchall()


def get_appointment_by_id(appointment_id, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if hospital_id:
            cursor.execute(
                "SELECT * FROM appointments WHERE id = ? AND hospital_id = ?",
                (appointment_id, hospital_id),
            )
        else:
            cursor.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,))
        return cursor.fetchone()


def update_appointment(appointment_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE appointments
            SET patient_id = ?,
                patient_name = ?,
                visit_type = ?,
                department = ?,
                doctor_name = ?,
                appointment_date = ?,
                status = ?,
                notes = ?,
                appointment_kind = ?,
                follow_up_for = ?,
                reminder_sent_at = ?,
                no_show_marked = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("visit_type", existing["visit_type"]),
                data.get("department", existing["department"]),
                data.get("doctor_name", existing["doctor_name"]),
                data.get("appointment_date", existing["appointment_date"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                data.get("appointment_kind", existing["appointment_kind"]),
                data.get("follow_up_for", existing["follow_up_for"]),
                data.get("reminder_sent_at", existing["reminder_sent_at"]),
                1 if data.get("no_show_marked", existing["no_show_marked"]) else 0,
                appointment_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


# --- Doctors (Static) ---

def create_doctor(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            _to_sql_params("""
            INSERT INTO doctors (
                doctor_name, department, consultation_fee, review_fee, status
            ) VALUES (?, ?, ?, ?, ?)
            """),
            (
                data.get("doctor_name"),
                data.get("department"),
                float(data.get("consultation_fee", 0)),
                float(data.get("review_fee", 0)),
                data.get("status", "available"),
            ),
        )
        doctor_id = cursor.lastrowid
        conn.commit()
        return doctor_id

def list_doctors(department=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if department:
            cursor.execute(_to_sql_params("SELECT * FROM doctors WHERE department = ? ORDER BY doctor_name"), (department,))
        else:
            cursor.execute("SELECT * FROM doctors ORDER BY doctor_name")
        return [dict(row) for row in cursor.fetchall()]

def update_doctor(doctor_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        updates = []
        params = []
        for key in ["doctor_name", "department", "consultation_fee", "review_fee", "status"]:
            if key in data:
                updates.append(f"{key} = ?")
                val = data[key]
                if key in ["consultation_fee", "review_fee"]:
                    val = float(val)
                params.append(val)
        if not updates:
            return False
        params.append(doctor_id)
        sql = _to_sql_params(f"UPDATE doctors SET {', '.join(updates)} WHERE id = ?")
        cursor.execute(sql, tuple(params))
        conn.commit()
        return cursor.rowcount > 0

def delete_doctor(doctor_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(_to_sql_params("DELETE FROM doctors WHERE id = ?"), (doctor_id,))
        conn.commit()
        return cursor.rowcount > 0


def create_doctor_schedule(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO doctor_schedules (
                doctor_name, department, schedule_date, start_time, end_time,
                slot_capacity, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["doctor_name"],
                data.get("department"),
                data["schedule_date"],
                data["start_time"],
                data["end_time"],
                int(data.get("slot_capacity", 12) or 12),
                data.get("status", "available"),
                data.get("notes"),
            ),
        )
        schedule_id = cursor.lastrowid
        conn.commit()
        return schedule_id


def list_doctor_schedules(schedule_date=None, doctor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if schedule_date:
            clauses.append("schedule_date = ?")
            params.append(schedule_date)
        if doctor_name:
            clauses.append("doctor_name = ?")
            params.append(doctor_name)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM doctor_schedules{where_clause} ORDER BY schedule_date ASC, start_time ASC",
            tuple(params),
        )
        return cursor.fetchall()


def update_doctor_schedule(schedule_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM doctor_schedules WHERE id = ?", (schedule_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE doctor_schedules
            SET doctor_name = ?, department = ?, schedule_date = ?, start_time = ?,
                end_time = ?, slot_capacity = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("doctor_name", existing["doctor_name"]),
                data.get("department", existing["department"]),
                data.get("schedule_date", existing["schedule_date"]),
                data.get("start_time", existing["start_time"]),
                data.get("end_time", existing["end_time"]),
                int(data.get("slot_capacity", existing["slot_capacity"] or 12)),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                schedule_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_doctor_schedule(schedule_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "doctor_schedules", "id", schedule_id, actor=actor)
        conn.commit()
        return deleted


def get_op_summary(target_date=None, hospital_id=None):
    day = target_date or current_ist_datetime().strftime("%Y-%m-%d")
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE hospital_id = ? AND visit_type = 'OP' AND DATE(appointment_date) = DATE(?)",
            (scoped_hospital_id, day),
        )
        total_appointments = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE hospital_id = ? AND visit_type = 'OP' AND appointment_kind = 'follow_up' AND DATE(appointment_date) = DATE(?)",
            (scoped_hospital_id, day),
        )
        follow_ups = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE hospital_id = ? AND visit_type = 'OP' AND status IN ('checked_in', 'in_consultation') AND DATE(appointment_date) = DATE(?)",
            (scoped_hospital_id, day),
        )
        active_queue = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE hospital_id = ? AND visit_type = 'OP' AND no_show_marked = 1 AND DATE(appointment_date) = DATE(?)",
            (scoped_hospital_id, day),
        )
        no_shows = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM appointments WHERE hospital_id = ? AND visit_type = 'OP' AND reminder_sent_at IS NOT NULL AND DATE(appointment_date) = DATE(?)",
            (scoped_hospital_id, day),
        )
        reminders_sent = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COUNT(*) AS value FROM doctor_schedules WHERE schedule_date = ? AND status = 'available'",
            (day,),
        )
        available_doctors = cursor.fetchone()["value"]
    return {
        "date": day,
        "total_appointments": total_appointments,
        "follow_ups": follow_ups,
        "active_queue": active_queue,
        "no_shows": no_shows,
        "reminders_sent": reminders_sent,
        "available_doctors": available_doctors,
    }


def create_patient_consent(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patient_consents (
                patient_id, patient_name, consent_type, signed_by, relation_to_patient, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data.get("consent_type", "general"),
                data["signed_by"],
                data.get("relation_to_patient"),
                data.get("status", "signed"),
                data.get("notes"),
            ),
        )
        consent_id = cursor.lastrowid
        conn.commit()
        return consent_id


def list_patient_consents(patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                "SELECT * FROM patient_consents WHERE patient_id = ? ORDER BY signed_at DESC, id DESC",
                (patient_id,),
            )
        else:
            cursor.execute("SELECT * FROM patient_consents ORDER BY signed_at DESC, id DESC")
        return cursor.fetchall()


def update_patient_consent(consent_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM patient_consents WHERE id = ?", (consent_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE patient_consents
            SET patient_id = ?, patient_name = ?, consent_type = ?, signed_by = ?,
                relation_to_patient = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("consent_type", existing["consent_type"]),
                data.get("signed_by", existing["signed_by"]),
                data.get("relation_to_patient", existing["relation_to_patient"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                consent_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def create_insurance_verification(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO insurance_verifications (
                patient_id, patient_name, insurer_name, policy_number, member_id,
                verification_status, coverage_notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("patient_id"),
                data["patient_name"],
                data["insurer_name"],
                data.get("policy_number"),
                data.get("member_id"),
                data.get("verification_status", "pending"),
                data.get("coverage_notes"),
            ),
        )
        verification_id = cursor.lastrowid
        conn.commit()
        return verification_id


def list_insurance_verifications(patient_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if patient_id:
            cursor.execute(
                "SELECT * FROM insurance_verifications WHERE patient_id = ? ORDER BY checked_at DESC, id DESC",
                (patient_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM insurance_verifications ORDER BY checked_at DESC, id DESC"
            )
        return cursor.fetchall()


def update_insurance_verification(verification_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM insurance_verifications WHERE id = ?",
            (verification_id,),
        )
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE insurance_verifications
            SET patient_id = ?, patient_name = ?, insurer_name = ?, policy_number = ?,
                member_id = ?, verification_status = ?, coverage_notes = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                data.get("patient_name", existing["patient_name"]),
                data.get("insurer_name", existing["insurer_name"]),
                data.get("policy_number", existing["policy_number"]),
                data.get("member_id", existing["member_id"]),
                data.get("verification_status", existing["verification_status"]),
                data.get("coverage_notes", existing["coverage_notes"]),
                verification_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def create_certificate(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO certificates (
                patient_id, admission_id, certificate_type, title, body, issued_by
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data["certificate_type"],
                data["title"],
                data["body"],
                data.get("issued_by"),
            ),
        )
        certificate_id = cursor.lastrowid
        conn.commit()

    try:
        from core.tasks import process_document_embedding_task
        process_document_embedding_task.delay(
            "certificates", certificate_id, data["body"], hospital_id=None, patient_id=data["patient_id"]
        )
    except Exception:
        pass

    return certificate_id


def list_certificates(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM certificates WHERE patient_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def delete_certificate(certificate_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "certificates", "id", certificate_id, actor=actor)
        conn.commit()
        return deleted


def create_ot_theatre(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO ot_theatres (
                theatre_code, theatre_name, equipment_notes, status
            ) VALUES (?, ?, ?, ?)
            """,
            (
                data["theatre_code"],
                data["theatre_name"],
                data.get("equipment_notes"),
                data.get("status", "available"),
            ),
        )
        theatre_id = cursor.lastrowid
        conn.commit()
        return theatre_id


def list_ot_theatres():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_theatres WHERE deleted_at IS NULL ORDER BY theatre_code ASC")
        return cursor.fetchall()


def update_ot_theatre(theatre_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_theatres WHERE id = ?", (theatre_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE ot_theatres
            SET theatre_code = ?, theatre_name = ?, equipment_notes = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("theatre_code", existing["theatre_code"]),
                data.get("theatre_name", existing["theatre_name"]),
                data.get("equipment_notes", existing["equipment_notes"]),
                data.get("status", existing["status"]),
                theatre_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_ot_theatre(theatre_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE ot_surgeries SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? "
            "WHERE theatre_id = ? AND deleted_at IS NULL",
            (actor, theatre_id),
        )
        deleted = soft_delete_row(cursor, "ot_theatres", "id", theatre_id, actor=actor)
        conn.commit()
        return deleted


def create_ot_surgery(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO ot_surgeries (
                theatre_id, patient_id, procedure_name, surgeon_name, scheduled_start,
                estimated_duration_hours, status, equipment_required, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["theatre_id"],
                data.get("patient_id"),
                data["procedure_name"],
                data["surgeon_name"],
                data["scheduled_start"],
                data.get("estimated_duration_hours", 1),
                data.get("status", "scheduled"),
                data.get("equipment_required"),
                data.get("notes"),
            ),
        )
        surgery_id = cursor.lastrowid
        cursor.execute(
            "UPDATE ot_theatres SET status = CASE WHEN ? IN ('scheduled', 'in_progress') THEN 'occupied' ELSE status END WHERE id = ?",
            (data.get("status", "scheduled"), data["theatre_id"]),
        )
        conn.commit()
        return surgery_id


def list_ot_surgeries(theatre_id=None, status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = ["deleted_at IS NULL"]
        params = []
        if theatre_id:
            clauses.append("theatre_id = ?")
            params.append(theatre_id)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM ot_surgeries{where_clause} ORDER BY scheduled_start ASC",
            tuple(params),
        )
        return cursor.fetchall()


def update_ot_surgery(surgery_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM ot_surgeries WHERE id = ?", (surgery_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        theatre_id = data.get("theatre_id", existing["theatre_id"])
        status = data.get("status", existing["status"])
        cursor.execute(
            """
            UPDATE ot_surgeries
            SET theatre_id = ?, patient_id = ?, procedure_name = ?, surgeon_name = ?,
                scheduled_start = ?, estimated_duration_hours = ?, status = ?,
                equipment_required = ?, notes = ?
            WHERE id = ?
            """,
            (
                theatre_id,
                data.get("patient_id", existing["patient_id"]),
                data.get("procedure_name", existing["procedure_name"]),
                data.get("surgeon_name", existing["surgeon_name"]),
                data.get("scheduled_start", existing["scheduled_start"]),
                data.get("estimated_duration_hours", existing["estimated_duration_hours"]),
                status,
                data.get("equipment_required", existing["equipment_required"]),
                data.get("notes", existing["notes"]),
                surgery_id,
            ),
        )
        cursor.execute(
            "UPDATE ot_theatres SET status = CASE WHEN ? IN ('scheduled', 'in_progress') THEN 'occupied' ELSE 'available' END WHERE id = ?",
            (status, theatre_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_ot_surgery(surgery_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT theatre_id FROM ot_surgeries WHERE id = ? AND deleted_at IS NULL", (surgery_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        soft_delete_row(cursor, "ot_surgeries", "id", surgery_id, actor=actor)
        cursor.execute(
            """
            UPDATE ot_theatres
            SET status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM ot_surgeries
                    WHERE theatre_id = ? AND status IN ('scheduled', 'in_progress') AND deleted_at IS NULL
                ) THEN 'occupied'
                ELSE 'available'
            END
            WHERE id = ?
            """,
            (existing["theatre_id"], existing["theatre_id"]),
        )
        deleted = cursor.rowcount >= 0
        conn.commit()
        return deleted


def get_ot_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS value FROM ot_theatres")
        theatre_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_theatres WHERE status = 'available'")
        available_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_surgeries WHERE status = 'scheduled'")
        scheduled_count = cursor.fetchone()["value"]
        cursor.execute("SELECT COUNT(*) AS value FROM ot_surgeries WHERE status = 'completed'")
        completed_count = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(estimated_duration_hours), 0) AS value FROM ot_surgeries WHERE status IN ('scheduled', 'in_progress')"
        )
        scheduled_hours = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(estimated_duration_hours), 0) AS value FROM ot_surgeries WHERE status = 'completed'"
        )
        completed_hours = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT
                ot_theatres.theatre_code AS label,
                COALESCE(SUM(
                    CASE
                        WHEN ot_surgeries.status IN ('scheduled', 'in_progress', 'completed')
                        THEN ot_surgeries.estimated_duration_hours
                        ELSE 0
                    END
                ), 0) AS count
            FROM ot_theatres
            LEFT JOIN ot_surgeries ON ot_surgeries.theatre_id = ot_theatres.id
            GROUP BY ot_theatres.id, ot_theatres.theatre_code
            ORDER BY count DESC, ot_theatres.theatre_code ASC
            """
        )
        utilization = [dict(row) for row in cursor.fetchall()]
    return {
        "theatre_count": theatre_count,
        "available_theatres": available_count,
        "scheduled_surgeries": scheduled_count,
        "completed_surgeries": completed_count,
        "scheduled_hours": scheduled_hours,
        "completed_hours": completed_hours,
        "theatre_utilization": utilization,
    }


# ==================== Accounts operations ====================

def create_account_ledger_entry(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO accounts_ledger (
                entry_date, entry_type, category, reference_no, counterparty_name, amount, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["entry_date"],
                data.get("entry_type", "expense"),
                data["category"],
                data.get("reference_no"),
                data.get("counterparty_name"),
                float(data["amount"]),
                data.get("notes"),
            ),
        )
        entry_id = cursor.lastrowid
        conn.commit()
        return entry_id


def list_account_ledger_entries(entry_type=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if entry_type:
            cursor.execute(
                "SELECT * FROM accounts_ledger WHERE entry_type = ? AND deleted_at IS NULL ORDER BY entry_date DESC, id DESC",
                (entry_type,),
            )
        else:
            cursor.execute(
                "SELECT * FROM accounts_ledger WHERE deleted_at IS NULL ORDER BY entry_date DESC, id DESC"
            )
        return cursor.fetchall()


def update_account_ledger_entry(entry_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM accounts_ledger WHERE id = ?", (entry_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE accounts_ledger
            SET entry_date = ?, entry_type = ?, category = ?, reference_no = ?,
                counterparty_name = ?, amount = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("entry_date", existing["entry_date"]),
                data.get("entry_type", existing["entry_type"]),
                data.get("category", existing["category"]),
                data.get("reference_no", existing["reference_no"]),
                data.get("counterparty_name", existing["counterparty_name"]),
                float(data.get("amount", existing["amount"] or 0)),
                data.get("notes", existing["notes"]),
                entry_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_account_ledger_entry(entry_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "accounts_ledger", "id", entry_id, actor=actor)
        conn.commit()
        return deleted


def create_vendor_payment(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vendor_payments (
                vendor_name, invoice_ref, amount, payment_date, payment_mode, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["vendor_name"],
                data.get("invoice_ref"),
                float(data["amount"]),
                data["payment_date"],
                data.get("payment_mode", "bank"),
                data.get("status", "paid"),
                data.get("notes"),
            ),
        )
        payment_id = cursor.lastrowid
        conn.commit()
        return payment_id


def list_vendor_payments(vendor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if vendor_name:
            cursor.execute(
                "SELECT * FROM vendor_payments WHERE vendor_name = ? AND deleted_at IS NULL ORDER BY payment_date DESC, id DESC",
                (vendor_name,),
            )
        else:
            cursor.execute(
                "SELECT * FROM vendor_payments WHERE deleted_at IS NULL ORDER BY payment_date DESC, id DESC"
            )
        return cursor.fetchall()


def update_vendor_payment(payment_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vendor_payments WHERE id = ?", (payment_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE vendor_payments
            SET vendor_name = ?, invoice_ref = ?, amount = ?, payment_date = ?,
                payment_mode = ?, status = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("vendor_name", existing["vendor_name"]),
                data.get("invoice_ref", existing["invoice_ref"]),
                float(data.get("amount", existing["amount"] or 0)),
                data.get("payment_date", existing["payment_date"]),
                data.get("payment_mode", existing["payment_mode"]),
                data.get("status", existing["status"]),
                data.get("notes", existing["notes"]),
                payment_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_vendor_payment(payment_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "vendor_payments", "id", payment_id, actor=actor)
        conn.commit()
        return deleted


def create_doctor_payout(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        total_amount = float(data["amount"])
        paid_amount = float(data.get("paid_amount", 0))
        due_amount = max(total_amount - paid_amount, 0.0)
        status = data.get("status")
        if not status:
            status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "pending")
        cursor.execute(
            """
            INSERT INTO doctor_payouts (
                doctor_name, payout_month, amount, paid_amount, due_amount, status, paid_date, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["doctor_name"],
                data["payout_month"],
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("paid_date"),
                data.get("notes"),
            ),
        )
        payout_id = cursor.lastrowid
        conn.commit()
        return payout_id


def list_doctor_payouts(doctor_name=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if doctor_name:
            cursor.execute(
                "SELECT * FROM doctor_payouts WHERE doctor_name = ? AND deleted_at IS NULL ORDER BY payout_month DESC, id DESC",
                (doctor_name,),
            )
        else:
            cursor.execute(
                "SELECT * FROM doctor_payouts WHERE deleted_at IS NULL ORDER BY payout_month DESC, id DESC"
            )
        return cursor.fetchall()


def update_doctor_payout(payout_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM doctor_payouts WHERE id = ?", (payout_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        total_amount = float(data.get("amount", existing["amount"] or 0))
        paid_amount = float(data.get("paid_amount", existing["paid_amount"] or 0))
        due_amount = max(total_amount - paid_amount, 0.0)
        status = data.get("status")
        if not status:
            status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "pending")
        cursor.execute(
            """
            UPDATE doctor_payouts
            SET doctor_name = ?, payout_month = ?, amount = ?, paid_amount = ?,
                due_amount = ?, status = ?, paid_date = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("doctor_name", existing["doctor_name"]),
                data.get("payout_month", existing["payout_month"]),
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("paid_date", existing["paid_date"]),
                data.get("notes", existing["notes"]),
                payout_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_doctor_payout(payout_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "doctor_payouts", "id", payout_id, actor=actor)
        conn.commit()
        return deleted


def get_accounts_summary():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM accounts_ledger WHERE entry_type = 'income'"
        )
        ledger_income = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM accounts_ledger WHERE entry_type = 'expense'"
        )
        ledger_expense = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM vendor_payments WHERE status IN ('partial', 'paid')"
        )
        vendor_paid = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(paid_amount), 0) AS value FROM doctor_payouts"
        )
        doctor_paid = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(due_amount), 0) AS value FROM doctor_payouts"
        )
        doctor_due = cursor.fetchone()["value"]
    return {
        "ledger_income": ledger_income,
        "ledger_expense": ledger_expense,
        "net_position": ledger_income - ledger_expense,
        "vendor_paid_total": vendor_paid,
        "doctor_paid_total": doctor_paid,
        "doctor_due_total": doctor_due,
    }


# ==================== HospAI module operations ====================

def create_encounter(data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO encounters (
                patient_id, encounter_type, insurance_provider, insurance_policy_no,
                is_accident, referral_source, referral_name, status, created_by, hospital_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("encounter_type", "OP"),
                data.get("insurance_provider"),
                data.get("insurance_policy_no"),
                1 if data.get("is_accident") else 0,
                data.get("referral_source"),
                data.get("referral_name"),
                data.get("status", "active"),
                data.get("created_by"),
                scoped_hospital_id,
            ),
        )
        encounter_id = cursor.lastrowid
        conn.commit()
        return encounter_id


def list_encounters(patient_id=None, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if hospital_id:
            clauses.append("hospital_id = ?")
            params.append(hospital_id)
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(f"SELECT * FROM encounters{where_clause} ORDER BY arrival_at DESC", tuple(params))
        return cursor.fetchall()


def assign_bed(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO bed_allocations (
                admission_id, patient_id, ward, room_no, bed_no, status
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["admission_id"],
                data["patient_id"],
                data.get("ward"),
                data.get("room_no"),
                data.get("bed_no"),
                data.get("status", "active"),
            ),
        )
        bed_id = cursor.lastrowid
        conn.commit()
        return bed_id


def list_bed_allocations(patient_id=None, active_only=False):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        if active_only:
            clauses.append("status = 'active'")
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(f"SELECT * FROM bed_allocations{where_clause} ORDER BY allocated_at DESC", tuple(params))
        return cursor.fetchall()


def add_medication_schedule(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO medication_schedules (
                patient_id, medicine_name, dosage, schedule_time, administered, alert_enabled, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data["medicine_name"],
                data.get("dosage"),
                data["schedule_time"],
                1 if data.get("administered") else 0,
                1 if data.get("alert_enabled", True) else 0,
                data.get("notes"),
            ),
        )
        schedule_id = cursor.lastrowid
        conn.commit()
        return schedule_id


def list_medication_schedules(patient_id, pending_only=False):
    with get_connection() as conn:
        cursor = conn.cursor()
        if pending_only:
            cursor.execute(
                """
                SELECT * FROM medication_schedules
                WHERE patient_id = ? AND administered = 0
                ORDER BY schedule_time ASC
                """,
                (patient_id,),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM medication_schedules
                WHERE patient_id = ?
                ORDER BY schedule_time ASC
                """,
                (patient_id,),
            )
        return cursor.fetchall()


def add_observation_note(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO observation_notes (
                patient_id, admission_id, doctor_name, note, treatment_plan
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data.get("doctor_name"),
                data["note"],
                data.get("treatment_plan"),
            ),
        )
        note_id = cursor.lastrowid
        conn.commit()
        return note_id


def list_observation_notes(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM observation_notes WHERE patient_id = ? ORDER BY created_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def add_patient_movement(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO patient_movements (
                patient_id, admission_id, from_department, to_department, moved_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                data["patient_id"],
                data.get("admission_id"),
                data.get("from_department"),
                data["to_department"],
                data.get("moved_by"),
            ),
        )
        movement_id = cursor.lastrowid
        conn.commit()
        return movement_id


def list_patient_movements(patient_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM patient_movements WHERE patient_id = ? ORDER BY moved_at DESC",
            (patient_id,),
        )
        return cursor.fetchall()


def get_patient_journey(patient_id, hospital_id=None):
    patient = get_patient(patient_id, hospital_id=hospital_id)
    if not patient:
        return None
    patient = dict(patient)

    events = []
    if patient.get("created_at"):
        events.append({"stage": "registration", "label": "Patient Registered", "timestamp": patient["created_at"]})

    for row in list_appointments(patient_id=patient_id, hospital_id=hospital_id):
        appt = dict(row)
        events.append(
            {
                "stage": "queue",
                "label": f"Appointment scheduled ({appt.get('visit_type')}, token #{appt.get('token_no')})",
                "timestamp": appt.get("created_at") or appt.get("appointment_date"),
                "detail": {"doctor_name": appt.get("doctor_name"), "department": appt.get("department")},
            }
        )
        if appt.get("status") in ("checked_in", "in_consultation", "completed", "cancelled"):
            events.append(
                {
                    "stage": "consultation",
                    "label": f"Status: {(appt.get('status') or '').replace('_', ' ')}",
                    "timestamp": appt.get("appointment_date"),
                }
            )

    for row in list_patient_movements(patient_id):
        movement = dict(row)
        events.append(
            {
                "stage": "queue",
                "label": f"Moved {movement.get('from_department') or '-'} -> {movement.get('to_department')}",
                "timestamp": movement.get("moved_at"),
            }
        )

    consultation_billed = 0.0
    consultation_paid = 0.0
    for row in list_invoices(patient_id=patient_id, hospital_id=hospital_id):
        invoice = dict(row)
        total_amount = float(invoice.get("total_amount") or 0)
        paid_amount = float(invoice.get("paid_amount") or 0)
        consultation_billed += total_amount
        consultation_paid += paid_amount
        events.append(
            {
                "stage": "billing",
                "label": f"Invoice {invoice.get('invoice_no')} raised — total {total_amount} ({invoice.get('payment_status')})",
                "timestamp": invoice.get("created_at"),
            }
        )

    for row in list_invoice_payments_for_patient(patient_id, hospital_id=hospital_id):
        payment = dict(row)
        events.append(
            {
                "stage": "billing",
                "label": f"Payment received: {payment.get('amount')} via {payment.get('payment_mode')} (Invoice {payment.get('invoice_no')})",
                "timestamp": payment.get("created_at"),
            }
        )

    lab_billed = 0.0
    lab_paid = 0.0
    for row in list_diagnostics(patient_id=patient_id, hospital_id=hospital_id):
        diagnostic = dict(row)
        amount = float(diagnostic.get("amount") or 0)
        paid_amount = float(diagnostic.get("paid_amount") or 0)
        lab_billed += amount
        lab_paid += paid_amount
        events.append(
            {
                "stage": "lab",
                "label": f"Lab order: {diagnostic.get('test_name')} ({diagnostic.get('order_status')}) — {amount}",
                "timestamp": diagnostic.get("created_at"),
            }
        )

    # Pharmacy sales have no due/partial concept -- they're paid in full at the
    # point of sale, so billed and paid are always equal.
    pharmacy_billed = 0.0
    for row in list_pharmacy_sales(patient_id=patient_id, hospital_id=hospital_id):
        sale = dict(row)
        amount = float(sale.get("amount") or 0)
        pharmacy_billed += amount
        events.append(
            {
                "stage": "pharmacy",
                "label": f"Pharmacy sale: {sale.get('medicine_name')} x{sale.get('quantity')} — {amount}",
                "timestamp": sale.get("sold_at"),
            }
        )
    pharmacy_paid = pharmacy_billed

    # Postgres returns native datetime objects while SQLite returns strings; mixing
    # None with either in a raw sort raises TypeError, so normalize everything to str
    # (Python's default datetime str() is still chronologically sortable).
    events.sort(key=lambda event: str(event["timestamp"]) if event["timestamp"] else "")

    total_billed = consultation_billed + lab_billed + pharmacy_billed
    total_paid = consultation_paid + lab_paid + pharmacy_paid
    summary = {
        "consultation_billed": consultation_billed,
        "consultation_paid": consultation_paid,
        "lab_billed": lab_billed,
        "lab_paid": lab_paid,
        "pharmacy_billed": pharmacy_billed,
        "pharmacy_paid": pharmacy_paid,
        "total_billed": total_billed,
        "total_paid": total_paid,
        "total_due": max(total_billed - total_paid, 0.0),
    }
    return {"patient": patient, "events": events, "summary": summary}


def create_invoice(data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        paid_amount = float(data.get("paid_amount", 0) or 0)
        advance_amount = float(data.get("advance_amount", 0) or 0)
        refunded_amount = float(data.get("refunded_amount", 0) or 0)
        collected_amount = max(paid_amount + advance_amount - refunded_amount, 0.0)
        total_amount = float(data["total_amount"])
        due_amount = max(total_amount - collected_amount, 0.0)
        # cursor.lastrowid is unreliable under psycopg2, so use RETURNING id on Postgres.
        insert_sql = """
            INSERT INTO invoices (
                invoice_no, patient_id, module, doctor_name, clinic_name, referral_source,
                subtotal, tax, discount, total_amount, paid_amount, due_amount, payment_status, created_by,
                advance_amount, refunded_amount, hospital_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        if IS_POSTGRES:
            insert_sql += " RETURNING id"
        cursor.execute(
            insert_sql,
            (
                data["invoice_no"],
                data.get("patient_id"),
                data["module"],
                data.get("doctor_name"),
                data.get("clinic_name"),
                data.get("referral_source"),
                data.get("subtotal", 0),
                data.get("tax", 0),
                data.get("discount", 0),
                total_amount,
                paid_amount,
                data.get("due_amount", due_amount),
                data.get("payment_status", "due"),
                data.get("created_by"),
                advance_amount,
                refunded_amount,
                scoped_hospital_id,
            ),
        )
        invoice_id = cursor.fetchone()[0] if IS_POSTGRES else cursor.lastrowid
        conn.commit()
        return invoice_id


def list_invoices(patient_id=None, module=None, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = ["deleted_at IS NULL"]
        params = []
        if hospital_id:
            clauses.append("hospital_id = ?")
            params.append(hospital_id)
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        if module:
            clauses.append("module = ?")
            params.append(module)
        where_clause = f" WHERE {' AND '.join(clauses)}"
        cursor.execute(f"SELECT * FROM invoices{where_clause} ORDER BY created_at DESC", tuple(params))
        return cursor.fetchall()


def get_invoice_by_id(invoice_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL", (invoice_id,))
        return cursor.fetchone()


def update_invoice(invoice_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        total_amount = float(data.get("total_amount", existing["total_amount"] or 0))
        paid_amount = float(data.get("paid_amount", existing["paid_amount"] or 0))
        advance_amount = float(data.get("advance_amount", existing["advance_amount"] or 0))
        refunded_amount = float(data.get("refunded_amount", existing["refunded_amount"] or 0))
        collected_amount = max(paid_amount + advance_amount - refunded_amount, 0.0)
        due_amount = max(total_amount - collected_amount, 0.0)
        payment_status = data.get("payment_status")
        if not payment_status:
            if due_amount == 0:
                payment_status = "paid"
            elif paid_amount > 0:
                payment_status = "partial"
            else:
                payment_status = "due"

        module_name = str(data.get("module", existing["module"])).upper()

        cursor.execute(
            """
            UPDATE invoices
            SET patient_id = ?,
                module = ?,
                doctor_name = ?,
                clinic_name = ?,
                referral_source = ?,
                subtotal = ?,
                tax = ?,
                discount = ?,
                total_amount = ?,
                paid_amount = ?,
                due_amount = ?,
                payment_status = ?,
                advance_amount = ?,
                refunded_amount = ?
            WHERE id = ?
            """,
            (
                data.get("patient_id", existing["patient_id"]),
                module_name,
                data.get("doctor_name", existing["doctor_name"]),
                data.get("clinic_name", existing["clinic_name"]),
                data.get("referral_source", existing["referral_source"]),
                data.get("subtotal", existing["subtotal"]),
                data.get("tax", existing["tax"]),
                data.get("discount", existing["discount"]),
                total_amount,
                paid_amount,
                due_amount,
                payment_status,
                advance_amount,
                refunded_amount,
                invoice_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_invoice(invoice_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE invoice_payments SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? "
            "WHERE invoice_id = ? AND deleted_at IS NULL",
            (actor, invoice_id),
        )
        deleted = soft_delete_row(cursor, "invoices", "id", invoice_id, actor=actor)
        conn.commit()
        return deleted


def list_invoice_payments_for_patient(patient_id, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clause = "invoices.patient_id = ? AND invoice_payments.deleted_at IS NULL"
        params = [patient_id]
        if hospital_id:
            clause += " AND invoices.hospital_id = ?"
            params.append(hospital_id)
        cursor.execute(
            f"""
            SELECT invoice_payments.*, invoices.invoice_no AS invoice_no
            FROM invoice_payments
            JOIN invoices ON invoices.id = invoice_payments.invoice_id
            WHERE {clause}
            ORDER BY invoice_payments.created_at ASC
            """,
            tuple(params),
        )
        return cursor.fetchall()


def record_invoice_payment(invoice_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT total_amount, paid_amount, advance_amount, refunded_amount, hospital_id FROM invoices WHERE id = ?",
            (invoice_id,),
        )
        invoice = cursor.fetchone()
        if not invoice:
            return None

        amount = float(data["amount"])
        paid_total = float(invoice["paid_amount"] or 0) + amount
        total_amount = float(invoice["total_amount"] or 0)
        advance_amount = float(invoice["advance_amount"] or 0)
        refunded_amount = float(invoice["refunded_amount"] or 0)
        due_total = max(total_amount - max(paid_total + advance_amount - refunded_amount, 0.0), 0.0)
        if due_total == 0:
            status = "paid"
        elif paid_total > 0:
            status = "partial"
        else:
            status = "due"

        payment_insert_sql = """
            INSERT INTO invoice_payments (
                invoice_id, amount, payment_mode, gateway_ref, converted_from_mode, converted_to_mode, hospital_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        if IS_POSTGRES:
            payment_insert_sql += " RETURNING id"
        cursor.execute(
            payment_insert_sql,
            (
                invoice_id,
                amount,
                data["payment_mode"],
                data.get("gateway_ref"),
                data.get("converted_from_mode"),
                data.get("converted_to_mode"),
                invoice["hospital_id"],
            ),
        )
        payment_id = cursor.fetchone()[0] if IS_POSTGRES else cursor.lastrowid
        cursor.execute(
            """
            UPDATE invoices
            SET paid_amount = ?, due_amount = ?, payment_status = ?
            WHERE id = ?
            """,
            (paid_total, due_total, status, invoice_id),
        )
        conn.commit()
        return payment_id


def create_insurance_claim(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO insurance_claims (
                invoice_id, patient_id, insurer_name, claim_amount, approved_amount,
                claim_status, external_ref, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["invoice_id"],
                data.get("patient_id"),
                data["insurer_name"],
                float(data["claim_amount"]),
                float(data.get("approved_amount", 0)),
                data.get("claim_status", "submitted"),
                data.get("external_ref"),
                data.get("notes"),
            ),
        )
        claim_id = cursor.lastrowid
        conn.commit()
        return claim_id


def list_insurance_claims(invoice_id=None, status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = ["deleted_at IS NULL"]
        params = []
        if invoice_id:
            clauses.append("invoice_id = ?")
            params.append(invoice_id)
        if status:
            clauses.append("claim_status = ?")
            params.append(status)
        where_clause = f" WHERE {' AND '.join(clauses)}"
        cursor.execute(
            f"SELECT * FROM insurance_claims{where_clause} ORDER BY submitted_at DESC, id DESC",
            tuple(params),
        )
        return cursor.fetchall()


def update_insurance_claim(claim_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM insurance_claims WHERE id = ?", (claim_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE insurance_claims
            SET invoice_id = ?, patient_id = ?, insurer_name = ?, claim_amount = ?,
                approved_amount = ?, claim_status = ?, external_ref = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("invoice_id", existing["invoice_id"]),
                data.get("patient_id", existing["patient_id"]),
                data.get("insurer_name", existing["insurer_name"]),
                float(data.get("claim_amount", existing["claim_amount"] or 0)),
                float(data.get("approved_amount", existing["approved_amount"] or 0)),
                data.get("claim_status", existing["claim_status"]),
                data.get("external_ref", existing["external_ref"]),
                data.get("notes", existing["notes"]),
                claim_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_insurance_claim(claim_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "insurance_claims", "id", claim_id, actor=actor)
        conn.commit()
        return deleted


def get_revenue_summary(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COALESCE(SUM(total_amount), 0) AS value FROM invoices WHERE hospital_id = ?", (scoped_hospital_id,))
        total_billed = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS value FROM invoices WHERE hospital_id = ?",
            (scoped_hospital_id,),
        )
        total_collected = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(due_amount), 0) AS value FROM invoices WHERE hospital_id = ?", (scoped_hospital_id,))
        total_due = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(advance_amount), 0) AS value FROM invoices WHERE hospital_id = ?", (scoped_hospital_id,))
        total_advance = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(refunded_amount), 0) AS value FROM invoices WHERE hospital_id = ?", (scoped_hospital_id,))
        total_refunded = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT payment_mode AS label, COALESCE(SUM(amount), 0) AS count
            FROM invoice_payments
            WHERE hospital_id = ?
            GROUP BY payment_mode
            ORDER BY count DESC
            """,
            (scoped_hospital_id,),
        )
        by_mode = [dict(row) for row in cursor.fetchall()]
        cursor.execute(
            """
            SELECT module AS label, COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS count
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY module
            ORDER BY count DESC
            """,
            (scoped_hospital_id,),
        )
        by_module = [dict(row) for row in cursor.fetchall()]

        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at < INTERVAL '31 days' THEN due_amount ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '31 days' AND CURRENT_TIMESTAMP - created_at < INTERVAL '61 days' THEN due_amount ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '61 days' AND CURRENT_TIMESTAMP - created_at < INTERVAL '91 days' THEN due_amount ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND CURRENT_TIMESTAMP - created_at >= INTERVAL '91 days' THEN due_amount ELSE 0 END), 0) AS bucket_91_plus
                FROM invoices
                WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
        else:
            cursor.execute(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND julianday('now') - julianday(created_at) <= 30 THEN due_amount ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND julianday('now') - julianday(created_at) > 30 AND julianday('now') - julianday(created_at) <= 60 THEN due_amount ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND julianday('now') - julianday(created_at) > 60 AND julianday('now') - julianday(created_at) <= 90 THEN due_amount ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN due_amount > 0 AND julianday('now') - julianday(created_at) > 90 THEN due_amount ELSE 0 END), 0) AS bucket_91_plus
                FROM invoices
                WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
        aging = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN gateway_ref IS NOT NULL AND TRIM(gateway_ref) <> '' THEN amount ELSE 0 END), 0) AS gateway_collected,
                COALESCE(SUM(CASE WHEN converted_from_mode IS NOT NULL AND TRIM(converted_from_mode) <> '' THEN amount ELSE 0 END), 0) AS converted_total
            FROM invoice_payments
            WHERE hospital_id = ?
            """,
            (scoped_hospital_id,),
        )
        reconciliation = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT
                COALESCE(NULLIF(TRIM(converted_from_mode), ''), payment_mode) || ' -> ' ||
                COALESCE(NULLIF(TRIM(converted_to_mode), ''), payment_mode) AS label,
                COALESCE(SUM(amount), 0) AS count
            FROM invoice_payments
            WHERE hospital_id = ? AND converted_from_mode IS NOT NULL AND TRIM(converted_from_mode) <> ''
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        conversion_breakdown = [dict(row) for row in cursor.fetchall()]
    return {
        "total_billed": total_billed,
        "total_collected": total_collected,
        "total_due": total_due,
        "total_advance": total_advance,
        "total_refunded": total_refunded,
        "payment_mode_breakdown": by_mode,
        "collections_by_module": by_module,
        "aging_buckets": {
            "bucket_0_30": aging.get("bucket_0_30", 0),
            "bucket_31_60": aging.get("bucket_31_60", 0),
            "bucket_61_90": aging.get("bucket_61_90", 0),
            "bucket_91_plus": aging.get("bucket_91_plus", 0),
        },
        "reconciliation_summary": {
            "gateway_collected": reconciliation.get("gateway_collected", 0),
            "converted_total": reconciliation.get("converted_total", 0),
        },
        "conversion_breakdown": conversion_breakdown,
    }


def get_reports_overview(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    hospital_summary = get_hospital_dashboard_summary(hospital_id=scoped_hospital_id)
    billing_summary = get_revenue_summary(hospital_id=scoped_hospital_id)
    pharmacy_summary = get_pharmacy_summary(hospital_id=scoped_hospital_id)
    lab_summary = get_diagnostic_summary(hospital_id=scoped_hospital_id)
    employee_summary = get_employee_stats(hospital_id=scoped_hospital_id)
    accounts_summary = get_accounts_summary()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doctor_name), ''), 'Unassigned') AS label,
                   COALESCE(SUM(paid_amount + advance_amount - refunded_amount), 0) AS count
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        doctor_income = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(patient_id), ''), 'Unknown') AS label,
                   COALESCE(SUM(total_amount), 0) AS total_billed,
                   COALESCE(SUM(due_amount), 0) AS total_due
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY total_due DESC, total_billed DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        patient_financials = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(doctor_name), ''), 'Unassigned') AS label,
                   COALESCE(SUM(amount), 0) AS count
            FROM diagnostics
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        diagnostics_by_doctor = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(clinic_name), ''), 'General') AS label,
                   COALESCE(SUM(total_amount), 0) AS count
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        clinic_income = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(module), ''), 'UNKNOWN') AS label,
                   COALESCE(SUM(discount), 0) AS count
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        discount_by_module = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(payment_status), ''), 'due') AS label,
                   COUNT(*) AS count
            FROM invoices
            WHERE hospital_id = ?
            GROUP BY label
            ORDER BY count DESC, label ASC
            """,
            (scoped_hospital_id,),
        )
        payment_status_breakdown = [dict(row) for row in cursor.fetchall()]

        if IS_POSTGRES:
            cursor.execute(
                """
                SELECT AVG(
                    GREATEST(
                        EXTRACT(EPOCH FROM (COALESCE(discharge_date::timestamp, CURRENT_TIMESTAMP) - admission_date)) / 86400.0,
                        0
                    )
                ) AS avg_los,
                COUNT(*) AS admission_count
                FROM admissions
                WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
        else:
            cursor.execute(
                """
                SELECT AVG(
                    CASE
                        WHEN discharge_date IS NOT NULL AND julianday(discharge_date) - julianday(admission_date) > 0
                        THEN julianday(discharge_date) - julianday(admission_date)
                        WHEN discharge_date IS NULL AND julianday('now') - julianday(admission_date) > 0
                        THEN julianday('now') - julianday(admission_date)
                        ELSE 0
                    END
                ) AS avg_los,
                COUNT(*) AS admission_count
                FROM admissions
                WHERE hospital_id = ?
                """,
                (scoped_hospital_id,),
            )
        alos_row = cursor.fetchone()
        average_los_days = round(float((alos_row or {"avg_los": 0})["avg_los"] or 0), 2)
        admission_count = int((alos_row or {"admission_count": 0})["admission_count"] or 0)
        
        # Phase H Metrics
        cursor.execute("SELECT COUNT(*) AS total_beds FROM bed_master")
        total_beds = int((cursor.fetchone() or {"total_beds": 0})["total_beds"] or 0)
        cursor.execute("SELECT COUNT(*) AS occupied_beds FROM bed_master WHERE status = 'Occupied'")
        occupied_beds = int((cursor.fetchone() or {"occupied_beds": 0})["occupied_beds"] or 0)
        bed_occupancy_rate = round((occupied_beds / total_beds * 100) if total_beds > 0 else 0, 1)

        cursor.execute("SELECT COUNT(*) AS icu_patients FROM icu_monitoring WHERE ventilator_active = 1")
        icu_critical = int((cursor.fetchone() or {"icu_patients": 0})["icu_patients"] or 0)

        cursor.execute("SELECT COUNT(*) AS active_emergencies FROM emergency_triage WHERE status = 'Pending'")
        active_emergencies = int((cursor.fetchone() or {"active_emergencies": 0})["active_emergencies"] or 0)

        cursor.execute("SELECT COUNT(*) AS active_ambulances FROM ambulance_dispatch WHERE status = 'En Route'")
        active_ambulances = int((cursor.fetchone() or {"active_ambulances": 0})["active_ambulances"] or 0)

    return {
        "hospital_summary": hospital_summary,
        "billing_summary": billing_summary,
        "pharmacy_summary": pharmacy_summary,
        "lab_summary": lab_summary,
        "employee_summary": employee_summary,
        "accounts_summary": accounts_summary,
        "doctor_income": doctor_income,
        "patient_financials": patient_financials,
        "diagnostics_by_doctor": diagnostics_by_doctor,
        "clinic_income": clinic_income,
        "discount_by_module": discount_by_module,
        "payment_status_breakdown": payment_status_breakdown,
        "alos_summary": {
            "average_los_days": average_los_days,
            "admission_count": admission_count,
        },
        "phase_h_summary": {
            "total_beds": total_beds,
            "occupied_beds": occupied_beds,
            "bed_occupancy_rate": bed_occupancy_rate,
            "icu_critical_patients": icu_critical,
            "active_emergencies": active_emergencies,
            "active_ambulances": active_ambulances
        }
    }


def upsert_inventory_item(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        item_id = data.get("id")
        if item_id:
            cursor.execute(
                """
                UPDATE pharmacy_inventory
                SET medicine_name=?, batch_no=?, quantity=?, reorder_level=?, unit_price=?, expiry_date=?, stock_condition=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                (
                    data["medicine_name"],
                    data.get("batch_no"),
                    data.get("quantity", 0),
                    data.get("reorder_level", 10),
                    data.get("unit_price", 0),
                    data.get("expiry_date"),
                    data.get("stock_condition", "proper"),
                    item_id,
                ),
            )
            conn.commit()
            return item_id
        cursor.execute(
            """
            INSERT INTO pharmacy_inventory (
                medicine_name, batch_no, quantity, reorder_level, unit_price, expiry_date, stock_condition
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["medicine_name"],
                data.get("batch_no"),
                data.get("quantity", 0),
                data.get("reorder_level", 10),
                data.get("unit_price", 0),
                data.get("expiry_date"),
                data.get("stock_condition", "proper"),
            ),
        )
        item_id = cursor.lastrowid
        conn.commit()
        return item_id


def list_inventory_items():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_inventory WHERE deleted_at IS NULL ORDER BY medicine_name ASC")
        return cursor.fetchall()


def delete_inventory_item(item_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "pharmacy_inventory", "id", item_id, actor=actor)
        conn.commit()
        return deleted


def create_pharmacy_supplier(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO pharmacy_suppliers (supplier_name, contact_person, phone, status)
            VALUES (?, ?, ?, ?)
            """,
            (
                data["supplier_name"],
                data.get("contact_person"),
                data.get("phone"),
                data.get("status", "active"),
            ),
        )
        supplier_id = cursor.lastrowid
        conn.commit()
        return supplier_id


def list_pharmacy_suppliers():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_suppliers WHERE deleted_at IS NULL ORDER BY supplier_name ASC")
        return cursor.fetchall()


def update_pharmacy_supplier(supplier_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_suppliers WHERE id = ?", (supplier_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE pharmacy_suppliers
            SET supplier_name = ?, contact_person = ?, phone = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("supplier_name", existing["supplier_name"]),
                data.get("contact_person", existing["contact_person"]),
                data.get("phone", existing["phone"]),
                data.get("status", existing["status"]),
                supplier_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_pharmacy_supplier(supplier_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE pharmacy_purchases SET supplier_id = NULL WHERE supplier_id = ?", (supplier_id,))
        deleted = soft_delete_row(cursor, "pharmacy_suppliers", "id", supplier_id, actor=actor)
        conn.commit()
        return deleted


def _apply_purchase_inventory(cursor, medicine_name, quantity):
    cursor.execute(
        "SELECT id, quantity FROM pharmacy_inventory WHERE medicine_name = ? AND deleted_at IS NULL",
        (medicine_name,),
    )
    existing_inventory = cursor.fetchone()
    if existing_inventory:
        cursor.execute(
            """
            UPDATE pharmacy_inventory
            SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (quantity, existing_inventory["id"]),
        )
    else:
        cursor.execute(
            """
            INSERT INTO pharmacy_inventory (
                medicine_name, quantity, reorder_level, unit_price, stock_condition
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (medicine_name, quantity, 10, 0, "proper"),
        )


def create_pharmacy_purchase(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        quantity = int(data["quantity"])
        unit_cost = float(data["unit_cost"])
        status = data.get("status", "ordered")
        stock_applied = 1 if status == "received" else 0
        cursor.execute(
            """
            INSERT INTO pharmacy_purchases (
                supplier_id, medicine_name, quantity, unit_cost, total_cost, status,
                expected_date, received_date, stock_applied
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("supplier_id"),
                data["medicine_name"],
                quantity,
                unit_cost,
                quantity * unit_cost,
                status,
                data.get("expected_date"),
                data.get("received_date"),
                stock_applied,
            ),
        )
        purchase_id = cursor.lastrowid
        if stock_applied:
            _apply_purchase_inventory(cursor, data["medicine_name"], quantity)
        conn.commit()
        return purchase_id


def list_pharmacy_purchases(status=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute(
                "SELECT * FROM pharmacy_purchases WHERE status = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC",
                (status,),
            )
        else:
            cursor.execute("SELECT * FROM pharmacy_purchases WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC")
        return cursor.fetchall()


def update_pharmacy_purchase(purchase_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pharmacy_purchases WHERE id = ?", (purchase_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        quantity = int(data.get("quantity", existing["quantity"] or 0))
        unit_cost = float(data.get("unit_cost", existing["unit_cost"] or 0))
        status = data.get("status", existing["status"])
        stock_applied = int(existing["stock_applied"] or 0)
        cursor.execute(
            """
            UPDATE pharmacy_purchases
            SET supplier_id = ?, medicine_name = ?, quantity = ?, unit_cost = ?, total_cost = ?,
                status = ?, expected_date = ?, received_date = ?, stock_applied = ?
            WHERE id = ?
            """,
            (
                data.get("supplier_id", existing["supplier_id"]),
                data.get("medicine_name", existing["medicine_name"]),
                quantity,
                unit_cost,
                quantity * unit_cost,
                status,
                data.get("expected_date", existing["expected_date"]),
                data.get("received_date", existing["received_date"]),
                stock_applied,
                purchase_id,
            ),
        )
        if status == "received" and not stock_applied:
            _apply_purchase_inventory(cursor, data.get("medicine_name", existing["medicine_name"]), quantity)
            cursor.execute(
                "UPDATE pharmacy_purchases SET stock_applied = 1 WHERE id = ?",
                (purchase_id,),
            )
        conn.commit()
        return cursor.rowcount > 0


def delete_pharmacy_purchase(purchase_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "pharmacy_purchases", "id", purchase_id, actor=actor)
        conn.commit()
        return deleted


def create_pharmacy_sale(data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        amount = float(data["quantity"]) * float(data["unit_price"])
        cursor.execute(
            """
            INSERT INTO pharmacy_sales (
                invoice_id, patient_id, prescription_ref, medicine_name, quantity, unit_price, amount, hospital_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("invoice_id"),
                data.get("patient_id"),
                data.get("prescription_ref"),
                data["medicine_name"],
                data["quantity"],
                data["unit_price"],
                amount,
                scoped_hospital_id,
            ),
        )
        sale_id = cursor.lastrowid
        cursor.execute(
            """
            UPDATE pharmacy_inventory
            SET quantity = CASE WHEN quantity >= ? THEN quantity - ? ELSE 0 END, updated_at=CURRENT_TIMESTAMP
            WHERE medicine_name = ?
            """,
            (data["quantity"], data["quantity"], data["medicine_name"]),
        )
        conn.commit()
        return sale_id


def list_pharmacy_sales(medicine_name=None, invoice_id=None, patient_id=None, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = []
        params = []
        if hospital_id:
            clauses.append("hospital_id = ?")
            params.append(hospital_id)
        if medicine_name:
            clauses.append("medicine_name = ?")
            params.append(medicine_name)
        if invoice_id:
            clauses.append("invoice_id = ?")
            params.append(invoice_id)
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        where_clause = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor.execute(
            f"SELECT * FROM pharmacy_sales{where_clause} ORDER BY sold_at DESC",
            tuple(params),
        )
        return cursor.fetchall()


def get_pharmacy_summary(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE quantity <= reorder_level
            """
        )
        low_stock = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE quantity = 0
            """
        )
        out_of_stock = cursor.fetchone()["value"]
        cursor.execute(
            """
            SELECT COUNT(*) AS value
            FROM pharmacy_inventory
            WHERE stock_condition = 'damaged'
            """
        )
        damaged = cursor.fetchone()["value"]
        cursor.execute(
            "SELECT COALESCE(SUM(amount), 0) AS value FROM pharmacy_sales WHERE hospital_id = ?",
            (scoped_hospital_id,),
        )
        sales_total = cursor.fetchone()["value"]
    return {
        "low_stock_count": low_stock,
        "out_of_stock_count": out_of_stock,
        "damaged_stock_count": damaged,
        "sales_total": sales_total,
    }


def create_lab_vendor(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lab_vendors (vendor_name, contact_person, phone, status)
            VALUES (?, ?, ?, ?)
            """,
            (
                data["vendor_name"],
                data.get("contact_person"),
                data.get("phone"),
                data.get("status", "active"),
            ),
        )
        vendor_id = cursor.lastrowid
        conn.commit()
        return vendor_id


def list_lab_vendors():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM lab_vendors WHERE deleted_at IS NULL ORDER BY vendor_name ASC")
        return cursor.fetchall()


def update_lab_vendor(vendor_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM lab_vendors WHERE id = ?", (vendor_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE lab_vendors
            SET vendor_name = ?, contact_person = ?, phone = ?, status = ?
            WHERE id = ?
            """,
            (
                data.get("vendor_name", existing["vendor_name"]),
                data.get("contact_person", existing["contact_person"]),
                data.get("phone", existing["phone"]),
                data.get("status", existing["status"]),
                vendor_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_lab_vendor(vendor_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE diagnostics SET vendor_id = NULL WHERE vendor_id = ?", (vendor_id,))
        deleted = soft_delete_row(cursor, "lab_vendors", "id", vendor_id, actor=actor)
        conn.commit()
        return deleted


def create_diagnostic_record(data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        paid_amount = float(data.get("paid_amount", 0))
        total_amount = float(data["amount"])
        due_amount = max(total_amount - paid_amount, 0.0)
        status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "due")
        cursor.execute(
            """
            INSERT INTO diagnostics (
                invoice_no, patient_id, vendor_id, doctor_name, test_name, amount, paid_amount, due_amount, status,
                sample_barcode, order_status, collected_at, reported_at, hospital_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("invoice_no"),
                data.get("patient_id"),
                data.get("vendor_id"),
                data.get("doctor_name"),
                data["test_name"],
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("sample_barcode"),
                data.get("order_status", "ordered"),
                data.get("collected_at"),
                data.get("reported_at"),
                scoped_hospital_id,
            ),
        )
        diagnostic_id = cursor.lastrowid
        conn.commit()
        return diagnostic_id


def list_diagnostics(patient_id=None, doctor_name=None, hospital_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        clauses = ["deleted_at IS NULL"]
        params = []
        if hospital_id:
            clauses.append("hospital_id = ?")
            params.append(hospital_id)
        if patient_id:
            clauses.append("patient_id = ?")
            params.append(patient_id)
        if doctor_name:
            clauses.append("doctor_name = ?")
            params.append(doctor_name)
        where_clause = f" WHERE {' AND '.join(clauses)}"
        cursor.execute(f"SELECT * FROM diagnostics{where_clause} ORDER BY created_at DESC", tuple(params))
        return cursor.fetchall()


def update_diagnostic_record(diagnostic_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM diagnostics WHERE id = ?", (diagnostic_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        total_amount = float(data.get("amount", existing["amount"] or 0))
        paid_amount = float(data.get("paid_amount", existing["paid_amount"] or 0))
        due_amount = max(total_amount - paid_amount, 0.0)
        status = data.get("status")
        if not status:
            status = "paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "due")

        cursor.execute(
            """
            UPDATE diagnostics
            SET invoice_no = ?,
                patient_id = ?,
                vendor_id = ?,
                doctor_name = ?,
                test_name = ?,
                amount = ?,
                paid_amount = ?,
                due_amount = ?,
                status = ?,
                sample_barcode = ?,
                order_status = ?,
                collected_at = ?,
                reported_at = ?
            WHERE id = ?
            """,
            (
                data.get("invoice_no", existing["invoice_no"]),
                data.get("patient_id", existing["patient_id"]),
                data.get("vendor_id", existing["vendor_id"]),
                data.get("doctor_name", existing["doctor_name"]),
                data.get("test_name", existing["test_name"]),
                total_amount,
                paid_amount,
                due_amount,
                status,
                data.get("sample_barcode", existing["sample_barcode"]),
                data.get("order_status", existing["order_status"]),
                data.get("collected_at", existing["collected_at"]),
                data.get("reported_at", existing["reported_at"]),
                diagnostic_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_diagnostic_record(diagnostic_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "diagnostics", "id", diagnostic_id, actor=actor)
        conn.commit()
        return deleted


def get_diagnostic_summary(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COALESCE(SUM(amount), 0) AS value FROM diagnostics WHERE hospital_id = ?", (scoped_hospital_id,))
        total_amount = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(paid_amount), 0) AS value FROM diagnostics WHERE hospital_id = ?", (scoped_hospital_id,))
        total_paid = cursor.fetchone()["value"]
        cursor.execute("SELECT COALESCE(SUM(due_amount), 0) AS value FROM diagnostics WHERE hospital_id = ?", (scoped_hospital_id,))
        total_due = cursor.fetchone()["value"]
    return {"total_amount": total_amount, "total_paid": total_paid, "total_due": total_due}


def create_department(data, hospital_id=None):
    scoped_hospital_id = hospital_id or data.get("hospital_id") or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO department_master (hospital_id, department_name, mapped_head_employee_id)
            VALUES (?, ?, ?)
            """,
            (scoped_hospital_id, data["department_name"], data.get("mapped_head_employee_id")),
        )
        department_id = cursor.lastrowid
        conn.commit()
        return department_id


def list_departments(hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM department_master WHERE hospital_id = ? AND deleted_at IS NULL ORDER BY department_name ASC",
            (scoped_hospital_id,),
        )
        return cursor.fetchall()


def update_department(department_id, data, hospital_id=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM department_master WHERE id = ? AND hospital_id = ?",
            (department_id, scoped_hospital_id),
        )
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE department_master
            SET department_name = ?, mapped_head_employee_id = ?
            WHERE id = ? AND hospital_id = ?
            """,
            (
                data.get("department_name", existing["department_name"]),
                data.get("mapped_head_employee_id", existing["mapped_head_employee_id"]),
                department_id,
                scoped_hospital_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_department(department_id, hospital_id=None, actor=None):
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(
            cursor, "department_master", "id", department_id, hospital_id=scoped_hospital_id, actor=actor
        )
        conn.commit()
        return deleted


def create_attendance(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO attendance (employee_id, attendance_date, status, in_time, out_time, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["attendance_date"],
                data["status"],
                data.get("in_time"),
                data.get("out_time"),
                data.get("notes"),
            ),
        )
        attendance_id = cursor.lastrowid
        conn.commit()
        return attendance_id


def list_attendance(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM attendance WHERE employee_id = ? AND deleted_at IS NULL ORDER BY attendance_date DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM attendance WHERE deleted_at IS NULL ORDER BY attendance_date DESC")
        return cursor.fetchall()


def update_attendance_record(attendance_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM attendance WHERE id = ?", (attendance_id,))
        existing = cursor.fetchone()
        if not existing:
            return False
        cursor.execute(
            """
            UPDATE attendance
            SET employee_id = ?, attendance_date = ?, status = ?, in_time = ?, out_time = ?, notes = ?
            WHERE id = ?
            """,
            (
                data.get("employee_id", existing["employee_id"]),
                data.get("attendance_date", existing["attendance_date"]),
                data.get("status", existing["status"]),
                data.get("in_time", existing["in_time"]),
                data.get("out_time", existing["out_time"]),
                data.get("notes", existing["notes"]),
                attendance_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_attendance_record(attendance_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "attendance", "id", attendance_id, actor=actor)
        conn.commit()
        return deleted


def create_payroll_record(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        net_salary = float(data["basic_salary"]) + float(data.get("allowances", 0)) - float(data.get("deductions", 0))
        cursor.execute(
            """
            INSERT INTO payroll (
                employee_id, payroll_month, basic_salary, allowances, deductions, net_salary, paid_status, paid_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["payroll_month"],
                data["basic_salary"],
                data.get("allowances", 0),
                data.get("deductions", 0),
                net_salary,
                data.get("paid_status", "pending"),
                data.get("paid_date"),
            ),
        )
        payroll_id = cursor.lastrowid
        conn.commit()
        return payroll_id


def list_payroll(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM payroll WHERE employee_id = ? AND deleted_at IS NULL ORDER BY payroll_month DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM payroll WHERE deleted_at IS NULL ORDER BY payroll_month DESC")
        return cursor.fetchall()


def update_payroll_record(payroll_id, data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM payroll WHERE id = ?", (payroll_id,))
        existing = cursor.fetchone()
        if not existing:
            return False

        basic_salary = float(data.get("basic_salary", existing["basic_salary"] or 0))
        allowances = float(data.get("allowances", existing["allowances"] or 0))
        deductions = float(data.get("deductions", existing["deductions"] or 0))
        net_salary = basic_salary + allowances - deductions

        cursor.execute(
            """
            UPDATE payroll
            SET employee_id = ?, payroll_month = ?, basic_salary = ?, allowances = ?, deductions = ?, net_salary = ?, paid_status = ?, paid_date = ?
            WHERE id = ?
            """,
            (
                data.get("employee_id", existing["employee_id"]),
                data.get("payroll_month", existing["payroll_month"]),
                basic_salary,
                allowances,
                deductions,
                net_salary,
                data.get("paid_status", existing["paid_status"]),
                data.get("paid_date", existing["paid_date"]),
                payroll_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_payroll_record(payroll_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "payroll", "id", payroll_id, actor=actor)
        conn.commit()
        return deleted


def create_leave_request(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO leave_requests (
                employee_id, leave_type, start_date, end_date, reason, status, decided_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["employee_id"],
                data["leave_type"],
                data["start_date"],
                data["end_date"],
                data.get("reason"),
                data.get("status", "pending"),
                data.get("decided_by"),
            ),
        )
        leave_id = cursor.lastrowid
        conn.commit()
        return leave_id


def update_leave_status(leave_id, status, decided_by=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE leave_requests SET status=?, decided_by=? WHERE id=?",
            (status, decided_by, leave_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def list_leave_requests(employee_id=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        if employee_id:
            cursor.execute(
                "SELECT * FROM leave_requests WHERE employee_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
                (employee_id,),
            )
        else:
            cursor.execute("SELECT * FROM leave_requests WHERE deleted_at IS NULL ORDER BY created_at DESC")
        return cursor.fetchall()


def delete_leave_request(leave_id, actor=None):
    with get_connection() as conn:
        cursor = conn.cursor()
        deleted = soft_delete_row(cursor, "leave_requests", "id", leave_id, actor=actor)
        conn.commit()
        return deleted


def add_audit_log(data):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO audit_logs (
                actor_username, action, module_name, entity_key, payload, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("actor_username"),
                data["action"],
                data["module_name"],
                data.get("entity_key"),
                data.get("payload"),
                data.get("ip_address"),
            ),
        )
        log_id = cursor.lastrowid
        conn.commit()
        return log_id


def get_audit_logs(module_name=None, limit=100):
    with get_connection() as conn:
        cursor = conn.cursor()
        safe_limit = max(1, min(int(limit), 1000))
        if module_name:
            cursor.execute(
                f"""
                SELECT * FROM audit_logs
                WHERE module_name = ?
                ORDER BY created_at DESC
                LIMIT {safe_limit}
                """,
                (module_name,),
            )
        else:
            cursor.execute(
                f"""
                SELECT * FROM audit_logs
                ORDER BY created_at DESC
                LIMIT {safe_limit}
                """
            )
        return cursor.fetchall()


def get_hospital_dashboard_summary(hospital_id=None):
    # strftime()/DATE('now') are SQLite-only; Postgres has no such functions. Compute the
    # "today" and "this month" boundaries in Python instead so the comparisons are portable
    # range/equality checks against plain ISO date strings on both engines.
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    today = current_ist_datetime().date()
    month_start = today.replace(day=1)
    if month_start.month == 12:
        next_month_start = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month_start = month_start.replace(month=month_start.month + 1)
    today_str = today.isoformat()
    month_start_str = month_start.isoformat()
    next_month_start_str = next_month_start.isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                SUM(CASE WHEN encounter_type='IP' AND DATE(arrival_at)=? THEN 1 ELSE 0 END) AS daily_ip,
                SUM(CASE WHEN encounter_type='OP' AND DATE(arrival_at)=? THEN 1 ELSE 0 END) AS daily_op,
                SUM(CASE WHEN encounter_type='IP' THEN 1 ELSE 0 END) AS monthly_ip,
                SUM(CASE WHEN encounter_type='OP' THEN 1 ELSE 0 END) AS monthly_op,
                SUM(CASE WHEN is_accident=1 AND DATE(arrival_at)=? THEN 1 ELSE 0 END) AS daily_accident,
                SUM(CASE WHEN is_accident=1 THEN 1 ELSE 0 END) AS monthly_accident
            FROM encounters
            WHERE hospital_id = ? AND arrival_at >= ? AND arrival_at < ?
            """,
            (today_str, today_str, today_str, scoped_hospital_id, month_start_str, next_month_start_str),
        )
        encounter_summary = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT
                COALESCE(SUM(total_amount), 0) AS total_revenue,
                COALESCE(SUM(due_amount), 0) AS due_collection
            FROM invoices
            WHERE hospital_id = ? AND created_at >= ? AND created_at < ?
            """,
            (scoped_hospital_id, month_start_str, next_month_start_str),
        )
        revenue_summary = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT payment_mode AS label, COALESCE(SUM(amount), 0) AS count
            FROM invoice_payments
            WHERE hospital_id = ? AND created_at >= ? AND created_at < ?
            GROUP BY payment_mode
            ORDER BY count DESC
            """,
            (scoped_hospital_id, month_start_str, next_month_start_str),
        )
        payment_mode_breakdown = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS diagnostics_income
            FROM diagnostics
            WHERE hospital_id = ? AND created_at >= ? AND created_at < ?
            """,
            (scoped_hospital_id, month_start_str, next_month_start_str),
        )
        diagnostics_income_row = cursor.fetchone()
        diagnostics_income = diagnostics_income_row["diagnostics_income"] if diagnostics_income_row else 0

        cursor.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS pharmacy_sales
            FROM pharmacy_sales
            WHERE hospital_id = ? AND sold_at >= ? AND sold_at < ?
            """,
            (scoped_hospital_id, month_start_str, next_month_start_str),
        )
        pharmacy_sales_row = cursor.fetchone()
        pharmacy_sales = pharmacy_sales_row["pharmacy_sales"] if pharmacy_sales_row else 0

        cursor.execute(
            """
            SELECT COALESCE(referral_source, 'unknown') AS label, COUNT(*) AS count
            FROM encounters
            WHERE hospital_id = ? AND arrival_at >= ? AND arrival_at < ?
            GROUP BY referral_source
            ORDER BY count DESC
            """,
            (scoped_hospital_id, month_start_str, next_month_start_str),
        )
        referral_summary = [dict(row) for row in cursor.fetchall()]

    return {
        "ip_op_counts": {
            "daily_ip": encounter_summary.get("daily_ip", 0) or 0,
            "daily_op": encounter_summary.get("daily_op", 0) or 0,
            "monthly_ip": encounter_summary.get("monthly_ip", 0) or 0,
            "monthly_op": encounter_summary.get("monthly_op", 0) or 0,
        },
        "accidents": {
            "daily": encounter_summary.get("daily_accident", 0) or 0,
            "monthly": encounter_summary.get("monthly_accident", 0) or 0,
        },
        "revenue": {
            "total": revenue_summary.get("total_revenue", 0) or 0,
            "due": revenue_summary.get("due_collection", 0) or 0,
            "payment_mode_breakdown": payment_mode_breakdown,
        },
        "pharmacy_summary": {"monthly_sales": pharmacy_sales},
        "diagnostics_summary": {"monthly_income": diagnostics_income},
        "referrals": referral_summary,
    }


# ---- Pharmacy Prescriptions (OCR Integration) ----

def ensure_pharmacy_prescriptions_tables(conn):
    cursor = conn.cursor()
    from utils.database import IS_POSTGRES
    
    if IS_POSTGRES:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS pharmacy_prescriptions (
                id SERIAL PRIMARY KEY,
                hospital_id INTEGER NOT NULL,
                patient_id TEXT NOT NULL,
                doctor_username TEXT NOT NULL,
                doc_id INTEGER,
                medicines_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TIMESTAMP,
                FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
            )
            """
        )
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS pharmacy_prescriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hospital_id INTEGER NOT NULL,
                patient_id TEXT NOT NULL,
                doctor_username TEXT NOT NULL,
                doc_id INTEGER,
                medicines_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TIMESTAMP,
                FOREIGN KEY (hospital_id) REFERENCES hospitals(id)
            )
            """
        )
    conn.commit()


def create_pharmacy_prescription(hospital_id, patient_id, doctor_username, medicines_json, doc_id=None):
    from utils.database import get_connection, IS_POSTGRES
    with get_connection() as conn:
        cursor = conn.cursor()
        if IS_POSTGRES:
            cursor.execute(
                """
                INSERT INTO pharmacy_prescriptions (hospital_id, patient_id, doctor_username, doc_id, medicines_json)
                VALUES (?, ?, ?, ?, ?)
                RETURNING id
                """,
                (hospital_id, patient_id, doctor_username, doc_id, medicines_json)
            )
            pid = cursor.fetchone()[0]
        else:
            cursor.execute(
                """
                INSERT INTO pharmacy_prescriptions (hospital_id, patient_id, doctor_username, doc_id, medicines_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (hospital_id, patient_id, doctor_username, doc_id, medicines_json)
            )
            pid = cursor.lastrowid
        conn.commit()
        return pid


def list_pending_pharmacy_prescriptions(hospital_id):
    from utils.database import get_connection
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT p.*, pat.name as patient_name, pat.last_name as patient_last_name 
            FROM pharmacy_prescriptions p
            JOIN patients pat ON pat.patient_id = p.patient_id
            WHERE p.hospital_id = ? AND p.status = 'pending'
            ORDER BY p.created_at DESC
            """,
            (hospital_id,)
        )
        return cursor.fetchall()


def get_pharmacy_prescription(hospital_id, prescription_id):
    from utils.database import get_connection
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM pharmacy_prescriptions
            WHERE id = ? AND hospital_id = ?
            """,
            (prescription_id, hospital_id)
        )
        return cursor.fetchone()


def fulfill_pharmacy_prescription(hospital_id, prescription_id):
    from utils.database import get_connection
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE pharmacy_prescriptions
            SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP
            WHERE id = ? AND hospital_id = ?
            """,
            (prescription_id, hospital_id)
        )
        conn.commit()


def ensure_emr_tables(conn):
    cursor = conn.cursor()
    
    if IS_POSTGRES:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS medical_history (
                id SERIAL PRIMARY KEY,
                patient_id TEXT NOT NULL,
                allergies TEXT,
                existing_diseases TEXT,
                chronic_conditions TEXT,
                previous_surgeries TEXT,
                family_history TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS clinical_notes (
                id SERIAL PRIMARY KEY,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                chief_complaint TEXT,
                notes TEXT,
                follow_up TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS patient_vitals (
                id SERIAL PRIMARY KEY,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                bp TEXT,
                pulse TEXT,
                temperature TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnosis_records (
                id SERIAL PRIMARY KEY,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                diagnosis_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS emr_access_logs (
                id SERIAL PRIMARY KEY,
                patient_id TEXT NOT NULL,
                doctor_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (doctor_id) REFERENCES users(id)
            )
            """
        )
    else:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS medical_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                allergies TEXT,
                existing_diseases TEXT,
                chronic_conditions TEXT,
                previous_surgeries TEXT,
                family_history TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS clinical_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                chief_complaint TEXT,
                notes TEXT,
                follow_up TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS patient_vitals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                bp TEXT,
                pulse TEXT,
                temperature TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnosis_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encounter_id INTEGER,
                patient_id TEXT NOT NULL,
                diagnosis_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (encounter_id) REFERENCES encounters(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS emr_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                doctor_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
                FOREIGN KEY (doctor_id) REFERENCES users(id)
            )
            """
        )
