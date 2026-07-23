from datetime import datetime, timezone

from utils.auth import SESSION_COOKIE_NAME
from utils.auth import _parse_ts


def _create_employee_as_owner(app_client, username: str, password: str):
    login = app_client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert login.status_code == 200
    create = app_client.post(
        "/api/employees",
        json={
            "username": username,
            "password": password,
            "full_name": "New User",
            "email": f"{username}@example.com",
            "phone": "5551112222",
            "access_role": "receptionist",
            "job_role": "Tester",
            "department": "QA",
            "address": "",
            "emergency_contact": "",
        },
    )
    assert create.status_code == 201
    return create


def test_login_success_default_user(app_client):
    response = app_client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert response.status_code == 200
    payload = response.get_json()["user"]
    assert payload["username"] == "employee"
    assert payload["user_type"] == "admin"
    assert isinstance(payload.get("module_access"), list)
    assert "id" not in payload

    set_cookie = response.headers.get("Set-Cookie", "")
    assert SESSION_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite" in set_cookie


def test_login_invalid_credentials(app_client):
    response = app_client.post("/api/auth/login", json={"username": "employee", "password": "wrong"})
    assert response.status_code == 401
    assert response.get_json()["error"] == "Invalid credentials"


def test_login_inactive_account(app_client):
    created = _create_employee_as_owner(app_client, "inactive.user", "secret123")
    employee_id = created.get_json()["employee_id"]

    login = app_client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert login.status_code == 200

    deactivate = app_client.post(f"/api/employees/{employee_id}/deactivate")
    assert deactivate.status_code == 200

    response = app_client.post("/api/auth/login", json={"username": "inactive.user", "password": "secret123"})
    assert response.status_code == 403
    assert "inactive" in response.get_json()["error"].lower()


def test_check_username(app_client):
    response = app_client.get("/api/auth/check-username?username=employee")
    assert response.status_code == 200
    assert response.get_json()["available"] is False

    response = app_client.get("/api/auth/check-username?username=new_user_123")
    assert response.status_code == 200
    assert response.get_json()["available"] is True


def test_signup_success_and_login(app_client):
    created = _create_employee_as_owner(app_client, "new.user", "secret123")
    payload = created.get_json()
    assert payload["success"] is True
    assert payload["employee_id"]

    login = app_client.post("/api/auth/login", json={"username": "new.user", "password": "secret123"})
    assert login.status_code == 200
    assert login.get_json()["user"]["username"] == "new.user"


def test_signup_endpoint_removed(app_client):
    response = app_client.post(
        "/api/auth/signup",
        json={"username": "blocked.user", "password": "secret123"},
    )
    assert response.status_code == 404


def test_session_and_logout(app_client):
    login = app_client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert login.status_code == 200

    session = app_client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.get_json()["user"]["username"] == "employee"

    logout = app_client.post("/api/auth/logout")
    assert logout.status_code == 200

    session_after = app_client.get("/api/auth/session")
    assert session_after.status_code == 401


def test_parse_ts_accepts_datetime_value():
    value = datetime.now(timezone.utc)
    parsed = _parse_ts(value)
    assert parsed == value
