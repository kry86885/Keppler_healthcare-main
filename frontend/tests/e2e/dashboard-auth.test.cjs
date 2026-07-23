const { ensureLoggedIn, waitForText } = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Dashboard", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("loads dashboard and stats cards", async () => {
    await waitForText("Dashboard");
    await page.waitForFunction(() => document.querySelectorAll(".stat-card").length > 0, { timeout: 20000 });
    const cards = await page.$$(".stat-card");
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });
});
