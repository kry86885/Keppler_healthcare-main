export type AppointmentStatusTone = "scheduled" | "checked-in" | "in-consultation" | "completed" | "cancelled";

type StatusMeta = {
  label: string;
  tone: AppointmentStatusTone;
};

const STATUS_META: Record<string, StatusMeta> = {
  scheduled: { label: "Scheduled", tone: "scheduled" },
  checked_in: { label: "Checked In", tone: "checked-in" },
  in_consultation: { label: "In Consultation", tone: "in-consultation" },
  completed: { label: "Completed", tone: "completed" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
};

export function getAppointmentStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] || { label: status.replace(/_/g, " "), tone: "scheduled" };
}

export const APPOINTMENT_STATUS_ORDER = ["scheduled", "checked_in", "in_consultation", "completed", "cancelled"];
