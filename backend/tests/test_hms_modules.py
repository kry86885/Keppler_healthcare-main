import uuid


def _login(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.get_json()["user"]


def _owner_login(client):
    return _login(client, "employee", "employee123")


def _patient_payload(seed):
    return {
        "name": f"HMS{seed}",
        "middle_name": "",
        "last_name": "Patient",
        "dob": "1990-01-01",
        "age": 35,
        "weight": 68,
        "height": 169,
        "gender": "Female",
        "pregnant": False,
        "allergies": "None",
        "symptoms": "Fever",
        "phone": f"555{seed:07d}",
    }


def test_extended_patient_management_flow(app_client):
    _owner_login(app_client)
    suffix = uuid.uuid4().hex[:6]
    created = app_client.post("/api/patients", json=_patient_payload(700001))
    assert created.status_code == 200
    patient_id = created.get_json()["patient_id"]
    admission_id = created.get_json()["admission_id"]

    encounter = app_client.post(
        f"/api/patients/{patient_id}/encounters",
        json={
            "encounter_type": "IP",
            "insurance_provider": "Acme Insurance",
            "insurance_policy_no": "POL-001",
            "is_accident": True,
            "referral_source": "doctor",
            "referral_name": "Dr. Smith",
        },
    )
    assert encounter.status_code == 200

    bed = app_client.post(
        f"/api/patients/{patient_id}/beds",
        json={"admission_id": admission_id, "ward": "A", "room_no": "101", "bed_no": "1"},
    )
    assert bed.status_code == 200

    medication = app_client.post(
        f"/api/patients/{patient_id}/medications",
        json={"medicine_name": "Paracetamol", "dosage": "500mg", "schedule_time": "2026-02-18T10:00:00"},
    )
    assert medication.status_code == 200

    note = app_client.post(
        f"/api/patients/{patient_id}/notes",
        json={"admission_id": admission_id, "doctor_name": "Dr. Smith", "note": "Under observation", "treatment_plan": "Monitor vitals"},
    )
    assert note.status_code == 200

    certificate = app_client.post(
        f"/api/patients/{patient_id}/certificates",
        json={
            "admission_id": admission_id,
            "certificate_type": "medical_certificate",
            "title": "Fitness Rest Certificate",
            "body": "Patient requires rest for seven days.",
        },
    )
    assert certificate.status_code == 200
    certificate_payload = certificate.get_json()

    movement = app_client.post(
        f"/api/patients/{patient_id}/movements",
        json={"admission_id": admission_id, "from_department": "ER", "to_department": "ICU"},
    )
    assert movement.status_code == 200

    assert len(app_client.get(f"/api/patients/{patient_id}/encounters").get_json()["encounters"]) == 1
    assert len(app_client.get(f"/api/patients/{patient_id}/beds").get_json()["beds"]) == 1
    assert len(app_client.get(f"/api/patients/{patient_id}/medications").get_json()["medications"]) == 1
    assert len(app_client.get(f"/api/patients/{patient_id}/notes").get_json()["notes"]) == 1
    certificates = app_client.get(f"/api/patients/{patient_id}/certificates").get_json()["certificates"]
    matching_certificates = [item for item in certificates if item["id"] == certificate_payload["certificate_id"]]
    assert matching_certificates
    assert len(app_client.get(f"/api/patients/{patient_id}/movements").get_json()["movements"]) == 1

    appointment = app_client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "patient_name": "HMS700001 Patient",
            "visit_type": "OP",
            "department": "General Medicine",
            "doctor_name": "Dr. Smith",
            "appointment_date": "2026-03-03T09:30:00",
        },
    )
    assert appointment.status_code == 200
    appointment_payload = appointment.get_json()
    assert appointment_payload["token_no"] >= 1

    registration_department = app_client.post(
        "/api/registration/departments",
        json={"department_name": f"General Medicine {suffix}"},
    )
    assert registration_department.status_code == 200
    registration_departments = app_client.get("/api/registration/departments").get_json()["departments"]
    assert any(row.get("department_name") == f"General Medicine {suffix}" for row in registration_departments)

    appointments = app_client.get("/api/appointments?date=2026-03-03").get_json()["appointments"]
    matching_appointments = [item for item in appointments if item["id"] == appointment_payload["appointment_id"]]
    assert matching_appointments
    assert matching_appointments[0]["status"] == "scheduled"
    assert matching_appointments[0]["appointment_kind"] == "new"

    updated_appointment = app_client.put(
        f"/api/appointments/{matching_appointments[0]['id']}",
        json={"status": "checked_in"},
    )
    assert updated_appointment.status_code == 200

    reminder_marked = app_client.put(
        f"/api/appointments/{matching_appointments[0]['id']}",
        json={"reminder_sent_at": "2026-03-03T08:00:00"},
    )
    assert reminder_marked.status_code == 200

    consent = app_client.post(
        "/api/registration/consents",
        json={
            "patient_id": patient_id,
            "patient_name": "HMS700001 Patient",
            "consent_type": "general",
            "signed_by": "Ravi Kumar",
            "relation_to_patient": "Self",
        },
    )
    assert consent.status_code == 200

    insurance = app_client.post(
        "/api/registration/insurance",
        json={
            "patient_id": patient_id,
            "patient_name": "HMS700001 Patient",
            "insurer_name": "Star Health",
            "policy_number": "POL-100",
            "verification_status": "verified",
        },
    )
    assert insurance.status_code == 200
    insurance_id = insurance.get_json()["verification_id"]
    insurance_update = app_client.put(
        f"/api/registration/insurance/{insurance_id}",
        json={"coverage_notes": "Cashless up to room-limit cap"},
    )
    assert insurance_update.status_code == 200
    insurance_rows = app_client.get(f"/api/registration/insurance?patient_id={patient_id}").get_json()["verifications"]
    assert any(item["id"] == insurance_id for item in insurance_rows)

    doctor_schedule = app_client.post(
        "/api/op/doctor-schedules",
        json={
            "doctor_name": f"Dr. OP {suffix}",
            "department": "General Medicine",
            "schedule_date": "2026-03-03",
            "start_time": "09:00",
            "end_time": "13:00",
            "slot_capacity": 8,
        },
    )
    assert doctor_schedule.status_code == 200

    follow_up = app_client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "patient_name": "HMS700001 Patient",
            "visit_type": "OP",
            "department": "General Medicine",
            "doctor_name": f"Dr. OP {suffix}",
            "appointment_date": "2026-03-03T11:00:00",
            "appointment_kind": "follow_up",
            "follow_up_for": appointment_payload["appointment_id"],
        },
    )
    assert follow_up.status_code == 200

    op_summary = app_client.get("/api/op/summary?date=2026-03-03").get_json()
    assert op_summary["total_appointments"] >= 2
    assert op_summary["follow_ups"] >= 1
    assert op_summary["available_doctors"] >= 1
    assert op_summary["reminders_sent"] >= 1

    no_show_update = app_client.put(
        f"/api/appointments/{follow_up.get_json()['appointment_id']}",
        json={"no_show_marked": True, "status": "cancelled"},
    )
    assert no_show_update.status_code == 200
    op_summary_after_no_show = app_client.get("/api/op/summary?date=2026-03-03").get_json()
    assert op_summary_after_no_show["no_shows"] >= 1


