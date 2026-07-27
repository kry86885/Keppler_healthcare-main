import { act } from "react";
import { createRoot } from "react-dom/client";
import LabPage from "./LabPage";

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

describe("LabPage", () => {
  test("renders vendor and diagnostic creation forms", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/lab/summary")) {
        return jsonResponse({ total_amount: 0, total_paid: 0, total_due: 0 });
      }
      if (requestUrl.includes("/api/lab/diagnostics")) {
        return jsonResponse({
          diagnostics: [
            {
              id: 1,
              test_name: "Blood Test",
              order_status: "sample_collected",
              sample_barcode: "SMP-1",
              doctor_name: "Dr. Prime",
              amount: 500,
            },
          ],
        });
      }
      if (requestUrl.includes("/api/lab/vendors")) {
        return jsonResponse({ vendors: [{ id: 11, vendor_name: "Prime Labs", status: "active" }] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LabPage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Add Lab Vendor");
    expect(container.textContent).toContain("Create Diagnostic Entry");
    expect(container.textContent).toContain("Doctor-wise Income");
    expect(container.textContent).toContain("Blood Test");
    expect(container.textContent).toContain("Apply");
    expect(container.querySelector('input[aria-label="Lab vendor name"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Lab diagnostic test"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Lab sample barcode"]')).toBeTruthy();
    expect(container.querySelector('select[aria-label="Lab order status"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Lab diagnostic patient id"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("selecting a patient from the autocomplete auto-fills the doctor field", async () => {
    vi.useFakeTimers();
    mockLocalStorage();
    const patient = { patient_id: "PAT-20260101-0001", name: "Alice", last_name: "Smith", age: 30, gender: "Female" };

    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/lab/summary")) {
        return jsonResponse({ total_amount: 0, total_paid: 0, total_due: 0 });
      }
      if (requestUrl.includes("/api/lab/diagnostics")) {
        return jsonResponse({ diagnostics: [] });
      }
      if (requestUrl.includes("/api/lab/vendors")) {
        return jsonResponse({ vendors: [] });
      }
      if (requestUrl.includes("/api/patients?q=")) {
        return jsonResponse({ patients: [patient] });
      }
      if (requestUrl.includes("/api/appointments?patient_id=")) {
        return jsonResponse({ appointments: [{ id: 1, patient_name: "Alice Smith", doctor_name: "Dr. Rao", visit_type: "OP", appointment_date: "2026-01-01T09:00:00", token_no: 1, status: "scheduled" }] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LabPage setNotice={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = container.querySelector('input[aria-label="Lab diagnostic patient id"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

    act(() => {
      nativeInputValueSetter.call(input, "alice");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      root.render(<LabPage setNotice={vi.fn()} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.useRealTimers();

    const suggestion = Array.from(container.querySelectorAll(".patient-autocomplete-option")).find((el) =>
      el.textContent?.includes("Alice Smith")
    );
    expect(suggestion).toBeTruthy();

    await act(async () => {
      suggestion?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const doctorInput = container.querySelector('input[aria-label="Lab diagnostic doctor"]') as HTMLInputElement;
    expect(doctorInput.value).toBe("Dr. Rao");
    expect(container.textContent).toContain("Confirmed: Alice Smith");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
