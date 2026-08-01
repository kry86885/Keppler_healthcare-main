import os
import importlib
import sys

import pytest

# Module-level, not inside a fixture: pytest imports every test module during its
# *collection* phase, before any fixture ever runs -- and several test files (e.g.
# test_bulk_import.py) do a module-level `import app`, whose own module-level code
# calls init_database() immediately on import. Setting these inside a fixture would
# be too late for that first collection-time import. Tests must never depend on
# whatever DB_ENGINE/DATABASE_URL happens to be sitting in a developer's root .env
# (e.g. pointed at a real shared Postgres) -- database.py's load_dotenv(...,
# override=False) would otherwise pick that up, silently making the suite try to
# reach a real database instead of the fast, isolated SQLite fixture it's meant to
# use. Confirmed this exact thing was happening: the full suite took over an hour
# instead of ~1-2 minutes because collection itself hung against stale
# local-Postgres credentials from the root .env before a single test could run.
os.environ["DB_ENGINE"] = "sqlite"
os.environ["DATABASE_URL"] = ""
os.environ["BUCKET_URL"] = "s3://memory-test/bucket"
# Must be set before app.py (and therefore core.celery_app.celery_init_app) is ever
# imported/reloaded -- app.config["TESTING"] is only set *after* the app_client fixture
# reloads the module, which is too late for celery_init_app's own eager-mode check.
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"


@pytest.fixture(scope="session", autouse=True)
def test_db_env():
    if "backend" not in sys.path:
        sys.path.insert(0, os.path.dirname(__file__) + "/..")

    from utils.database import init_database
    from core.auth import create_default_users

    init_database()
    create_default_users()
    yield


@pytest.fixture(scope="session")
def app_client(test_db_env):
    app_module = importlib.import_module("app")
    importlib.reload(app_module)

    app_module.app.config.update({"TESTING": True, "RATELIMIT_ENABLED": False})
    
    from core.limiter import limiter
    limiter.enabled = False

    with app_module.app.test_client() as client:
        yield client


@pytest.fixture()
def auth_client(app_client):
    response = app_client.post(
        "/api/auth/login",
        json={"username": "employee", "password": "employee123"},
    )
    assert response.status_code == 200
    return app_client


@pytest.fixture(autouse=True)
def clean_database():
    from utils.database import get_connection, resolve_hospital_id

    with get_connection() as conn:
        cursor = conn.cursor()
        default_hospital_id = resolve_hospital_id()
        cursor.execute("DELETE FROM symptom_ai_chat_messages")
        cursor.execute("DELETE FROM symptom_ai_documents")
        cursor.execute("DELETE FROM insurance_claims")
        cursor.execute("DELETE FROM patient_consents")
        cursor.execute("DELETE FROM insurance_verifications")
        cursor.execute("DELETE FROM certificates")
        cursor.execute("DELETE FROM doctor_schedules")
        cursor.execute("DELETE FROM appointments")
        cursor.execute("DELETE FROM pharmacy_purchases")
        cursor.execute("DELETE FROM pharmacy_suppliers")
        cursor.execute("DELETE FROM ot_surgeries")
        cursor.execute("DELETE FROM ot_theatres")
        cursor.execute("DELETE FROM doctor_payouts")
        cursor.execute("DELETE FROM vendor_payments")
        cursor.execute("DELETE FROM accounts_ledger")
        cursor.execute("DELETE FROM documents")
        cursor.execute("DELETE FROM encounters")
        cursor.execute("DELETE FROM bed_allocations")
        cursor.execute("DELETE FROM medication_schedules")
        cursor.execute("DELETE FROM observation_notes")
        cursor.execute("DELETE FROM patient_movements")
        cursor.execute("DELETE FROM invoice_payments")
        cursor.execute("DELETE FROM invoices")
        cursor.execute("DELETE FROM pharmacy_sales")
        cursor.execute("DELETE FROM pharmacy_inventory")
        cursor.execute("DELETE FROM diagnostics")
        cursor.execute("DELETE FROM lab_vendors")
        cursor.execute("DELETE FROM attendance")
        cursor.execute("DELETE FROM payroll")
        cursor.execute("DELETE FROM leave_requests")
        cursor.execute("DELETE FROM department_master")
        cursor.execute("DELETE FROM audit_logs")
        cursor.execute("DELETE FROM admissions")
        cursor.execute("DELETE FROM bulk_import_jobs")
        cursor.execute("DELETE FROM patients")
        cursor.execute("DELETE FROM sessions")
        cursor.execute(
            """
            DELETE FROM users
            WHERE NOT (hospital_id = ? AND username IN ('employee', 'staff'))
            """,
            (default_hospital_id,),
        )
        cursor.execute("DELETE FROM hospitals WHERE id <> ?", (default_hospital_id,))
        try:
            cursor.execute("UPDATE users SET access_role='owner' WHERE username='employee'")
            cursor.execute("UPDATE users SET access_role='receptionist' WHERE username='staff'")
            cursor.execute(
                "UPDATE users SET user_type='admin', module_access='[\"dashboard\",\"patients\",\"billing\",\"pharmacy\",\"lab\",\"hrms\",\"ot\",\"accounts\",\"reports\",\"symptom_ai\"]' WHERE username='employee'"
            )
            cursor.execute("UPDATE users SET user_type='normal', module_access='[\"dashboard\",\"patients\",\"symptom_ai\"]' WHERE username='staff'")
        except Exception:
            # Backward compatibility for schemas that predate access_role
            pass
        conn.commit()
    yield


@pytest.fixture()
def patient_payload():
    return {
        "name": "Test",
        "middle_name": "Q",
        "last_name": "Patient",
        "dob": "1990-01-01",
        "age": 34,
        "weight": 70,
        "height": 175,
        "gender": "Male",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Headache",
        "phone": "5550001234",
    }


@pytest.fixture()
def create_patient(auth_client, patient_payload):
    def _create(overrides=None):
        payload = dict(patient_payload)
        if overrides:
            payload.update(overrides)
        response = auth_client.post("/api/patients", json=payload)
        assert response.status_code == 200
        return response.get_json()["patient_id"]

    return _create
