import { apiFetch } from "./api";

export async function updateAppointmentStatus(appointmentId: number, status: string) {
  return apiFetch(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
