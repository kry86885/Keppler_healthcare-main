import type { ReactNode } from "react";
import { FiClock, FiHome, FiTag, FiUser } from "react-icons/fi";
import { formatDateTime } from "../lib/format";
import { getAppointmentStatusMeta } from "../lib/appointmentStatus";
import type { Appointment } from "../types";

type Props = {
  appointment: Appointment;
  actions?: ReactNode;
};

export default function AppointmentQueueCard({ appointment, actions }: Props) {
  const statusMeta = getAppointmentStatusMeta(appointment.status);

  return (
    <article className={`queue-card queue-card-${statusMeta.tone}`}>
      <div className="queue-card-token">
        <span className="queue-card-token-num">{appointment.token_no}</span>
        <span className="queue-card-token-label">Token</span>
      </div>

      <div className="queue-card-body">
        <div className="queue-card-top">
          <h4 className="queue-card-name">{appointment.patient_name}</h4>
          <span className={`queue-status-pill queue-status-pill-${statusMeta.tone}`}>{statusMeta.label}</span>
        </div>
        <div className="queue-card-meta">
          <span className="queue-meta-item">
            <FiTag aria-hidden /> {appointment.visit_type}
          </span>
          {appointment.department ? (
            <span className="queue-meta-item">
              <FiHome aria-hidden /> {appointment.department}
            </span>
          ) : null}
          {appointment.doctor_name ? (
            <span className="queue-meta-item">
              <FiUser aria-hidden /> {appointment.doctor_name}
            </span>
          ) : null}
          <span className="queue-meta-item">
            <FiClock aria-hidden /> {formatDateTime(appointment.appointment_date)}
          </span>
        </div>
        {appointment.notes ? <p className="queue-card-notes">{appointment.notes}</p> : null}
      </div>

      {actions ? <div className="queue-card-actions">{actions}</div> : null}
    </article>
  );
}
