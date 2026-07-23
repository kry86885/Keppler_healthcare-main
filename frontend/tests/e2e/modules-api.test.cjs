const {
  ensureLoggedIn,
  uniqueSuffix,
  uniquePhone,
  registerPatient,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Module APIs", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("covers extended patient management API workflows", async () => {
    const patient = {
      first: "E2E",
      last: `ExtPatient${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 36,
    };
    const patientId = await registerPatient(patient);

    const admissions = await apiRequest(`/api/patients/${patientId}/admissions`);
    expect(admissions.status).toBe(200);
    const admissionId = admissions.data?.admissions?.[0]?.id;
    expect(admissionId).toBeTruthy();

    expect(
      (await apiRequest(`/api/patients/${patientId}/encounters`, {
        method: "POST",
        body: {
          encounter_type: "IP",
          insurance_provider: "E2E Insurance",
          insurance_policy_no: `POL-${uniqueSuffix()}`,
          is_accident: true,
          referral_source: "doctor",
          referral_name: "Dr E2E",
        },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest(`/api/patients/${patientId}/beds`, {
        method: "POST",
        body: { admission_id: admissionId, ward: "A", room_no: "101", bed_no: "1" },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest(`/api/patients/${patientId}/medications`, {
        method: "POST",
        body: { medicine_name: "Paracetamol", dosage: "500mg", schedule_time: "2026-02-18T10:00:00" },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest(`/api/patients/${patientId}/notes`, {
        method: "POST",
        body: {
          admission_id: admissionId,
          doctor_name: "Dr E2E",
          note: "Patient stable",
          treatment_plan: "Observe and hydrate",
        },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest(`/api/patients/${patientId}/movements`, {
        method: "POST",
        body: { admission_id: admissionId, from_department: "ER", to_department: "ICU" },
      })).status
    ).toBe(200);
  });

  test("covers billing, pharmacy, diagnostics, and hospital summary APIs", async () => {
    const patient = {
      first: "E2E",
      last: `OpsFinance${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 41,
    };
    const patientId = await registerPatient(patient);

    const invoice = await apiRequest("/api/billing/invoices", {
      method: "POST",
      body: {
        patient_id: patientId,
        module: "OP",
        doctor_name: "Dr E2E",
        clinic_name: "General",
        referral_source: "doctor",
        total_amount: 1500,
      },
    });
    expect(invoice.status).toBe(200);
    const invoiceId = invoice.data.invoice_id;
    expect(invoiceId).toBeTruthy();

    expect(
      (await apiRequest(`/api/billing/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: {
          amount: 1000,
          payment_mode: "upi",
          gateway_ref: `gw-${uniqueSuffix()}`,
          converted_from_mode: "cash",
          converted_to_mode: "upi",
        },
      })).status
    ).toBe(200);

    const billingSummary = await apiRequest("/api/billing/revenue-summary");
    expect(billingSummary.status).toBe(200);
    expect(Number(billingSummary.data.total_billed)).toBeGreaterThan(0);

    expect(
      (await apiRequest("/api/pharmacy/inventory", {
        method: "POST",
        body: { medicine_name: "Amoxicillin", quantity: 50, reorder_level: 10, unit_price: 20 },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest("/api/pharmacy/sales", {
        method: "POST",
        body: { invoice_id: invoiceId, medicine_name: "Amoxicillin", quantity: 3, unit_price: 20 },
      })).status
    ).toBe(200);

    const pharmacySummary = await apiRequest("/api/pharmacy/summary");
    expect(pharmacySummary.status).toBe(200);
    expect(Number(pharmacySummary.data.sales_total)).toBeGreaterThan(0);

    const vendor = await apiRequest("/api/lab/vendors", {
      method: "POST",
      body: { vendor_name: `MedLab-${uniqueSuffix()}`, phone: "5558887777" },
    });
    expect(vendor.status).toBe(200);
    const vendorId = vendor.data.vendor_id;

    expect(
      (await apiRequest("/api/lab/diagnostics", {
        method: "POST",
        body: {
          patient_id: patientId,
          vendor_id: vendorId,
          doctor_name: "Dr E2E",
          test_name: "Blood Test",
          amount: 500,
          paid_amount: 300,
        },
      })).status
    ).toBe(200);

    const hospitalSummary = await apiRequest("/api/dashboard/hospital-summary");
    expect(hospitalSummary.status).toBe(200);
    expect(hospitalSummary.data).toHaveProperty("revenue");
  });

  test("covers HRMS and audit APIs", async () => {
    const suffix = uniqueSuffix();
    const username = `e2e.hr.${suffix}`;
    const employee = await apiRequest("/api/employees", {
      method: "POST",
      body: {
        username,
        password: "secret123",
        full_name: `E2E HR ${suffix}`,
        email: `${username}@example.com`,
        phone: "5554443333",
        access_role: "hr_manager",
        job_role: "HR Manager",
        department: "HR",
        address: "QA Avenue",
        emergency_contact: "5559991111",
      },
    });
    expect(employee.status).toBe(201);
    const employeeId = employee.data.employee_id;

    expect(
      (await apiRequest("/api/hr/departments", {
        method: "POST",
        body: { department_name: `Nursing-${suffix}`, mapped_head_employee_id: employeeId },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest("/api/hr/attendance", {
        method: "POST",
        body: { employee_id: employeeId, attendance_date: "2026-02-18", status: "present", in_time: "09:00", out_time: "17:00" },
      })).status
    ).toBe(200);

    expect(
      (await apiRequest("/api/hr/payroll", {
        method: "POST",
        body: { employee_id: employeeId, payroll_month: "2026-02", basic_salary: 50000, allowances: 3000, deductions: 1000 },
      })).status
    ).toBe(200);

    const leave = await apiRequest("/api/hr/leaves", {
      method: "POST",
      body: { employee_id: employeeId, leave_type: "Sick", start_date: "2026-02-20", end_date: "2026-02-21", reason: "E2E sick leave" },
    });
    expect(leave.status).toBe(200);

    expect(
      (await apiRequest(`/api/hr/leaves/${leave.data.leave_id}/status`, {
        method: "POST",
        body: { status: "approved" },
      })).status
    ).toBe(200);

    const auditLogs = await apiRequest("/api/audit/logs?limit=50");
    expect(auditLogs.status).toBe(200);
    expect(Array.isArray(auditLogs.data.logs)).toBe(true);
  });
});
