import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { FiActivity, FiUsers, FiCheckCircle, FiArrowRightCircle, FiUploadCloud, FiClock, FiFileText, FiInfo } from "react-icons/fi";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import type { Appointment, Notice } from "../types";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import Button from "../components/ui/Button";
import AppointmentQueueCard from "../components/AppointmentQueueCard";
import StatCard from "../components/StatCard";
import { formatDateTime } from "../lib/format";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
};

export default function DoctorPrescriptionPage({ setNotice, onNavigate }: Props) {
  const [activeAppointments, setActiveAppointments] = useState<Appointment[]>([]);
  const [queueAppointments, setQueueAppointments] = useState<Appointment[]>([]);
  const [seenCount, setSeenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploadPrescriptionPatient, setUploadPrescriptionPatient] = useState<{ id: string; name: string; doctorName?: string } | null>(null);

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      if (data && Array.isArray(data.appointments)) {
        const inConsultation = data.appointments.filter((a) => a.status === "in_consultation");
        const inQueue = data.appointments.filter((a) => a.status === "checked_in");
        const completed = data.appointments.filter((a) => a.status === "completed");
        
        setActiveAppointments(inConsultation);
        setQueueAppointments(inQueue);
        setSeenCount(completed.length);
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load appointments.");
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

  const handleCompleteAndCallNext = async (currentId: number) => {
    try {
      await updateAppointmentStatus(currentId, "completed");
      if (queueAppointments.length > 0) {
        const nextPatient = queueAppointments[0];
        await updateAppointmentStatus(nextPatient.id, "in_consultation");
        setNotice({ type: "success", message: `Completed previous. Called in ${nextPatient.patient_name}.` });
      } else {
        setNotice({ type: "success", message: `Consultation completed. No more patients in queue.` });
      }
      await loadAppointments();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Failed to complete and call next.");
    }
  };

  return (
    <section className="module-page" style={{ maxWidth: '1400px', margin: '0 auto', padding: '1rem' }}>
      
      <div className="module-panel-head">
        <h3>Doctor Workspace</h3>
        <p className="muted">Unified dashboard for queue management, consultations, and prescriptions.</p>
      </div>

      <div className="queue-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="queue-stat-card">
          <span className="queue-stat-icon queue-stat-icon-warning"><FiClock aria-hidden /></span>
          <span className="queue-stat-text">
            <span className="queue-stat-value">{queueAppointments.length}</span>
            <span className="queue-stat-label">Waiting in Queue</span>
          </span>
        </div>
        <div className="queue-stat-card">
          <span className="queue-stat-icon queue-stat-icon-info"><FiActivity aria-hidden /></span>
          <span className="queue-stat-text">
            <span className="queue-stat-value">{activeAppointments.length}</span>
            <span className="queue-stat-label">Active Consultations</span>
          </span>
        </div>
        <div className="queue-stat-card">
          <span className="queue-stat-icon queue-stat-icon-success"><FiCheckCircle aria-hidden /></span>
          <span className="queue-stat-text">
            <span className="queue-stat-value">{seenCount}</span>
            <span className="queue-stat-label">Patients Seen Today</span>
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Left Column: Active Consultation Hero */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="module-panel-head">
            <h3>
              <FiActivity style={{ marginRight: '0.5rem' }} /> Active Consultation
            </h3>
          </div>
          
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
            {loading && activeAppointments.length === 0 ? (
              <div className="panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>Loading active consultation...</p>
              </div>
            ) : activeAppointments.length === 0 ? (
              <div className="panel module-empty-state" style={{ padding: '4rem 2rem' }}>
                <span className="module-empty-state-icon" style={{ fontSize: '3rem', color: 'var(--color-border)' }}>
                  <FiCheckCircle aria-hidden />
                </span>
                <p className="module-empty-state-title" style={{ fontSize: '1.25rem', marginTop: '1rem' }}>No active consultation</p>
                <p className="module-empty-state-hint">You can call the next patient from the queue.</p>
                {queueAppointments.length > 0 && (
                  <Button 
                    style={{ marginTop: '1.5rem', padding: '0.75rem 1.5rem', fontSize: '1.1rem' }}
                    onClick={() => handleStatusChange(queueAppointments[0].id, "in_consultation")}
                  >
                    Call Next Patient ({queueAppointments[0].patient_name})
                  </Button>
                )}
              </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {activeAppointments.map((appointment) => (
                    <div key={appointment.id} style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1rem'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span style={{ 
                              display: 'inline-block',
                              fontSize: '0.75rem', 
                              fontWeight: 700, 
                              color: 'var(--color-primary)', 
                              textTransform: 'uppercase', 
                              letterSpacing: '0.1em',
                              background: 'rgba(37, 99, 235, 0.1)',
                              padding: '0.25rem 0.75rem',
                              borderRadius: '999px',
                              marginBottom: '0.75rem'
                            }}>
                              Token #{appointment.token_no}
                            </span>
                            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.01em', textTransform: 'capitalize' }}>
                              {appointment.patient_name}
                            </h4>
                            <div style={{ display: 'flex', gap: '1.5rem', color: '#64748b', fontSize: '0.95rem' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <FiActivity /> <strong>Type:</strong> {appointment.visit_type}
                              </span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <FiClock /> {formatDateTime(appointment.appointment_date)}
                              </span>
                            </div>
                          </div>
                          
                          <div style={{ 
                            background: '#eff6ff', 
                            color: '#1d4ed8', 
                            padding: '0.5rem 1.25rem', 
                            borderRadius: '999px',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            border: '1px solid #bfdbfe'
                          }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }}></span>
                            In Consultation
                          </div>
                        </div>

                        <div style={{ height: '1px', background: 'var(--color-border)', margin: '1.5rem 0', opacity: 0.6 }} />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                          <div style={{ 
                            padding: '1.25rem', 
                            background: '#fff', 
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem'
                          }}>
                            <h4 style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <FiFileText color="#94a3b8" /> Reported Symptoms
                            </h4>
                            <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.6, color: appointment.patient_symptoms ? '#334155' : '#94a3b8', fontStyle: appointment.patient_symptoms ? 'normal' : 'italic' }}>
                              {appointment.patient_symptoms || "No symptoms reported by patient or reception."}
                            </p>
                          </div>

                          {appointment.notes && (
                            <div style={{ 
                              padding: '1.25rem', 
                              background: '#f8fafc', 
                              borderRadius: '12px',
                              border: '1px dashed #cbd5e1',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem'
                            }}>
                              <h4 style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FiInfo color="#94a3b8" /> Reception Notes
                              </h4>
                              <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.5, color: '#475569' }}>
                                {appointment.notes}
                              </p>
                            </div>
                          )}
                        </div>
                        <div style={{ height: '1px', background: 'var(--color-border)', margin: '1.5rem 0', opacity: 0.6 }} />

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <Button
                              type="button"
                              variant="primary"
                              style={{ padding: '1.25rem', fontSize: '1.1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', fontWeight: 700, boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)' }}
                              onClick={() =>
                                setUploadPrescriptionPatient({
                                  id: String(appointment.patient_id),
                                  name: appointment.patient_name,
                                  doctorName: appointment.doctor_name || undefined,
                                })
                              }
                            >
                              <FiUploadCloud size={24} /> Upload Prescription (OCR)
                            </Button>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                              <Button 
                                type="button" 
                                variant="secondary" 
                                style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 600, background: '#fff' }}
                                onClick={() => void handleStatusChange(appointment.id, "completed")}
                              >
                                Complete Only
                              </Button>
                              <Button 
                                type="button" 
                                variant="secondary"
                                style={{ padding: '1rem', fontSize: '1.05rem', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
                                onClick={() => void handleCompleteAndCallNext(appointment.id)}
                              >
                                Complete & Call Next <FiArrowRightCircle size={20} />
                              </Button>
                            </div>
                          </div>
                      </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Patients Waiting in Queue */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="module-panel-head">
            <h3>
              <FiUsers style={{ marginRight: '0.5rem' }} /> Up Next ({queueAppointments.length})
            </h3>
          </div>
          
          <div style={{ padding: '1.5rem', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {loading && queueAppointments.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center' }}>Loading queue...</p>
            ) : queueAppointments.length === 0 ? (
              <div className="module-empty-state" style={{ padding: '3rem 1rem' }}>
                <span className="module-empty-state-icon">
                  <FiUsers aria-hidden />
                </span>
                <p className="module-empty-state-title">Queue is empty</p>
                <p className="module-empty-state-hint">All caught up!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {queueAppointments.map((appointment, index) => (
                  <div key={appointment.id} style={{
                    background: 'var(--color-bg)',
                    padding: '1.25rem',
                    borderRadius: '10px',
                    borderLeft: index === 0 ? '4px solid var(--color-primary)' : '1px solid var(--color-border)',
                    boxShadow: index === 0 ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                        Token #{appointment.token_no}
                      </span>
                      {index === 0 && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', background: '#e0f2fe', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          NEXT
                        </span>
                      )}
                    </div>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>{appointment.patient_name}</h4>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{appointment.visit_type}</p>
                    </div>
                    <Button 
                      type="button" 
                      size="sm" 
                      variant={index === 0 ? "primary" : "secondary"}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                      onClick={() => void handleStatusChange(appointment.id, "in_consultation")}
                    >
                      Call Patient In
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
