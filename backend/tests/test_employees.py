def test_create_employee_and_get_detail(auth_client):
    signup = auth_client.post(
        "/api/employees",
        json={
            "username": "new.employee",
            "password": "secret123",
            "full_name": "New Employee",
            "email": "new.employee@example.com",
            "phone": "5553334444",
            "job_role": "Nurse",
            "department": "ER",
            "address": "123 Main St",
            "emergency_contact": "5550001111",
        },
    )
    assert signup.status_code == 201
    payload = signup.get_json()
    assert payload["success"] is True
    employee_id = payload["employee_id"]

    detail = auth_client.get(f"/api/employees/{employee_id}")
    assert detail.status_code == 200
    employee = detail.get_json()["employee"]
    assert employee["username"] == "new.employee"
    assert employee["department"] == "ER"


def test_update_employee(auth_client):
    signup = auth_client.post(
        "/api/employees",
        json={
            "username": "updatable.employee",
            "password": "secret123",
            "full_name": "Updatable Employee",
            "email": "updatable@example.com",
            "phone": "5551112222",
            "job_role": "Doctor",
            "department": "ICU",
            "address": "",
            "emergency_contact": "",
        },
    )
    employee_id = signup.get_json()["employee_id"]

    update = auth_client.put(
        f"/api/employees/{employee_id}",
        json={
            "full_name": "Updated Employee",
            "email": "updated@example.com",
            "phone": "5559998888",
            "department": "Oncology",
            "status": "active",
            "address": "Updated address",
            "emergency_contact": "5551212121",
            "job_role": "Consultant",
        },
    )
    assert update.status_code == 200

    detail = auth_client.get(f"/api/employees/{employee_id}")
    employee = detail.get_json()["employee"]
    assert employee["full_name"] == "Updated Employee"
    assert employee["department"] == "Oncology"


def test_employee_search(auth_client):
    signup = auth_client.post(
        "/api/employees",
        json={
            "username": "search.employee",
            "password": "secret123",
            "full_name": "Search Employee",
            "email": "search.employee@example.com",
            "phone": "5557776666",
            "job_role": "Admin",
            "department": "Operations",
            "address": "",
            "emergency_contact": "",
        },
    )
    employee_id = signup.get_json()["employee_id"]

    response = auth_client.get("/api/employees/search?q=Search")
    assert response.status_code == 200
    results = response.get_json()["employees"]
    assert any(emp["employee_id"] == employee_id for emp in results)


def test_employee_stats_and_status(auth_client):
    stats = auth_client.get("/api/employees/stats").get_json()
    assert stats["total"] >= 2
    assert stats["active"] >= 2

    signup = auth_client.post(
        "/api/employees",
        json={
            "username": "inactive.employee",
            "password": "secret123",
            "full_name": "Inactive Employee",
            "email": "inactive.employee@example.com",
            "phone": "5554445555",
            "job_role": "Tech",
            "department": "Lab",
            "address": "",
            "emergency_contact": "",
        },
    )
    employee_id = signup.get_json()["employee_id"]

    deactivate = auth_client.post(f"/api/employees/{employee_id}/deactivate")
    assert deactivate.status_code == 200

    stats_after = auth_client.get("/api/employees/stats").get_json()
    assert stats_after["inactive"] >= 1


def test_employee_delete(auth_client):
    signup = auth_client.post(
        "/api/employees",
        json={
            "username": "delete.employee",
            "password": "secret123",
            "full_name": "Delete Employee",
            "email": "delete.employee@example.com",
            "phone": "5558889999",
            "job_role": "Staff",
            "department": "Support",
            "address": "",
            "emergency_contact": "",
        },
    )
    employee_id = signup.get_json()["employee_id"]

    deleted = auth_client.delete(f"/api/employees/{employee_id}")
    assert deleted.status_code == 200

    detail = auth_client.get(f"/api/employees/{employee_id}")
    assert detail.status_code == 404
