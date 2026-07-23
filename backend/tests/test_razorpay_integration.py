import importlib


def _owner_login(client):
    response = client.post("/api/auth/login", json={"username": "employee", "password": "employee123"})
    assert response.status_code == 200


def _enable_razorpay(monkeypatch):
    app_module = importlib.import_module("app")
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_SECRET", "secret")
    return app_module


def test_billing_razorpay_order_and_verify_records_payment(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)

    invoice = app_client.post(
        "/api/billing/invoices",
        json={
            "patient_id": "P-1001",
            "module": "OP",
            "total_amount": 1200,
        },
    )
    assert invoice.status_code == 200
    invoice_id = invoice.get_json()["invoice_id"]

    monkeypatch.setattr(
        app_module,
        "create_razorpay_order",
        lambda amount_paise, currency, receipt, notes: {
            "id": "order_123",
            "amount": amount_paise,
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
        },
    )

    order = app_client.post(
        "/api/billing/razorpay/order",
        json={"invoice_id": invoice_id, "amount": 500},
    )
    assert order.status_code == 200
    assert order.get_json()["order_id"] == "order_123"

    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: True)
    verify = app_client.post(
        "/api/billing/razorpay/verify",
        json={
            "invoice_id": invoice_id,
            "amount": 500,
            "payment_mode": "upi",
            "razorpay_order_id": "order_123",
            "razorpay_payment_id": "pay_123",
            "razorpay_signature": "sig_123",
        },
    )
    assert verify.status_code == 200
    assert verify.get_json()["payment_id"] >= 1

    invoices = app_client.get("/api/billing/invoices").get_json()["invoices"]
    matching = [row for row in invoices if row["id"] == invoice_id]
    assert matching
    assert matching[0]["paid_amount"] == 500
    assert matching[0]["payment_status"] == "partial"