def test_billing_pharmacy_lab_summary_and_dashboard(app_client):
    _owner_login(app_client)
    suffix = uuid.uuid4().hex[:6]
    created = app_client.post("/api/patients", json=_patient_payload(700002))
    patient_id = created.get_json()["patient_id"]
    app_client.post(
        f"/api/patients/{patient_id}/encounters",
        json={"encounter_type": "OP", "is_accident": False, "referral_source": "marketing"},
    )

    invoice = app_client.post(
        "/api/billing/invoices",
        json={
            "patient_id": patient_id,
            "module": "OP",
            "total_amount": 1200,
            "advance_amount": 100,
            "doctor_name": "Dr. Who",
            "clinic_name": "General Clinic",
            "referral_source": "doctor",
        },
    )
    assert invoice.status_code == 200
    invoice_id = invoice.get_json()["invoice_id"]

    payment = app_client.post(
        f"/api/billing/invoices/{invoice_id}/payments",
        json={
            "amount": 900,
            "payment_mode": "upi",
            "gateway_ref": "gw-101",
            "converted_from_mode": "cash",
            "converted_to_mode": "upi",
        },
    )
    assert payment.status_code == 200

    update_invoice = app_client.put(
        f"/api/billing/invoices/{invoice_id}",
        json={"module": "LAB", "total_amount": 1400, "paid_amount": 900, "refunded_amount": 50},
    )
    assert update_invoice.status_code == 200

    inv_list = app_client.get("/api/billing/invoices").get_json()["invoices"]
    assert len(inv_list) == 1
    revenue = app_client.get("/api/billing/revenue-summary").get_json()
    assert revenue["total_billed"] == 1400
    assert revenue["total_advance"] == 100
    assert revenue["total_refunded"] == 50
    assert revenue["total_due"] == 450
    assert any(row["label"] == "LAB" for row in revenue["collections_by_module"])
    assert "aging_buckets" in revenue
    assert "reconciliation_summary" in revenue
    assert "conversion_breakdown" in revenue
    assert revenue["reconciliation_summary"]["gateway_collected"] >= 900
    assert revenue["reconciliation_summary"]["converted_total"] >= 900
    assert any(row["label"] == "cash -> upi" for row in revenue["conversion_breakdown"])

    claim = app_client.post(
        "/api/billing/claims",
        json={
            "invoice_id": invoice_id,
            "patient_id": patient_id,
            "insurer_name": "Acme Insurance",
            "claim_amount": 700,
            "approved_amount": 500,
            "claim_status": "under_review",
            "external_ref": "CLM-100",
        },
    )
    assert claim.status_code == 200
    claim_id = claim.get_json()["claim_id"]
    claim_rows = app_client.get(f"/api/billing/claims?invoice_id={invoice_id}").get_json()["claims"]
    assert any(item["id"] == claim_id for item in claim_rows)
    update_claim = app_client.put(f"/api/billing/claims/{claim_id}", json={"claim_status": "approved", "approved_amount": 650})
    assert update_claim.status_code == 200

    item = app_client.post(
        "/api/pharmacy/inventory",
        json={"medicine_name": "Amoxicillin", "quantity": 20, "reorder_level": 10, "unit_price": 50},
    )
    assert item.status_code == 200

    supplier = app_client.post(
        "/api/pharmacy/suppliers",
        json={"supplier_name": "MediSupply", "contact_person": "Asha", "phone": "5551112222"},
    )
    assert supplier.status_code == 200
    supplier_id = supplier.get_json()["supplier_id"]

    purchase = app_client.post(
        "/api/pharmacy/purchases",
        json={
            "supplier_id": supplier_id,
            "medicine_name": "Amoxicillin",
            "quantity": 5,
            "unit_cost": 30,
            "status": "received",
            "received_date": "2026-03-03",
        },
    )
    assert purchase.status_code == 200
    purchase_rows = app_client.get("/api/pharmacy/purchases").get_json()["purchases"]
    assert any(item["medicine_name"] == "Amoxicillin" for item in purchase_rows)

    sale = app_client.post(
        "/api/pharmacy/sales",
        json={
            "patient_id": patient_id,
            "prescription_ref": "RX-100",
            "medicine_name": "Amoxicillin",
            "quantity": 2,
            "unit_price": 50,
        },
    )
    assert sale.status_code == 200
    sales_list = app_client.get("/api/pharmacy/sales").get_json()["sales"]
    assert len(sales_list) == 1
    assert sales_list[0]["amount"] == 100
    assert sales_list[0]["prescription_ref"] == "RX-100"
    pharmacy_summary = app_client.get("/api/pharmacy/summary").get_json()
    assert pharmacy_summary["sales_total"] == 100

    inventory_rows = app_client.get("/api/pharmacy/inventory").get_json()["items"]
    assert len(inventory_rows) == 1
    assert inventory_rows[0]["quantity"] == 23
    delete_inventory = app_client.delete(f"/api/pharmacy/inventory/{inventory_rows[0]['id']}")
    assert delete_inventory.status_code == 200

    vendor = app_client.post("/api/lab/vendors", json={"vendor_name": "MedLab", "phone": "5558887777"})
    assert vendor.status_code == 200
    vendor_id = vendor.get_json()["vendor_id"]

    diagnostic = app_client.post(
        "/api/lab/diagnostics",
        json={
            "patient_id": patient_id,
            "vendor_id": vendor_id,
            "doctor_name": "Dr. Who",
            "test_name": "Blood Test",
            "amount": 300,
            "paid_amount": 100,
            "sample_barcode": "LAB-BC-100",
            "order_status": "sample_collected",
            "collected_at": "2026-03-03T08:30:00",
        },
    )
    assert diagnostic.status_code == 200
    diagnostic_id = diagnostic.get_json()["diagnostic_id"]

    update_vendor = app_client.put(f"/api/lab/vendors/{vendor_id}", json={"status": "inactive"})
    assert update_vendor.status_code == 200

    update_diagnostic = app_client.put(
        f"/api/lab/diagnostics/{diagnostic_id}",
        json={"paid_amount": 200, "order_status": "reported", "reported_at": "2026-03-03T09:45:00"},
    )
    assert update_diagnostic.status_code == 200
    diagnostic_rows = app_client.get("/api/lab/diagnostics").get_json()["diagnostics"]
    matching_diagnostic = next(item for item in diagnostic_rows if item["id"] == diagnostic_id)
    assert matching_diagnostic["sample_barcode"] == "LAB-BC-100"
    assert matching_diagnostic["order_status"] == "reported"

    lab_summary = app_client.get("/api/lab/summary").get_json()
    assert lab_summary["total_due"] == 100

    delete_diagnostic = app_client.delete(f"/api/lab/diagnostics/{diagnostic_id}")
    assert delete_diagnostic.status_code == 200

    theatre = app_client.post(
        "/api/ot/theatres",
        json={"theatre_code": f"OT-{suffix}", "theatre_name": "Main OT", "equipment_notes": "Cardiac monitor"},
    )
    assert theatre.status_code == 200
    theatre_id = theatre.get_json()["theatre_id"]

    surgery = app_client.post(
        "/api/ot/surgeries",
        json={
            "theatre_id": theatre_id,
            "patient_id": patient_id,
            "procedure_name": "Appendectomy",
            "surgeon_name": "Dr. Who",
            "scheduled_start": "2026-03-03T10:00:00",
            "estimated_duration_hours": 2,
            "equipment_required": "Laparoscopy set",
        },
    )
    assert surgery.status_code == 200
    surgery_id = surgery.get_json()["surgery_id"]

    ot_summary = app_client.get("/api/ot/summary").get_json()
    assert ot_summary["theatre_count"] >= 1
    assert ot_summary["scheduled_surgeries"] >= 1
    assert ot_summary["scheduled_hours"] >= 2
    assert "theatre_utilization" in ot_summary

    update_surgery = app_client.put(f"/api/ot/surgeries/{surgery_id}", json={"status": "completed"})
    assert update_surgery.status_code == 200

    listed_surgeries = app_client.get("/api/ot/surgeries").get_json()["surgeries"]
    assert any(item["id"] == surgery_id for item in listed_surgeries)

    accounts_before = app_client.get("/api/accounts/summary").get_json()

    ledger = app_client.post(
        "/api/accounts/ledger",
        json={
            "entry_date": "2026-03-03",
            "entry_type": "income",
            "category": "Insurance Settlement",
            "reference_no": "LED-100",
            "counterparty_name": "Acme Insurance",
            "amount": 5000,
        },
    )
    assert ledger.status_code == 200
    entry_id = ledger.get_json()["entry_id"]

    vendor_payment = app_client.post(
        "/api/accounts/vendors",
        json={
            "vendor_name": "MedSupply",
            "invoice_ref": "VN-100",
            "amount": 1800,
            "payment_date": "2026-03-03",
            "payment_mode": "bank",
        },
    )
    assert vendor_payment.status_code == 200

    doctor_payout = app_client.post(
        "/api/accounts/doctors",
        json={
            "doctor_name": "Dr. Who",
            "payout_month": "2026-03",
            "amount": 3000,
            "paid_amount": 2000,
        },
    )
    assert doctor_payout.status_code == 200
    payout_id = doctor_payout.get_json()["payout_id"]

    accounts_summary = app_client.get("/api/accounts/summary").get_json()
    assert accounts_summary["ledger_income"] == accounts_before["ledger_income"] + 5000
    assert accounts_summary["vendor_paid_total"] == accounts_before["vendor_paid_total"] + 1800
    assert accounts_summary["doctor_due_total"] == accounts_before["doctor_due_total"] + 1000

    update_ledger = app_client.put(f"/api/accounts/ledger/{entry_id}", json={"amount": 5500})
    assert update_ledger.status_code == 200
    update_payout = app_client.put(f"/api/accounts/doctors/{payout_id}", json={"paid_amount": 3000})
    assert update_payout.status_code == 200

    ledger_entries = app_client.get("/api/accounts/ledger").get_json()["entries"]
    assert any(item["id"] == entry_id for item in ledger_entries)
    doctor_payouts = app_client.get("/api/accounts/doctors").get_json()["payouts"]
    assert any(item["id"] == payout_id for item in doctor_payouts)

    delete_invoice = app_client.delete(f"/api/billing/invoices/{invoice_id}")
    assert delete_invoice.status_code == 200

    dashboard = app_client.get("/api/dashboard/hospital-summary")
    assert dashboard.status_code == 200
    assert "revenue" in dashboard.get_json()


