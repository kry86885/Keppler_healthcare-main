import { act } from "react";
import { createRoot } from "react-dom/client";
import PatientJourneyPage from "./PatientJourneyPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

const FIXTURE_PATIENT = { patient_id: "PAT-20260101-0001", name: "Alice", last_name: "Smith", age: 30, gender: "Female" };

describe("PatientJourneyPage", () => {
  test("searching, selecting a patient, and loading the journey renders events in order", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/patients?q=")) {
        return jsonResponse({ patients: [FIXTURE_PATIENT] });
      }
      if (requestUrl.includes("/journey")) {
        return jsonResponse({
          patient: FIXTURE_PATIENT,
          events: [
            { stage: "registration", label: "Patient Registered", timestamp: "2026-01-01T08:00:00" },
            { stage: "queue", label: "Appointment scheduled (OP, token #1)", timestamp: "2026-01-01T09:00:00" },
            { stage: "lab", label: "Lab order: CBC (ordered) — 500", timestamp: "2026-01-01T10:00:00" },
          ],
          summary: {
            consultation_billed: 750,
            consultation_paid: 750,
            lab_billed: 500,
            lab_paid: 0,
            total_billed: 1250,
            total_paid: 750,
            total_due: 500,
          },
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<PatientJourneyPage setNotice={vi.fn()} />);
    });

    const input = container.querySelector('input[aria-label="Patient journey search"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

    act(() => {
      nativeInputValueSetter.call(input, "alice");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      root.render(<PatientJourneyPage setNotice={vi.fn()} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.useRealTimers();

    expect(container.textContent).toContain("Alice Smith");

    const suggestion = Array.from(container.querySelectorAll(".patient-autocomplete-option")).find((el) =>
      el.textContent?.includes("Alice Smith")
    );
    expect(suggestion).toBeTruthy();

    await act(async () => {
      suggestion?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Timeline");
    const cardTitles = Array.from(container.querySelectorAll(".module-mobile-card h4")).map((el) => el.textContent);
    expect(cardTitles).toEqual(["Registration", "Queue", "Lab"]);

    expect(container.textContent).toContain("Consultation Fees");
    expect(container.textContent).toContain("Lab / Diagnostics Fees");
    expect(container.textContent).toContain("Total Paid");
    expect(container.textContent).toContain("Total Due");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
