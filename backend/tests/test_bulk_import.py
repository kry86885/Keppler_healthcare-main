import io
import json
import pytest

import app  # noqa: F401  -- must be imported before modules.bulk_import.routes directly,
# since app.py registers that blueprint at the bottom of its own module and importing
# the submodule first here would otherwise hit a circular import.
from modules.bulk_import.routes import _build_filter_clause


@pytest.fixture(autouse=True)
def mock_llm_provider(monkeypatch):
    import ai.service
    monkeypatch.setattr(ai.service.llm_provider, "is_configured", lambda: True)

    def mock_generate(prompt, context=""):
        return json.dumps({
            "answer": "Found Ravi Kumar and Asha Rao.",
            "entries": [
                {"name": "Ravi Kumar", "phone": "9876500000", "medical_condition": "hypertension"},
                {"name": "Asha Rao", "phone": "9876543210", "medical_condition": "diabetes"}
            ]
        })
    monkeypatch.setattr(ai.service.llm_provider, "generate", mock_generate)
from utils.database import (
    resolve_hospital_id,
    add_patient,
    generate_patient_id,
    upsert_bulk_import_patients_batch,
    query_bulk_patients,
)


# ---- Prompt-filter allow-list validator -----------------------------------

def test_build_filter_clause_only_uses_allowed_fields_and_ops():
    where_clause, params = _build_filter_clause(
        [{"field": "area", "op": "eq", "value": "Koramangala"}], "AND"
    )
    assert "area = ?" in where_clause
    assert params == ["Koramangala"]


def test_build_filter_clause_drops_unknown_field():
    where_clause, params = _build_filter_clause(
        [{"field": "ssn", "op": "eq", "value": "123-45-6789"}], "AND"
    )
    assert where_clause == ""
    assert params == []


def test_build_filter_clause_drops_unknown_op():
    where_clause, params = _build_filter_clause(
        [{"field": "area", "op": "DROP TABLE patients;--", "value": "x"}], "AND"
    )
    assert where_clause == ""
    assert params == []


def test_build_filter_clause_excludes_phone_as_a_search_facet():
    # phone is the contact key, not something prompts should be able to filter on.
    where_clause, params = _build_filter_clause(
        [{"field": "phone", "op": "eq", "value": "5551234567"}], "AND"
    )
    assert where_clause == ""
    assert params == []


def test_build_filter_clause_expands_in_operator_to_one_placeholder_per_value():
    where_clause, params = _build_filter_clause(
        [{"field": "area", "op": "in", "value": ["Koramangala", "Indiranagar"]}], "AND"
    )
    assert where_clause.count("?") == 2
    assert params == ["Koramangala", "Indiranagar"]


def test_build_filter_clause_combines_conditions_with_requested_logic():
    where_clause, _params = _build_filter_clause(
        [
            {"field": "area", "op": "eq", "value": "Koramangala"},
            {"field": "medical_condition", "op": "contains", "value": "diabetes"},
        ],
        "OR",
    )
    assert " OR " in where_clause


# ---- Upsert behavior --------------------------------------------------------

def test_bulk_import_upsert_does_not_collide_with_registration_patient_sharing_phone(app_client):
    hospital_id = resolve_hospital_id()
    shared_phone = "5559998888"

    # A normal registration-flow patient with this phone already exists --
    # bulk import must not violate a unique constraint against it.
    add_patient(
        {
            "patient_id": generate_patient_id(hospital_id),
            "name": "Family",
            "last_name": "Member",
            "phone": shared_phone,
        },
        hospital_id=hospital_id,
    )

    upsert_bulk_import_patients_batch(
        hospital_id,
        [
            (
                "BULK-TEST-1",
                shared_phone,
                {"name": "Imported", "last_name": "Row", "age": 40, "gender": "Female", "area": "Koramangala", "medical_condition": "diabetes"},
            )
        ],
    )

    rows, total = query_bulk_patients(hospital_id, "", [])
    assert total == 1
    assert rows[0]["area"] == "Koramangala"


def test_bulk_import_upsert_updates_on_repeat_upload_instead_of_duplicating(app_client):
    hospital_id = resolve_hospital_id()
    phone = "5557778899"

    upsert_bulk_import_patients_batch(
        hospital_id,
        [("BULK-TEST-2", phone, {"name": "First", "last_name": "Pass", "age": 30, "gender": "Male", "area": "Old Area", "medical_condition": "asthma"})],
    )
    upsert_bulk_import_patients_batch(
        hospital_id,
        [("BULK-TEST-3", phone, {"name": "Second", "last_name": "Pass", "age": 31, "gender": "Male", "area": "New Area", "medical_condition": "asthma, hypertension"})],
    )

    rows, total = query_bulk_patients(hospital_id, "", [])
    assert total == 1
    assert rows[0]["area"] == "New Area"
    assert rows[0]["medical_condition"] == "asthma, hypertension"


