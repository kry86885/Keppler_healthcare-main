import { formatDateIST, resolvePermissions, stripUploadTimestampPrefix } from "./format";

describe("resolvePermissions", () => {
  test("returns explicit user permissions when provided", () => {
    const permissions = resolvePermissions({
      username: "u1",
      permissions: ["patients.read", "billing.read"],
    });
    expect(permissions).toEqual(["patients.read", "billing.read"]);
  });

  test("returns full admin permissions for admin users", () => {
    const permissions = resolvePermissions({
      username: "admin1",
      user_type: "admin",
    });
    expect(permissions).toContain("employees.read");
    expect(permissions).toContain("admin.use");
  });

  test("maps module access to normal user permissions", () => {
    const permissions = resolvePermissions({
      username: "u2",
      user_type: "normal",
      module_access: ["patients", "billing"],
    });
    expect(permissions).toContain("patients.read");
    expect(permissions).toContain("patients.write");
    expect(permissions).toContain("billing.read");
    expect(permissions).toContain("billing.write");
    expect(permissions).not.toContain("employees.read");
  });

  test("denies access by default for normal users with missing module access", () => {
    const permissions = resolvePermissions({
      username: "u3",
      user_type: "normal",
    });
    expect(permissions).toEqual([]);
  });

  test("denies access by default for normal users with empty module access", () => {
    const permissions = resolvePermissions({
      username: "u4",
      user_type: "normal",
      module_access: [],
    });
    expect(permissions).toEqual([]);
  });

  test("does not grant permissions for unknown modules", () => {
    const permissions = resolvePermissions({
      username: "u5",
      user_type: "normal",
      module_access: ["unknown_module"],
    } as any);
    expect(permissions).toEqual([]);
  });

  test("returns empty permissions for missing user", () => {
    const permissions = resolvePermissions(null);
    expect(permissions).toEqual([]);
  });
});

describe("format helpers", () => {
  test("strips generated upload timestamp prefix", () => {
    expect(stripUploadTimestampPrefix("20260218_101530_report.pdf")).toBe("report.pdf");
    expect(stripUploadTimestampPrefix("report.pdf")).toBe("report.pdf");
  });

  test("returns safe fallback for invalid IST date values", () => {
    expect(formatDateIST(undefined)).toBe("Unknown Date");
    expect(formatDateIST("not-a-date")).toBe("Unknown Date");
  });
});
