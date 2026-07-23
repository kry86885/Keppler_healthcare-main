const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "../..");
const runId = process.env.E2E_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const artifactsRoot =
  process.env.E2E_ARTIFACTS_DIR || path.join(rootDir, "tests", "e2e", "artifacts", runId);

let shotIndex = 0;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const sanitize = (value) =>
  String(value || "unnamed-test")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function capture(label) {
  if (!global.page || global.page.isClosed()) return;
  const testName = expect.getState().currentTestName || "unknown-test";
  const safeTestName = sanitize(testName);
  const testDir = path.join(artifactsRoot, safeTestName);
  fs.mkdirSync(testDir, { recursive: true });
  shotIndex += 1;
  const fileName = `${String(shotIndex).padStart(3, "0")}_${sanitize(label)}.png`;
  try {
    await page.screenshot({ path: path.join(testDir, fileName), fullPage: true });
  } catch (_error) {
    // Artifact capture should never make the test itself fail.
  }
}

async function ensureE2EPage() {
  if (!global.browser) return null;
  if (!global.page || global.page.isClosed()) {
    global.page = await global.browser.newPage();
  }
  try {
    await global.page.setViewport(DEFAULT_VIEWPORT);
  } catch (_error) {
    // No-op: some browser states can reject viewport updates.
  }
  global.page.setDefaultTimeout(15000);
  return global.page;
}

beforeAll(async () => {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  await ensureE2EPage();
});

beforeEach(async () => {
  await ensureE2EPage();
  shotIndex = 0;
  await capture("start");
});

afterEach(async () => {
  const state = expect.getState();
  if (state.currentTestName && state.testPath) {
    await capture(state.currentTestName.includes("fails") ? "failed" : "end");
  }
});

global.captureE2E = capture;
global.E2E_ARTIFACTS_DIR = artifactsRoot;
global.ensureE2EPage = ensureE2EPage;
