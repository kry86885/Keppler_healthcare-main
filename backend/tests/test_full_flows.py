import io
import uuid


def _login(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["user"]


def _owner_login(client):
    return _login(client, "employee", "employee123")


def _create_patient_payload(seed):
    return {
        "name": f"Flow{seed}",
        "middle_name": "M",
        "last_name": "Patient",
        "dob": "1991-06-01",
        "age": 34,
        "weight": 72,
        "height": 171,
        "gender": "Female",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Fatigue",
        "phone": f"555{seed:07d}",
    }


def test_patient_admission_readmit_documents_and_exports_flow(app_client):
    _owner_login(app_client)

    create_patient = app_client.post("/api/patients", json=_create_patient_payload(1000001))
    assert create_patient.status_code == 200
    patient_id = create_patient.get_json()["patient_id"]

    initial_admissions = app_client.get(f"/api/patients/{patient_id}/admissions")
    assert initial_admissions.status_code == 200
    initial_list = initial_admissions.get_json()["admissions"]
    assert len(initial_list) == 1
    assert initial_list[0]["notes"] == "Initial registration"

    patient_before = app_client.get(f"/api/patients/{patient_id}").get_json()["patient"]
    updated_payload = dict(patient_before)
    updated_payload.update(
        {
            "weight": 79,
            "height": 174,
            "symptoms": "Headache, dry cough",
            "allergies": "Penicillin",
            "phone": "5551230000",
            "pregnant": False,
        }
    )
    update_response = app_client.put(f"/api/patients/{patient_id}", json=updated_payload)
    assert update_response.status_code == 200

    readmit = app_client.post(f"/api/patients/{patient_id}/admissions", json={"notes": "Readmitted for observation"})
    assert readmit.status_code == 200
    admission_id = readmit.get_json()["admission_id"]
    assert admission_id

    document_upload = app_client.post(
        f"/api/patients/{patient_id}/documents",
        data={
            "doc_type": "prescriptions",
            "admission_id": str(admission_id),
            "ocr_text": "Take medicine twice daily.",
            "ocr_language": "en",
            "file": (io.BytesIO(b"rx-data"), "rx.txt"),
        },
        content_type="multipart/form-data",
    )
    assert document_upload.status_code == 200
    assert document_upload.get_json()["document_id"]

    admissions_after = app_client.get(f"/api/patients/{patient_id}/admissions").get_json()["admissions"]
    assert len(admissions_after) == 2
    assert any(item["id"] == admission_id and item["notes"] == "Readmitted for observation" for item in admissions_after)

    patient_after = app_client.get(f"/api/patients/{patient_id}").get_json()["patient"]
    assert patient_after["weight"] == 79
    assert patient_after["height"] == 174
    assert patient_after["symptoms"] == "Headache, dry cough"
    assert patient_after["allergies"] == "Penicillin"
    assert patient_after["phone"] == "5551230000"

    documents = app_client.get(f"/api/patients/{patient_id}/documents").get_json()["documents"]
    assert len(documents) == 1
    assert documents[0]["admission_id"] == admission_id
    assert documents[0]["doc_type"] == "prescriptions"
    assert documents[0]["ocr_text"] == "Take medicine twice daily."

    pdf_export = app_client.post(
        "/api/export/pdf",
        json={
            "patient_name": f"{patient_after['name']} {patient_after['last_name']}",
            "doc_type": documents[0]["doc_type"],
            "ocr_text": documents[0]["ocr_text"],
            "date": documents[0]["created_at"],
        },
    )
    assert pdf_export.status_code == 200
    assert pdf_export.mimetype == "application/pdf"
    assert pdf_export.data

    word_export = app_client.post(
        "/api/export/word",
        json={
            "patient_name": f"{patient_after['name']} {patient_after['last_name']}",
            "doc_type": documents[0]["doc_type"],
            "ocr_text": documents[0]["ocr_text"],
            "date": documents[0]["created_at"],
        },
    )
    assert word_export.status_code == 200
    assert word_export.mimetype == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert word_export.data

    csv_export = app_client.get(f"/api/export/patients/csv?q={patient_id}")
    assert csv_export.status_code == 200
    assert csv_export.mimetype == "text/csv"
    csv_content = csv_export.data.decode("utf-8-sig")
    assert patient_id in csv_content

    stats = app_client.get("/api/stats").get_json()
    assert stats["total"] == 1
    assert stats["active_admissions"] == 2
    assert stats["documents"] == 1
    assert stats["readmitted_patients"] == 1


def test_employee_onboarding_lifecycle_flow(app_client):
    _owner_login(app_client)

    suffix = uuid.uuid4().hex[:8]
    username = f"flow.employee.{suffix}"
    password = "secret123"
    employee_payload = {
        "username": username,
        "password": password,
        "full_name": "Flow Employee",
        "email": f"{username}@example.com",
        "phone": "5554567890",
        "user_type": "normal",
        "module_access": ["dashboard", "patients", "lab", "pharmacy", "symptom_ai"],
        "job_role": "Nurse",
        "department": "ER",
        "address": "Flow Street",
        "emergency_contact": "5550001111",
    }

    created = app_client.post("/api/employees", json=employee_payload)
    assert created.status_code == 201
    payload = created.get_json()
    employee_id = payload["employee_id"]
    assert payload["success"] is True

    session_user = _login(app_client, username, password)
    assert session_user["username"] == username
    assert session_user["user_type"] == "normal"
    assert "symptom_ai.use" in (session_user.get("permissions") or [])

    _owner_login(app_client)
    details = app_client.get(f"/api/employees/{employee_id}")
    assert details.status_code == 200
    employee = details.get_json()["employee"]
    assert employee["department"] == "ER"

    updated = app_client.put(
        f"/api/employees/{employee_id}",
        json={
            "full_name": "Flow Employee Updated",
            "email": f"updated.{username}@example.com",
            "phone": "5557778888",
            "department": "ICU",
            "status": "active",
            "address": "Updated address",
            "emergency_contact": "5553332222",
            "job_role": "Senior Nurse",
        },
    )
    assert updated.status_code == 200

    search = app_client.get("/api/employees/search?q=Flow Employee Updated")
    assert search.status_code == 200
    assert any(row["employee_id"] == employee_id for row in search.get_json()["employees"])

    deactivate = app_client.post(f"/api/employees/{employee_id}/deactivate")
    assert deactivate.status_code == 200
    blocked_login = app_client.post("/api/auth/login", json={"username": username, "password": password})
    assert blocked_login.status_code == 403

    activate = app_client.post(f"/api/employees/{employee_id}/activate")
    assert activate.status_code == 200
    relogin = app_client.post("/api/auth/login", json={"username": username, "password": password})
    assert relogin.status_code == 200

    _owner_login(app_client)
    deleted = app_client.delete(f"/api/employees/{employee_id}")
    assert deleted.status_code == 200
    missing = app_client.get(f"/api/employees/{employee_id}")
    assert missing.status_code == 404


def test_clinician_can_run_ocr_and_patient_document_flow(app_client, tmp_path, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "extract_text_from_image", lambda *_args, **_kwargs: "Simulated OCR")

    _owner_login(app_client)
    suffix = uuid.uuid4().hex[:8]
    created = app_client.post(
        "/api/employees",
        json={
            "username": f"clinician.{suffix}",
            "password": "secret123",
            "full_name": "Clinician Flow",
            "email": f"clinician.{suffix}@example.com",
            "phone": "5559090000",
            "user_type": "normal",
            "module_access": ["dashboard", "patients", "lab", "pharmacy", "symptom_ai"],
            "job_role": "Doctor",
            "department": "Cardiology",
            "address": "",
            "emergency_contact": "",
        },
    )
    assert created.status_code == 201
    clinician_username = created.get_json()["username"]

    login = app_client.post("/api/auth/login", json={"username": clinician_username, "password": "secret123"})
    assert login.status_code == 200

    created_patient = app_client.post("/api/patients", json=_create_patient_payload(1000002))
    assert created_patient.status_code == 200
    patient_id = created_patient.get_json()["patient_id"]

    ocr_response = app_client.post(
        "/api/ocr",
        data={
            "file": (io.BytesIO(b"scan-bytes"), "scan.png"),
            "language": "en",
            "doc_type": "test_docs",
        },
        content_type="multipart/form-data",
    )
    assert ocr_response.status_code == 200
    assert ocr_response.get_json()["text"] == "Simulated OCR"

    admissions = app_client.get(f"/api/patients/{patient_id}/admissions").get_json()["admissions"]
    assert len(admissions) == 1
    admission_id = admissions[0]["id"]

    upload = app_client.post(
        f"/api/patients/{patient_id}/documents",
        data={
            "doc_type": "test_docs",
            "admission_id": str(admission_id),
            "ocr_text": "Simulated OCR",
            "ocr_language": "en",
            "file": (io.BytesIO(b"ocr-file"), "ocr.txt"),
        },
        content_type="multipart/form-data",
    )
    assert upload.status_code == 200

    docs = app_client.get(f"/api/patients/{patient_id}/documents").get_json()["documents"]
    assert len(docs) == 1
    assert docs[0]["ocr_text"] == "Simulated OCR"

    export_pdf = app_client.post(
        "/api/export/pdf",
        json={
            "patient_name": "Clinician Flow",
            "doc_type": "test_docs",
            "ocr_text": "Simulated OCR",
        },
    )
    assert export_pdf.status_code == 200
