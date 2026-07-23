const {
  ensureLoggedIn,
  uniqueSuffix,
  uniquePhone,
  SAMPLE_READMIT_DOC,
  registerPatient,
  searchReadmitPatient,
  waitForText,
  fillControlByLabel,
  clickByText,
  waitForTableRowWithText,
  clickTableRowAction,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Readmit & Docs", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("re-admits a patient", async () => {
    const patient = {
      first: "E2E",
      last: `Readmit${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 38,
    };
    await registerPatient(patient);

    await searchReadmitPatient(patient.last);
    await waitForTableRowWithText(patient.last);
    await clickTableRowAction(patient.last, "Readmit");
    await waitForText("Re-admitting:");

    await fillControlByLabel("Admission Notes", "E2E re-admit notes", ".readmit-form");
    await fillControlByLabel("Current Symptoms", "E2E symptoms", ".readmit-form");
    await clickByText("Confirm Re-admission");
    await waitForText("Re-admitted");
  });

  test("re-admits and updates changing patient details", async () => {
    const patient = {
      first: "E2E",
      last: `ReadmitUpdate${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 40,
    };
    const patientId = await registerPatient(patient);
    const admissionsBefore = await apiRequest(`/api/patients/${patientId}/admissions`);
    expect(admissionsBefore.status).toBe(200);
    const beforeCount = Array.isArray(admissionsBefore.data?.admissions) ? admissionsBefore.data.admissions.length : 0;

    await searchReadmitPatient(patient.last);
    await waitForTableRowWithText(patient.last);
    const patientDetailResponse = page
      .waitForResponse(
        (response) => response.request().method() === "GET" && response.url().includes(`/api/patients/${patientId}`),
        { timeout: 20000 }
      )
      .catch(() => null);
    await clickTableRowAction(patient.last, "Readmit");
    await waitForText("Re-admitting:");
    await patientDetailResponse;

    await fillControlByLabel("Weight (kg)", "82", ".readmit-form");
    await fillControlByLabel("Height (cm)", "176", ".readmit-form");
    await fillControlByLabel("Current Symptoms", "Updated re-admit symptoms", ".readmit-form");
    await fillControlByLabel("Allergies", "Peanuts", ".readmit-form");
    await page.evaluate(() => {
      const set = (labelText, value) => {
        const labels = Array.from(document.querySelectorAll(".readmit-form label"));
        const label = labels.find((item) => (item.textContent || "").replace(/\s+/g, " ").includes(labelText));
        if (!label) return;
        const control = label.querySelector("input, textarea, select");
        if (!control) return;
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("Weight (kg)", "82");
      set("Height (cm)", "176");
      set("Allergies", "Peanuts");
      set("Current Symptoms", "Updated re-admit symptoms");
    });
    await clickByText("Confirm Re-admission");
    await waitForText("Re-admitted");

    const admissionsAfter = await apiRequest(`/api/patients/${patientId}/admissions`);
    expect(admissionsAfter.status).toBe(200);
    const afterCount = Array.isArray(admissionsAfter.data?.admissions) ? admissionsAfter.data.admissions.length : 0;
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test("uploads readmission document and shows in patient documents", async () => {
    const patient = {
      first: "E2E",
      last: `ReadmitDoc${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 42,
    };
    const patientId = await registerPatient(patient);

    await searchReadmitPatient(patient.last);
    await waitForTableRowWithText(patient.last);
    await clickTableRowAction(patient.last, "Readmit");
    await waitForText("Re-admitting:");
    await fillControlByLabel("Admission Notes", "Readmit with document upload", ".readmit-form");

    const readmitFileInput = await page.waitForSelector(".readmit-form input[type='file']");
    await readmitFileInput.uploadFile(SAMPLE_READMIT_DOC);
    await clickByText("Confirm Re-admission");
    await waitForText("Uploaded 1 document");

    let documents = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const verifyDocs = await apiRequest(`/api/patients/${patientId}/documents`);
      expect(verifyDocs.status).toBe(200);
      documents = verifyDocs.data?.documents || [];
      if (documents.some((item) => item.doc_type === "test_docs")) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    expect(documents.some((item) => item.doc_type === "test_docs")).toBe(true);
  });
});
