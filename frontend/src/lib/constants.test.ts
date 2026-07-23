import { isSupportedDocumentFile, SUPPORTED_DOCUMENT_EXTENSIONS } from "./constants";

describe("document type validation", () => {
  test("accepts supported document extensions case-insensitively", () => {
    const file = new File(["demo"], "scan.PDF", { type: "application/pdf" });
    expect(isSupportedDocumentFile(file)).toBe(true);
  });

  test("rejects unsupported extensions", () => {
    const file = new File(["demo"], "script.exe", { type: "application/octet-stream" });
    expect(isSupportedDocumentFile(file)).toBe(false);
  });

  test("has expected enterprise-safe extension baseline", () => {
    expect(SUPPORTED_DOCUMENT_EXTENSIONS).toEqual(
      expect.arrayContaining(["pdf", "png", "jpg", "jpeg", "webp"])
    );
  });
});
