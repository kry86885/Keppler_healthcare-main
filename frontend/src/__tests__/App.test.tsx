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
    expect(container.textContent).toContain("Welcome back");
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
      ],
      full_name: "Owner User",
      status: "active",
    });

    await act(async () => {
      root.render(<App />);
      await flush();
    });

    const employeesTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Employee Management") as HTMLButtonElement;
    const appointmentInTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Appointment In") as HTMLButtonElement;
    const appointmentOutTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Appointment Out") as HTMLButtonElement;

    expect(employeesTab.disabled).toBe(false);
    expect(appointmentInTab.disabled).toBe(false);
    expect(appointmentOutTab.disabled).toBe(false);
    expect(container.textContent).toContain("Registration Desk");
  });

  test("uses module_access to unlock finance billing pages and pick receivable aging by default", async () => {
    mockFetchForUser({
      username: "billing-user",
      user_type: "normal",
      module_access: ["billing"],
      full_name: "Billing User",
      status: "active",
    });

    await act(async () => {
      root.render(<App />);
      await flush();
      await flush();
    });

    const billingTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Receivable Aging") as HTMLButtonElement;
    const patientsTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Patients") as HTMLButtonElement;

    expect(billingTab).toBeTruthy();
    expect(billingTab.disabled).toBe(false);
    expect(patientsTab).toBeFalsy();
    expect(container.textContent).toContain("Receivable Aging");
    expect(container.textContent).toContain("Payment Reconciliation");
    expect(container.textContent).toContain("Create Invoice");
    expect(container.textContent).toContain("Record Payment");
    expect(container.textContent).toContain("Insurance Claims");
    expect(container.textContent).toContain("Invoices");
    expect(container.textContent).toContain("Payment Mode Breakdown");
    expect(container.textContent).toContain("Collections by Module");
  });

  test("uses module_access to unlock accounts pages and pick overview by default", async () => {
    mockFetchForUser({
      username: "accounts-user",
      user_type: "normal",
      module_access: ["accounts"],
      full_name: "Accounts User",
      status: "active",
    });

    await act(async () => {
      root.render(<App />);
      await flush();
      await flush();
    });

    const overviewTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Accounts Overview") as HTMLButtonElement;
    const ledgerTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Ledger Entries") as HTMLButtonElement;
    const vendorTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Vendor Payments") as HTMLButtonElement;
    const doctorTab = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === "Doctor Payouts") as HTMLButtonElement;

    expect(overviewTab).toBeTruthy();
    expect(ledgerTab).toBeTruthy();
    expect(vendorTab).toBeTruthy();
    expect(doctorTab).toBeTruthy();
    expect(container.textContent).toContain("Accounts Overview");
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

    expect(container.textContent).toContain("Welcome back");
    expect(container.textContent).toContain("Login");
    expect(container.textContent).not.toContain("Log out");
    expect(container.textContent).not.toContain("Authentication required");
  });
});
