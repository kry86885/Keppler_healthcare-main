import { act } from "react";
import { createRoot } from "react-dom/client";
import AccountsPage from "./AccountsPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("AccountsPage", () => {
  test("renders ledger workflow by default", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/accounts/summary")) {
        return jsonResponse({
          ledger_income: 10000,
          ledger_expense: 4000,
          net_position: 6000,
          vendor_paid_total: 2000,
          doctor_paid_total: 2500,
          doctor_due_total: 500,
        });
      }
      if (requestUrl.includes("/api/accounts/ledger")) {
        return jsonResponse({
          entries: [{ id: 1, entry_date: "2026-03-04", entry_type: "income", category: "Collections", amount: 10000 }],
        });
      }
      if (requestUrl.includes("/api/accounts/vendors")) {
        return jsonResponse({
          payments: [{ id: 2, vendor_name: "Acme Pharma", amount: 2000, payment_date: "2026-03-04", status: "paid" }],
        });
      }
      if (requestUrl.includes("/api/accounts/doctors")) {
        return jsonResponse({
          payouts: [{ id: 3, doctor_name: "Dr. Shah", payout_month: "2026-03", amount: 3000, paid_amount: 2500, due_amount: 500, status: "partial" }],
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AccountsPage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("General Ledger");
    expect(container.querySelector('input[aria-label="Ledger amount"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Vendor payment amount"]')).toBeFalsy();
    expect(container.querySelector('input[aria-label="Doctor payout amount"]')).toBeFalsy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
