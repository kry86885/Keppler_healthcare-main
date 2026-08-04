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

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddPatientPage", () => {
  test("renders patient registration form with no document/OCR elements", async () => {
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
          setNotice={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Patient Registration");
    expect(container.textContent).toContain("Register Patient");
    expect(container.textContent).not.toContain("Upload Documents");
    expect(container.textContent).not.toContain("Process OCR");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("pressing Enter in a text field does not submit the form", async () => {
    mockLocalStorage();
    global.fetch = vi.fn(() => jsonResponse({})) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          setNotice={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
      await flush();
      await flush();
    });

    const nameInputs = Array.from(container.querySelectorAll("input")).filter(
      (input) => input.type === "text",
    );
    const target = nameInputs[0];
    expect(target).toBeTruthy();

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });

    expect(defaultPrevented).toBe(true);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
