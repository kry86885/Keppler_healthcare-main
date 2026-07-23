const { ensureLoggedIn, navigateTo, waitForText } = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Module Workspace UI", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("shows registration desk controls inside Add Patient", async () => {
    await navigateTo("Add Patient");
    await waitForText("Patient Registration");
    await waitForText("Registration Desk");
    await waitForText("Schedule Appointment");
    await waitForText("Digital Consent");
    await waitForText("Insurance Verification");

    await page.waitForFunction(
      () =>
        !!document.querySelector("#patient-registration-form") &&
        Array.from(document.querySelectorAll("label")).some((label) =>
          (label.textContent || "").includes("First Name")
        ),
      { timeout: 20000 }
    );
  });

  test("shows pharmacy workflow panels", async () => {
    await navigateTo("Pharmacy");
    await waitForText("Add Medicine to Inventory");
    await waitForText("Record Pharmacy Sale");
    await waitForText("Suppliers");
    await waitForText("Procurement");
    await waitForText("Inventory Snapshot");

    await page.waitForFunction(
      () =>
        !!document.querySelector('input[aria-label="Medicine name"]') &&
        !!document.querySelector('input[aria-label="Supplier name"]') &&
        !!document.querySelector('select[aria-label="Purchase supplier"]'),
      { timeout: 20000 }
    );
  });

  test("shows diagnostics workflow panels", async () => {
    await navigateTo("Lab & Diagnostics");
    await waitForText("Add Lab Vendor");
    await waitForText("Create Diagnostic Entry");
    await waitForText("Doctor-wise Income");
    await waitForText("Invoice-wise Diagnostics");

    await page.waitForFunction(
      () =>
        !!document.querySelector('input[aria-label="Lab vendor name"]') &&
        !!document.querySelector('input[aria-label="Lab diagnostic test"]') &&
        !!document.querySelector('input[aria-label="Lab sample barcode"]'),
      { timeout: 20000 }
    );
  });
});
