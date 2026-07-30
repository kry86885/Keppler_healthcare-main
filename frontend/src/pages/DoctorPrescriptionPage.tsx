import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { FiActivity } from "react-icons/fi";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import type { Appointment, Notice } from "../types";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import Button from "../components/ui/Button";
import PatientJourneySteps from "../components/PatientJourneySteps";
import AppointmentQueueCard from "../components/AppointmentQueueCard";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
};

export default function DoctorPrescriptionPage({ setNotice, onNavigate }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadPrescriptionPatient, setUploadPrescriptionPatient] = useState<{ id: string; name: string; doctorName?: string } | null>(null);

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
      // Finishing the consultation hands the patient off to the checkout desk.
      if (status === "completed") {
        onNavigate?.("appointment-out");
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  return (
    <section className="module-page">
      <PatientJourneySteps current="doctor-prescription" onNavigate={onNavigate} />
      <div className="panel">
        <div className="module-panel-head">
          <h3>Patients In Consultation</h3>
        </div>
        {loading && appointments.length === 0 ? (
          <p className="muted">Loading consultations...</p>
        ) : appointments.length === 0 ? (
          <div className="module-empty-state">
            <span className="module-empty-state-icon">
              <FiActivity aria-hidden />
            </span>
            <p className="module-empty-state-title">No patients currently in consultation</p>
            <p className="module-empty-state-hint">Patients sent in from Queue Management will appear here automatically.</p>
          </div>
        ) : (
          <div className="queue-card-list" style={{ padding: "0 1rem 1rem" }}>
            {appointments.map((appointment) => (
              <AppointmentQueueCard
                key={appointment.id}
                appointment={appointment}
                actions={
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        setUploadPrescriptionPatient({
                          id: String(appointment.patient_id),
                          name: appointment.patient_name,
                          doctorName: appointment.doctor_name || undefined,
                        })
                      }
                    >
                      Upload Rx
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleStatusChange(appointment.id, "completed")}>
                      Complete Consultation
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>

      {uploadPrescriptionPatient && (
        <PrescriptionUploadModal
          patientId={uploadPrescriptionPatient.id}
          patientName={uploadPrescriptionPatient.name}
          doctorName={uploadPrescriptionPatient.doctorName}
          setNotice={setNotice}
          onClose={() => setUploadPrescriptionPatient(null)}
        />
      )}
    </section>
  );
}