def test_hr_and_audit_permissions(app_client):
    _owner_login(app_client)
    suffix = uuid.uuid4().hex[:8]
    created = app_client.post(
        "/api/employees",
        json={
            "username": f"hr.{suffix}",
            "password": "secret123",
            "full_name": "HR Manager",
            "email": f"hr.{suffix}@example.com",
            "phone": "5554443333",
            "user_type": "normal",
            "module_access": ["hrms"],
            "job_role": "HR",
            "department": "HR",
            "address": "",
            "emergency_contact": "",
        },
    )
    assert created.status_code == 201
    employee_id = created.get_json()["employee_id"]

    _login(app_client, f"hr.{suffix}", "secret123")
    dept = app_client.post("/api/hr/departments", json={"department_name": f"Nursing-{suffix}", "mapped_head_employee_id": employee_id})
    assert dept.status_code == 200

    attendance = app_client.post(
        "/api/hr/attendance",
        json={"employee_id": employee_id, "attendance_date": "2026-02-18", "status": "present", "in_time": "09:00", "out_time": "17:00"},
    )
    assert attendance.status_code == 200
    attendance_id = attendance.get_json()["attendance_id"]

    payroll = app_client.post(
        "/api/hr/payroll",
        json={"employee_id": employee_id, "payroll_month": "2026-02", "basic_salary": 50000, "allowances": 5000, "deductions": 2000},
    )
    assert payroll.status_code == 200
    payroll_id = payroll.get_json()["payroll_id"]

    leave = app_client.post(
        "/api/hr/leaves",
        json={"employee_id": employee_id, "leave_type": "Sick", "start_date": "2026-02-20", "end_date": "2026-02-21", "reason": "Fever"},
    )
    assert leave.status_code == 200
    leave_id = leave.get_json()["leave_id"]
    updated_leave = app_client.post(f"/api/hr/leaves/{leave_id}/status", json={"status": "approved"})
    assert updated_leave.status_code == 200

    update_department = app_client.put(
        f"/api/hr/departments/{dept.get_json()['department_id']}",
        json={"mapped_head_employee_id": employee_id},
    )
    assert update_department.status_code == 200

    update_attendance = app_client.put(f"/api/hr/attendance/{attendance_id}", json={"status": "leave"})
    assert update_attendance.status_code == 200

    update_payroll = app_client.put(f"/api/hr/payroll/{payroll_id}", json={"deductions": 2500, "paid_status": "paid"})
    assert update_payroll.status_code == 200

    assert len(app_client.get("/api/hr/attendance").get_json()["attendance"]) == 1
    assert len(app_client.get("/api/hr/payroll").get_json()["payroll"]) == 1
    assert len(app_client.get("/api/hr/leaves").get_json()["leaves"]) == 1

    delete_leave = app_client.delete(f"/api/hr/leaves/{leave_id}")
    assert delete_leave.status_code == 200

    delete_attendance = app_client.delete(f"/api/hr/attendance/{attendance_id}")
    assert delete_attendance.status_code == 200

    delete_payroll = app_client.delete(f"/api/hr/payroll/{payroll_id}")
    assert delete_payroll.status_code == 200

    audit_for_hr = app_client.get("/api/audit/logs")
    assert audit_for_hr.status_code == 403
    accounts_for_hr = app_client.get("/api/accounts/summary")
    assert accounts_for_hr.status_code == 403
    reports_for_hr = app_client.get("/api/reports/overview")
    assert reports_for_hr.status_code == 403

    _owner_login(app_client)
    audit_for_owner = app_client.get("/api/audit/logs?limit=50")
    assert audit_for_owner.status_code == 200
    assert len(audit_for_owner.get_json()["logs"]) >= 1
    reports_for_owner = app_client.get("/api/reports/overview")
    assert reports_for_owner.status_code == 200
    assert "billing_summary" in reports_for_owner.get_json()
    assert "accounts_summary" in reports_for_owner.get_json()
    assert "doctor_income" in reports_for_owner.get_json()
    assert "clinic_income" in reports_for_owner.get_json()
    assert "discount_by_module" in reports_for_owner.get_json()
    assert "payment_status_breakdown" in reports_for_owner.get_json()
    assert "alos_summary" in reports_for_owner.get_json()
    assert "patient_financials" in reports_for_owner.get_json()

    reports_csv = app_client.get("/api/reports/export/csv")
    assert reports_csv.status_code == 200
    assert "text/csv" in reports_csv.headers["Content-Type"]

    reports_pdf = app_client.get("/api/reports/export/pdf")
    assert reports_pdf.status_code == 200
    assert "application/pdf" in reports_pdf.headers["Content-Type"]
