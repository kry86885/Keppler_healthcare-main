def _owner_login(client):
    response = client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert response.status_code == 200


def test_department_contract_validation_and_audit_trail(app_client):
    _owner_login(app_client)

    blank = app_client.post("/api/registration/departments", json={"department_name": "   "})
    assert blank.status_code == 400

    too_long = app_client.post("/api/registration/departments", json={"department_name": "A" * 121})
    assert too_long.status_code == 400

    first = app_client.post("/api/registration/departments", json={"department_name": "Cardiology"})
    assert first.status_code == 200
    first_payload = first.get_json()
    first_id = first_payload["department_id"]

    duplicate_registration = app_client.post("/api/registration/departments", json={"department_name": "  cardiology  "})
    assert duplicate_registration.status_code == 200
    duplicate_registration_payload = duplicate_registration.get_json()
    assert duplicate_registration_payload["already_exists"] is True
    assert duplicate_registration_payload["department_id"] == first_id

    second = app_client.post("/api/hr/departments", json={"department_name": "Neurology"})
    assert second.status_code == 200
    second_id = second.get_json()["department_id"]

    duplicate_hr = app_client.post("/api/hr/departments", json={"department_name": "neurology"})
    assert duplicate_hr.status_code == 200
    assert duplicate_hr.get_json()["already_exists"] is True

    update_duplicate = app_client.put(
        f"/api/hr/departments/{second_id}",
        json={"department_name": "CARDIOLOGY"},
    )
    assert update_duplicate.status_code == 409

    update_too_long = app_client.put(
        f"/api/hr/departments/{second_id}",
        json={"department_name": "B" * 121},
    )
    assert update_too_long.status_code == 400

    update_ok = app_client.put(
        f"/api/hr/departments/{second_id}",
        json={"department_name": "Neuro Care"},
    )
    assert update_ok.status_code == 200

    delete_ok = app_client.delete(f"/api/hr/departments/{second_id}")
    assert delete_ok.status_code == 200

    logs_response = app_client.get("/api/audit/logs?module=departments&limit=100")
    assert logs_response.status_code == 200
    logs = logs_response.get_json()["logs"]
    actions = [row.get("action") for row in logs]

    assert "create" in actions
    assert "update" in actions
    assert "delete" in actions
