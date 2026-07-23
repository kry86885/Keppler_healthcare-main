const path = require("path");

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const API_BASE = process.env.E2E_API_BASE || "http://localhost:5001";
const SAMPLE_READMIT_DOC = path.resolve(__dirname, "..", "fixtures", "sample-readmit.png");

const uniqueSuffix = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const uniquePhone = () => `555${uniqueSuffix().slice(-7)}`;
const xpathSelector = (expr) => `::-p-xpath(${expr})`;

function isTargetCloseError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("TargetCloseError") ||
    message.includes("Page closed!") ||
    message.includes("Session closed")
  );
}

async function getPage() {
  if (typeof global.ensureE2EPage === "function") {
    const activePage = await global.ensureE2EPage();
    if (activePage) return activePage;
  }
  if (!global.page || global.page.isClosed()) {
    throw new Error("No active Puppeteer page. Ensure jest-puppeteer setup is running.");
  }
  return global.page;
}

async function withPageRetry(operation, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const currentPage = await getPage();
      return await operation(currentPage);
    } catch (error) {
      lastError = error;
      if (!isTargetCloseError(error) || attempt === attempts) {
        throw error;
      }
      // Recreate the page and retry once when browser closed the target unexpectedly.
      if (typeof global.ensureE2EPage === "function") {
        await global.ensureE2EPage();
      }
    }
  }
  throw lastError;
}

async function waitForText(text) {
  await withPageRetry((currentPage) =>
    currentPage.waitForFunction(
      (targetText) => (document.body?.innerText || "").includes(targetText),
      { timeout: 20000 },
      text
    )
  );
}

async function clickByText(text) {
  const clicked = await withPageRetry((currentPage) =>
    currentPage.evaluate((targetText) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const exact = buttons.find(
        (button) => !button.disabled && button.textContent && button.textContent.trim() === targetText
      );
      const fallback = buttons.find(
        (button) => !button.disabled && button.textContent && button.textContent.includes(targetText)
      );
      const target = exact || fallback;
      if (!target) return false;
      target.click();
      return true;
    }, text)
  );

  if (!clicked) throw new Error(`Button with text "${text}" not found`);
}

async function waitForTableRowWithText(text, timeout = 20000) {
  await withPageRetry((currentPage) =>
    currentPage.waitForFunction(
      (targetText) =>
        Array.from(document.querySelectorAll(".table-row")).some((row) =>
          (row.textContent || "").replace(/\s+/g, " ").includes(targetText)
        ),
      { timeout },
      text
    )
  );
}

async function clickTableRowAction(rowText, actionLabels) {
  const labels = Array.isArray(actionLabels) ? actionLabels : [actionLabels];
  const clicked = await withPageRetry((currentPage) =>
    currentPage.evaluate(
      ({ targetRowText, targetLabels }) => {
        const rows = Array.from(document.querySelectorAll(".table-row"));
        const row = rows.find((item) => (item.textContent || "").replace(/\s+/g, " ").includes(targetRowText));
        if (!row) return false;
        const buttons = Array.from(row.querySelectorAll("button"));
        const byExact = targetLabels
          .map((label) => buttons.find((button) => !button.disabled && (button.textContent || "").trim() === label))
          .find(Boolean);
        const byContains = targetLabels
          .map((label) => buttons.find((button) => !button.disabled && (button.textContent || "").includes(label)))
          .find(Boolean);
        const target = byExact || byContains;
        if (!target) return false;
        target.click();
        return true;
      },
      { targetRowText: rowText, targetLabels: labels }
    )
  );

  if (!clicked) {
    throw new Error(`Row action not found. row="${rowText}", actions="${labels.join(", ")}"`);
  }
}

async function ensureTableRowExpanded(rowText, expandLabel = "View", collapseLabel = "Hide") {
  const expanded = await withPageRetry((currentPage) =>
    currentPage.evaluate(
      ({ targetRowText, openText, closeText }) => {
        const rows = Array.from(document.querySelectorAll(".table-row"));
        const row = rows.find((item) => (item.textContent || "").replace(/\s+/g, " ").includes(targetRowText));
        if (!row) return { ok: false, reason: "row_not_found" };
        const buttons = Array.from(row.querySelectorAll("button"));
        const openButton = buttons.find((button) => !button.disabled && (button.textContent || "").trim() === openText);
        if (openButton) {
          openButton.click();
          return { ok: true, clicked: true };
        }
        const closeButton = buttons.find((button) => !button.disabled && (button.textContent || "").trim() === closeText);
        if (closeButton) {
          return { ok: true, clicked: false };
        }
        return { ok: false, reason: "action_not_found" };
      },
      { targetRowText: rowText, openText: expandLabel, closeText: collapseLabel }
    )
  );

  if (!expanded?.ok) {
    throw new Error(`Unable to expand row "${rowText}": ${expanded?.reason || "unknown"}`);
  }
}

