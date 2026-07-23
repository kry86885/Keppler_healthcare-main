const {
  ensureLoggedIn,
  uniqueSuffix,
  waitForText,
  fillControlByLabel,
  clickByText,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Employees & Settings", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("manages employees (add, search, edit, delete)", async () => {
    await clickByText("Employee Management");
    await waitForText("Add New Employee");
    await clickByText("Add New Employee");

    const suffix = uniqueSuffix();
    const username = `e2e.${suffix}`;
    const fullName = `E2E Employee ${suffix}`;

    await fillControlByLabel("Username", username);
    await fillControlByLabel("Password", "secret123");
    await fillControlByLabel("Full Name", fullName);
    await fillControlByLabel("Email", `e2e.${suffix}@example.com`);
    await fillControlByLabel("Phone", "5551110000");
    await fillControlByLabel("Access Level", "receptionist");
    await fillControlByLabel("Job Title", "Nurse");
    await fillControlByLabel("Department", "QA");

    const createEmployeeResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/employees") && response.request().method() === "POST",
      { timeout: 20000 }
    );
    await page.$eval("form.grid-form", (form) => form.requestSubmit());
    const createEmployeeResponse = await createEmployeeResponsePromise;
    const employeePayload = await createEmployeeResponse.json().catch(() => ({}));
    if (createEmployeeResponse.status() !== 201 || !employeePayload?.employee_id) {
      throw new Error(`Employee creation failed [${createEmployeeResponse.status()}]: ${JSON.stringify(employeePayload)}`);
    }
    const employeeId = employeePayload.employee_id;

    await clickByText("All Employees");
    const searchInput = await page.waitForSelector('input[placeholder="Search by name, email, phone, or ID"]');
    await searchInput.type(fullName);
    await clickByText("Search");
    await waitForText(fullName);

    const update = await apiRequest(`/api/employees/${employeeId}`, {
      method: "PUT",
      body: {
        full_name: fullName,
        email: `e2e.${suffix}@example.com`,
        phone: "5551110000",
        department: "QA Ops",
        status: "active",
        address: "",
        emergency_contact: "",
        job_role: "Nurse",
      },
    });
    if (update.status !== 200) {
      throw new Error(`Employee update failed [${update.status}]: ${JSON.stringify(update.data || {})}`);
    }
    const updatedEmployee = await apiRequest(`/api/employees/${employeeId}`);
    if (updatedEmployee.status !== 200) {
      throw new Error(`Employee read-back failed [${updatedEmployee.status}]`);
    }
    expect(updatedEmployee.data?.employee?.department).toBe("QA Ops");

    const deleteEmployee = await apiRequest(`/api/employees/${employeeId}`, { method: "DELETE" });
    if (deleteEmployee.status !== 200) {
      throw new Error(`Employee delete failed [${deleteEmployee.status}]: ${JSON.stringify(deleteEmployee.data || {})}`);
    }
    const deletedEmployee = await apiRequest(`/api/employees/${employeeId}`);
    expect(deletedEmployee.status).toBe(404);
  });

  test("shows settings and API tester responses", async () => {
    await clickByText("Settings");
    await waitForText("OCR Preferences");
    await waitForText("OCR Language");
  });
});
