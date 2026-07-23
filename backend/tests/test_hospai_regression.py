def _create_invoice(client, patient_id, total_amount=1200, module="OP"):
    response = client.post(
        "/api/billing/invoices",
        json={
            "patient_id": patient_id,
            "module": module,
            "doctor_name": "Dr. Regression",
            "clinic_name": "General Clinic",
            "referral_source": "doctor",
            "total_amount": total_amount,
            "discount_amount": 100,
            "advance_amount": 150,
        },
    )
    assert response.status_code == 200
    return response.get_json()["invoice_id"]


def test_reports_overview_and_exports_cover_new_modules(auth_client, create_patient):
    patient_id = create_patient({"name": "Report", "last_name": "Coverage"})
    invoice_id = _create_invoice(auth_client, patient_id, total_amount=2500, module="LAB")

    payment = auth_client.post(
        f"/api/billing/invoices/{invoice_id}/payments",
        json={
            "amount": 1900,
            "payment_mode": "upi",
            "gateway_ref": "gw-report-1",
            "converted_from_mode": "cash",
            "converted_to_mode": "upi",
        },
    )
    assert payment.status_code == 200

    claim = auth_client.post(
        "/api/billing/claims",
        json={
            "invoice_id": invoice_id,
            "insurer_name": "Star Health",
            "claim_amount": 600,
            "approved_amount": 450,
            "claim_status": "submitted",
            "external_ref": "CLM-1001",
        },
    )
    assert claim.status_code == 200

    ledger = auth_client.post(
        "/api/accounts/ledger",
        json={
            "entry_date": "2026-03-04",
            "entry_type": "income",
            "category": "Collections",
            "reference_no": "LED-1001",
            "counterparty_name": "Front Desk",
            "amount": 2500,
        },
    )
    assert ledger.status_code == 200

    overview = auth_client.get("/api/reports/overview")
    assert overview.status_code == 200
    payload = overview.get_json()
    assert "billing_summary" in payload
    assert "accounts_summary" in payload
    assert "clinic_income" in payload
    assert "discount_by_module" in payload
    assert "payment_status_breakdown" in payload
    assert "alos_summary" in payload
    assert payload["billing_summary"]["total_billed"] >= 2500
    assert payload["accounts_summary"]["net_position"] >= 2500

    csv_export = auth_client.get("/api/reports/export/csv")
    assert csv_export.status_code == 200
    assert csv_export.mimetype == "text/csv"
    csv_text = csv_export.data.decode("utf-8")
    assert "section,label,value" in csv_text
    assert "clinic_income" in csv_text

    pdf_export = auth_client.get("/api/reports/export/pdf")
    assert pdf_export.status_code == 200
    assert pdf_export.mimetype == "application/pdf"
    assert pdf_export.data

    word_export = auth_client.get("/api/reports/export/word")
    assert word_export.status_code == 200
    assert word_export.mimetype == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert word_export.data


def test_ops_and_pharmacy_workflows_cover_reminders_procurement_ot_and_accounts(auth_client, create_patient):
    patient_id = create_patient({"name": "Ops", "last_name": "Coverage"})

    inventory = auth_client.post(
        "/api/pharmacy/inventory",
        json={"medicine_name": "Cefixime", "quantity": 10, "reorder_level": 5, "unit_price": 18},
    )
    assert inventory.status_code == 200

    supplier = auth_client.post(
        "/api/pharmacy/suppliers",
        json={"supplier_name": "Acme Pharma", "contact_person": "Ravi", "phone": "5551112222"},
    )
    assert supplier.status_code == 200
    supplier_id = supplier.get_json()["supplier_id"]

    purchase = auth_client.post(
        "/api/pharmacy/purchases",
        json={
            "supplier_id": supplier_id,
            "medicine_name": "Cefixime",
            "quantity": 15,
            "unit_cost": 12,
            "status": "ordered",
        },
    )
    assert purchase.status_code == 200
    purchase_id = purchase.get_json()["purchase_id"]

    purchase_update = auth_client.put(
        f"/api/pharmacy/purchases/{purchase_id}",
        json={"status": "received", "received_date": "2026-03-04"},
    )
    assert purchase_update.status_code == 200

    inventory_rows = auth_client.get("/api/pharmacy/inventory").get_json()["items"]
    cefixime = next((item for item in inventory_rows if item["medicine_name"] == "Cefixime"), None)
    assert cefixime is not None
    assert cefixime["quantity"] >= 25

    appointment = auth_client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "patient_name": "Ops Coverage",
            "visit_type": "OP",
            "department": "General Medicine",
            "doctor_name": "Dr. Queue",
            "appointment_date": "2026-03-04T09:30:00",
        },
    )
    assert appointment.status_code == 200
    appointment_id = appointment.get_json()["appointment_id"]

    reminder = auth_client.put(
        f"/api/appointments/{appointment_id}",
        json={"reminder_sent_at": "2026-03-04T08:00:00"},
    )
    assert reminder.status_code == 200

    no_show = auth_client.put(
        f"/api/appointments/{appointment_id}",
        json={"no_show_marked": True, "status": "cancelled"},
    )
    assert no_show.status_code == 200

    op_summary = auth_client.get("/api/op/summary?date=2026-03-04")
    assert op_summary.status_code == 200
    op_payload = op_summary.get_json()
    assert op_payload["reminders_sent"] >= 1
    assert op_payload["no_shows"] >= 1

    theatre = auth_client.post(
        "/api/ot/theatres",
        json={"theatre_code": "OT-11", "theatre_name": "Main Theatre", "status": "available"},
    )
    assert theatre.status_code == 200
    theatre_id = theatre.get_json()["theatre_id"]

    surgery = auth_client.post(
        "/api/ot/surgeries",
        json={
            "theatre_id": theatre_id,
            "patient_id": patient_id,
            "procedure_name": "Appendectomy",
            "surgeon_name": "Dr. Surgeon",
            "scheduled_start": "2026-03-04T10:00:00",
            "estimated_duration_hours": 2.5,
            "status": "completed",
        },
    )
    assert surgery.status_code == 200

    ot_summary = auth_client.get("/api/ot/summary")
    assert ot_summary.status_code == 200
    ot_payload = ot_summary.get_json()
    assert ot_payload["completed_surgeries"] >= 1
    assert ot_payload["completed_hours"] >= 2
    assert any(row["label"] == "OT-11" for row in ot_payload["theatre_utilization"])

    vendor_payment = auth_client.post(
        "/api/accounts/vendors",
        json={
            "vendor_name": "Acme Pharma",
            "invoice_ref": "VP-1001",
            "amount": 1500,
            "payment_date": "2026-03-04",
            "payment_mode": "bank",
            "status": "paid",
        },
    )
    assert vendor_payment.status_code == 200

    doctor_payout = auth_client.post(
        "/api/accounts/doctors",
        json={
            "doctor_name": "Dr. Surgeon",
            "payout_month": "2026-03",
            "amount": 5000,
            "paid_amount": 3000,
            "status": "partial",
        },
    )
    assert doctor_payout.status_code == 200

    accounts_summary = auth_client.get("/api/accounts/summary")
    assert accounts_summary.status_code == 200
    accounts_payload = accounts_summary.get_json()
    assert accounts_payload["vendor_paid_total"] >= 1500
    assert accounts_payload["doctor_paid_total"] >= 3000
    assert accounts_payload["doctor_due_total"] >= 2000