def test_appointment_razorpay_verify_creates_appointment_and_paid_invoice(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: True)

    response = app_client.post(
        "/api/appointments/razorpay/verify",
        json={
            "amount": 350,
            "payment_mode": "upi",
            "razorpay_order_id": "order_appt_1",
            "razorpay_payment_id": "pay_appt_1",
            "razorpay_signature": "sig_appt_1",
            "appointment": {
                "patient_id": "P-2001",
                "patient_name": "Razor Appointment",
                "visit_type": "OP",
                "department": "General Medicine",
                "doctor_name": "Dr. Payment",
                "appointment_date": "2026-03-10T10:30:00",
                "status": "scheduled",
                "appointment_kind": "new",
            },
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["appointment_id"] >= 1
    assert payload["invoice_id"] >= 1
    assert payload["payment_id"] >= 1

    appointments = app_client.get("/api/appointments?date=2026-03-10").get_json()["appointments"]
    assert any(item["id"] == payload["appointment_id"] for item in appointments)

    invoices = app_client.get("/api/billing/invoices").get_json()["invoices"]
    matching = [row for row in invoices if row["id"] == payload["invoice_id"]]
    assert matching
    assert matching[0]["module"] == "OP"
    assert matching[0]["paid_amount"] == 350
    assert matching[0]["payment_status"] == "paid"


def test_razorpay_endpoints_require_backend_keys(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = importlib.import_module("app")
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_SECRET", "")

    billing_order = app_client.post(
        "/api/billing/razorpay/order",
        json={"invoice_id": 1, "amount": 200},
    )
    assert billing_order.status_code == 503

    appointment_order = app_client.post(
        "/api/appointments/razorpay/order",
        json={"amount": 200},
    )
    assert appointment_order.status_code == 503
    config = app_client.get("/api/payments/razorpay/config")
    assert config.status_code == 200
    assert config.get_json()["configured"] is False


def test_billing_razorpay_verify_rejects_invalid_signature(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: False)

    invoice = app_client.post(
        "/api/billing/invoices",
        json={
            "patient_id": "P-1002",
            "module": "OP",
            "total_amount": 900,
        },
    )
    assert invoice.status_code == 200
    invoice_id = invoice.get_json()["invoice_id"]

    verify = app_client.post(
        "/api/billing/razorpay/verify",
        json={
            "invoice_id": invoice_id,
            "amount": 300,
            "payment_mode": "upi",
            "razorpay_order_id": "order_bad",
            "razorpay_payment_id": "pay_bad",
            "razorpay_signature": "sig_bad",
        },
    )
    assert verify.status_code == 400
    assert "Invalid Razorpay signature" in verify.get_json().get("error", "")


def test_billing_razorpay_order_validates_invoice_id(app_client, monkeypatch):
    _owner_login(app_client)
    _enable_razorpay(monkeypatch)

    response = app_client.post(
        "/api/billing/razorpay/order",
        json={"invoice_id": "not-a-number", "amount": 200},
    )
    assert response.status_code == 400
    assert "invoice_id must be a valid number" in response.get_json().get("error", "")


def test_billing_razorpay_order_returns_404_for_missing_invoice(app_client, monkeypatch):
    _owner_login(app_client)
    _enable_razorpay(monkeypatch)

    response = app_client.post(
        "/api/billing/razorpay/order",
        json={"invoice_id": 999999, "amount": 200},
    )
    assert response.status_code == 404
    assert response.get_json().get("error") == "Invoice not found"


def test_razorpay_config_reports_enabled_state(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_ID", "rzp_test_live")
    monkeypatch.setattr(app_module, "RAZORPAY_KEY_SECRET", "secret")

    response = app_client.get("/api/payments/razorpay/config")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["configured"] is True
    assert payload["key_id"] == "rzp_test_live"


def test_billing_razorpay_verify_returns_404_for_missing_invoice(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: True)

    response = app_client.post(
        "/api/billing/razorpay/verify",
        json={
            "invoice_id": 999999,
            "amount": 200,
            "payment_mode": "upi",
            "razorpay_order_id": "order_missing",
            "razorpay_payment_id": "pay_missing",
            "razorpay_signature": "sig_missing",
        },
    )
    assert response.status_code == 404
    assert response.get_json().get("error") == "Invoice not found"


def test_appointment_razorpay_verify_rejects_invalid_signature(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: False)

    response = app_client.post(
        "/api/appointments/razorpay/verify",
        json={
            "amount": 350,
            "payment_mode": "upi",
            "razorpay_order_id": "order_appt_bad",
            "razorpay_payment_id": "pay_appt_bad",
            "razorpay_signature": "sig_appt_bad",
            "appointment": {
                "patient_id": "P-4001",
                "patient_name": "Bad Signature",
                "visit_type": "OP",
                "appointment_date": "2026-03-10T10:30:00",
            },
        },
    )
    assert response.status_code == 400
    assert "Invalid Razorpay signature" in response.get_json().get("error", "")


def test_razorpay_order_rejects_non_positive_amounts(app_client, monkeypatch):
    _owner_login(app_client)
    _enable_razorpay(monkeypatch)

    billing_order = app_client.post(
        "/api/billing/razorpay/order",
        json={"invoice_id": 1, "amount": 0},
    )
    assert billing_order.status_code == 400
    assert "Amount must be greater than zero" in billing_order.get_json().get("error", "")

    appointment_order = app_client.post(
        "/api/appointments/razorpay/order",
        json={"amount": -1},
    )
    assert appointment_order.status_code == 400
    assert "Amount must be greater than zero" in appointment_order.get_json().get("error", "")


def test_billing_verify_normalizes_unknown_payment_mode_to_upi(app_client, monkeypatch):
    _owner_login(app_client)
    app_module = _enable_razorpay(monkeypatch)
    monkeypatch.setattr(app_module, "verify_razorpay_signature", lambda order_id, payment_id, signature: True)

    invoice = app_client.post(
        "/api/billing/invoices",
        json={
            "patient_id": "P-5001",
            "module": "OP",
            "total_amount": 1000,
        },
    )
    assert invoice.status_code == 200
    invoice_id = invoice.get_json()["invoice_id"]

    verify = app_client.post(
        "/api/billing/razorpay/verify",
        json={
            "invoice_id": invoice_id,
            "amount": 400,
            "payment_mode": "wallet",
            "razorpay_order_id": "order_mode",
            "razorpay_payment_id": "pay_mode",
            "razorpay_signature": "sig_mode",
        },
    )
    assert verify.status_code == 200

    summary = app_client.get("/api/billing/revenue-summary")
    assert summary.status_code == 200
    breakdown = summary.get_json().get("payment_mode_breakdown", [])
    labels = {str(item.get("label", "")).lower() for item in breakdown}
    assert "upi" in labels