async function fillControlByLabel(labelText, value, scopeSelector) {
  const result = await withPageRetry(async (currentPage) => {
    await currentPage.waitForFunction(
      ({ text, scope }) =>
        Array.from(document.querySelectorAll(scope || "label")).some(
          (label) => (label.textContent || "").replace(/\s+/g, " ").includes(text)
        ),
      { timeout: 30000 },
      { text: labelText, scope: scopeSelector ? `${scopeSelector} label` : "label" }
    );
    return currentPage.evaluate(
      ({ text, nextValue, scope }) => {
        const labels = Array.from(document.querySelectorAll(scope || "label"));
        const label = labels.find((item) => (item.textContent || "").replace(/\s+/g, " ").includes(text));
        if (!label) return { ok: false, reason: "label_not_found" };
        const control = label.querySelector("input, textarea, select");
        if (!control) return { ok: false, reason: "control_not_found" };

        const tag = control.tagName.toUpperCase();
        if (tag === "SELECT") {
          control.value = String(nextValue);
          control.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }

        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          control.checked = !!nextValue;
          control.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }

        control.focus();
        const textProto =
          control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : control instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : null;
        const valueSetter = textProto ? Object.getOwnPropertyDescriptor(textProto, "value")?.set : null;
        if (valueSetter) {
          valueSetter.call(control, String(nextValue));
        } else if ("value" in control) {
          control.value = String(nextValue);
        }
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      },
      { text: labelText, nextValue: value, scope: scopeSelector ? `${scopeSelector} label` : "label" }
    );
  });

  if (!result?.ok) {
    throw new Error(`Unable to fill label "${labelText}": ${result?.reason || "unknown"}`);
  }
}

async function ensureLoggedIn() {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  try {
    await currentPage.goto(BASE_URL, { waitUntil: "networkidle2" });
  } catch (error) {
    throw new Error(
      `Unable to reach frontend at ${BASE_URL}. Start frontend dev server first (example: npm run dev -- --host 0.0.0.0 --port 5173). Original error: ${error.message}`
    );
  }
  const initialText = await currentPage.evaluate(() => (document.body?.innerText || "").slice(0, 5000));
  const looksLikeHospAI = initialText.includes("Welcome back") || initialText.includes("Dashboard");
  if (!looksLikeHospAI) {
    throw new Error(
      `E2E target at ${BASE_URL} does not look like HospAI UI. Ensure frontend for this repo is running on that URL.`
    );
  }
  if (global.captureE2E) await global.captureE2E("landing");

  const logout = await currentPage.$(xpathSelector(`//button[contains(normalize-space(.), "Log out")]`));
  if (logout) {
    if (global.captureE2E) await global.captureE2E("already-logged-in");
    return;
  }

  await fillControlByLabel("Username", "employee");
  await fillControlByLabel("Password", "employee123");
  if (global.captureE2E) await global.captureE2E("credentials-entered");

  await clickByText("Login");
  await waitForText("Dashboard");
  if (global.captureE2E) await global.captureE2E("post-login-dashboard");
}

async function navigateTo(label) {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  await clickByText(label);
  await currentPage.waitForFunction(
    (value) => {
      const heading = document.querySelector(".topbar h2");
      return !!heading && heading.textContent && heading.textContent.trim().includes(value);
    },
    { timeout: 20000 },
    label
  );
  if (global.captureE2E) await global.captureE2E(`nav-${label}`);
}