def test_registration_and_diagnostics_workflows_cover_consent_verification_and_lifecycle(auth_client, create_patient):
    patient_id = create_patient({"name": "Reg", "last_name": "Diag"})

    consent = auth_client.post(
        "/api/registration/consents",
        json={
            "patient_id": patient_id,
            "patient_name": "Reg Diag",
            "consent_type": "general",
            "signed_by": "Reg Diag",
            "relation_to_patient": "Self",
        },
    )
    assert consent.status_code == 200

    verification = auth_client.post(
        "/api/registration/insurance",
        json={
            "patient_id": patient_id,
            "patient_name": "Reg Diag",
            "insurer_name": "Health First",
            "policy_number": "POL-9001",
            "member_id": "MBR-55",
            "verification_status": "verified",
            "coverage_notes": "Cashless approved",
        },
    )
    assert verification.status_code == 200

    consent_rows = auth_client.get(f"/api/registration/consents?patient_id={patient_id}")
    assert consent_rows.status_code == 200
    assert any(row["signed_by"] == "Reg Diag" for row in consent_rows.get_json()["consents"])

    verification_rows = auth_client.get(f"/api/registration/insurance?patient_id={patient_id}")
    assert verification_rows.status_code == 200
    assert any(row["insurer_name"] == "Health First" for row in verification_rows.get_json()["verifications"])

    vendor = auth_client.post(
        "/api/lab/vendors",
        json={"vendor_name": "Diagnostic Hub", "contact_person": "Anita", "phone": "5553334444"},
    )
    assert vendor.status_code == 200
    vendor_id = vendor.get_json()["vendor_id"]

    diagnostic = auth_client.post(
        "/api/lab/diagnostics",
        json={
            "invoice_no": "LAB-1001",
            "patient_id": patient_id,
            "vendor_id": vendor_id,
            "doctor_name": "Dr. Path",
            "test_name": "CBC",
            "amount": 850,
            "paid_amount": 400,
            "sample_barcode": "SMP-1001",
            "order_status": "sample_collected",
            "collected_at": "2026-03-04T10:00:00",
        },
    )
    assert diagnostic.status_code == 200
    diagnostic_id = diagnostic.get_json()["diagnostic_id"]

    diagnostic_update = auth_client.put(
        f"/api/lab/diagnostics/{diagnostic_id}",
        json={
            "order_status": "reported",
            "reported_at": "2026-03-04T12:30:00",
            "paid_amount": 850,
        },
    )
    assert diagnostic_update.status_code == 200

    diagnostics = auth_client.get(f"/api/lab/diagnostics?patient_id={patient_id}")
    assert diagnostics.status_code == 200
    matching = next((row for row in diagnostics.get_json()["diagnostics"] if row["id"] == diagnostic_id), None)
    assert matching is not None
    assert matching["sample_barcode"] == "SMP-1001"
    assert matching["order_status"] == "reported"
    assert matching["reported_at"]

    summary = auth_client.get("/api/lab/summary")
    assert summary.status_code == 200
    summary_payload = summary.get_json()
    assert summary_payload["total_amount"] >= 850
    assert summary_payload["total_paid"] >= 850
