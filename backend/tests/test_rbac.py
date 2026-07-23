import uuid


_MODULE_ACCESS_UNSET = object()


def _login(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["user"]


def _login_with_hospital(client, hospital_code: str, username: str, password: str):
    response = client.post(
        "/api/auth/login",
        headers={"X-Hospital-Code": hospital_code},
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.get_json()["user"]


def _admin_login(client):
    return _login(client, "employee", "employee123")


def _create_user_as_admin(client, user_type="normal", module_access=_MODULE_ACCESS_UNSET, job_role="Staff"):
    _admin_login(client)
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "username": f"{user_type}.{suffix}",
        "password": "secret123",
        "full_name": f"{user_type.title()} User",
        "email": f"{user_type}.{suffix}@example.com",
        "phone": f"555{uuid.uuid4().int % 9000000 + 1000000}",
        "user_type": user_type,
        "job_role": job_role,
        "department": "QA",
        "address": "",
        "emergency_contact": "",
    }
    if module_access is _MODULE_ACCESS_UNSET:
        payload["module_access"] = ["dashboard", "patients", "symptom_ai"]
    elif module_access is not None:
        payload["module_access"] = module_access

    created = client.post("/api/employees", json=payload)
    assert created.status_code == 201
    return payload["username"], payload["password"], created.get_json()["employee_id"]


def _patient_payload(seed):
    return {
        "name": f"Patient{seed}",
        "middle_name": "",
        "last_name": "RBAC",
        "dob": "1990-01-01",
        "age": 35,
        "weight": 70,
        "height": 170,
        "gender": "Male",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Headache",
        "phone": f"555{seed:07d}",
    }


def test_signup_cannot_self_assign_admin(app_client):
    username = f"public.{uuid.uuid4().hex[:8]}"
    response = app_client.post(
        "/api/auth/signup",
        json={
            "username": username,
            "password": "secret123",
            "full_name": "Public User",
            "email": "public@example.com",
            "phone": "5551010101",
            "user_type": "admin",
            "module_access": ["dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "symptom_ai"],
            "job_role": "CEO",
            "department": "General",
            "address": "",
            "emergency_contact": "",
        },
    )
    assert response.status_code == 201
    login = app_client.post(
        "/api/auth/login",
        json={"username": username, "password": "secret123"},
    )
    assert login.status_code == 200
    user = login.get_json()["user"]
    assert user["user_type"] == "normal"
    assert "employees.write" not in user.get("permissions", [])


def test_module_access_controls_patients_and_billing(app_client):
    patients_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=["dashboard", "patients", "symptom_ai"],
        job_role="Reception",
    )
    billing_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=["billing"],
        job_role="Billing",
    )

    _login(app_client, patients_user[0], patients_user[1])
    assert app_client.get("/api/patients").status_code == 200
    assert app_client.post("/api/patients", json=_patient_payload(uuid.uuid4().int % 1000000)).status_code == 200
    assert app_client.get("/api/billing/revenue-summary").status_code == 403

    _login(app_client, billing_user[0], billing_user[1])
    assert app_client.get("/api/billing/revenue-summary").status_code == 200
    assert app_client.get("/api/patients").status_code == 403


def test_normal_user_invalid_or_missing_module_access_is_denied(app_client):
    missing_modules_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=None,
        job_role="No Modules",
    )
    unknown_modules_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=["unknown-module"],
        job_role="Unknown Modules",
    )
    malformed_modules_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access={"bad": "format"},
        job_role="Malformed Modules",
    )

    for username, password, _employee_id in [missing_modules_user, unknown_modules_user, malformed_modules_user]:
        logged_in = _login(app_client, username, password)
        assert logged_in["module_access"] == []
        assert app_client.get("/api/patients").status_code == 403
        assert app_client.get("/api/billing/revenue-summary").status_code == 403


def test_employee_management_is_admin_only(app_client):
    normal_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=["dashboard", "patients"],
        job_role="Ops",
    )
    admin_user = _create_user_as_admin(
        app_client,
        user_type="admin",
        module_access=[],
        job_role="Admin",
    )

    _admin_login(app_client)
    target_user = _create_user_as_admin(app_client, user_type="normal", module_access=["dashboard"], job_role="Front Desk")
    target_employee_id = target_user[2]

    _login(app_client, normal_user[0], normal_user[1])
    assert app_client.get("/api/employees").status_code == 403
    assert app_client.get("/api/employees/stats").status_code == 403
    assert app_client.post(f"/api/employees/{target_employee_id}/deactivate").status_code == 403

    _login(app_client, admin_user[0], admin_user[1])
    assert app_client.get("/api/employees").status_code == 200
    assert app_client.get("/api/employees/stats").status_code == 200
    assert app_client.post(f"/api/employees/{target_employee_id}/deactivate").status_code == 200


