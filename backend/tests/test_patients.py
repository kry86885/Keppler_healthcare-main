import io


def test_health_check(app_client):
    response = app_client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_create_and_fetch_patient(auth_client, patient_payload):
    create = auth_client.post("/api/patients", json=patient_payload)
    assert create.status_code == 200
    patient_id = create.get_json()["patient_id"]

    fetched = auth_client.get(f"/api/patients/{patient_id}")
    assert fetched.status_code == 200
    data = fetched.get_json()["patient"]
    assert data["patient_id"] == patient_id
    assert data["name"] == patient_payload["name"]


def test_list_patients_returns_created(auth_client, create_patient):
    create_patient({"name": "Alice", "last_name": "Smith"})
    create_patient({"name": "Bob", "last_name": "Jones"})

    response = auth_client.get("/api/patients")
    assert response.status_code == 200
    data = response.get_json()["patients"]
    assert len(data) == 2


def test_search_patients_by_name_phone_id(auth_client, create_patient):
    patient_id = create_patient({"name": "Carla", "last_name": "Diaz", "phone": "5551112222"})

    by_name = auth_client.get("/api/patients?q=carla")
    assert any(p["patient_id"] == patient_id for p in by_name.get_json()["patients"])

    by_phone = auth_client.get("/api/patients?q=555111")
    assert any(p["patient_id"] == patient_id for p in by_phone.get_json()["patients"])

    by_id = auth_client.get(f"/api/patients?q={patient_id}")
    assert any(p["patient_id"] == patient_id for p in by_id.get_json()["patients"])


def test_patient_journey_returns_ordered_events(auth_client, create_patient):
    patient_id = create_patient({"name": "Journey", "last_name": "Test"})

    appointment = auth_client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "patient_name": "Journey Test",
            "visit_type": "OP",
            "doctor_name": "Dr. Journey",
            "appointment_date": "2026-03-03T09:30:00",
        },
    )
    assert appointment.status_code == 200

    vendor = auth_client.post("/api/lab/vendors", json={"vendor_name": "Journey Diagnostics"})
    assert vendor.status_code == 200
    diagnostic = auth_client.post(
        "/api/lab/diagnostics",
        json={
            "patient_id": patient_id,
            "vendor_id": vendor.get_json()["vendor_id"],
            "test_name": "CBC",
            "amount": 500,
        },
    )
    assert diagnostic.status_code == 200

    invoice = auth_client.post(
        "/api/billing/invoices",
        json={"patient_id": patient_id, "module": "OP", "total_amount": 500},
    )
    assert invoice.status_code == 200
    invoice_id = invoice.get_json()["invoice_id"]

    payment = auth_client.post(
        f"/api/billing/invoices/{invoice_id}/payments",
        json={"amount": 500, "payment_mode": "upi"},
    )
    assert payment.status_code == 200

    response = auth_client.get(f"/api/patients/{patient_id}/journey")
    assert response.status_code == 200
    data = response.get_json()
    assert data["patient"]["patient_id"] == patient_id

    stages = [event["stage"] for event in data["events"]]
    assert "registration" in stages
    assert "queue" in stages
    assert "lab" in stages
    assert stages.count("billing") == 2  # invoice raised + payment received

    labels = [event["label"] for event in data["events"]]
    assert any("Payment received" in label and "upi" in label for label in labels)
    assert any("Invoice" in label and "raised" in label for label in labels)

    timestamps = [event["timestamp"] for event in data["events"] if event["timestamp"]]
    assert timestamps == sorted(timestamps)

    summary = data["summary"]
    assert summary["consultation_billed"] == 500
    assert summary["consultation_paid"] == 500
    assert summary["lab_billed"] == 500
    assert summary["lab_paid"] == 0
    assert summary["total_billed"] == 1000
    assert summary["total_paid"] == 500
    assert summary["total_due"] == 500


