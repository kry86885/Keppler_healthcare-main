import { act } from "react";
import { createRoot } from "react-dom/client";
import PharmacyPage from "./PharmacyPage";

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

describe("PharmacyPage", () => {
  test("renders inventory management sections", async () => {
    mockLocalStorage();
    const setNotice = vi.fn();
    const inventory = [
      {
        id: 1,
        medicine_name: "Ibuprofen",
        batch_no: "B100",
        quantity: 20,
        reorder_level: 10,
        unit_price: 18,
        stock_condition: "proper",
      },
    ];

    global.fetch = vi.fn((url: string, options?: RequestInit) => {
      const requestUrl = String(url);
      const method = (options?.method || "GET").toUpperCase();
      if (requestUrl.includes("/api/pharmacy/summary")) {
        return jsonResponse({ low_stock_count: 0, out_of_stock_count: 0, damaged_stock_count: 0, sales_total: 0 });
      }
      if (requestUrl.includes("/api/pharmacy/inventory") && method === "GET") {
        return jsonResponse({ items: inventory });
      }
      if (requestUrl.includes("/api/pharmacy/sales")) {
        return jsonResponse({ sales: [] });
      }
      if (requestUrl.includes("/api/pharmacy/suppliers")) {
        return jsonResponse({ suppliers: [{ id: 9, supplier_name: "MediSupply", status: "active" }] });
      }
      if (requestUrl.includes("/api/pharmacy/purchases")) {
        return jsonResponse({ purchases: [{ id: 4, supplier_id: 9, medicine_name: "Ibuprofen", status: "ordered" }] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PharmacyPage setNotice={setNotice} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Add Medicine to Inventory");
    expect(container.textContent).toContain("Record Pharmacy Sale");
    expect(container.textContent).toContain("Suppliers");
    expect(container.textContent).toContain("Create Order");
    expect(container.textContent).toContain("Inventory Snapshot");
    expect(container.textContent).toContain("MediSupply");
    expect(container.querySelector('input[aria-label="Medicine name"]')).toBeTruthy();
    expect(container.querySelector('select[aria-label="Medicine for sale"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Supplier name"]')).toBeTruthy();
    expect(container.querySelector('select[aria-label="Purchase supplier"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