def test_admin_has_full_module_access(app_client):
    admin_user = _create_user_as_admin(app_client, user_type="admin", module_access=[], job_role="Super Admin")
    _login(app_client, admin_user[0], admin_user[1])

    assert app_client.get("/api/patients").status_code == 200
    assert app_client.get("/api/billing/revenue-summary").status_code == 200
    assert app_client.get("/api/pharmacy/summary").status_code == 200
    assert app_client.get("/api/lab/summary").status_code == 200
    assert app_client.get("/api/hr/departments").status_code == 200
    assert app_client.get("/api/audit/logs").status_code == 200


def test_registration_departments_require_patient_permissions(app_client):
    admin_user = _create_user_as_admin(app_client, user_type="admin", module_access=[], job_role="Super Admin")
    billing_user = _create_user_as_admin(
        app_client,
        user_type="normal",
        module_access=["billing"],
        job_role="Billing",
    )

    _login(app_client, billing_user[0], billing_user[1])
    assert app_client.get("/api/registration/departments").status_code == 403
    assert app_client.post("/api/registration/departments", json={"department_name": "Cardiology"}).status_code == 403

    _login(app_client, admin_user[0], admin_user[1])
    create_response = app_client.post("/api/registration/departments", json={"department_name": "Cardiology"})
    assert create_response.status_code == 200
    first_payload = create_response.get_json()
    assert first_payload["department_id"] >= 1

    duplicate_response = app_client.post("/api/registration/departments", json={"department_name": "  cardiology  "})
    assert duplicate_response.status_code == 200
    duplicate_payload = duplicate_response.get_json()
    assert duplicate_payload["department_id"] == first_payload["department_id"]
    assert duplicate_payload["already_exists"] is True

    listed_departments = app_client.get("/api/registration/departments").get_json()["departments"]
    matching_departments = [row for row in listed_departments if (row.get("department_name") or "").lower() == "cardiology"]
    assert len(matching_departments) == 1


def test_registration_departments_are_hospital_scoped_via_api(app_client):
    from utils.auth import hash_password
    from utils.database import add_employee, create_hospital

    hospital_one_code = "hosp-rbac-dept-1"
    hospital_two_code = "hosp-rbac-dept-2"
    hospital_one_id, _ = create_hospital(hospital_one_code, "RBAC Dept One")
    hospital_two_id, _ = create_hospital(hospital_two_code, "RBAC Dept Two")

    add_employee(
        {
            "username": "dept.one",
            "password_hash": hash_password("secret123"),
            "role": "employee",
            "access_role": "owner",
            "user_type": "admin",
            "module_access": ["dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "ot", "accounts", "reports", "symptom_ai"],
            "job_role": "Hospital Admin",
            "full_name": "Dept One Admin",
            "email": "dept.one@example.com",
            "phone": "5551111111",
            "department": "Administration",
            "employee_id": "EMP-DEPT-1",
            "status": "active",
            "address": "",
            "emergency_contact": "",
        },
        hospital_id=hospital_one_id,
    )
    add_employee(
        {
            "username": "dept.two",
            "password_hash": hash_password("secret123"),
            "role": "employee",
            "access_role": "owner",
            "user_type": "admin",
            "module_access": ["dashboard", "patients", "billing", "pharmacy", "lab", "hrms", "ot", "accounts", "reports", "symptom_ai"],
            "job_role": "Hospital Admin",
            "full_name": "Dept Two Admin",
            "email": "dept.two@example.com",
            "phone": "5552222222",
            "department": "Administration",
            "employee_id": "EMP-DEPT-2",
            "status": "active",
            "address": "",
            "emergency_contact": "",
        },
        hospital_id=hospital_two_id,
    )

    _login_with_hospital(app_client, hospital_one_code, "dept.one", "secret123")
    create_one = app_client.post(
        "/api/registration/departments",
        headers={"X-Hospital-Code": hospital_one_code},
        json={"department_name": "Cardiology"},
    )
    assert create_one.status_code == 200
    department_one_id = create_one.get_json()["department_id"]

    _login_with_hospital(app_client, hospital_two_code, "dept.two", "secret123")
    list_two_before = app_client.get("/api/registration/departments", headers={"X-Hospital-Code": hospital_two_code})
    assert list_two_before.status_code == 200
    assert list_two_before.get_json()["departments"] == []

    create_two = app_client.post(
        "/api/registration/departments",
        headers={"X-Hospital-Code": hospital_two_code},
        json={"department_name": "Cardiology"},
    )
    assert create_two.status_code == 200
    assert create_two.get_json()["department_id"] != department_one_id

    cross_delete = app_client.delete(
        f"/api/hr/departments/{department_one_id}",
        headers={"X-Hospital-Code": hospital_two_code},
    )
    assert cross_delete.status_code == 404
