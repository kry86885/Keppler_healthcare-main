import { act } from "react";
import { createRoot } from "react-dom/client";
import SymptomAiPage from "./SymptomAiPage";

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

describe("SymptomAiPage - Ask About Your Documents tab", () => {
  test("loads documents and chat history when the tab is opened, and supports sending a chat message", async () => {
    global.fetch = vi.fn(
      (url: string, options?: { method?: string; body?: string }) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/api/symptom-ai/meta")) {
          return jsonResponse({
            context_tags: [],
            duration_options: [],
            regions: [],
          });
        }
        if (
          requestUrl.includes("/api/symptom-ai/documents") &&
          (!options || !options.method)
        ) {
          return jsonResponse({
            documents: [
              {
                id: 1,
                filename: "labresult.pdf",
                doc_category: "USER_UPLOAD",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          });
        }
        if (requestUrl.includes("/api/symptom-ai/chat/history")) {
          return jsonResponse({ messages: [] });
        }
        if (
          requestUrl.includes("/api/symptom-ai/chat") &&
          options?.method === "POST"
        ) {
          return jsonResponse({
            session_id: "sess-1",
            answer: "Your hemoglobin was within normal range.",
          });
        }
        return jsonResponse({});
      },
    ) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SymptomAiPage setNotice={vi.fn()} />);
      await flush();
      await flush();
    });

    const documentsTabButton = Array.from(
      container.querySelectorAll("button"),
    ).find((btn) => btn.textContent === "Ask About Your Documents");
    expect(documentsTabButton).toBeTruthy();

    await act(async () => {
      documentsTabButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("labresult.pdf");

    const chatInput = container.querySelector(
      'input[placeholder="Ask a question about your documents..."]',
    ) as HTMLInputElement;
    expect(chatInput).toBeTruthy();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      nativeInputValueSetter.call(chatInput, "What was my hemoglobin result?");
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Send",
    );
    expect(sendButton?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      await flush();
    });

    expect(container.textContent).toContain(
      "Your hemoglobin was within normal range.",
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
