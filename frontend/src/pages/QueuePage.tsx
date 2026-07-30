import { useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { FiActivity, FiCheckCircle, FiClock, FiRefreshCw, FiUserCheck, FiUsers, FiXCircle } from "react-icons/fi";
import { Button, Select } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import { getAppointmentStatusMeta } from "../lib/appointmentStatus";
import type { Appointment, Notice } from "../types";
import PatientJourneySteps from "../components/PatientJourneySteps";
import AppointmentQueueCard from "../components/AppointmentQueueCard";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
  /** Receptionists only check patients in; the doctor/consultation actions are handled downstream. */
  isReceptionist?: boolean;
};

const ACTIVE_STATUSES = ["scheduled", "checked_in", "in_consultation"];

const STAT_CARDS: { status: string; label: string; icon: ReactNode }[] = [
  { status: "scheduled", label: "Waiting", icon: <FiClock aria-hidden /> },
  { status: "checked_in", label: "Checked In", icon: <FiUserCheck aria-hidden /> },
  { status: "in_consultation", label: "In Consultation", icon: <FiActivity aria-hidden /> },
  { status: "completed", label: "Completed", icon: <FiCheckCircle aria-hidden /> },
  { status: "cancelled", label: "Cancelled", icon: <FiXCircle aria-hidden /> },
];

export default function QueuePage({ setNotice, onNavigate, isReceptionist }: Props) {
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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    appointments.forEach((item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });
    return counts;
  }, [appointments]);

  const hasActiveFilters = Boolean(doctorFilter || departmentFilter || statusFilter);

  const clearFilters = () => {
    setDoctorFilter("");
    setDepartmentFilter("");
    setStatusFilter("");
  };

  const handleStatusChange = async (appointmentId: number, status: string) => {
    try {
      await updateAppointmentStatus(appointmentId, status);
      await loadAppointments();
      setNotice({ type: "success", message: `Token status updated to ${status.replace("_", " ")}.` });
      // Check-in and cancellation keep the patient in this desk's queue; consultation
      // start/finish hand the patient off to the next desk, so follow them there.
      if (status === "in_consultation") {
        onNavigate?.("doctor-prescription");
      } else if (status === "completed") {
        onNavigate?.("appointment-out");
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  return (
    <section className="module-page">
      <PatientJourneySteps current="queue" onNavigate={onNavigate} />

      <div className="module-panel-head">
        <h3>Queue Management</h3>
        <p className="muted">{waitingCount} token(s) waiting or in progress today.</p>
      </div>

      <div className="queue-stats">
        {STAT_CARDS.map((card) => {
          const tone = getAppointmentStatusMeta(card.status).tone;
          return (
            <div className="queue-stat-card" key={card.status}>
              <span className={`queue-stat-icon queue-stat-icon-${tone}`}>{card.icon}</span>
              <span className="queue-stat-text">
                <span className="queue-stat-value">{statusCounts[card.status] || 0}</span>
                <span className="queue-stat-label">{card.label}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="queue-toolbar">
          <div className="queue-toolbar-field">
            <label htmlFor="queue-filter-doctor">Doctor</label>
            <Select id="queue-filter-doctor" value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}>
              <option value="">All Doctors</option>
              {doctorOptions.map((doctor) => (
                <option key={doctor} value={doctor}>
                  {doctor}
                </option>
              ))}
            </Select>
          </div>
          <div className="queue-toolbar-field">
            <label htmlFor="queue-filter-department">Department</label>
            <Select id="queue-filter-department" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="">All Departments</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </Select>
          </div>
          <div className="queue-toolbar-field">
            <label htmlFor="queue-filter-status">Status</label>
            <Select id="queue-filter-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="checked_in">Checked In</option>
              <option value="in_consultation">In Consultation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Clear Filters
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="queue-toolbar-refresh" onClick={() => void loadAppointments()}>
            <FiRefreshCw aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      <div className="panel">
        {loading ? <p className="muted">Loading queue...</p> : null}
        {!loading && filteredAppointments.length === 0 ? (
          <div className="module-empty-state">
            <span className="module-empty-state-icon">
              <FiUsers aria-hidden />
            </span>
            <p className="module-empty-state-title">
              {appointments.length === 0 ? "No appointments scheduled today" : "No appointments match this filter"}
            </p>
            <p className="module-empty-state-hint">
              {appointments.length === 0
                ? "Register a patient and book an appointment to see their token appear here."
                : "Try clearing the doctor, department, or status filters above."}
            </p>
          </div>
        ) : null}
        {!loading && filteredAppointments.length > 0 ? (
          <div className="queue-card-list">
            {filteredAppointments.map((appointment) => (
              <AppointmentQueueCard
                key={appointment.id}
                appointment={appointment}
                actions={
                  <>
                    {appointment.status === "scheduled" ? (
                      <Button type="button" size="sm" onClick={() => void handleStatusChange(appointment.id, "checked_in")}>
                        Check In
                      </Button>
                    ) : null}
                    {!isReceptionist && appointment.status === "checked_in" ? (
                      <Button type="button" size="sm" onClick={() => void handleStatusChange(appointment.id, "in_consultation")}>
                        Start Consultation
                      </Button>
                    ) : null}
                    {!isReceptionist && appointment.status === "in_consultation" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleStatusChange(appointment.id, "completed")}>
                        Complete
                      </Button>
                    ) : null}
                    {!isReceptionist && appointment.status !== "completed" && appointment.status !== "cancelled" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void handleStatusChange(appointment.id, "cancelled")}>
                        Cancel
                      </Button>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