# ---- Job lifecycle via the HTTP API (Celery runs eagerly under CELERY_TASK_ALWAYS_EAGER) ----

def test_bulk_import_upload_to_query_end_to_end_flow(auth_client):
    csv_bytes = (
        b"Patient Name,Mobile Number,City,Diagnosis\n"
        b"Asha Rao,9876543210,Koramangala,Diabetes\n"
        b"Ravi Kumar,9876500000,Indiranagar,Hypertension\n"
    )

    upload_response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(csv_bytes), "patients.csv")},
        content_type="multipart/form-data",
    )
    assert upload_response.status_code == 200
    job_id = upload_response.get_json()["job_id"]

    status_response = auth_client.get(f"/api/bulk-import/jobs/{job_id}")
    assert status_response.status_code == 200
    job = status_response.get_json()
    assert job["status"] == "AWAITING_MAPPING"
    assert "Mobile Number" in job["detected_columns"]

    mapping = {
        "Patient Name": "name",
        "Mobile Number": "phone",
        "City": "area",
        "Diagnosis": "medical_condition",
    }
    mapping_response = auth_client.post(
        f"/api/bulk-import/jobs/{job_id}/mapping", json={"mapping": mapping}
    )
    assert mapping_response.status_code == 200

    final_status = auth_client.get(f"/api/bulk-import/jobs/{job_id}").get_json()
    assert final_status["status"] == "DONE"
    assert final_status["imported_count"] == 2
    assert final_status["skipped_count"] == 0

    query_response = auth_client.post("/api/bulk-import/query", json={"prompt": ""})
    assert query_response.status_code == 200
    results = query_response.get_json()["results"]
    assert len(results) == 2
    assert {row["area"] for row in results} == {"Koramangala", "Indiranagar"}


def test_bulk_import_mapping_requires_a_phone_column(auth_client):
    csv_bytes = b"Patient Name,City\nAsha Rao,Koramangala\n"
    upload_response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(csv_bytes), "patients.csv")},
        content_type="multipart/form-data",
    )
    job_id = upload_response.get_json()["job_id"]

    mapping_response = auth_client.post(
        f"/api/bulk-import/jobs/{job_id}/mapping",
        json={"mapping": {"Patient Name": "name", "City": "area"}},
    )
    assert mapping_response.status_code == 400


def test_bulk_import_upload_rejects_unsupported_extension(auth_client):
    response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(b"not a real workbook"), "patients.xls")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400


def _build_docx_bytes(paragraphs):
    from docx import Document

    document = Document()
    for text in paragraphs:
        document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_bulk_import_docx_upload_skips_mapping_and_goes_to_awaiting_prompt(auth_client):
    docx_bytes = _build_docx_bytes(
        [
            "Discharge Summary",
            "Patient: Ravi Kumar, phone 9876500000, area Indiranagar, diagnosed with hypertension.",
            "Patient: Asha Rao, phone 9876543210, area Koramangala, diagnosed with diabetes.",
        ]
    )
    upload_response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(docx_bytes), "discharge_summary.docx")},
        content_type="multipart/form-data",
    )
    assert upload_response.status_code == 200
    job_id = upload_response.get_json()["job_id"]

    status_response = auth_client.get(f"/api/bulk-import/jobs/{job_id}")
    job = status_response.get_json()
    assert job["kind"] == "document"
    assert job["status"] == "AWAITING_PROMPT"
    assert "extracted_text" not in job

    ask_response = auth_client.post(
        f"/api/bulk-import/jobs/{job_id}/ask",
        json={"prompt": "List every patient mentioned with their phone number and condition."},
    )
    assert ask_response.status_code == 200
    payload = ask_response.get_json()
    assert "results" in payload
    assert "answer" in payload
    assert isinstance(payload["results"], list)


def test_bulk_import_ask_requires_awaiting_prompt_status(auth_client):
    csv_bytes = b"Patient Name,Mobile Number\nAsha Rao,9876543210\n"
    upload_response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(csv_bytes), "patients.csv")},
        content_type="multipart/form-data",
    )
    job_id = upload_response.get_json()["job_id"]

    ask_response = auth_client.post(
        f"/api/bulk-import/jobs/{job_id}/ask",
        json={"prompt": "List everyone."},
    )
    assert ask_response.status_code == 409


def test_bulk_import_ask_requires_prompt(auth_client):
    docx_bytes = _build_docx_bytes(["Patient: Test Person, phone 9999999999."])
    upload_response = auth_client.post(
        "/api/bulk-import/upload",
        data={"file": (io.BytesIO(docx_bytes), "note.docx")},
        content_type="multipart/form-data",
    )
    job_id = upload_response.get_json()["job_id"]

    ask_response = auth_client.post(f"/api/bulk-import/jobs/{job_id}/ask", json={"prompt": ""})
    assert ask_response.status_code == 400
