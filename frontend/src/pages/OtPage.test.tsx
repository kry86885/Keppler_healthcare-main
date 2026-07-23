import { act } from "react";
import { createRoot } from "react-dom/client";
import OtPage from "./OtPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("OtPage", () => {
  test("renders OT utilisation and surgery management", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/ot/summary")) {
        return jsonResponse({
          theatre_count: 2,
          available_theatres: 1,
          scheduled_surgeries: 1,
          completed_surgeries: 1,
          scheduled_hours: 4,
          completed_hours: 3,
          theatre_utilization: [{ label: "OT-01", count: 3 }],
        });
      }
      if (requestUrl.includes("/api/ot/theatres")) {
        return jsonResponse({
          theatres: [{ id: 1, theatre_code: "OT-01", theatre_name: "Main OT", status: "available" }],
        });
      }
      if (requestUrl.includes("/api/ot/surgeries")) {
        return jsonResponse({
          surgeries: [
            {
              id: 4,
              theatre_id: 1,
              procedure_name: "CABG",
              surgeon_name: "Dr. Shah",
              scheduled_start: "2026-03-04 10:00:00",
              estimated_duration_hours: 3,
              status: "completed",
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
      root.render(<OtPage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("OT Utilization");
    expect(container.textContent).toContain("Manage Theatres");
    expect(container.textContent).toContain("Schedule Surgery");
    expect(container.textContent).toContain("OT Theatres");
    expect(container.textContent).toContain("Scheduled Surgeries");
    expect(container.querySelector('input[aria-label="OT theatre code"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="OT procedure"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
