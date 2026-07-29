import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import { formatDateTime } from "../lib/format";
import type { Appointment, Notice } from "../types";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import Button from "../components/ui/Button";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

export default function DoctorPrescriptionPage({ setNotice }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadPrescriptionPatient, setUploadPrescriptionPatient] = useState<{ id: string; name: string } | null>(null);

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      if (data && Array.isArray(data.appointments)) {
        const inConsultation = data.appointments.filter((a) => a.status === "in_consultation");
        setAppointments(inConsultation);
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load active consultations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAppointments();
    const interval = setInterval(() => void loadAppointments(), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleStatusChange = async (id: number, status: Appointment["status"]) => {
    try {
      await updateAppointmentStatus(id, status);
      setNotice({ type: "success", message: `Appointment status updated to ${status}.` });
      await loadAppointments();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  return (
    <section className="module-page">
      <div className="panel">
        <div className="module-panel-head">
          <h3>Patients In Consultation</h3>
        </div>
        {loading && appointments.length === 0 ? (
          <p className="muted">Loading consultations...</p>
        ) : appointments.length === 0 ? (
          <p className="muted" style={{ padding: "1rem" }}>No patients currently in consultation.</p>
        ) : (
          <div className="module-grid" style={{ padding: "1rem" }}>
            {appointments.map((appointment) => (
              <article className="module-mobile-card" key={appointment.id}>
                <h4>
                  Token #{appointment.token_no} · {appointment.patient_name}
                </h4>
                <p><strong>Visit:</strong> {appointment.visit_type}</p>
                <p><strong>Department:</strong> {appointment.department || "-"}</p>
                <p><strong>Doctor:</strong> {appointment.doctor_name || "-"}</p>
                <p><strong>Time:</strong> {formatDateTime(appointment.appointment_date)}</p>
                <p><strong>Status:</strong> In Consultation</p>
                <div className="module-card-actions" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                  <Button type="button" size="sm" onClick={() => setUploadPrescriptionPatient({ id: String(appointment.patient_id), name: appointment.patient_name })}>
                    Upload Rx
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handleStatusChange(appointment.id, "completed")}>
                    Complete Consultation
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {uploadPrescriptionPatient && (
        <PrescriptionUploadModal
          patientId={uploadPrescriptionPatient.id}
          patientName={uploadPrescriptionPatient.name}
          setNotice={setNotice}
          onClose={() => setUploadPrescriptionPatient(null)}
        />
      )}
    </section>
  );
}
