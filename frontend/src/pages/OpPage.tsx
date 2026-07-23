import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Button, Input, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { openRazorpayCheckout } from "../lib/razorpay";
import type { Appointment, DoctorSchedule, Notice, OpSummary } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  canEdit: boolean;
};

type Department = {
  id: number;
  department_name?: string;
};

type ScheduleForm = {
  id: string;
  doctor_name: string;
  department: string;
  schedule_date: string;
  start_time: string;
  end_time: string;
  slot_capacity: string;
  status: string;
  notes: string;
};

type AppointmentForm = {
  id: string;
  patient_id: string;
  patient_name: string;
  visit_type: string;
  department: string;
  doctor_name: string;
  appointment_date: string;
  status: string;
  appointment_kind: string;
  follow_up_for: string;
  consultation_fee: string;
  payment_mode: string;
  notes: string;
};

const EMPTY_SUMMARY: OpSummary = {
  date: "",
  total_appointments: 0,
  follow_ups: 0,
  active_queue: 0,
  no_shows: 0,
  reminders_sent: 0,
  available_doctors: 0,
};

const DEFAULT_SCHEDULE_FORM: ScheduleForm = {
  id: "",
  doctor_name: "",
  department: "",
  schedule_date: "",
  start_time: "09:00",
  end_time: "17:00",
  slot_capacity: "12",
  status: "available",
  notes: "",
};

