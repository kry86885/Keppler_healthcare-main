import { act } from "react";
import { createRoot } from "react-dom/client";
import RegistrationDeskPage from "./RegistrationDeskPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("RegistrationDeskPage", () => {
  test("renders appointment in desk with department dropdown and doctor autocomplete", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/appointments")) {
        return jsonResponse({
          appointments: [
            {
              id: 1,
              token_no: 7,
              patient_name: "Ravi Kumar",
              visit_type: "OP",
              department: "Cardiology",
              doctor_name: "Dr. Mehta",
              appointment_date: "2026-03-09T09:30:00",
              status: "scheduled",
            },
          ],
        });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [{ id: 1, department_name: "Cardiology" }] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [{ id: 1, doctor_name: "Dr. Mehta" }] });
      }
      if (requestUrl.includes("/api/registration/consents")) {
        return jsonResponse({ consents: [] });
      }
      if (requestUrl.includes("/api/registration/insurance")) {
        return jsonResponse({ verifications: [] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RegistrationDeskPage mode="appointment-in" selectedPatient={null} setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Appointment In Desk");
    expect(container.textContent).toContain("Department Master");
    expect(container.textContent).toContain("Schedule & Assign Token");
    expect(container.textContent).toContain("Token #7");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("renders appointment out desk with completion actions", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/appointments")) {
        return jsonResponse({
          appointments: [
            {
              id: 2,
              token_no: 8,
              patient_name: "Sita Rai",
              visit_type: "OP",
              department: "Neurology",
              doctor_name: "Dr. Sharma",
              appointment_date: "2026-03-09T11:00:00",
              status: "checked_in",
            },
          ],
        });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [{ id: 2, department_name: "Neurology" }] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [{ id: 2, doctor_name: "Dr. Sharma" }] });
      }
      if (requestUrl.includes("/api/registration/consents")) {
        return jsonResponse({ consents: [] });
      }
      if (requestUrl.includes("/api/registration/insurance")) {
        return jsonResponse({ verifications: [] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RegistrationDeskPage mode="appointment-out" selectedPatient={null} setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Appointment Out Desk");
    expect(container.textContent).toContain("Token #8");
    expect(container.textContent).toContain("Complete");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("editing an existing consent record populates the form and issues a PUT", async () => {
    const fetchMock = vi.fn((url: string, options?: { method?: string; body?: string }) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/appointments")) {
        return jsonResponse({ appointments: [] });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [] });
      }
      if (requestUrl.match(/\/api\/registration\/consents\/\d+$/) && options?.method === "PUT") {
        return jsonResponse({ status: "ok" });
      }
      if (requestUrl.includes("/api/registration/consents")) {
        return jsonResponse({
          consents: [
            { id: 5, patient_name: "Ravi Kumar", consent_type: "general", signed_by: "Ravi Kumar", relation_to_patient: "self" },
          ],
        });
      }
      if (requestUrl.includes("/api/registration/insurance")) {
        return jsonResponse({ verifications: [] });
      }
      return jsonResponse({});
    }) as any;
    global.fetch = fetchMock;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RegistrationDeskPage mode="consent" selectedPatient={null} setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Ravi Kumar · general · Ravi Kumar");

    const editButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent === "Edit");
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const signedByInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "Patient / Guardian"
    ) as HTMLInputElement;
    expect(signedByInput.value).toBe("Ravi Kumar");

    const saveButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent === "Update Consent");
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      await flush();
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, options]: [string, { method?: string }]) => String(url).includes("/api/registration/consents/5") && options?.method === "PUT"
    );
    expect(putCall).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
