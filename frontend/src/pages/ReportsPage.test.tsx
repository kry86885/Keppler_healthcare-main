import { act } from "react";
import { createRoot } from "react-dom/client";
import ReportsPage from "./ReportsPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("ReportsPage", () => {
  test("renders reports center and export controls", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/reports/overview")) {
        return jsonResponse({
          billing_summary: {
            total_billed: 12000,
            total_collected: 9000,
            total_due: 3000,
            total_advance: 1000,
            total_refunded: 100,
            collections_by_module: [{ label: "LAB", count: 9000 }],
          },
          pharmacy_summary: { sales_total: 5000, low_stock_count: 1, out_of_stock_count: 0, damaged_stock_count: 0 },
          lab_summary: { total_amount: 8000, total_due: 1200 },
          hospital_summary: {
            revenue: { total: 12000, due: 3000 },
            accidents: { daily: 1, monthly: 4 },
            referrals: [{ label: "doctor", count: 3 }],
            ip_op_counts: { monthly_op: 25, monthly_ip: 10 },
          },
          employee_summary: { total: 10, active: 8, inactive: 2 },
          accounts_summary: { net_position: 4500, vendor_paid_total: 2000, doctor_due_total: 500 },
          doctor_income: [{ label: "Dr. Rao", count: 5000 }],
          diagnostics_by_doctor: [{ label: "Dr. Rao", count: 2000 }],
          clinic_income: [{ label: "General", count: 7000 }],
          discount_by_module: [{ label: "LAB", count: 300 }],
          payment_status_breakdown: [{ label: "partial", count: 2 }],
          patient_financials: [{ label: "PAT-1", count: 1200 }],
          alos_summary: { average_los_days: 2.5, admission_count: 4 },
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ReportsPage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Reports Center");
    expect(container.textContent).toContain("Export CSV");
    expect(container.textContent).toContain("Doctor-wise Income");
    expect(container.textContent).toContain("Discount Reports");
    expect(container.textContent).toContain("Patient Financial Balances");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
