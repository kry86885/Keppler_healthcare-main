import { act } from "react";
import { createRoot } from "react-dom/client";
import OcrPage from "./OcrPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(payload),
  });
}

describe("OcrPage", () => {
  test("renders the OCR workspace and loads documents when the My Documents tab is opened", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/ocr-portal/blueprints")) {
        return jsonResponse({
          blueprints: [
            "Universal OCR (Any Text)",
            "Handwritten Medical Prescription",
          ],
        });
      }
      if (requestUrl.includes("/api/ocr-portal/vault")) {
        return jsonResponse([
          {
            id: 1,
            filename: "report.pdf",
            doc_category: "Universal OCR (Any Text)",
            confidence_score: 96,
            extraction_date: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<OcrPage setNotice={vi.fn()} />);
      await flush();
    });

    expect(container.textContent).toContain("Upload a Document");
    expect(container.textContent).toContain("Start OCR Scanning");

    const vaultTab = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("My Documents"),
    );
    expect(vaultTab).toBeTruthy();

    await act(async () => {
      vaultTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain("report.pdf");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
