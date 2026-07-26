import { act } from "react";
import { createRoot } from "react-dom/client";
import OcrPage from "./OcrPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("OcrPage", () => {
  test("renders OCR scanner page and document dropzone", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<OcrPage setNotice={vi.fn()} onNavigate={vi.fn()} />);
      await flush();
    });

    expect(container.textContent).toContain("Intelligent OCR Scanner");
    expect(container.textContent).toContain("Document Category");
    expect(container.textContent).toContain("Start OCR Scanning");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
