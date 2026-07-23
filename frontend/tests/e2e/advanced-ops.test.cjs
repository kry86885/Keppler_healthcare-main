const {
  ensureLoggedIn,
  navigateTo,
  waitForText,
  uniqueSuffix,
  uniquePhone,
  registerPatient,
  apiRequest,
} = require("./helpers/e2e-helpers.cjs");

describe("HospAI E2E - Advanced Operations", () => {
  beforeEach(async () => {
    await ensureLoggedIn();
  });

  test("shows reports, OT, and accounts workspaces", async () => {
    await navigateTo("Reports");
    await waitForText("Reports Center");
    await waitForText("Export CSV");
    await waitForText("Discount Reports");

    await navigateTo("OT");
    await waitForText("OT Utilization");
    await waitForText("Manage Theatres");
    await waitForText("Schedule Surgery");

    await navigateTo("Accounts");
    await waitForText("General Ledger");
    await waitForText("Vendor Payments");
    await waitForText("Doctor Payouts");
  });

  test("covers OP, OT, accounts, and reports APIs for the newer modules", async () => {
    const patientId = await registerPatient({
      first: "E2E",
      last: `Advanced${uniqueSuffix()}`,
      phone: uniquePhone(),
      age: 39,
    });

    const schedule = await apiRequest("/api/op/doctor-schedules", {
      method: "POST",
      body: {
        doctor_name: "Dr. E2E Ops",
        department: "General Medicine",
        schedule_date: "2026-03-04",
        start_time: "09:00",
        end_time: "13:00",
        slot_capacity: 8,
      },
    });
    expect(schedule.status).toBe(200);

    const appointment = await apiRequest("/api/appointments", {
      method: "POST",
      body: {
        patient_id: patientId,
        patient_name: "E2E Advanced",
        visit_type: "OP",
        department: "General Medicine",
        doctor_name: "Dr. E2E Ops",
        appointment_date: "2026-03-04T10:00:00",
      },
    });
    expect(appointment.status).toBe(200);
    const appointmentId = appointment.data.appointment_id;

    expect(
      (
        await apiRequest(`/api/appointments/${appointmentId}`, {
          method: "PUT",
          body: { reminder_sent_at: "2026-03-04T08:30:00" },
        })
      ).status
    ).toBe(200);

    const opSummary = await apiRequest("/api/op/summary?date=2026-03-04");
    expect(opSummary.status).toBe(200);
    expect(Number(opSummary.data.reminders_sent)).toBeGreaterThan(0);

    const theatre = await apiRequest("/api/ot/theatres", {
      method: "POST",
      body: {
        theatre_code: `OT-${String(Date.now()).slice(-3)}`,
        theatre_name: "E2E Theatre",
        status: "available",
      },
    });
    expect(theatre.status).toBe(200);
    const theatreId = theatre.data.theatre_id;

    expect(
      (
        await apiRequest("/api/ot/surgeries", {
          method: "POST",
          body: {
            theatre_id: theatreId,
            patient_id: patientId,
            procedure_name: "Laparoscopy",
            surgeon_name: "Dr. E2E Surgeon",
            scheduled_start: "2026-03-04T11:00:00",
            estimated_duration_hours: 2,
            status: "completed",
          },
        })
      ).status
    ).toBe(200);

    const ledger = await apiRequest("/api/accounts/ledger", {
      method: "POST",
      body: {
        entry_date: "2026-03-04",
        entry_type: "income",
        category: "OP Collections",
        amount: 1800,
      },
    });
    expect(ledger.status).toBe(200);

    const accounts = await apiRequest("/api/accounts/summary");
    expect(accounts.status).toBe(200);
    expect(accounts.data).toHaveProperty("net_position");

    const reports = await apiRequest("/api/reports/overview");
    expect(reports.status).toBe(200);
    expect(reports.data).toHaveProperty("accounts_summary");
    expect(reports.data).toHaveProperty("alos_summary");
  });
});
