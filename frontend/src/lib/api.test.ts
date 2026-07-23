import { apiFetch, reportError } from "./api";

describe("apiFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("uses JSON defaults, credentials include, and no-store cache for GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = await apiFetch("/api/health");
    expect(payload).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/health");
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  test("dispatches unauthorized event for 401 on protected endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Authentication required" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const unauthorizedListener = vi.fn();
    window.addEventListener("app:unauthorized", unauthorizedListener);

    await expect(apiFetch("/api/stats")).rejects.toMatchObject({
      message: "Authentication required",
      status: 401,
    });
    expect(unauthorizedListener).toHaveBeenCalledTimes(1);

    window.removeEventListener("app:unauthorized", unauthorizedListener);
  });

  test("does not dispatch unauthorized event for login/session endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Authentication required" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const unauthorizedListener = vi.fn();
    window.addEventListener("app:unauthorized", unauthorizedListener);

    await expect(apiFetch("/api/auth/session")).rejects.toMatchObject({
      status: 401,
    });
    expect(unauthorizedListener).toHaveBeenCalledTimes(0);

    window.removeEventListener("app:unauthorized", unauthorizedListener);
  });
});

describe("reportError", () => {
  test("sets fallback notice for non-401 errors", () => {
    const setNotice = vi.fn();
    reportError(setNotice, { status: 500, message: "Internal error" }, "Fallback");
    expect(setNotice).toHaveBeenCalledWith({ type: "error", message: "Internal error" });
  });

  test("does nothing for 401 errors", () => {
    const setNotice = vi.fn();
    reportError(setNotice, { status: 401, message: "Unauthorized" }, "Fallback");
    expect(setNotice).not.toHaveBeenCalled();
  });
});
