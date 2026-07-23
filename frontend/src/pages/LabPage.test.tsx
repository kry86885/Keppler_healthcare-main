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

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
