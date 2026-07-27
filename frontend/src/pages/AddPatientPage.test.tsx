import { act } from "react";
import { createRoot } from "react-dom/client";
import AddPatientPage from "./AddPatientPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function mockLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddPatientPage", () => {
  test("renders patient registration form with no document/OCR elements", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/patients/next-id")) {
        return jsonResponse({ patient_id: "HSP1001" });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          setNotice={vi.fn()}
          onNavigate={vi.fn()}
        />
      );
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Patient Registration");
    expect(container.textContent).toContain("Register Patient");
    expect(container.textContent).not.toContain("Upload Documents");
    expect(container.textContent).not.toContain("Process OCR");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("pressing Enter in a text field does not submit the form", async () => {
    mockLocalStorage();
    global.fetch = vi.fn(() => jsonResponse({})) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          setNotice={vi.fn()}
          onNavigate={vi.fn()}
        />
      );
      await flush();
      await flush();
    });

    const nameInputs = Array.from(container.querySelectorAll("input")).filter((input) => input.type === "text");
    const target = nameInputs[0];
    expect(target).toBeTruthy();

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });

    expect(defaultPrevented).toBe(true);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("registering a patient also creates an appointment and navigates to the queue", async () => {
    mockLocalStorage();
    const onCreate = vi.fn(async () => ({ patient_id: "PAT-20260101-0001" }));
    const onNavigate = vi.fn();
    const fetchCalls: { url: string; method: string }[] = [];

    global.fetch = vi.fn((url: string, options?: { method?: string }) => {
      const requestUrl = String(url);
      fetchCalls.push({ url: requestUrl, method: options?.method || "GET" });
      if (requestUrl.includes("/api/patients/next-id")) {
        return jsonResponse({ patient_id: "PAT-20260101-0001" });
      }
      if (requestUrl.includes("/api/appointments") && options?.method === "POST") {
        return jsonResponse({ appointment_id: 1, token_no: 5 });
      }
      if (requestUrl.includes("/api/billing/invoices") && options?.method === "POST") {
        return jsonResponse({ invoice_id: 1, invoice_no: "INV-1" });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={onCreate}
          setNotice={vi.fn()}
          onNavigate={onNavigate}
        />
      );
      await flush();
      await flush();
    });

    const form = container.querySelector("#patient-registration-form") as HTMLFormElement;
    const requiredInputs = Array.from(form.querySelectorAll("input[required]")) as HTMLInputElement[];
    expect(requiredInputs.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      setNativeInputValue(requiredInputs[0], "Jane");
      setNativeInputValue(requiredInputs[1], "Doe");
      await flush();
    });

    const feeInput = container.querySelector('input[placeholder="Consultation amount"]') as HTMLInputElement;
    expect(feeInput).toBeTruthy();
    await act(async () => {
      setNativeInputValue(feeInput, "500");
      await flush();
    });

    const submitButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent === "Register Patient");
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
      await flush();
    });

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((call) => call.url.includes("/api/appointments") && call.method === "POST")).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/api/billing/invoices") && call.method === "POST")).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith("queue");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("consultation fee is mandatory and blocks submission when appointment scheduling is on", async () => {
    mockLocalStorage();
    const onCreate = vi.fn(async () => ({ patient_id: "PAT-20260101-0001" }));
    global.fetch = vi.fn(() => jsonResponse({ patient_id: "PAT-20260101-0001" })) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AddPatientPage onCreate={onCreate} setNotice={vi.fn()} onNavigate={vi.fn()} />);
      await flush();
      await flush();
    });

    const feeInput = container.querySelector('input[placeholder="Consultation amount"]') as HTMLInputElement;
    expect(feeInput).toBeTruthy();
    expect(feeInput.required).toBe(true);
    expect(feeInput.value).toBe("");

    const form = container.querySelector("#patient-registration-form") as HTMLFormElement;
    const requiredInputs = Array.from(form.querySelectorAll("input[required]")) as HTMLInputElement[];
    await act(async () => {
      setNativeInputValue(requiredInputs[0], "Jane");
      setNativeInputValue(requiredInputs[1], "Doe");
      await flush();
    });

    // Leave the consultation fee blank and try to submit — native required validation
    // on the shared <form> must block the whole submission, not just the appointment part.
    expect(form.checkValidity()).toBe(false);

    const submitButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent === "Register Patient");
    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
      await flush();
    });

    expect(onCreate).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
