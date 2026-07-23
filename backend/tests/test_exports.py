import io


def test_ocr_missing_file(auth_client):
    response = auth_client.post("/api/ocr", data={})
    assert response.status_code == 400
    assert response.get_json()["error"] == "Missing file"


def test_ocr_success(auth_client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "extract_text_from_image", lambda *_args, **_kwargs: "OCR OK")

    data = {
        "file": (io.BytesIO(b"image-bytes"), "sample.png"),
        "language": "en",
        "doc_type": "test_docs",
    }
    response = auth_client.post("/api/ocr", data=data, content_type="multipart/form-data")
    assert response.status_code == 200
    assert response.get_json()["text"] == "OCR OK"


def test_process_document_ocr_updates_database(auth_client, create_patient, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "extract_text_from_image", lambda *_args, **_kwargs: "Persisted OCR")

    patient_id = create_patient({"name": "OCR", "last_name": "Persist"})
    upload = auth_client.post(
        f"/api/patients/{patient_id}/documents",
        data={
            "doc_type": "test_docs",
            "file": (io.BytesIO(b"scan-bytes"), "scan.png"),
        },
        content_type="multipart/form-data",
    )
    assert upload.status_code == 200
    document_id = upload.get_json()["document_id"]

    process = auth_client.post(
        f"/api/documents/{document_id}/ocr",
        json={"language": "en"},
    )
    assert process.status_code == 200
    payload = process.get_json()
    assert payload["ocr_text"] == "Persisted OCR"
    assert payload["ocr_language"] == "en"

    docs = auth_client.get(f"/api/patients/{patient_id}/documents")
    assert docs.status_code == 200
    stored = docs.get_json()["documents"]
    assert len(stored) == 1
    assert stored[0]["ocr_text"] == "Persisted OCR"
    assert stored[0]["ocr_language"] == "en"


def test_export_pdf(auth_client):
    response = auth_client.post(
        "/api/export/pdf",
        json={
            "patient_name": "Test Patient",
            "doc_type": "test_docs",
            "ocr_text": "Sample text",
        },
    )
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert response.data


def test_export_word(auth_client):
    response = auth_client.post(
        "/api/export/word",
        json={
            "patient_name": "Test Patient",
            "doc_type": "test_docs",
            "ocr_text": "Sample text",
        },
    )
    assert response.status_code == 200
    assert response.mimetype == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert response.data


def test_export_patients_csv(auth_client, create_patient):
    patient_id = create_patient({"name": "Csv", "last_name": "Export"})
    response = auth_client.get("/api/export/patients/csv")
    assert response.status_code == 200
    assert response.mimetype == "text/csv"
    content = response.data.decode("utf-8-sig")
    assert "patient_id,name,middle_name,last_name" in content
    assert patient_id in content
    assert "Csv" in content
