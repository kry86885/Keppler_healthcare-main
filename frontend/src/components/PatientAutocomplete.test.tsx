import { act } from "react";
import { createRoot } from "react-dom/client";
import PatientAutocomplete from "./PatientAutocomplete";

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

const FIXTURE_PATIENTS = [
  { patient_id: "PAT-20260101-0001", name: "Alice", last_name: "Smith", phone: "5551112222" },
  { patient_id: "PAT-20260101-0002", name: "Alicia", last_name: "Jones", phone: "5553334444" },
];

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PatientAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("debounces search input and renders suggestions after the delay", async () => {
    global.fetch = vi.fn(() => jsonResponse({ patients: FIXTURE_PATIENTS })) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<PatientAutocomplete value="" onChange={onChange} ariaLabel="Search patient" />);
    });

    act(() => {
      root.render(<PatientAutocomplete value="ali" onChange={onChange} ariaLabel="Search patient" />);
    });

    expect(global.fetch).not.toHaveBeenCalled();

    await advanceDebounce();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Alice Smith");
    expect(container.textContent).toContain("Alicia Jones");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("ArrowDown + Enter selects a suggestion and prevents default so a wrapping form does not submit", async () => {
    global.fetch = vi.fn(() => jsonResponse({ patients: FIXTURE_PATIENTS })) as any;

    const form = document.createElement("form");
    document.body.appendChild(form);
    const root = createRoot(form);
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const submitHandler = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitHandler);

    act(() => {
      root.render(<PatientAutocomplete value="ali" onChange={onChange} onSelect={onSelect} ariaLabel="Search patient" />);
    });

    await advanceDebounce();

    const input = form.querySelector('input[aria-label="Search patient"]') as HTMLInputElement;

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });

    let enterEvent: KeyboardEvent | null = null;
    act(() => {
      enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      input.dispatchEvent(enterEvent);
    });

    expect(onSelect).toHaveBeenCalledWith(FIXTURE_PATIENTS[0]);
    expect(enterEvent!.defaultPrevented).toBe(true);
    expect(submitHandler).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    form.remove();
  });

  test("Escape closes the suggestion list without selecting", async () => {
    global.fetch = vi.fn(() => jsonResponse({ patients: FIXTURE_PATIENTS })) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const onSelect = vi.fn();

    act(() => {
      root.render(<PatientAutocomplete value="ali" onChange={onChange} onSelect={onSelect} ariaLabel="Search patient" />);
    });

    await advanceDebounce();

    expect(container.textContent).toContain("Alice Smith");

    const input = container.querySelector('input[aria-label="Search patient"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    expect(container.querySelector(".patient-autocomplete-list")).toBeFalsy();
    expect(onSelect).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
