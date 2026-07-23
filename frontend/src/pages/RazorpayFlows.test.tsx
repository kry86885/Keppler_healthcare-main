import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BillingPage from "./BillingPage";
import OpPage from "./OpPage";
import RegistrationDeskPage from "./RegistrationDeskPage";

const openRazorpayCheckoutMock = vi.fn();

vi.mock("../lib/razorpay", () => ({
  openRazorpayCheckout: (...args: unknown[]) => openRazorpayCheckoutMock(...args),
}));

function ok(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("Razorpay UI flows", () => {
  beforeEach(() => {
    openRazorpayCheckoutMock.mockReset();
  });

  test("Billing page triggers Razorpay order and verify calls", async () => {
    openRazorpayCheckoutMock.mockResolvedValue({
      razorpay_payment_id: "pay_1",
      razorpay_order_id: "order_1",
      razorpay_signature: "sig_1",
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/billing/revenue-summary")) return ok({ total_billed: 0, total_collected: 0, total_due: 0, payment_mode_breakdown: [] });
      if (url.includes("/api/billing/invoices") && method === "GET") {
        return ok({ invoices: [{ id: 10, invoice_no: "INV-10", patient_id: "P-1", due_amount: 700 }] });
      }
      if (url.includes("/api/billing/claims")) return ok({ claims: [] });
      if (url.includes("/api/billing/razorpay/order") && method === "POST") {
        return ok({ key_id: "rzp_test", order_id: "order_1", amount: 50000, currency: "INR" });
      }
      if (url.includes("/api/billing/razorpay/verify") && method === "POST") return ok({ payment_id: 1 });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<BillingPage setNotice={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pay via Razorpay" })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Billing payment amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay via Razorpay" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/billing/razorpay/order"), expect.any(Object));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/billing/razorpay/verify"), expect.any(Object));
    });
    expect(openRazorpayCheckoutMock).toHaveBeenCalledTimes(1);
  });

  test("OP page triggers Razorpay appointment payment flow", async () => {
    openRazorpayCheckoutMock.mockResolvedValue({
      razorpay_payment_id: "pay_2",
      razorpay_order_id: "order_2",
      razorpay_signature: "sig_2",
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/op/summary")) {
        return ok({
          total_appointments: 0,
          follow_ups: 0,
          active_queue: 0,
          no_shows: 0,
          reminders_sent: 0,
          available_doctors: 1,
        });
      }
      if (url.includes("/api/op/doctor-schedules")) {
        return ok({
          schedules: [
            {
              id: 1,
              doctor_name: "Dr. A",
              department: "Cardiology",
              schedule_date: "2026-03-10",
              start_time: "09:00",
              end_time: "17:00",
            },
          ],
        });
      }
      if (url.includes("/api/appointments?")) return ok({ appointments: [] });
      if (url.includes("/api/registration/departments")) return ok({ departments: [{ id: 1, department_name: "Cardiology" }] });
      if (url.includes("/api/appointments/razorpay/order") && method === "POST") {
        return ok({ key_id: "rzp_test", order_id: "order_2", amount: 25000, currency: "INR" });
      }
      if (url.includes("/api/appointments/razorpay/verify") && method === "POST") {
        return ok({ appointment_id: 21, token_no: 2, invoice_id: 31, payment_id: 41 });
      }
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<OpPage setNotice={vi.fn()} canEdit={true} />);

    await waitFor(() => {
      expect(screen.getByText("Schedule OP Visit")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("OP patient name"), { target: { value: "Razor OP" } });
    fireEvent.change(screen.getByLabelText("OP appointment date"), { target: { value: "2026-03-10T10:00" } });
    fireEvent.change(screen.getByLabelText("OP consultation fee"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay via Razorpay & Schedule" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/appointments/razorpay/order"), expect.any(Object));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/appointments/razorpay/verify"), expect.any(Object));
    });
    expect(openRazorpayCheckoutMock).toHaveBeenCalledTimes(1);
  });

  test("Registration desk triggers Razorpay appointment flow", async () => {
    openRazorpayCheckoutMock.mockResolvedValue({
      razorpay_payment_id: "pay_3",
      razorpay_order_id: "order_3",
      razorpay_signature: "sig_3",
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/appointments?")) return ok({ appointments: [] });
      if (url.includes("/api/registration/departments")) return ok({ departments: [{ id: 2, department_name: "General Medicine" }] });
      if (url.includes("/api/op/doctor-schedules")) return ok({ schedules: [{ doctor_name: "Dr. B" }] });
      if (url.includes("/api/registration/consents")) return ok({ consents: [] });
      if (url.includes("/api/registration/insurance")) return ok({ verifications: [] });
      if (url.includes("/api/appointments/razorpay/order") && method === "POST") return ok({ key_id: "rzp_test", order_id: "order_3", amount: 15000, currency: "INR" });
      if (url.includes("/api/appointments/razorpay/verify") && method === "POST") return ok({ appointment_id: 22, token_no: 3, invoice_id: 32, payment_id: 42 });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<RegistrationDeskPage mode="appointment-in" selectedPatient={null} setNotice={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Schedule Appointment")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Patient Name"), { target: { value: "Razor Reg" } });
    fireEvent.change(screen.getByLabelText("Appointment Time"), { target: { value: "2026-03-10T11:00" } });
    fireEvent.change(screen.getByLabelText("Consultation Fee"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay via Razorpay & Schedule" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/appointments/razorpay/order"), expect.any(Object));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/appointments/razorpay/verify"), expect.any(Object));
    });
    expect(openRazorpayCheckoutMock).toHaveBeenCalledTimes(1);
  });

  test("Billing does not verify when Razorpay checkout is dismissed", async () => {
    openRazorpayCheckoutMock.mockRejectedValue(new Error("Razorpay checkout was closed."));
    const setNotice = vi.fn();

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/billing/revenue-summary")) return ok({ total_billed: 0, total_collected: 0, total_due: 0, payment_mode_breakdown: [] });
      if (url.includes("/api/billing/invoices") && method === "GET") return ok({ invoices: [{ id: 10, invoice_no: "INV-10", patient_id: "P-1", due_amount: 700 }] });
      if (url.includes("/api/billing/claims")) return ok({ claims: [] });
      if (url.includes("/api/billing/razorpay/order") && method === "POST") return ok({ key_id: "rzp_test", order_id: "order_x", amount: 50000, currency: "INR" });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<BillingPage setNotice={setNotice} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pay via Razorpay" })).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Billing payment amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay via Razorpay" }));

    await waitFor(() => {
      expect(openRazorpayCheckoutMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/billing/razorpay/verify"), expect.any(Object));
    expect(setNotice).toHaveBeenCalled();
  });

  test("OP flow does not verify when Razorpay checkout fails", async () => {
    openRazorpayCheckoutMock.mockRejectedValue(new Error("Razorpay checkout failed."));
    const setNotice = vi.fn();

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/op/summary")) return ok({ total_appointments: 0, follow_ups: 0, active_queue: 0, no_shows: 0, reminders_sent: 0, available_doctors: 1 });
      if (url.includes("/api/op/doctor-schedules")) return ok({ schedules: [{ id: 1, doctor_name: "Dr. A", department: "Cardiology", schedule_date: "2026-03-10", start_time: "09:00", end_time: "17:00" }] });
      if (url.includes("/api/appointments?")) return ok({ appointments: [] });
      if (url.includes("/api/registration/departments")) return ok({ departments: [{ id: 1, department_name: "Cardiology" }] });
      if (url.includes("/api/appointments/razorpay/order") && method === "POST") return ok({ key_id: "rzp_test", order_id: "order_fail", amount: 25000, currency: "INR" });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<OpPage setNotice={setNotice} canEdit={true} />);
    await waitFor(() => {
      expect(screen.getByText("Schedule OP Visit")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("OP patient name"), { target: { value: "Razor OP" } });
    fireEvent.change(screen.getByLabelText("OP appointment date"), { target: { value: "2026-03-10T10:00" } });
    fireEvent.change(screen.getByLabelText("OP consultation fee"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay via Razorpay & Schedule" }));

    await waitFor(() => {
      expect(openRazorpayCheckoutMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/appointments/razorpay/verify"), expect.any(Object));
    expect(setNotice).toHaveBeenCalled();
  });

  test("Billing disables Razorpay button when gateway config is missing", async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/payments/razorpay/config")) return ok({ configured: false });
      if (url.includes("/api/billing/revenue-summary")) return ok({ total_billed: 0, total_collected: 0, total_due: 0, payment_mode_breakdown: [] });
      if (url.includes("/api/billing/invoices") && method === "GET") return ok({ invoices: [{ id: 10, invoice_no: "INV-10", patient_id: "P-1", due_amount: 700 }] });
      if (url.includes("/api/billing/claims")) return ok({ claims: [] });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<BillingPage setNotice={vi.fn()} />);

    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Pay via Razorpay" }) as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText("Razorpay payments are disabled until backend keys are configured.")).toBeTruthy();
  });

  test("OP disables Razorpay schedule button when gateway config is missing", async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (url.includes("/api/payments/razorpay/config")) return ok({ configured: false });
      if (url.includes("/api/op/summary")) return ok({ total_appointments: 0, follow_ups: 0, active_queue: 0, no_shows: 0, reminders_sent: 0, available_doctors: 1 });
      if (url.includes("/api/op/doctor-schedules")) return ok({ schedules: [] });
      if (url.includes("/api/appointments?")) return ok({ appointments: [] });
      if (url.includes("/api/registration/departments")) return ok({ departments: [] });
      if (url.includes("/api/appointments/razorpay/order") && method === "POST") return ok({ key_id: "rzp_test", order_id: "order_fail", amount: 25000, currency: "INR" });
      return ok({});
    });
    global.fetch = fetchMock as any;

    render(<OpPage setNotice={vi.fn()} canEdit={true} />);

    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Pay via Razorpay & Schedule" }) as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText("Razorpay payments are disabled until backend keys are configured.")).toBeTruthy();
  });
});
