from datetime import datetime

from utils.auth import hash_password
from utils.database import (
    add_admission,
    add_document,
    add_employee,
    add_patient,
    create_department,
    create_hospital,
    generate_patient_id,
    get_employee_stats,
    get_patient_stats,
    list_departments,
    search_patients,
)


def test_generate_patient_id_sequence():
    first_id = generate_patient_id()
    date_str = datetime.now().strftime("%Y%m%d")
    assert first_id.startswith(f"PAT-{date_str}-")

    add_patient(
        {
            "patient_id": first_id,
            "name": "Seq",
            "middle_name": "",
            "last_name": "Test",
            "dob": "1991-01-01",
            "age": 30,
            "weight": 70,
            "height": 170,
            "gender": "Male",
            "pregnant": 0,
            "allergies": "",
            "symptoms": "",
            "phone": "5550000000",
        }
    )

    second_id = generate_patient_id()
    assert second_id.endswith("0002")


def test_search_patients_full_name_matching():
    add_patient(
        {
            "patient_id": "PAT-TEST-0001",
            "name": "Mary",
            "middle_name": "Jane",
            "last_name": "Watson",
            "dob": "1990-10-10",
            "age": 33,
            "weight": 60,
            "height": 165,
            "gender": "Female",
            "pregnant": 0,
            "allergies": "",
            "symptoms": "",
            "phone": "5551234567",
        }
    )

    results = search_patients("Mary Watson")
    assert not any(row["patient_id"] == "PAT-TEST-0001" for row in results)

    results = search_patients("Mary Jane Watson")
    assert any(row["patient_id"] == "PAT-TEST-0001" for row in results)

    results = search_patients("Watson Mary")
    assert any(row["patient_id"] == "PAT-TEST-0001" for row in results)


def test_get_patient_stats_counts():
    add_patient(
        {
            "patient_id": "PAT-STAT-0001",
            "name": "Stats",
            "middle_name": "",
            "last_name": "Case",
            "dob": "1988-01-01",
            "age": 36,
            "weight": 75,
            "height": 172,
            "gender": "Male",
            "pregnant": 0,
            "allergies": "",
            "symptoms": "",
            "phone": "5559991234",
        }
    )
    admission_id = add_admission("PAT-STAT-0001", "Observation")
    add_document("PAT-STAT-0001", admission_id, "test_docs", "/tmp/doc.txt", "OCR text", "en")

    stats = get_patient_stats()
    assert stats["total"] == 1
    assert stats["active_admissions"] == 1
    assert stats["documents"] == 1
    assert stats["readmitted_patients"] == 0


def test_employee_stats_counts():
    add_employee(
        {
            "username": "unit.employee",
            "password_hash": hash_password("pass123"),
            "role": "employee",
            "job_role": "Tester",
            "full_name": "Unit Employee",
            "email": "unit@example.com",
            "phone": "5552221111",
            "department": "QA",
            "employee_id": "EMP-UNIT-1",
            "status": "active",
            "address": "",
            "emergency_contact": "",
        }
    )

    stats = get_employee_stats()
    assert stats["total"] >= 3
    assert stats["active"] >= 3


def test_departments_are_scoped_per_hospital():
    hospital_one_id, _ = create_hospital("hosp-scope-one", "Scope One")
    hospital_two_id, _ = create_hospital("hosp-scope-two", "Scope Two")

    department_one_id = create_department({"department_name": "Cardiology"}, hospital_id=hospital_one_id)
    department_two_id = create_department({"department_name": "Cardiology"}, hospital_id=hospital_two_id)

    assert department_one_id != department_two_id

    hospital_one_departments = list_departments(hospital_id=hospital_one_id)
    hospital_two_departments = list_departments(hospital_id=hospital_two_id)

    assert len(hospital_one_departments) == 1
    assert len(hospital_two_departments) == 1
    assert hospital_one_departments[0]["hospital_id"] == hospital_one_id
    assert hospital_two_departments[0]["hospital_id"] == hospital_two_id
