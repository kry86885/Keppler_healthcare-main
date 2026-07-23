import uuid


def _headers(hospital_code: str, platform_admin: dict | None = None):
    headers = {"X-Hospital-Code": hospital_code}
    if platform_admin:
        headers["X-Platform-Admin-Username"] = platform_admin["username"]
        headers["X-Platform-Admin-Password"] = platform_admin["password"]
    return headers


def _setup_admin(client, hospital_code: str, username: str, password: str, platform_admin: dict):
    return client.post(
        "/api/auth/setup-admin",
        headers=_headers(hospital_code, platform_admin),
        json={
            "username": username,
            "password": password,
            "full_name": f"Admin {hospital_code}",
            "email": f"{username}@example.com",
            "phone": "5551231234",
        },
    )


def _login(client, hospital_code: str, username: str, password: str):
    response = client.post(
        "/api/auth/login",
        headers=_headers(hospital_code),
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response


def _employee_payload(prefix: str, access_role: str):
    suffix = uuid.uuid4().hex[:6]
    return {
        "username": f"{prefix}.{suffix}",
        "password": "secret123",
        "full_name": f"{access_role} User",
        "email": f"{prefix}.{suffix}@example.com",
        "phone": f"555{uuid.uuid4().int % 9000000 + 1000000}",
        "access_role": access_role,
        "job_role": "Staff",
        "department": "Ops",
        "address": "",
        "emergency_contact": "",
    }


def _patient_payload(seed: int):
    return {
        "name": f"Patient{seed}",
        "middle_name": "",
        "last_name": "Tenant",
        "dob": "1992-01-01",
        "age": 33,
        "weight": 70,
        "height": 170,
        "gender": "Female",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Cough",
        "phone": f"555{seed:07d}",
    }


def test_hospital_onboarding_requires_platform_admin_credentials(app_client, monkeypatch):
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", "platform-admin")
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", "platform-secret")

    response = app_client.post(
        "/api/auth/setup-admin",
        headers=_headers("hosp-acme"),
        json={"username": "acme.admin", "password": "secret123"},
    )
    assert response.status_code == 403


def test_hospital_onboarding_requires_env_configuration(app_client, monkeypatch):
    monkeypatch.delenv("ONBOARDING_ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ONBOARDING_ADMIN_PASSWORD", raising=False)

    response = app_client.post(
        "/api/auth/setup-admin",
        headers=_headers("hosp-acme"),
        json={"username": "acme.admin", "password": "secret123"},
    )
    assert response.status_code == 503

    response = app_client.post(
        "/api/auth/setup-admin",
        headers={
            "X-Hospital-Code": "hosp-acme",
            "X-Platform-Admin-Username": "platform-admin",
            "X-Platform-Admin-Password": "wrong",
        },
        json={"username": "acme.admin", "password": "secret123"},
    )
    assert response.status_code == 403


def test_hospital_onboarding_creates_single_admin_per_hospital(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    create = _setup_admin(app_client, "hosp-alpha", "alpha.admin", "secret123", platform_admin)
    assert create.status_code == 201
    payload = create.get_json()
    assert payload["success"] is True
    assert payload["user"]["access_role"] == "owner"
    assert payload["user"]["hospital_code"] == "hosp-alpha"

    second = _setup_admin(app_client, "hosp-alpha", "alpha.second", "secret123", platform_admin)
    assert second.status_code == 409

    other = _setup_admin(app_client, "hosp-beta", "beta.admin", "secret123", platform_admin)
    assert other.status_code == 201
    assert other.get_json()["user"]["hospital_code"] == "hosp-beta"


def test_employee_account_creation_is_admin_only_per_hospital(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    assert _setup_admin(app_client, "hosp-a", "a.admin", "secret123", platform_admin).status_code == 201
    assert _setup_admin(app_client, "hosp-b", "b.admin", "secret123", platform_admin).status_code == 201

    _login(app_client, "hosp-a", "a.admin", "secret123")
    receptionist_payload = _employee_payload("a.reception", "receptionist")
    created_receptionist = app_client.post("/api/employees", headers=_headers("hosp-a"), json=receptionist_payload)
    assert created_receptionist.status_code == 201

    hr_payload = _employee_payload("a.hr", "hr_manager")
    created_hr = app_client.post("/api/employees", headers=_headers("hosp-a"), json=hr_payload)
    assert created_hr.status_code == 201
    hr_username = created_hr.get_json()["username"]

    _login(app_client, "hosp-a", hr_username, "secret123")
    denied_create = app_client.post("/api/employees", headers=_headers("hosp-a"), json=_employee_payload("a.denied", "receptionist"))
    assert denied_create.status_code == 403
    assert denied_create.get_json()["required_permissions"] == ["admin.use"]

    _login(app_client, "hosp-b", "b.admin", "secret123")
    b_create = app_client.post("/api/employees", headers=_headers("hosp-b"), json=_employee_payload("b.reception", "receptionist"))
    assert b_create.status_code == 201

    b_list = app_client.get("/api/employees", headers=_headers("hosp-b"))
    assert b_list.status_code == 200
    b_usernames = {item["username"] for item in b_list.get_json()["employees"]}
    assert receptionist_payload["username"] not in b_usernames
    assert "b.admin" in b_usernames


def test_hospital_admin_cannot_access_other_hospital_patient_data(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    assert _setup_admin(app_client, "hosp-1", "one.admin", "secret123", platform_admin).status_code == 201
    assert _setup_admin(app_client, "hosp-2", "two.admin", "secret123", platform_admin).status_code == 201

    _login(app_client, "hosp-1", "one.admin", "secret123")
    created = app_client.post("/api/patients", headers=_headers("hosp-1"), json=_patient_payload(3000001))
    assert created.status_code == 200
    patient_id = created.get_json()["patient_id"]

    _login(app_client, "hosp-2", "two.admin", "secret123")
    patients_h2 = app_client.get("/api/patients", headers=_headers("hosp-2"))
    assert patients_h2.status_code == 200
    assert patients_h2.get_json()["patients"] == []

    fetch_other_hospital = app_client.get(f"/api/patients/{patient_id}", headers=_headers("hosp-2"))
    assert fetch_other_hospital.status_code == 404


def test_platform_admin_can_create_list_and_disable_hospital(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    create_hospital = app_client.post(
        "/api/platform/hospitals",
        headers=_headers("hosp-default", platform_admin),
        json={"hospital_code": "hosp-zeta", "name": "Zeta Hospital"},
    )
    assert create_hospital.status_code == 201
    assert create_hospital.get_json()["hospital"]["code"] == "hosp-zeta"

    listed = app_client.get("/api/platform/hospitals", headers=_headers("hosp-default", platform_admin))
    assert listed.status_code == 200
    codes = {row["code"] for row in listed.get_json()["hospitals"]}
    assert "hosp-zeta" in codes

    disabled = app_client.post(
        "/api/platform/hospitals/hosp-zeta/disable",
        headers=_headers("hosp-default", platform_admin),
        json={"reason": "Billing issue"},
    )
    assert disabled.status_code == 200
    assert disabled.get_json()["hospital"]["status"] == "inactive"


def test_disabled_hospital_blocks_auth_until_reenabled(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    assert _setup_admin(app_client, "hosp-lock", "lock.admin", "secret123", platform_admin).status_code == 201
    assert _login(app_client, "hosp-lock", "lock.admin", "secret123").status_code == 200

    disabled = app_client.post(
        "/api/platform/hospitals/hosp-lock/disable",
        headers=_headers("hosp-default", platform_admin),
        json={"reason": "Non-payment"},
    )
    assert disabled.status_code == 200

    blocked_login = app_client.post(
        "/api/auth/login",
        headers=_headers("hosp-lock"),
        json={"username": "lock.admin", "password": "secret123"},
    )
    assert blocked_login.status_code == 403
    assert "disabled" in blocked_login.get_json()["error"].lower()

    reenabled = app_client.post(
        "/api/platform/hospitals/hosp-lock/enable",
        headers=_headers("hosp-default", platform_admin),
        json={},
    )
    assert reenabled.status_code == 200

    restored_login = app_client.post(
        "/api/auth/login",
        headers=_headers("hosp-lock"),
        json={"username": "lock.admin", "password": "secret123"},
    )
    assert restored_login.status_code == 200


def test_platform_admin_can_reset_hospital_admin_password(app_client, monkeypatch):
    platform_admin = {"username": "platform-admin", "password": "platform-secret"}
    monkeypatch.setenv("ONBOARDING_ADMIN_USERNAME", platform_admin["username"])
    monkeypatch.setenv("ONBOARDING_ADMIN_PASSWORD", platform_admin["password"])

    assert _setup_admin(app_client, "hosp-reset", "reset.admin", "secret123", platform_admin).status_code == 201

    reset = app_client.post(
        "/api/platform/hospitals/hosp-reset/admin/reset-password",
        headers=_headers("hosp-default", platform_admin),
        json={"username": "reset.admin", "new_password": "newsecret123"},
    )
    assert reset.status_code == 200
    assert reset.get_json()["success"] is True

    old_login = app_client.post(
        "/api/auth/login",
        headers=_headers("hosp-reset"),
        json={"username": "reset.admin", "password": "secret123"},
    )
    assert old_login.status_code == 401

    new_login = app_client.post(
        "/api/auth/login",
        headers=_headers("hosp-reset"),
        json={"username": "reset.admin", "password": "newsecret123"},
    )
    assert new_login.status_code == 200
