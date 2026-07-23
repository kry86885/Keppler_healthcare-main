const { ensureLoggedIn, navigateTo, waitForText } = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Finance And Operations UI", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("shows billing workflow panels", async () => {
    await navigateTo("Billing");
    await waitForText("Create Invoice");
    await waitForText("Record Payment");
    await waitForText("Insurance Claims");
    await waitForText("Receivable Aging");

    await page.waitForFunction(
      () =>
        !!document.querySelector('input[aria-label="Billing total amount"]') &&
        !!document.querySelector('select[aria-label="Billing payment invoice"]'),
      { timeout: 20000 }
    );
  });

  test("shows OT workflow panels", async () => {
    await navigateTo("OT");
    await waitForText("OT Utilization");
    await waitForText("Manage Theatres");
    await waitForText("Schedule Surgery");
    await waitForText("Scheduled Surgeries");

    await page.waitForFunction(
      () =>
        !!document.querySelector('input[aria-label="OT theatre code"]') &&
        !!document.querySelector('input[aria-label="OT procedure"]'),
      { timeout: 20000 }
    );
  });

  test("shows accounts workflow panels", async () => {
    await navigateTo("Accounts");
    await waitForText("General Ledger");
    await waitForText("Vendor Payments");
    await waitForText("Doctor Payouts");

    await page.waitForFunction(
      () =>
        !!document.querySelector('input[aria-label="Ledger amount"]') &&
        !!document.querySelector('input[aria-label="Vendor payment amount"]') &&
        !!document.querySelector('input[aria-label="Doctor payout amount"]'),
      { timeout: 20000 }
    );
  });
});
