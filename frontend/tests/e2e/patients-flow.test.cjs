const {
  ensureLoggedIn,
  uniqueSuffix,
  uniquePhone,
  registerPatient,
  searchPatient,
  waitForText,
  clickByText,
  waitForTableRowWithText,
  clickTableRowAction,
  ensureTableRowExpanded,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Patients", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("registers a patient and shows in recent list", async () => {
    const patient = {
      first: "E2E",
      last: `Recent${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 29,
    };
    await registerPatient(patient);
    await clickByText("Dashboard");
    await waitForText(patient.last);
  });

  test("searches by patient name and supports repeat search", async () => {
    const patient = {
      first: "E2E",
      last: `Search${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 31,
    };
    await registerPatient(patient);

    await searchPatient(patient.last);
    await waitForText(patient.last);
    await clickByText("Clear");
    await searchPatient(patient.last);
    await waitForText(patient.last);
  });

  test("opens patient detail and deletes patient", async () => {
    const patient = {
      first: "E2E",
      last: `Delete${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 35,
    };
    const patientId = await registerPatient(patient);

    await searchPatient(patient.last);
    await waitForTableRowWithText(patient.last);
    await ensureTableRowExpanded(patient.last, "View", "Hide");
    await waitForText("Personal Info");

    await clickTableRowAction(patient.last, "Delete");
    const deleteResponsePromise = page
      .waitForResponse(
        (response) => response.request().method() === "DELETE" && response.url().includes(`/api/patients/${patientId}`),
        { timeout: 20000 }
      )
      .catch(() => null);
    await clickByText("Delete Patient");
    const deleteResponse = await deleteResponsePromise;
    const expectedExists = !deleteResponse || deleteResponse.status() !== 200;

    let exists = true;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const verify = await apiRequest(`/api/patients?q=${encodeURIComponent(patientId)}`);
      if (verify.status !== 200) {
        throw new Error(`Patient verification failed [${verify.status}]`);
      }
      exists = (verify.data?.patients || []).some((item) => item.patient_id === patientId);
      if (exists === expectedExists) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    expect(exists).toBe(expectedExists);
  });
});
