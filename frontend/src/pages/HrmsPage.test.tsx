import { act } from "react";
import { createRoot } from "react-dom/client";
import HrmsPage from "./HrmsPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("HrmsPage", () => {
  test("renders hr write forms across tabs", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/hr/departments")) {
        return jsonResponse({ departments: [{ id: 1, department_name: "Nursing", mapped_head_employee_id: "EMP-9" }] });
      }
      if (url.includes("/api/hr/attendance")) {
        return jsonResponse({ attendance: [] });
      }
      if (url.includes("/api/hr/payroll")) {
        return jsonResponse({ payroll: [] });
      }
      if (url.includes("/api/hr/leaves")) {
        return jsonResponse({ leaves: [] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<HrmsPage setNotice={vi.fn()} />);
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Add Attendance");
    const payrollTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Payroll");
    const leavesTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Leaves");
    const departmentsTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Departments");

    await act(async () => {
      payrollTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(container.textContent).toContain("Add Payroll");

    await act(async () => {
      leavesTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(container.textContent).toContain("Request Leave");

    await act(async () => {
      departmentsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });
    expect(container.textContent).toContain("Add Department");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