def test_patient_journey_unknown_patient_returns_404(auth_client):
    response = auth_client.get("/api/patients/PAT-NOPE-0000/journey")
    assert response.status_code == 404


def test_update_patient(auth_client, create_patient, patient_payload):
    patient_id = create_patient()
    updated = dict(patient_payload)
    updated.update({"name": "Updated", "age": 45, "phone": "5559990000"})

    response = auth_client.put(f"/api/patients/{patient_id}", json=updated)
    assert response.status_code == 200

    fetched = auth_client.get(f"/api/patients/{patient_id}")
    data = fetched.get_json()["patient"]
    assert data["name"] == "Updated"
    assert data["age"] == 45
    assert data["phone"] == "5559990000"


def test_delete_patient(auth_client, create_patient):
    patient_id = create_patient()
    response = auth_client.delete(f"/api/patients/{patient_id}")
    assert response.status_code == 200

    fetched = auth_client.get(f"/api/patients/{patient_id}")
    assert fetched.status_code == 404


def test_duplicate_patient_returns_409(auth_client, patient_payload):
    create = auth_client.post("/api/patients", json=patient_payload)
    assert create.status_code == 200

    duplicate = auth_client.post("/api/patients", json=patient_payload)
    assert duplicate.status_code == 409
    payload = duplicate.get_json()
    assert payload["error"] == "Possible duplicate"
    assert "duplicate" in payload


def test_admissions_create_and_list(auth_client, create_patient):
    patient_id = create_patient()
    response = auth_client.post(f"/api/patients/{patient_id}/admissions", json={"notes": "Initial stay"})
    assert response.status_code == 200
    admission_id = response.get_json()["admission_id"]
    assert admission_id

    admissions = auth_client.get(f"/api/patients/{patient_id}/admissions").get_json()["admissions"]
    assert len(admissions) == 2
    current_admission = next((adm for adm in admissions if adm["notes"] == "Initial stay"), None)
    assert current_admission is not None
    assert ":" in current_admission["admission_date"]


def test_documents_requires_file(auth_client, create_patient):
    patient_id = create_patient()
    response = auth_client.post(f"/api/patients/{patient_id}/documents", data={})
    assert response.status_code == 400
    assert response.get_json()["error"] == "Missing file"


def test_documents_upload_and_list(auth_client, create_patient):
    patient_id = create_patient()

    data = {
        "doc_type": "test_docs",
        "admission_id": "",
        "ocr_text": "Sample OCR text",
        "ocr_language": "en",
        "file": (io.BytesIO(b"file-contents"), "sample.txt"),
    }

    response = auth_client.post(
        f"/api/patients/{patient_id}/documents",
        data=data,
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    assert response.get_json()["document_id"]

    documents = auth_client.get(f"/api/patients/{patient_id}/documents").get_json()["documents"]
    assert len(documents) == 1
    assert documents[0]["doc_type"] == "test_docs"
    assert documents[0]["ocr_text"] == "Sample OCR text"


def test_stats_endpoint_counts(auth_client, create_patient):
    create_patient({"name": "Stats", "last_name": "Check"})
    stats = auth_client.get("/api/stats").get_json()
    assert stats["total"] == 1
    assert stats["readmitted_patients"] == 0


def test_dashboard_analytics_endpoint(auth_client, create_patient):
    patient_id = create_patient({"name": "Ana", "last_name": "Chart", "gender": "Female"})
    auth_client.post(f"/api/patients/{patient_id}/admissions", json={"notes": "Follow-up"})

    response = auth_client.get("/api/dashboard/analytics?days=14")
    assert response.status_code == 200

    payload = response.get_json()
    assert payload["window_days"] == 14
    assert isinstance(payload["patients_trend"], list)
    assert isinstance(payload["documents_trend"], list)
    assert isinstance(payload["doc_type_distribution"], list)
    assert isinstance(payload["admission_status_distribution"], list)
    assert isinstance(payload["gender_distribution"], list)
    assert "employee" in payload
