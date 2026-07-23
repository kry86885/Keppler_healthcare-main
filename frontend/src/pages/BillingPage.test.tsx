import { act } from "react";
import { createRoot } from "react-dom/client";
import BillingPage from "./BillingPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("BillingPage", () => {
  test("renders record payment workflow by default", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/billing/revenue-summary")) {
        return jsonResponse({ total_billed: 0, total_collected: 0, total_due: 0, payment_mode_breakdown: [] });
      }
      if (url.includes("/api/billing/invoices")) {
        return jsonResponse({ invoices: [{ id: 1, invoice_no: "INV-1", due_amount: 2500 }] });
      }
      return jsonResponse({});
    });
    global.fetch = fetchMock as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<BillingPage setNotice={vi.fn()} />);
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Record Payment");
    expect(container.querySelector('select[aria-label="Billing payment invoice"]')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/billing/revenue-summary"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/billing/invoices"), expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/billing/claims"), expect.any(Object));

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
