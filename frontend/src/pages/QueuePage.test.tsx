import { act } from "react";
import { createRoot } from "react-dom/client";
import QueuePage from "./QueuePage";

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

const FIXTURE_APPOINTMENTS = [
  {
    id: 1,
    patient_name: "Alice",
    visit_type: "OP",
    department: "Cardiology",
    doctor_name: "Dr. Rao",
    appointment_date: "2026-07-26T09:00:00",
    token_no: 1,
    status: "scheduled",
  },
  {
    id: 2,
    patient_name: "Bob",
    visit_type: "OP",
    department: "Orthopedics",
    doctor_name: "Dr. Iyer",
    appointment_date: "2026-07-26T09:30:00",
    token_no: 2,
    status: "checked_in",
  },
];

describe("QueuePage", () => {
  test("derives filter options from loaded appointments and updates status on check-in", async () => {
    mockLocalStorage();
    const putCalls: { url: string; body: string }[] = [];
    global.fetch = vi.fn(
      (url: string, options?: { method?: string; body?: string }) => {
        const requestUrl = String(url);
        if (options?.method === "PUT") {
          putCalls.push({ url: requestUrl, body: options.body || "" });
          return jsonResponse({ status: "ok" });
        }
        if (requestUrl.includes("/api/appointments")) {
          return jsonResponse({ appointments: FIXTURE_APPOINTMENTS });
        }
        return jsonResponse({});
      },
    ) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<QueuePage setNotice={vi.fn()} />);
      await flush();
      await flush();
    });

    const doctorSelect = container.querySelector(
      "#queue-filter-doctor",
    ) as HTMLSelectElement;
    const doctorOptionValues = Array.from(
      doctorSelect.querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(doctorOptionValues).toEqual(["All Doctors", "Dr. Iyer", "Dr. Rao"]);

    const departmentSelect = container.querySelector(
      "#queue-filter-department",
    ) as HTMLSelectElement;
    const departmentOptionValues = Array.from(
      departmentSelect.querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(departmentOptionValues).toEqual([
      "All Departments",
      "Cardiology",
      "Orthopedics",
    ]);

    const checkInButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Check In",
    );
    expect(checkInButton).toBeTruthy();

    await act(async () => {
      checkInButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      await flush();
    });

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].url).toContain("/api/appointments/1");
    expect(JSON.parse(putCalls[0].body)).toEqual({ status: "checked_in" });

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
