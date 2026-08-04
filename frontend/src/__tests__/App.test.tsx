import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import App from "../App";

function mockFetchForUser(user: any = null) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/languages")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ languages: { en: "English" } }),
      });
    }

    if (url.includes("/api/auth/session")) {
      if (!user) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: "Authentication required" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ user }),
      });
    }

    if (url.includes("/api/stats")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ total: 0, today: 0, active_admissions: 0, documents: 0, readmitted_patients: 0 }),
      });
    }

    if (url.includes("/api/patients")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ patients: [] }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  }) as any;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("App role-based UI", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFetchForUser(null);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  test("renders login form by default", async () => {
    await act(async () => {
      root.render(<App />);
      await flush();
    });
    expect(container.textContent).toContain("Welcome Back");
    expect(container.textContent).toContain("Login");
  });

  test("hides admin-only nav items for receptionist", async () => {
    mockFetchForUser({
      username: "reception",
      role: "employee",
      access_role: "receptionist",
      permissions: ["patients.read", "patients.write"],
      full_name: "Reception User",
      status: "active",
    });

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    const employeesTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Employee Management");
    expect(employeesTab).toBeFalsy();
  });

  test("keeps owner navigation enabled for all modules", async () => {
    mockFetchForUser({
      username: "employee",
      role: "employee",
      access_role: "owner",
      permissions: [
        "patients.read",
        "patients.write",
        "patients.delete",
        "symptom_ai.use",
        "employees.read",
        "employees.write",
        "admin.use",
        "hr.read",
      ],
      full_name: "Owner User",
      status: "active",
      module_access: ["hrms", "billing", "accounts"],
    });

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    // The Administration group should show count ≥ 2 (Employee Management + Patient Experience,
    // and HRMS if hr.read permission is present)
    const adminToggle = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent?.includes("Administration")
    );
    expect(adminToggle).toBeTruthy();
    // Count is at least 2: Employee Management + Patient Experience
    const adminCount = parseInt(adminToggle?.querySelector(".sidebar-nav-count")?.textContent || "0", 10);
    expect(adminCount).toBeGreaterThanOrEqual(2);

    // The user has hrms in module_access so they land on HRMS page by default
    expect(container.textContent).toContain("HRMS");
  });



  test("returns to login when a protected request receives 401", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/languages")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ languages: { en: "English" } }),
        });
      }

      if (url.includes("/api/auth/session")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              user: {
                username: "admin",
                user_type: "admin",
                role: "admin",
                full_name: "Admin User",
              },
            }),
        });
      }

      if (url.includes("/api/stats")) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: "Authentication required" }),
        });
      }

      if (url.includes("/api/patients")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ patients: [] }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }) as any;

    await act(async () => {
      root.render(<App />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Welcome Back");
    expect(container.textContent).toContain("Login");
    expect(container.textContent).not.toContain("Log out");
    expect(container.textContent).not.toContain("Authentication required");
  });
});
