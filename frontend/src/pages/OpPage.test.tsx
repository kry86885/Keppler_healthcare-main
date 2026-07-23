import { act } from "react";
import { createRoot } from "react-dom/client";
import OpPage from "./OpPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("OpPage", () => {
  test("renders OP desk scheduling and queue controls", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/op/summary")) {
        return jsonResponse({
          total_appointments: 4,
          follow_ups: 1,
          active_queue: 2,
          no_shows: 1,
          reminders_sent: 3,
          available_doctors: 2,
        });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({
          schedules: [
            {
              id: 1,
              doctor_name: "Dr. Mehta",
              department: "Cardiology",
              schedule_date: "2026-03-04",
              start_time: "09:00",
              end_time: "13:00",
              slot_capacity: 8,
              status: "available",
            },
          ],
        });
      }
      if (requestUrl.includes("/api/appointments")) {
        return jsonResponse({
          appointments: [
            {
              id: 11,
              patient_name: "Ravi Kumar",
              visit_type: "OP",
              department: "Cardiology",
              doctor_name: "Dr. Mehta",
              appointment_date: "2026-03-04 09:30:00",
              status: "scheduled",
              token_no: 3,
              appointment_kind: "follow_up",
              reminder_sent_at: "2026-03-04T08:00:00",
              no_show_marked: 0,
            },
          ],
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<OpPage setNotice={vi.fn()} canEdit={true} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("OP Desk");
    expect(container.textContent).toContain("Doctor Schedule");
    expect(container.textContent).toContain("Schedule OP Visit");
    expect(container.textContent).toContain("Reminders Sent");
    expect(container.querySelector('input[aria-label="Doctor name"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="OP patient name"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