const DEFAULT_APPOINTMENT_FORM: AppointmentForm = {
  id: "",
  patient_id: "",
  patient_name: "",
  visit_type: "OP",
  department: "",
  doctor_name: "",
  appointment_date: "",
  status: "scheduled",
  appointment_kind: "new",
  follow_up_for: "",
  consultation_fee: "0",
  payment_mode: "upi",
  notes: "",
};

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export default function OpPage({ setNotice, canEdit }: Props) {
  const [summary, setSummary] = useState<OpSummary>(EMPTY_SUMMARY);
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(DEFAULT_SCHEDULE_FORM);
  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(DEFAULT_APPOINTMENT_FORM);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [isRazorpayReady, setIsRazorpayReady] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedDoctor, setSelectedDoctor] = useState("");

  const loadOpDesk = async (date = selectedDate, doctorName = selectedDoctor) => {
    setLoading(true);
    try {
      const doctorQuery = doctorName ? `&doctor_name=${encodeURIComponent(doctorName)}` : "";
      const [summaryData, scheduleData, appointmentData] = await Promise.all([
        apiFetch<OpSummary>(`/api/op/summary?date=${date}`),
        apiFetch<{ schedules?: DoctorSchedule[] }>(`/api/op/doctor-schedules?date=${date}${doctorQuery}`),
        apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${date}&visit_type=OP${doctorQuery}`),
      ]);
      const nextSchedules = scheduleData.schedules || [];
      const nextAppointments = appointmentData.appointments || [];
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setSchedules(nextSchedules);
      setAppointments(nextAppointments);
      setAppointmentForm((current) => {
        if (current.doctor_name || !nextSchedules[0]) return current;
        return {
          ...current,
          doctor_name: nextSchedules[0].doctor_name,
          department: nextSchedules[0].department || current.department,
        };
      });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load OP desk.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOpDesk(selectedDate, selectedDoctor);
  }, [selectedDate, selectedDoctor]);

  useEffect(() => {
    apiFetch<{ departments?: Department[] }>("/api/registration/departments")
      .then((data) => setDepartments(data.departments || []))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    apiFetch<{ configured?: boolean }>("/api/payments/razorpay/config")
      .then((data) => setIsRazorpayReady(data.configured !== false))
      .catch(() => setIsRazorpayReady(true));
  }, []);

  const ensureRazorpayConfigured = async () => {
    try {
      const config = await apiFetch<{ configured?: boolean }>("/api/payments/razorpay/config");
      const configured = config.configured !== false;
      setIsRazorpayReady(configured);
      if (!configured) {
        setNotice({ type: "error", message: "Razorpay is not configured. Add keys in backend .env." });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const doctorNames = useMemo(() => {
    const names = new Set<string>();
    schedules.forEach((item) => names.add(item.doctor_name));
    appointments.forEach((item) => {
      if (item.doctor_name) names.add(item.doctor_name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [schedules, appointments]);

  const handleScheduleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduleForm.doctor_name.trim() || !scheduleForm.schedule_date || !scheduleForm.start_time || !scheduleForm.end_time) {
      setNotice({ type: "error", message: "Doctor, date, and time range are required." });
      return;
    }
    setSavingSchedule(true);
    try {
      const scheduleId = Number(scheduleForm.id);
      const path = scheduleId ? `/api/op/doctor-schedules/${scheduleId}` : "/api/op/doctor-schedules";
      await apiFetch(path, {
        method: scheduleId ? "PUT" : "POST",
        body: JSON.stringify({
          doctor_name: scheduleForm.doctor_name.trim(),
          department: scheduleForm.department.trim() || undefined,
          schedule_date: scheduleForm.schedule_date,
          start_time: scheduleForm.start_time,
          end_time: scheduleForm.end_time,
          slot_capacity: Number(scheduleForm.slot_capacity) || 12,
          status: scheduleForm.status,
          notes: scheduleForm.notes.trim() || undefined,
        }),
      });
      setScheduleForm({ ...DEFAULT_SCHEDULE_FORM, schedule_date: selectedDate });
      setNotice({ type: "success", message: scheduleId ? "Doctor schedule updated." : "Doctor schedule added." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save doctor schedule.");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleAppointmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!appointmentForm.patient_name.trim() || !appointmentForm.appointment_date) {
      setNotice({ type: "error", message: "Patient name and appointment date are required." });
      return;
    }
    setSavingAppointment(true);
    try {
      const appointmentId = Number(appointmentForm.id);
      const path = appointmentId ? `/api/appointments/${appointmentId}` : "/api/appointments";
      const appointmentPayload = {
        patient_id: appointmentForm.patient_id.trim() || undefined,
        patient_name: appointmentForm.patient_name.trim(),
        visit_type: "OP",
        department: appointmentForm.department.trim() || undefined,
        doctor_name: appointmentForm.doctor_name.trim() || undefined,
        appointment_date: appointmentForm.appointment_date,
        status: appointmentForm.status,
        appointment_kind: appointmentForm.appointment_kind,
        follow_up_for: appointmentForm.appointment_kind === "follow_up" && appointmentForm.follow_up_for ? Number(appointmentForm.follow_up_for) : undefined,
        notes: appointmentForm.notes.trim() || undefined,
      };
      await apiFetch(path, {
        method: appointmentId ? "PUT" : "POST",
        body: JSON.stringify(appointmentPayload),
      });
      setAppointmentForm({
        ...DEFAULT_APPOINTMENT_FORM,
        appointment_date: `${selectedDate}T09:00`,
        doctor_name: appointmentForm.doctor_name,
        department: appointmentForm.department,
      });
      setNotice({ type: "success", message: appointmentId ? "Appointment updated." : "Appointment scheduled." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save appointment.");
    } finally {
      setSavingAppointment(false);
    }
  };

  const handleRazorpayAppointmentSubmit = async () => {
    if (!(await ensureRazorpayConfigured())) {
      return;
    }
    if (!appointmentForm.patient_name.trim() || !appointmentForm.appointment_date) {
      setNotice({ type: "error", message: "Patient name and appointment date are required." });
      return;
    }
    const consultationFee = Number(appointmentForm.consultation_fee) || 0;
    if (consultationFee <= 0) {
      setNotice({ type: "error", message: "Consultation fee must be greater than zero for Razorpay payment." });
      return;
    }
    setSavingAppointment(true);
    try {
      const appointmentPayload = {
        patient_id: appointmentForm.patient_id.trim() || undefined,
        patient_name: appointmentForm.patient_name.trim(),
        visit_type: "OP",
        department: appointmentForm.department.trim() || undefined,
        doctor_name: appointmentForm.doctor_name.trim() || undefined,
        appointment_date: appointmentForm.appointment_date,
        status: appointmentForm.status,
        appointment_kind: appointmentForm.appointment_kind,
        follow_up_for: appointmentForm.appointment_kind === "follow_up" && appointmentForm.follow_up_for ? Number(appointmentForm.follow_up_for) : undefined,
        notes: appointmentForm.notes.trim() || undefined,
      };

      const order = await apiFetch<{
        key_id: string;
        order_id: string;
        amount: number;
        currency: string;
      }>("/api/appointments/razorpay/order", {
        method: "POST",
        body: JSON.stringify({
          amount: consultationFee,
          notes: {
            patient_name: appointmentPayload.patient_name,
            doctor_name: appointmentPayload.doctor_name || "",
            appointment_date: appointmentPayload.appointment_date,
          },
        }),
      });

      const paymentResult = await openRazorpayCheckout({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "HospAI OP Desk",
        description: "OP Appointment Booking",
        order_id: order.order_id,
        prefill: {
          name: appointmentPayload.patient_name,
        },
        notes: {
          patient_id: appointmentPayload.patient_id || "",
        },
        theme: {
          color: "#0f766e",
        },
      });

      await apiFetch("/api/appointments/razorpay/verify", {
        method: "POST",
        body: JSON.stringify({
          amount: consultationFee,
          payment_mode: appointmentForm.payment_mode,
          appointment: appointmentPayload,
          razorpay_order_id: paymentResult.razorpay_order_id,
          razorpay_payment_id: paymentResult.razorpay_payment_id,
          razorpay_signature: paymentResult.razorpay_signature,
        }),
      });

      setAppointmentForm({
        ...DEFAULT_APPOINTMENT_FORM,
        appointment_date: `${selectedDate}T09:00`,
        doctor_name: appointmentForm.doctor_name,
        department: appointmentForm.department,
      });
      setNotice({ type: "success", message: "Appointment scheduled and paid via Razorpay." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to complete Razorpay appointment payment.");
    } finally {
      setSavingAppointment(false);
    }
  };

  const quickUpdateAppointment = async (appointment: Appointment, status: string) => {
    try {
      await apiFetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setNotice({ type: "success", message: `Appointment marked ${status.replace("_", " ")}.` });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  const markReminderSent = async (appointment: Appointment) => {
    try {
      await apiFetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
      });
      setNotice({ type: "success", message: "Reminder marked as sent." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update reminder status.");
    }
  };

  const markNoShow = async (appointment: Appointment) => {
    try {
      await apiFetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        body: JSON.stringify({ no_show_marked: true, status: "cancelled" }),
      });
      setNotice({ type: "success", message: "Appointment marked as no-show." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to mark no-show.");
    }
  };

  const deleteSchedule = async (schedule: DoctorSchedule) => {
    if (!window.confirm(`Delete ${schedule.doctor_name} schedule?`)) return;
    try {
      await apiFetch(`/api/op/doctor-schedules/${schedule.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Doctor schedule deleted." });
      await loadOpDesk(selectedDate, selectedDoctor);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete doctor schedule.");
    }
  };

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <h3>OP Desk</h3>
        <div className="module-inline-actions">
          <Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="OP date" />
          <Select value={selectedDoctor} onChange={(event) => setSelectedDoctor(event.target.value)} aria-label="OP doctor filter">
            <option value="">All doctors</option>
            {doctorNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard label="OP Appointments" value={summary.total_appointments} />
        <StatCard label="Follow-ups" value={summary.follow_ups} />
        <StatCard label="Active Queue" value={summary.active_queue} />
        <StatCard label="No-Shows" value={summary.no_shows} />
        <StatCard label="Reminders Sent" value={summary.reminders_sent} />
        <StatCard label="Doctors Available" value={summary.available_doctors} />
      </div>

      {loading ? <p className="muted">Loading OP workflow...</p> : null}

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Doctor Schedule</h3>
          </div>
          <form className="module-form-grid module-sales-grid" onSubmit={handleScheduleSubmit}>
            <Input
              value={scheduleForm.doctor_name}
              onChange={(event) => setScheduleForm((current) => ({ ...current, doctor_name: event.target.value }))}
              placeholder="Doctor name"
              aria-label="Doctor name"
              disabled={!canEdit}
              list="op-doctor-suggestions"
            />
            <Select
              value={scheduleForm.department}
              onChange={(event) => setScheduleForm((current) => ({ ...current, department: event.target.value }))}
              aria-label="Doctor department"
              disabled={!canEdit}
            >
              <option value="">Select department</option>
              {departments.map((department) => {
                const name = (department.department_name || "").trim();
                if (!name) return null;
                return (
                  <option key={department.id} value={name}>
                    {name}
                  </option>
                );
              })}
            </Select>
            <Input type="date" value={scheduleForm.schedule_date} onChange={(event) => setScheduleForm((current) => ({ ...current, schedule_date: event.target.value }))} aria-label="Schedule date" disabled={!canEdit} />
            <Input type="time" value={scheduleForm.start_time} onChange={(event) => setScheduleForm((current) => ({ ...current, start_time: event.target.value }))} aria-label="Start time" disabled={!canEdit} />
            <Input type="time" value={scheduleForm.end_time} onChange={(event) => setScheduleForm((current) => ({ ...current, end_time: event.target.value }))} aria-label="End time" disabled={!canEdit} />
            <Input type="number" min={1} value={scheduleForm.slot_capacity} onChange={(event) => setScheduleForm((current) => ({ ...current, slot_capacity: event.target.value }))} placeholder="Slot capacity" aria-label="Slot capacity" disabled={!canEdit} />
            <Select value={scheduleForm.status} onChange={(event) => setScheduleForm((current) => ({ ...current, status: event.target.value }))} aria-label="Schedule status" disabled={!canEdit}>
              <option value="available">Available</option>
              <option value="full">Full</option>
              <option value="leave">Leave</option>
            </Select>
            <Button type="submit" variant="primary" disabled={!canEdit || savingSchedule}>
              {savingSchedule ? "Saving..." : scheduleForm.id ? "Update" : "Add"}
            </Button>
          </form>

          {schedules.length === 0 ? (
            <p className="muted">No doctor schedules for this day.</p>
          ) : (
            <Table className="module-table" aria-label="Doctor schedules table">
              <TableHead>
                <TableCell>Doctor</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Capacity</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {schedules.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>{schedule.doctor_name}</TableCell>
                  <TableCell>{schedule.department || "-"}</TableCell>
                  <TableCell>{`${schedule.start_time} - ${schedule.end_time}`}</TableCell>
                  <TableCell>{schedule.slot_capacity || 12}</TableCell>
                  <TableCell>{schedule.status || "available"}</TableCell>
                  <TableCell>
                    <div className="module-inline-actions">
                      {canEdit ? (
                        <>
                          <Button
                            type="button"
                            onClick={() =>
                              setScheduleForm({
                                id: String(schedule.id),
                                doctor_name: schedule.doctor_name,
                                department: schedule.department || "",
                                schedule_date: schedule.schedule_date,
                                start_time: schedule.start_time,
                                end_time: schedule.end_time,
                                slot_capacity: String(schedule.slot_capacity || 12),
                                status: schedule.status || "available",
                                notes: schedule.notes || "",
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button type="button" variant="destructive" onClick={() => void deleteSchedule(schedule)}>
                            Delete
                          </Button>
                        </>
                      ) : (
                        <span className="muted">Read only</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          )}
        </div>

        <div className="panel">
          <div className="module-panel-head">
            <h3>Schedule OP Visit</h3>
          </div>
          <form className="module-form-grid module-sales-grid" onSubmit={handleAppointmentSubmit}>
            <Input value={appointmentForm.patient_id} onChange={(event) => setAppointmentForm((current) => ({ ...current, patient_id: event.target.value }))} placeholder="Patient ID" aria-label="OP patient id" disabled={!canEdit} />
            <Input value={appointmentForm.patient_name} onChange={(event) => setAppointmentForm((current) => ({ ...current, patient_name: event.target.value }))} placeholder="Patient name" aria-label="OP patient name" disabled={!canEdit} />
            <Input
              value={appointmentForm.doctor_name}
              onChange={(event) => {
                const nextDoctor = event.target.value;
                const matched = schedules.find((item) => item.doctor_name === nextDoctor);
                setAppointmentForm((current) => ({
                  ...current,
                  doctor_name: nextDoctor,
                  department: matched?.department || current.department,
                }));
              }}
              placeholder="Doctor name"
              aria-label="OP doctor"
              disabled={!canEdit}
              list="op-doctor-suggestions"
            />
            <datalist id="op-doctor-suggestions">
              {doctorNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <Select value={appointmentForm.department} onChange={(event) => setAppointmentForm((current) => ({ ...current, department: event.target.value }))} aria-label="OP department" disabled={!canEdit}>
              <option value="">Select department</option>
              {departments.map((department) => {
                const name = (department.department_name || "").trim();
                if (!name) return null;
                return (
                  <option key={department.id} value={name}>
                    {name}
                  </option>
                );
              })}
            </Select>
            <Input type="datetime-local" value={appointmentForm.appointment_date} onChange={(event) => setAppointmentForm((current) => ({ ...current, appointment_date: event.target.value }))} aria-label="OP appointment date" disabled={!canEdit} />
            <Select value={appointmentForm.appointment_kind} onChange={(event) => setAppointmentForm((current) => ({ ...current, appointment_kind: event.target.value }))} aria-label="Appointment kind" disabled={!canEdit}>
              <option value="new">New Visit</option>
              <option value="follow_up">Follow-up</option>
            </Select>
            <Select value={appointmentForm.status} onChange={(event) => setAppointmentForm((current) => ({ ...current, status: event.target.value }))} aria-label="Appointment status" disabled={!canEdit}>
              <option value="scheduled">Scheduled</option>
              <option value="checked_in">Checked In</option>
              <option value="in_consultation">In Consultation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Select value={appointmentForm.follow_up_for} onChange={(event) => setAppointmentForm((current) => ({ ...current, follow_up_for: event.target.value }))} aria-label="Follow up for" disabled={!canEdit || appointmentForm.appointment_kind !== "follow_up"}>
              <option value="">Follow-up of</option>
              {appointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {`${appointment.patient_name} (#${appointment.token_no})`}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={0}
              value={appointmentForm.consultation_fee}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, consultation_fee: event.target.value }))}
              placeholder="Consultation fee"
              aria-label="OP consultation fee"
              disabled={!canEdit}
            />
            <Select
              value={appointmentForm.payment_mode}
              onChange={(event) => setAppointmentForm((current) => ({ ...current, payment_mode: event.target.value }))}
              aria-label="OP payment mode"
              disabled={!canEdit}
            >
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank">Bank Transfer</option>
              <option value="cash">Cash</option>
            </Select>
            <Button type="submit" variant="primary" disabled={!canEdit || savingAppointment}>
              {savingAppointment ? "Saving..." : appointmentForm.id ? "Update" : "Schedule"}
            </Button>
            <Button type="button" variant="secondary" disabled={!canEdit || savingAppointment || !!appointmentForm.id || !isRazorpayReady} onClick={() => void handleRazorpayAppointmentSubmit()}>
              {savingAppointment ? "Processing..." : "Pay via Razorpay & Schedule"}
            </Button>
          </form>
          {!isRazorpayReady ? <p className="muted">Razorpay payments are disabled until backend keys are configured.</p> : null}

          <Table className="module-table module-table-op" aria-label="OP appointments table">
              <TableHead>
                <TableCell>Token</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Visit</TableCell>
                <TableCell>Reminder</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
            {appointments.length === 0 ? (
              <TableRow>
                <TableCell>-</TableCell>
                <TableCell>No appointments</TableCell>
                <TableCell>-</TableCell>
                <TableCell>-</TableCell>
                <TableCell>-</TableCell>
                <TableCell>-</TableCell>
              </TableRow>
            ) : (
              appointments.map((appointment) => (
                <TableRow key={appointment.id}>
                  <TableCell>{appointment.token_no}</TableCell>
                  <TableCell>{appointment.patient_name}</TableCell>
                <TableCell>{appointment.doctor_name || "-"}</TableCell>
                <TableCell>{formatDateTime(appointment.appointment_date)}</TableCell>
                <TableCell>{appointment.appointment_kind === "follow_up" ? "Follow-up" : "New"}</TableCell>
                <TableCell>{appointment.reminder_sent_at ? "Sent" : "Pending"}</TableCell>
                <TableCell>
                  <div className="module-inline-actions">
                      <Button
                        type="button"
                        onClick={() =>
                          setAppointmentForm({
                            id: String(appointment.id),
                            patient_id: appointment.patient_id || "",
                            patient_name: appointment.patient_name,
                            visit_type: appointment.visit_type,
                            department: appointment.department || "",
                            doctor_name: appointment.doctor_name || "",
                            appointment_date: toDateTimeLocalValue(appointment.appointment_date),
                            status: appointment.status,
                            appointment_kind: appointment.appointment_kind || "new",
                            follow_up_for: appointment.follow_up_for ? String(appointment.follow_up_for) : "",
                            consultation_fee: appointmentForm.consultation_fee,
                            payment_mode: appointmentForm.payment_mode || "upi",
                            notes: appointment.notes || "",
                          })
                        }
                      >
                        Edit
                      </Button>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void quickUpdateAppointment(appointment, appointment.status === "scheduled" ? "checked_in" : appointment.status === "checked_in" ? "in_consultation" : "completed")}
                        >
                          Advance
                        </Button>
                      ) : null}
                      {canEdit && !appointment.reminder_sent_at ? (
                        <Button type="button" variant="ghost" onClick={() => void markReminderSent(appointment)}>
                          Reminder
                        </Button>
                      ) : null}
                      {canEdit && appointment.status === "scheduled" && !appointment.no_show_marked ? (
                        <Button type="button" variant="destructive" onClick={() => void markNoShow(appointment)}>
                          No-Show
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </Table>
        </div>
      </div>
    </section>
  );
}
