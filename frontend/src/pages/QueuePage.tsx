import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Select } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import { formatDateTime } from "../lib/format";
import type { Appointment, Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

const ACTIVE_STATUSES = ["scheduled", "checked_in", "in_consultation"];

export default function QueuePage({ setNotice }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [doctorFilter, setDoctorFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      setAppointments(data.appointments || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load the queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAppointments();
  }, []);

  const doctorOptions = useMemo(
    () => Array.from(new Set(appointments.map((item) => (item.doctor_name || "").trim()).filter(Boolean))).sort(),
    [appointments]
  );
  const departmentOptions = useMemo(
    () => Array.from(new Set(appointments.map((item) => (item.department || "").trim()).filter(Boolean))).sort(),
    [appointments]
  );

  const filteredAppointments = useMemo(
    () =>
      appointments.filter((item) => {
        if (doctorFilter && (item.doctor_name || "").trim() !== doctorFilter) return false;
        if (departmentFilter && (item.department || "").trim() !== departmentFilter) return false;
        if (statusFilter && item.status !== statusFilter) return false;
        return true;
      }),
    [appointments, doctorFilter, departmentFilter, statusFilter]
  );

  const waitingCount = useMemo(
    () => appointments.filter((item) => ACTIVE_STATUSES.includes(item.status)).length,
    [appointments]
  );

  const handleStatusChange = async (appointmentId: number, status: string) => {
    try {
      await updateAppointmentStatus(appointmentId, status);
      await loadAppointments();
      setNotice({ type: "success", message: `Token status updated to ${status.replace("_", " ")}.` });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <h3>Queue Management</h3>
        <p className="muted">{waitingCount} token(s) waiting or in progress today.</p>
      </div>

      <div className="panel">
        <div className="module-inline-actions">
          <Select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} aria-label="Filter by doctor">
            <option value="">All Doctors</option>
            {doctorOptions.map((doctor) => (
              <option key={doctor} value={doctor}>
                {doctor}
              </option>
            ))}
          </Select>
          <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
            <option value="">All Departments</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
            <option value="">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="checked_in">Checked In</option>
            <option value="in_consultation">In Consultation</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Button type="button" variant="ghost" onClick={() => void loadAppointments()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="panel">
        {loading ? <p className="muted">Loading queue...</p> : null}
        {!loading && filteredAppointments.length === 0 ? <p className="muted">No appointments match this filter.</p> : null}
        {!loading && filteredAppointments.length > 0 ? (
          <div className="module-mobile-list" style={{ display: "grid" }}>
            {filteredAppointments.map((appointment) => (
              <article className="module-mobile-card" key={appointment.id}>
                <h4>
                  Token #{appointment.token_no} · {appointment.patient_name}
                </h4>
                <p><strong>Visit:</strong> {appointment.visit_type}</p>
                <p><strong>Department:</strong> {appointment.department || "-"}</p>
                <p><strong>Doctor:</strong> {appointment.doctor_name || "-"}</p>
                <p><strong>Time:</strong> {formatDateTime(appointment.appointment_date)}</p>
                <p><strong>Status:</strong> {appointment.status.replace("_", " ")}</p>
                <div className="module-card-actions">
                  {appointment.status === "scheduled" ? (
                    <Button type="button" size="sm" onClick={() => void handleStatusChange(appointment.id, "checked_in")}>
                      Check In
                    </Button>
                  ) : null}
                  {appointment.status === "checked_in" ? (
                    <Button type="button" size="sm" onClick={() => void handleStatusChange(appointment.id, "in_consultation")}>
                      Start Consultation
                    </Button>
                  ) : null}
                  {appointment.status === "in_consultation" ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleStatusChange(appointment.id, "completed")}>
                      Complete
                    </Button>
                  ) : null}
                  {appointment.status !== "completed" && appointment.status !== "cancelled" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => void handleStatusChange(appointment.id, "cancelled")}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
