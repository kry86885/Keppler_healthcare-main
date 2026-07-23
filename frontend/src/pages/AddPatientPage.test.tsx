import { act } from "react";
import { createRoot } from "react-dom/client";
import AddPatientPage from "./AddPatientPage";

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

describe("AddPatientPage", () => {
  test("renders patient registration and document upload sections", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/patients/next-id")) {
        return jsonResponse({ patient_id: "HSP1001" });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          selectedPatient={null}
          ocrLanguage="en"
          setNotice={vi.fn()}
        />
      );
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Patient Registration");
    expect(container.textContent).toContain("Upload Documents");
    expect(container.textContent).toContain("Register Patient");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
