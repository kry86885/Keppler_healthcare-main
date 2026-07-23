const {
  ensureLoggedIn,
  uniqueSuffix,
  uniquePhone,
  registerPatient,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Registration, Pharmacy, and Lab", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("covers registration desk, diagnostics lifecycle, and pharmacy procurement APIs", async () => {
    const patientId = await registerPatient({
      first: "E2E",
      last: `RegOps${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 44,
    });

    expect(
      (
        await apiRequest("/api/registration/consents", {
          method: "POST",
          body: {
            patient_id: patientId,
            patient_name: "E2E RegOps",
            consent_type: "general",
            signed_by: "E2E RegOps",
            relation_to_patient: "Self",
          },
        })
      ).status
    ).toBe(200);

    expect(
      (
        await apiRequest("/api/registration/insurance", {
          method: "POST",
          body: {
            patient_id: patientId,
            patient_name: "E2E RegOps",
            insurer_name: "Star Health",
            policy_number: `POL-${uniqueSuffix()}`,
            verification_status: "verified",
          },
        })
      ).status
    ).toBe(200);

    const vendor = await apiRequest("/api/lab/vendors", {
      method: "POST",
      body: { vendor_name: `AdvancedLab-${uniqueSuffix()}`, phone: "5552223333" },
    });
    expect(vendor.status).toBe(200);
    const vendorId = vendor.data.vendor_id;

    const diagnostic = await apiRequest("/api/lab/diagnostics", {
      method: "POST",
      body: {
        patient_id: patientId,
        vendor_id: vendorId,
        doctor_name: "Dr E2E Path",
        test_name: "LFT",
        amount: 900,
        paid_amount: 500,
        sample_barcode: `SMP-${uniqueSuffix()}`,
        order_status: "processing",
      },
    });
    expect(diagnostic.status).toBe(200);
    const diagnosticId = diagnostic.data.diagnostic_id;

    expect(
      (
        await apiRequest(`/api/lab/diagnostics/${diagnosticId}`, {
          method: "PUT",
          body: { order_status: "reported", reported_at: "2026-03-04T14:00:00", paid_amount: 900 },
        })
      ).status
    ).toBe(200);

    const supplier = await apiRequest("/api/pharmacy/suppliers", {
      method: "POST",
      body: { supplier_name: `Supply-${uniqueSuffix()}`, contact_person: "QA", phone: "5557778888" },
    });
    expect(supplier.status).toBe(200);
    const supplierId = supplier.data.supplier_id;

    expect(
      (
        await apiRequest("/api/pharmacy/inventory", {
          method: "POST",
          body: { medicine_name: "Azithromycin", quantity: 20, reorder_level: 5, unit_price: 22 },
        })
      ).status
    ).toBe(200);

    const purchase = await apiRequest("/api/pharmacy/purchases", {
      method: "POST",
      body: {
        supplier_id: supplierId,
        medicine_name: "Azithromycin",
        quantity: 10,
        unit_cost: 15,
        status: "received",
      },
    });
    expect(purchase.status).toBe(200);

    const summary = await apiRequest("/api/pharmacy/summary");
    expect(summary.status).toBe(200);
    expect(summary.data).toHaveProperty("sales_total");
  });
});