async function registerPatient(patient) {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navigateTo("Add Patient");
    await waitForText("Patient Registration");
    await fillControlByLabel("First Name", patient.first);
    await fillControlByLabel("Last Name", patient.last);
    await fillControlByLabel("Phone", patient.phone);
    await fillControlByLabel("Age", patient.age.toString());

    const createResponsePromise = currentPage.waitForResponse((response) => {
      const request = response.request();
      return (
        request.url().includes("/api/patients") &&
        request.method() === "POST" &&
        !request.url().includes("/admissions") &&
        !request.url().includes("/documents")
      );
    }, { timeout: 20000 });
    const submitted = await currentPage.evaluate(() => {
      const form =
        document.querySelector("#patient-registration-form") ||
        document.querySelector("form.patient-grid-form") ||
        document.querySelector("form.grid-form");
      if (!form) return false;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return true;
      }
      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        submitButton.click();
        return true;
      }
      return false;
    });
    if (!submitted) {
      // Fallback for layouts where the submit button sits outside form and uses form="<id>".
      await clickByText("Register Patient");
    }

    const noticePromise = currentPage
      .waitForFunction(
        () => {
          const notice = document.querySelector(".notice");
          if (!notice) return false;
          const text = (notice.textContent || "").trim().toLowerCase();
          return (
            text.includes("patient") ||
            text.includes("duplicate") ||
            text.includes("failed") ||
            text.includes("unable") ||
            text.includes("forbidden")
          );
        },
        { timeout: 20000 }
      )
      .then(() => "notice")
      .catch(() => "timeout");

    const responseOrNotice = await Promise.race([
      createResponsePromise.then(() => "response").catch(() => "no-response"),
      noticePromise,
    ]);

    let createResponse;
    try {
      if (responseOrNotice === "response") {
        createResponse = await createResponsePromise;
      }
    } catch (error) {
      // no-op: fallback handling below will produce debug
    }

    if (createResponse) {
      const payload = await createResponse.json().catch(() => ({}));
      if (createResponse.status() === 200 && payload?.patient_id) return payload.patient_id;
      if (createResponse.status() === 409) {
        patient.phone = uniquePhone();
        continue;
      }
      throw new Error(`Patient registration failed [${createResponse.status()}]: ${JSON.stringify(payload)}`);
    }

    // Fallback path: if UI rendered a success message, verify patient exists and continue.
    const patientCheck = await apiRequest(`/api/patients?q=${encodeURIComponent(patient.last)}`);
    if (patientCheck.status === 200 && Array.isArray(patientCheck.data?.patients)) {
      const match = patientCheck.data.patients.find((p) => (p.last_name || "").includes(patient.last));
      if (match?.patient_id) return match.patient_id;
    }

    const formDebug = await currentPage.$eval("form.grid-form", (form) => {
      const controls = Array.from(form.querySelectorAll("input, textarea, select")).map((el) => ({
        name: el.name || "",
        type: el.type || el.tagName,
        required: !!el.required,
        value: "value" in el ? el.value : "",
        valid: typeof el.checkValidity === "function" ? el.checkValidity() : true,
        message: el.validationMessage || "",
      }));
      const notice = document.querySelector(".notice");
      return {
        formValid: form.checkValidity(),
        controls,
        notice: notice ? notice.textContent.trim() : "",
      };
    });
    throw new Error(`No patient create response. Debug: ${JSON.stringify(formDebug)}`);
  }
  throw new Error("Patient registration failed after retries due duplicate conflicts.");
}

async function searchPatient(term) {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  await navigateTo("Patients");
  const searchInput = await currentPage.waitForSelector('input[placeholder="Search by name, phone, or ID"]');
  await searchInput.click({ clickCount: 3 });
  await searchInput.type(term);
  await clickByText("Search");
}

async function searchReadmitPatient(term) {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  await navigateTo("Re-admit");
  const searchInput = await currentPage.waitForSelector('input[placeholder="Search by name, phone, or DOB"]');
  await searchInput.click({ clickCount: 3 });
  await searchInput.type(term);
  await waitForText(term);
}

async function apiRequest(endpoint, options = {}) {
  const currentPage = await withPageRetry((p) => Promise.resolve(p));
  return currentPage.evaluate(
    async ({ base, target, requestOptions }) => {
      const response = await fetch(`${base}${target}`, {
        method: requestOptions.method || "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(requestOptions.headers || {}),
        },
        body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
      });
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_error) {
        data = { raw };
      }
      return { status: response.status, data };
    },
    { base: API_BASE, target: endpoint, requestOptions: options }
  );
}

module.exports = {
  SAMPLE_READMIT_DOC,
  uniqueSuffix,
  uniquePhone,
  xpathSelector,
  waitForText,
  clickByText,
  waitForTableRowWithText,
  clickTableRowAction,
  ensureTableRowExpanded,
  fillControlByLabel,
  ensureLoggedIn,
  navigateTo,
  registerPatient,
  searchPatient,
  searchReadmitPatient,
  apiRequest,
  getPage,
  withPageRetry,
};
