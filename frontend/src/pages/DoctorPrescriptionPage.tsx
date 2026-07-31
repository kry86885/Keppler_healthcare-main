import { useState, useEffect, useCallback } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  FiActivity, FiUsers, FiCheckCircle, FiArrowRightCircle,
  FiUploadCloud, FiClock, FiFileText, FiInfo, FiUser,
  FiCalendar, FiSearch, FiRefreshCw, FiEdit3, FiTrash2,
  FiPlus, FiX, FiAlertCircle, FiHeart, FiThermometer,
  FiZap, FiBookOpen, FiList, FiGrid, FiChevronRight,
  FiStar, FiPhone, FiMapPin, FiPrinter
} from "react-icons/fi";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import type { Appointment, Notice } from "../types";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import Button from "../components/ui/Button";
import { formatDateTime } from "../lib/format";

/* ─── Types ─────────────────────────────────────────────── */
type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
};

type Doctor = {
  id: number;
  doctor_name: string;
  department: string;
  consultation_fee: number;
  review_fee: number;
  status: string;
};

type Department = { id: number; department_name?: string };

type DoctorForm = {
  id: string;
  doctor_name: string;
  department: string;
  consultation_fee: string;
  review_fee: string;
  status: string;
};

type EmrData = {
  patient?: { name?: string; age?: number; gender?: string; blood_group?: string; phone?: string; address?: string };
  appointments?: { id: number; appointment_date: string; doctor_name?: string; visit_type?: string; status?: string; notes?: string }[];
  prescriptions?: { id: number; uploaded_at?: string; extracted_text?: string }[];
  lab_results?: { id: number; test_name?: string; result_value?: string; status?: string; created_at?: string }[];
};

type Tab = "workspace" | "schedule" | "emr" | "history";

const DEFAULT_FORM: DoctorForm = { id: "", doctor_name: "", department: "", consultation_fee: "0", review_fee: "0", status: "available" };

/* ─── Sub-components ─────────────────────────────────────── */

function StatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.9rem",
      background: "#fff", borderRadius: "14px", padding: "1rem 1.4rem",
      border: "1px solid #e8edf5", boxShadow: "0 2px 8px rgba(15,23,42,0.06)",
      minWidth: 0, flex: "1 1 0", transition: "box-shadow 0.2s",
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(15,23,42,0.10)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,0.06)")}
    >
      <span style={{
        width: 44, height: 44, borderRadius: "12px", background: color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "1.25rem", flexShrink: 0,
      }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{value}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</span>
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
      {children}
    </div>
  );
}

function InfoChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", color: "#475569", background: "#f1f5f9", padding: "0.35rem 0.75rem", borderRadius: "8px", fontWeight: 500 }}>
      {icon} {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    available: { bg: "#dcfce7", color: "#16a34a", label: "Available" },
    leave:     { bg: "#fee2e2", color: "#dc2626", label: "On Leave" },
    busy:      { bg: "#fef9c3", color: "#ca8a04", label: "Busy" },
  };
  const s = map[status] ?? { bg: "#f1f5f9", color: "#64748b", label: status };
  return (
    <span style={{ fontSize: "0.78rem", fontWeight: 700, background: s.bg, color: s.color, padding: "0.25rem 0.7rem", borderRadius: "999px" }}>
      {s.label}
    </span>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function DoctorPrescriptionPage({ setNotice, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("workspace");
  const [activeAppointments, setActiveAppointments] = useState<Appointment[]>([]);
  const [queueAppointments, setQueueAppointments] = useState<Appointment[]>([]);
  const [seenCount, setSeenCount] = useState(0);
  const [noShowCount, setNoShowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadPrescriptionPatient, setUploadPrescriptionPatient] = useState<{ id: string; name: string; doctorName?: string } | null>(null);

  // Doctor scheduling state
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctorForm, setDoctorForm] = useState<DoctorForm>(DEFAULT_FORM);
  const [savingDoctor, setSavingDoctor] = useState(false);
  const [departmentInput, setDepartmentInput] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");

  // EMR search state
  const [emrQuery, setEmrQuery] = useState("");
  const [emrResults, setEmrResults] = useState<{ id: number; patient_name: string; uhid?: string }[]>([]);
  const [emrLoading, setEmrLoading] = useState(false);
  const [selectedEmrPatient, setSelectedEmrPatient] = useState<string | null>(null);
  const [emrData, setEmrData] = useState<EmrData | null>(null);
  const [emrTab, setEmrTab] = useState<"overview" | "prescriptions" | "labs">("overview");

  // History state
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [historyAppointments, setHistoryAppointments] = useState<Appointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* ── Appointments loader ── */
  const loadAppointments = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      if (data?.appointments) {
        setActiveAppointments(data.appointments.filter(a => a.status === "in_consultation"));
        setQueueAppointments(data.appointments.filter(a => a.status === "checked_in"));
        setSeenCount(data.appointments.filter(a => a.status === "completed").length);
        setNoShowCount(data.appointments.filter(a => a.status === "no_show").length);
      }
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Unable to load appointments.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setNotice]);

  /* ── Doctors + Departments loader ── */
  const loadSchedulingData = useCallback(async () => {
    try {
      const [deptData, docData] = await Promise.all([
        apiFetch<{ departments?: Department[] }>("/api/registration/departments"),
        apiFetch<{ doctors?: Doctor[] }>("/api/op/doctors"),
      ]);
      setDepartments(deptData.departments ?? []);
      setDoctors(docData.doctors ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    void loadAppointments();
    void loadSchedulingData();
    const interval = setInterval(() => void loadAppointments(true), 30000);
    return () => clearInterval(interval);
  }, [loadAppointments, loadSchedulingData]);

  /* ── History loader ── */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${historyDate}`);
      setHistoryAppointments(data?.appointments ?? []);
    } catch { setHistoryAppointments([]); }
    finally { setHistoryLoading(false); }
  }, [historyDate]);

  useEffect(() => { if (activeTab === "history") void loadHistory(); }, [activeTab, loadHistory]);

  /* ── Appointment actions ── */
  const handleStatus = async (id: number, status: Appointment["status"]) => {
    try {
      await updateAppointmentStatus(id, status);
      setNotice({ type: "success", message: `Status → ${status}` });
      await loadAppointments(true);
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Could not update status.");
    }
  };

  const handleCompleteAndNext = async (currentId: number) => {
    try {
      await updateAppointmentStatus(currentId, "completed");
      if (queueAppointments.length > 0) {
        await updateAppointmentStatus(queueAppointments[0].id, "in_consultation");
        setNotice({ type: "success", message: `Called in ${queueAppointments[0].patient_name}.` });
      } else {
        setNotice({ type: "success", message: "Consultation done. Queue is clear." });
      }
      await loadAppointments(true);
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Failed to advance queue.");
    }
  };

  /* ── Doctor CRUD ── */
  const handleDoctorSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!doctorForm.doctor_name.trim() || !doctorForm.department.trim()) {
      setNotice({ type: "error", message: "Doctor name and department are required." });
      return;
    }
    setSavingDoctor(true);
    try {
      const id = Number(doctorForm.id);
      await apiFetch(id ? `/api/op/doctors/${id}` : "/api/op/doctors", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          doctor_name: doctorForm.doctor_name.trim(),
          department: doctorForm.department.trim(),
          consultation_fee: Number(doctorForm.consultation_fee) || 0,
          review_fee: Number(doctorForm.review_fee) || 0,
          status: doctorForm.status,
        }),
      });
      setDoctorForm(DEFAULT_FORM);
      setNotice({ type: "success", message: id ? "Doctor updated." : "Doctor added." });
      await loadSchedulingData();
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Unable to save doctor.");
    } finally { setSavingDoctor(false); }
  };

  const handleDeleteDoctor = async (id: number) => {
    if (!confirm("Delete this doctor?")) return;
    try {
      await apiFetch(`/api/op/doctors/${id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Doctor deleted." });
      await loadSchedulingData();
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Unable to delete doctor.");
    }
  };

  const handleAddDepartment = async () => {
    if (!departmentInput.trim()) return;
    try {
      await apiFetch("/api/registration/departments", { method: "POST", body: JSON.stringify({ department_name: departmentInput.trim() }) });
      setDepartmentInput("");
      setNotice({ type: "success", message: "Department added." });
      await loadSchedulingData();
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Failed to add department.");
    }
  };

  /* ── EMR Search ── */
  const handleEmrSearch = async () => {
    if (!emrQuery.trim()) return;
    setEmrLoading(true);
    try {
      const res = await apiFetch<{ id: number; patient_name: string; uhid?: string }[]>(`/api/emr/search?q=${encodeURIComponent(emrQuery)}`);
      setEmrResults(Array.isArray(res) ? res : []);
    } catch { setEmrResults([]); }
    finally { setEmrLoading(false); }
  };

  const handleSelectEmrPatient = async (pid: string) => {
    setSelectedEmrPatient(pid);
    setEmrData(null);
    setEmrLoading(true);
    try {
      const data = await apiFetch<EmrData>(`/api/emr/${pid}`);
      setEmrData(data);
    } catch { setEmrData(null); }
    finally { setEmrLoading(false); }
  };

  /* ─── Styles ─────────────────────────────────────────── */
  const cardStyle: React.CSSProperties = {
    background: "#fff", borderRadius: "16px",
    border: "1px solid #e8edf5", boxShadow: "0 2px 12px rgba(15,23,42,0.07)",
    overflow: "hidden",
  };

  const panelHeadStyle: React.CSSProperties = {
    padding: "1.1rem 1.5rem", borderBottom: "1px solid #f0f4f8",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "linear-gradient(135deg,#f8faff 0%,#fff 100%)",
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.6rem 1.35rem", borderRadius: "10px", border: "none", cursor: "pointer",
    fontWeight: active ? 700 : 500, fontSize: "0.88rem",
    background: active ? "#1d4ed8" : "transparent",
    color: active ? "#fff" : "#64748b",
    transition: "all 0.18s",
    display: "flex", alignItems: "center", gap: "0.45rem",
  });

  const inputStyle: React.CSSProperties = {
    padding: "0.65rem 1rem", borderRadius: "10px",
    border: "1px solid #dde3ee", fontSize: "0.9rem",
    outline: "none", background: "#f8faff", width: "100%", boxSizing: "border-box",
    color: "#0f172a", fontFamily: "inherit",
  };

  const filteredDoctors = doctors.filter(d =>
    d.doctor_name.toLowerCase().includes(doctorSearch.toLowerCase()) ||
    d.department?.toLowerCase().includes(doctorSearch.toLowerCase())
  );

  /* ─── RENDER ─────────────────────────────────────────── */
  return (
    <section style={{ maxWidth: 1480, margin: "0 auto", padding: "1.25rem 1.5rem", fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

      {/* ── PAGE HEADER ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            👨‍⚕️ Doctor Workspace
          </h2>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.92rem", color: "#64748b", fontWeight: 500 }}>
            Live queue · Consultations · Prescriptions · Scheduling · EMR
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{
            fontSize: "0.82rem", fontWeight: 600, color: "#16a34a",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            padding: "0.4rem 0.9rem", borderRadius: "999px",
            display: "flex", alignItems: "center", gap: "0.4rem",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block", animation: "pulse 1.5s infinite" }} />
            Live · Auto-refreshes every 30s
          </span>
          <button
            onClick={() => void loadAppointments(true)}
            style={{ ...tabBtnStyle(false), background: "#f1f5f9", border: "1px solid #dde3ee" }}
            title="Refresh now"
          >
            <FiRefreshCw size={15} style={{ animation: refreshing ? "spin 0.7s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── STAT PILLS ── */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <StatPill icon={<FiClock color="#f59e0b" />} label="Waiting" value={queueAppointments.length} color="#fffbeb" />
        <StatPill icon={<FiActivity color="#3b82f6" />} label="In Consultation" value={activeAppointments.length} color="#eff6ff" />
        <StatPill icon={<FiCheckCircle color="#10b981" />} label="Seen Today" value={seenCount} color="#ecfdf5" />
        <StatPill icon={<FiAlertCircle color="#ef4444" />} label="No-Shows" value={noShowCount} color="#fef2f2" />
        <StatPill icon={<FiUsers color="#8b5cf6" />} label="Doctors on Duty" value={doctors.filter(d => d.status === "available").length} color="#f5f3ff" />
      </div>

      {/* ── TABS ── */}
      <div style={{
        display: "flex", gap: "0.4rem", background: "#f1f5f9",
        borderRadius: "14px", padding: "0.4rem", marginBottom: "1.5rem",
        width: "fit-content", flexWrap: "wrap",
      }}>
        {([
          { id: "workspace", icon: <FiGrid size={14} />, label: "Workspace" },
          { id: "schedule",  icon: <FiCalendar size={14} />, label: "Doctors & Scheduling" },
          { id: "emr",       icon: <FiBookOpen size={14} />, label: "EMR Lookup" },
          { id: "history",   icon: <FiList size={14} />, label: "Appointment History" },
        ] as const).map(t => (
          <button key={t.id} style={tabBtnStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════
          TAB 1 — WORKSPACE
      ════════════════════════════════════════════════════ */}
      {activeTab === "workspace" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* ── LEFT: Active Consultation Hero ── */}
          <div style={cardStyle}>
            <div style={panelHeadStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ width: 32, height: 32, borderRadius: "9px", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FiActivity color="#3b82f6" size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a" }}>Active Consultation</div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Current patient in room</div>
                </div>
              </div>
              {activeAppointments.length > 0 && (
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "0.3rem 0.8rem", borderRadius: "999px", border: "1px solid #bfdbfe" }}>
                  {activeAppointments.length} active
                </span>
              )}
            </div>

            <div style={{ padding: "1.5rem" }}>
              {loading && activeAppointments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#94a3b8" }}>
                  <FiRefreshCw size={28} style={{ animation: "spin 1s linear infinite", marginBottom: "1rem" }} />
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>Loading…</p>
                </div>
              ) : activeAppointments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3.5rem 1.5rem" }}>
                  <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>🩺</div>
                  <p style={{ fontWeight: 700, fontSize: "1.05rem", color: "#334155", margin: "0 0 0.5rem" }}>No active consultation</p>
                  <p style={{ fontSize: "0.88rem", color: "#94a3b8", margin: "0 0 1.5rem" }}>Call a patient from the queue to begin</p>
                  {queueAppointments.length > 0 && (
                    <Button
                      onClick={() => void handleStatus(queueAppointments[0].id, "in_consultation")}
                      style={{ padding: "0.85rem 2rem", fontSize: "0.95rem", fontWeight: 700, borderRadius: "12px", boxShadow: "0 4px 14px rgba(29,78,216,0.25)" }}
                    >
                      <FiArrowRightCircle size={18} /> Call {queueAppointments[0].patient_name}
                    </Button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  {activeAppointments.map(appt => (
                    <div key={appt.id}>
                      {/* Patient banner */}
                      <div style={{
                        background: "linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%)",
                        borderRadius: "14px", padding: "1.5rem",
                        color: "#fff", marginBottom: "1.25rem",
                        position: "relative", overflow: "hidden",
                      }}>
                        <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
                        <div style={{ position: "absolute", top: 30, right: 40, width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />

                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                          <div>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                              Token #{appt.token_no} · In Consultation
                            </span>
                            <h3 style={{ margin: "0.4rem 0 0.5rem", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", textTransform: "capitalize" }}>
                              {appt.patient_name}
                            </h3>
                            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                              <InfoChip icon={<FiActivity size={13} />} text={appt.visit_type ?? "—"} />
                              <InfoChip icon={<FiClock size={13} />} text={formatDateTime(appt.appointment_date)} />
                              {appt.doctor_name && <InfoChip icon={<FiUser size={13} />} text={appt.doctor_name} />}
                            </div>
                          </div>
                          <div style={{
                            background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)",
                            borderRadius: "12px", padding: "0.75rem 1.25rem", textAlign: "center",
                            border: "1px solid rgba(255,255,255,0.18)", minWidth: 80,
                          }}>
                            <div style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1 }}>#{appt.token_no}</div>
                            <div style={{ fontSize: "0.7rem", color: "#bfdbfe", fontWeight: 600, marginTop: 2 }}>TOKEN</div>
                          </div>
                        </div>
                      </div>

                      {/* Symptoms + Notes */}
                      <div style={{ display: "grid", gridTemplateColumns: appt.notes ? "1fr 1fr" : "1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                        <div style={{ background: "#f8faff", borderRadius: "12px", padding: "1.1rem", border: "1px solid #e2e8f0" }}>
                          <SectionLabel><FiFileText size={11} /> Reported Symptoms</SectionLabel>
                          <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.65, color: appt.patient_symptoms ? "#334155" : "#94a3b8", fontStyle: appt.patient_symptoms ? "normal" : "italic" }}>
                            {appt.patient_symptoms || "No symptoms reported."}
                          </p>
                        </div>
                        {appt.notes && (
                          <div style={{ background: "#fffcf0", borderRadius: "12px", padding: "1.1rem", border: "1px dashed #fbbf24" }}>
                            <SectionLabel><FiInfo size={11} /> Reception Notes</SectionLabel>
                            <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.65, color: "#78350f" }}>{appt.notes}</p>
                          </div>
                        )}
                      </div>

                      {/* Vital placeholders */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
                        {[
                          { icon: <FiHeart color="#ef4444" size={15} />, label: "Heart Rate", value: "—  bpm" },
                          { icon: <FiThermometer color="#f59e0b" size={15} />, label: "Temp", value: "—  °F" },
                          { icon: <FiActivity color="#3b82f6" size={15} />, label: "BP", value: "—/—" },
                          { icon: <FiZap color="#8b5cf6" size={15} />, label: "SpO₂", value: "—  %" },
                        ].map(v => (
                          <div key={v.label} style={{ background: "#f8faff", borderRadius: "10px", padding: "0.8rem", border: "1px solid #e8edf5", textAlign: "center" }}>
                            <div style={{ marginBottom: 4 }}>{v.icon}</div>
                            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>{v.value}</div>
                            <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{v.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                        <button
                          onClick={() => setUploadPrescriptionPatient({ id: String(appt.patient_id), name: appt.patient_name, doctorName: appt.doctor_name ?? undefined })}
                          style={{
                            width: "100%", padding: "1rem 1.5rem", borderRadius: "12px",
                            background: "linear-gradient(135deg,#1d4ed8,#2563eb)",
                            color: "#fff", border: "none", cursor: "pointer",
                            fontWeight: 700, fontSize: "0.97rem", display: "flex", alignItems: "center",
                            justifyContent: "center", gap: "0.6rem",
                            boxShadow: "0 4px 16px rgba(29,78,216,0.3)", transition: "opacity 0.2s",
                            fontFamily: "inherit",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                        >
                          <FiUploadCloud size={20} /> Upload Prescription (OCR)
                        </button>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
                          <button
                            onClick={() => void handleStatus(appt.id, "completed")}
                            style={{
                              padding: "0.85rem", borderRadius: "12px", border: "1px solid #dde3ee",
                              background: "#f8faff", color: "#334155", cursor: "pointer",
                              fontWeight: 600, fontSize: "0.9rem", fontFamily: "inherit", transition: "background 0.15s",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f1f5f9")}
                            onMouseLeave={e => (e.currentTarget.style.background = "#f8faff")}
                          >
                            ✓ Complete Only
                          </button>
                          <button
                            onClick={() => void handleCompleteAndNext(appt.id)}
                            style={{
                              padding: "0.85rem", borderRadius: "12px", border: "none",
                              background: "linear-gradient(135deg,#0369a1,#0ea5e9)",
                              color: "#fff", cursor: "pointer",
                              fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center",
                              justifyContent: "center", gap: "0.5rem", fontFamily: "inherit",
                              boxShadow: "0 4px 12px rgba(14,165,233,0.3)", transition: "opacity 0.2s",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                          >
                            Complete & Call Next <FiArrowRightCircle size={17} />
                          </button>
                        </div>
                        <button
                          onClick={() => void handleStatus(appt.id, "no_show")}
                          style={{
                            padding: "0.7rem", borderRadius: "10px", border: "1px dashed #fca5a5",
                            background: "#fff5f5", color: "#dc2626", cursor: "pointer",
                            fontWeight: 600, fontSize: "0.85rem", fontFamily: "inherit",
                          }}
                        >
                          Mark as No-Show
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Queue ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={cardStyle}>
              <div style={panelHeadStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ width: 32, height: 32, borderRadius: "9px", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <FiUsers color="#8b5cf6" size={16} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a" }}>Patient Queue</div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{queueAppointments.length} waiting</div>
                  </div>
                </div>
                {queueAppointments.length > 0 && (
                  <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#7c3aed", background: "#ede9fe", padding: "0.3rem 0.75rem", borderRadius: "999px" }}>
                    {queueAppointments.length}
                  </span>
                )}
              </div>

              <div style={{ padding: "1rem", maxHeight: 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {loading && queueAppointments.length === 0 ? (
                  <p style={{ textAlign: "center", color: "#94a3b8", padding: "2rem", fontSize: "0.9rem" }}>Loading queue…</p>
                ) : queueAppointments.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
                    <p style={{ fontWeight: 700, color: "#334155", margin: "0 0 0.25rem", fontSize: "0.97rem" }}>Queue is clear</p>
                    <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>All patients seen!</p>
                  </div>
                ) : (
                  queueAppointments.map((appt, idx) => (
                    <div key={appt.id} style={{
                      borderRadius: "12px", padding: "1rem 1.1rem",
                      border: idx === 0 ? "2px solid #3b82f6" : "1px solid #e8edf5",
                      background: idx === 0 ? "#f0f9ff" : "#fafbff",
                      transition: "box-shadow 0.2s",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b" }}>Token #{appt.token_no}</span>
                        {idx === 0 && (
                          <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#1d4ed8", background: "#dbeafe", padding: "0.2rem 0.6rem", borderRadius: "999px" }}>
                            NEXT
                          </span>
                        )}
                        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>#{idx + 1}</span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a", marginBottom: "0.25rem", textTransform: "capitalize" }}>
                        {appt.patient_name}
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: "0.75rem" }}>
                        {appt.visit_type} · {formatDateTime(appt.appointment_date)}
                      </div>
                      <button
                        onClick={() => void handleStatus(appt.id, "in_consultation")}
                        style={{
                          width: "100%", padding: "0.6rem", borderRadius: "9px",
                          background: idx === 0 ? "linear-gradient(135deg,#1d4ed8,#3b82f6)" : "#f1f5f9",
                          color: idx === 0 ? "#fff" : "#334155",
                          border: "none", cursor: "pointer", fontWeight: 600,
                          fontSize: "0.85rem", fontFamily: "inherit", transition: "opacity 0.2s",
                        }}
                      >
                        {idx === 0 ? "Call In →" : "Call Patient"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Quick Actions card */}
            <div style={cardStyle}>
              <div style={panelHeadStyle}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <FiZap color="#f59e0b" size={15} /> Quick Actions
                </div>
              </div>
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                {[
                  { label: "Switch to Scheduling", icon: <FiCalendar size={15} />, tab: "schedule" as Tab, color: "#3b82f6" },
                  { label: "EMR Lookup", icon: <FiBookOpen size={15} />, tab: "emr" as Tab, color: "#8b5cf6" },
                  { label: "Appointment History", icon: <FiList size={15} />, tab: "history" as Tab, color: "#10b981" },
                ].map(qa => (
                  <button
                    key={qa.tab}
                    onClick={() => setActiveTab(qa.tab)}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.75rem",
                      padding: "0.8rem 1rem", borderRadius: "10px",
                      border: "1px solid #e8edf5", background: "#fafbff",
                      cursor: "pointer", color: "#334155", fontWeight: 600,
                      fontSize: "0.88rem", fontFamily: "inherit", transition: "all 0.15s",
                      textAlign: "left",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.borderColor = qa.color; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#fafbff"; e.currentTarget.style.borderColor = "#e8edf5"; }}
                  >
                    <span style={{ color: qa.color }}>{qa.icon}</span>
                    {qa.label}
                    <FiChevronRight size={14} style={{ marginLeft: "auto", color: "#94a3b8" }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TAB 2 — DOCTORS & SCHEDULING
      ════════════════════════════════════════════════════ */}
      {activeTab === "schedule" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* Doctor form */}
          <div style={cardStyle}>
            <div style={panelHeadStyle}>
              <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <FiPlus color="#1d4ed8" size={16} />
                {doctorForm.id ? "Edit Doctor" : "Add New Doctor"}
              </div>
              {doctorForm.id && (
                <button onClick={() => setDoctorForm(DEFAULT_FORM)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", display: "flex" }}>
                  <FiX size={18} />
                </button>
              )}
            </div>
            <div style={{ padding: "1.5rem" }}>
              <form onSubmit={e => void handleDoctorSubmit(e)}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
                  {([
                    { key: "doctor_name", ph: "Doctor Name *", type: "text" },
                    { key: "consultation_fee", ph: "Consultation Fee (₹)", type: "number" },
                    { key: "review_fee", ph: "Review Fee (₹)", type: "number" },
                  ] as const).map(f => (
                    <div key={f.key}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {f.ph}
                      </label>
                      <input
                        type={f.type}
                        placeholder={f.ph}
                        value={doctorForm[f.key as keyof DoctorForm]}
                        onChange={e => setDoctorForm(p => ({ ...p, [f.key]: e.target.value }))}
                        style={inputStyle}
                        required={f.key === "doctor_name"}
                        min={f.type === "number" ? "0" : undefined}
                      />
                    </div>
                  ))}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Department *
                    </label>
                    <select
                      value={doctorForm.department}
                      onChange={e => setDoctorForm(p => ({ ...p, department: e.target.value }))}
                      required
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d.id} value={d.department_name}>{d.department_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Status
                    </label>
                    <select
                      value={doctorForm.status}
                      onChange={e => setDoctorForm(p => ({ ...p, status: e.target.value }))}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="available">Available</option>
                      <option value="leave">On Leave</option>
                      <option value="busy">Busy</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.85rem" }}>
                  <button
                    type="submit"
                    disabled={savingDoctor}
                    style={{
                      padding: "0.8rem 2rem", borderRadius: "10px", border: "none",
                      background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", color: "#fff",
                      fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                      opacity: savingDoctor ? 0.7 : 1,
                    }}
                  >
                    {savingDoctor ? "Saving…" : doctorForm.id ? "Update Doctor" : "Add Doctor"}
                  </button>
                  {doctorForm.id && (
                    <button
                      type="button"
                      onClick={() => setDoctorForm(DEFAULT_FORM)}
                      style={{ padding: "0.8rem 1.5rem", borderRadius: "10px", border: "1px solid #dde3ee", background: "#f8faff", color: "#334155", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              {/* Add Department inline */}
              <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid #f0f4f8" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.75rem" }}>
                  Add New Department
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <input
                    value={departmentInput}
                    onChange={e => setDepartmentInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && void handleAddDepartment()}
                    placeholder="e.g. Cardiology"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => void handleAddDepartment()}
                    style={{ padding: "0.65rem 1.4rem", borderRadius: "10px", border: "none", background: "#10b981", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                  >
                    + Add
                  </button>
                </div>
                {departments.length > 0 && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {departments.map(d => (
                      <span key={d.id} style={{ fontSize: "0.8rem", fontWeight: 600, background: "#f1f5f9", color: "#475569", padding: "0.3rem 0.75rem", borderRadius: "999px", border: "1px solid #e2e8f0" }}>
                        {d.department_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Doctor roster table */}
          <div style={cardStyle}>
            <div style={panelHeadStyle}>
              <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <FiUsers color="#8b5cf6" size={16} /> Doctor Roster
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#64748b", background: "#f1f5f9", padding: "0.2rem 0.6rem", borderRadius: "999px" }}>
                  {filteredDoctors.length}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#f8faff", border: "1px solid #dde3ee", borderRadius: "9px", padding: "0.45rem 0.9rem" }}>
                <FiSearch size={14} color="#94a3b8" />
                <input
                  value={doctorSearch}
                  onChange={e => setDoctorSearch(e.target.value)}
                  placeholder="Search doctors…"
                  style={{ border: "none", background: "transparent", outline: "none", fontSize: "0.88rem", color: "#334155", width: 160, fontFamily: "inherit" }}
                />
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8faff", borderBottom: "1px solid #e8edf5" }}>
                    {["Doctor", "Department", "Consult Fee", "Review Fee", "Status", "Actions"].map(h => (
                      <th key={h} style={{ padding: "0.9rem 1.1rem", textAlign: "left", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDoctors.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "3rem", color: "#94a3b8", fontSize: "0.9rem" }}>
                        {doctors.length === 0 ? "No doctors added yet. Add your first doctor above." : "No results match your search."}
                      </td>
                    </tr>
                  ) : filteredDoctors.map((doc, i) => (
                    <tr key={doc.id} style={{ borderBottom: "1px solid #f0f4f8", background: i % 2 === 0 ? "#fff" : "#fafbff", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f0f9ff")}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafbff")}
                    >
                      <td style={{ padding: "1rem 1.1rem" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "#0f172a" }}>Dr. {doc.doctor_name}</div>
                      </td>
                      <td style={{ padding: "1rem 1.1rem", fontSize: "0.88rem", color: "#475569" }}>{doc.department || "—"}</td>
                      <td style={{ padding: "1rem 1.1rem", fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>₹{doc.consultation_fee}</td>
                      <td style={{ padding: "1rem 1.1rem", fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>₹{doc.review_fee}</td>
                      <td style={{ padding: "1rem 1.1rem" }}><StatusBadge status={doc.status} /></td>
                      <td style={{ padding: "1rem 1.1rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            onClick={() => setDoctorForm({ id: String(doc.id), doctor_name: doc.doctor_name, department: doc.department ?? "", consultation_fee: String(doc.consultation_fee), review_fee: String(doc.review_fee), status: doc.status })}
                            style={{ padding: "0.4rem 0.85rem", borderRadius: "8px", border: "1px solid #dde3ee", background: "#f8faff", color: "#334155", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.35rem", fontFamily: "inherit" }}
                          >
                            <FiEdit3 size={12} /> Edit
                          </button>
                          <button
                            onClick={() => void handleDeleteDoctor(doc.id)}
                            style={{ padding: "0.4rem 0.85rem", borderRadius: "8px", border: "1px solid #fca5a5", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.35rem", fontFamily: "inherit" }}
                          >
                            <FiTrash2 size={12} /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TAB 3 — EMR LOOKUP
      ════════════════════════════════════════════════════ */}
      {activeTab === "emr" && (
        <div style={{ display: "grid", gridTemplateColumns: selectedEmrPatient ? "320px 1fr" : "1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* Search panel */}
          <div style={cardStyle}>
            <div style={panelHeadStyle}>
              <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <FiBookOpen color="#8b5cf6" size={16} /> Patient EMR Search
              </div>
            </div>
            <div style={{ padding: "1.25rem" }}>
              <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem" }}>
                <input
                  value={emrQuery}
                  onChange={e => setEmrQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && void handleEmrSearch()}
                  placeholder="Search by name, UHID…"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => void handleEmrSearch()}
                  disabled={emrLoading}
                  style={{ padding: "0.65rem 1.1rem", borderRadius: "10px", border: "none", background: "#1d4ed8", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.88rem", fontFamily: "inherit" }}
                >
                  <FiSearch size={15} />
                </button>
              </div>

              {emrLoading && !emrData && (
                <p style={{ textAlign: "center", color: "#94a3b8", padding: "1.5rem", fontSize: "0.9rem" }}>Searching…</p>
              )}

              {emrResults.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.25rem" }}>
                    {emrResults.length} result{emrResults.length !== 1 ? "s" : ""}
                  </div>
                  {emrResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => void handleSelectEmrPatient(String(p.id))}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        padding: "0.85rem 1rem", borderRadius: "10px", width: "100%",
                        border: selectedEmrPatient === String(p.id) ? "2px solid #1d4ed8" : "1px solid #e8edf5",
                        background: selectedEmrPatient === String(p.id) ? "#eff6ff" : "#fafbff",
                        cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                      }}
                    >
                      <span style={{ width: 36, height: 36, borderRadius: "10px", background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <FiUser color="#8b5cf6" size={16} />
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>{p.patient_name}</div>
                        {p.uhid && <div style={{ fontSize: "0.78rem", color: "#64748b" }}>UHID: {p.uhid}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!emrLoading && emrResults.length === 0 && emrQuery && (
                <div style={{ textAlign: "center", padding: "2rem", color: "#94a3b8", fontSize: "0.88rem" }}>
                  No patients found. Try a different name or UHID.
                </div>
              )}

              {!emrQuery && emrResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔍</div>
                  <p style={{ fontWeight: 600, color: "#334155", fontSize: "0.92rem", margin: "0 0 0.25rem" }}>Search for a patient</p>
                  <p style={{ fontSize: "0.83rem", color: "#94a3b8", margin: 0 }}>Enter name or UHID to pull up their EMR</p>
                </div>
              )}
            </div>
          </div>

          {/* EMR Detail */}
          {selectedEmrPatient && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {emrLoading ? (
                <div style={{ ...cardStyle, padding: "4rem", textAlign: "center", color: "#94a3b8" }}>
                  <FiRefreshCw size={28} style={{ animation: "spin 1s linear infinite", marginBottom: "1rem" }} />
                  <p style={{ margin: 0 }}>Loading EMR…</p>
                </div>
              ) : emrData ? (
                <>
                  {/* Patient banner */}
                  <div style={{ ...cardStyle, background: "linear-gradient(135deg,#312e81,#4f46e5)", color: "#fff" }}>
                    <div style={{ padding: "1.5rem" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#c7d2fe", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>Patient Record</div>
                          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
                            {emrData.patient?.name ?? "—"}
                          </h3>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            {emrData.patient?.age && <InfoChip icon={<FiUser size={12} />} text={`${emrData.patient.age} yrs`} />}
                            {emrData.patient?.gender && <InfoChip icon={<FiHeart size={12} />} text={emrData.patient.gender} />}
                            {emrData.patient?.blood_group && <InfoChip icon={<FiActivity size={12} />} text={emrData.patient.blood_group} />}
                            {emrData.patient?.phone && <InfoChip icon={<FiPhone size={12} />} text={emrData.patient.phone} />}
                          </div>
                        </div>
                        <button
                          style={{ padding: "0.6rem 1.2rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "inherit" }}
                        >
                          <FiPrinter size={14} /> Print
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* EMR sub-tabs */}
                  <div style={cardStyle}>
                    <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f0f4f8", display: "flex", gap: "0.4rem" }}>
                      {(["overview", "prescriptions", "labs"] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setEmrTab(t)}
                          style={{
                            padding: "0.55rem 1.1rem", borderRadius: "8px", border: "none", cursor: "pointer",
                            fontWeight: emrTab === t ? 700 : 500, fontSize: "0.85rem", fontFamily: "inherit",
                            background: emrTab === t ? "#1d4ed8" : "transparent",
                            color: emrTab === t ? "#fff" : "#64748b",
                            transition: "all 0.15s", textTransform: "capitalize",
                          }}
                        >
                          {t === "overview" ? "Visit History" : t === "prescriptions" ? "Prescriptions" : "Lab Results"}
                        </button>
                      ))}
                    </div>

                    <div style={{ padding: "1.25rem" }}>
                      {emrTab === "overview" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {(emrData.appointments ?? []).length === 0
                            ? <p style={{ color: "#94a3b8", textAlign: "center", padding: "2rem", fontSize: "0.9rem" }}>No visit history found.</p>
                            : (emrData.appointments ?? []).slice(0, 10).map(a => (
                              <div key={a.id} style={{ display: "flex", gap: "1rem", alignItems: "flex-start", padding: "1rem", background: "#f8faff", borderRadius: "10px", border: "1px solid #e8edf5" }}>
                                <div style={{ width: 40, height: 40, borderRadius: "10px", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  <FiCalendar color="#3b82f6" size={16} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                                    <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>{a.visit_type ?? "Visit"}</span>
                                    <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{formatDateTime(a.appointment_date)}</span>
                                  </div>
                                  {a.doctor_name && <div style={{ fontSize: "0.82rem", color: "#64748b", marginTop: "0.2rem" }}>Dr. {a.doctor_name}</div>}
                                  {a.notes && <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: "0.4rem", lineHeight: 1.5 }}>{a.notes}</div>}
                                  <StatusBadge status={a.status ?? "—"} />
                                </div>
                              </div>
                            ))
                          }
                        </div>
                      )}

                      {emrTab === "prescriptions" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {(emrData.prescriptions ?? []).length === 0
                            ? <p style={{ color: "#94a3b8", textAlign: "center", padding: "2rem", fontSize: "0.9rem" }}>No prescriptions on file.</p>
                            : (emrData.prescriptions ?? []).map(p => (
                              <div key={p.id} style={{ background: "#f8faff", borderRadius: "10px", padding: "1rem", border: "1px solid #e8edf5" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>Prescription #{p.id}</span>
                                  <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{p.uploaded_at ? formatDateTime(p.uploaded_at) : "—"}</span>
                                </div>
                                {p.extracted_text && (
                                  <pre style={{ margin: 0, fontSize: "0.82rem", color: "#475569", whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.6, maxHeight: 160, overflowY: "auto", background: "#fff", padding: "0.75rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                                    {p.extracted_text.slice(0, 600)}{p.extracted_text.length > 600 ? "…" : ""}
                                  </pre>
                                )}
                              </div>
                            ))
                          }
                        </div>
                      )}

                      {emrTab === "labs" && (
                        <div style={{ overflowX: "auto" }}>
                          {(emrData.lab_results ?? []).length === 0
                            ? <p style={{ color: "#94a3b8", textAlign: "center", padding: "2rem", fontSize: "0.9rem" }}>No lab results found.</p>
                            : (
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ background: "#f8faff" }}>
                                    {["Test", "Result", "Status", "Date"].map(h => (
                                      <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(emrData.lab_results ?? []).map(lr => (
                                    <tr key={lr.id} style={{ borderBottom: "1px solid #f0f4f8" }}>
                                      <td style={{ padding: "0.85rem 1rem", fontWeight: 600, fontSize: "0.88rem", color: "#0f172a" }}>{lr.test_name ?? "—"}</td>
                                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.88rem", color: "#334155" }}>{lr.result_value ?? "—"}</td>
                                      <td style={{ padding: "0.85rem 1rem" }}><StatusBadge status={lr.status ?? "—"} /></td>
                                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.82rem", color: "#94a3b8" }}>{lr.created_at ? formatDateTime(lr.created_at) : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )
                          }
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ ...cardStyle, padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
                  Could not load EMR data. Try selecting the patient again.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TAB 4 — APPOINTMENT HISTORY
      ════════════════════════════════════════════════════ */}
      {activeTab === "history" && (
        <div style={cardStyle}>
          <div style={panelHeadStyle}>
            <div style={{ fontWeight: 700, fontSize: "0.97rem", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <FiList color="#10b981" size={16} /> Appointment History
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <input
                type="date"
                value={historyDate}
                onChange={e => setHistoryDate(e.target.value)}
                style={{ ...inputStyle, width: "auto" }}
              />
              <button
                onClick={() => void loadHistory()}
                style={{ padding: "0.65rem 1.2rem", borderRadius: "10px", border: "none", background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "0.4rem" }}
              >
                <FiSearch size={14} /> Load
              </button>
            </div>
          </div>

          <div style={{ padding: "1.25rem" }}>
            {historyLoading ? (
              <p style={{ textAlign: "center", color: "#94a3b8", padding: "3rem", fontSize: "0.9rem" }}>Loading…</p>
            ) : historyAppointments.length === 0 ? (
              <div style={{ textAlign: "center", padding: "3rem" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📅</div>
                <p style={{ fontWeight: 700, color: "#334155", margin: "0 0 0.25rem", fontSize: "0.97rem" }}>No appointments</p>
                <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>Select a different date to view records.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                {/* Summary chips */}
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
                  {[
                    { label: "Total", val: historyAppointments.length, color: "#64748b", bg: "#f1f5f9" },
                    { label: "Completed", val: historyAppointments.filter(a => a.status === "completed").length, color: "#16a34a", bg: "#f0fdf4" },
                    { label: "No-Show", val: historyAppointments.filter(a => a.status === "no_show").length, color: "#dc2626", bg: "#fef2f2" },
                    { label: "Waiting", val: historyAppointments.filter(a => a.status === "checked_in").length, color: "#f59e0b", bg: "#fffbeb" },
                  ].map(s => (
                    <span key={s.label} style={{ padding: "0.4rem 0.9rem", borderRadius: "999px", fontSize: "0.82rem", fontWeight: 700, color: s.color, background: s.bg }}>
                      {s.label}: {s.val}
                    </span>
                  ))}
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8faff", borderBottom: "1px solid #e8edf5" }}>
                      {["Token", "Patient", "Doctor", "Type", "Time", "Status"].map(h => (
                        <th key={h} style={{ padding: "0.9rem 1rem", textAlign: "left", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historyAppointments.map((a, i) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid #f0f4f8", background: i % 2 === 0 ? "#fff" : "#fafbff" }}>
                        <td style={{ padding: "0.9rem 1rem", fontWeight: 700, fontSize: "0.9rem", color: "#1d4ed8" }}>#{a.token_no}</td>
                        <td style={{ padding: "0.9rem 1rem", fontWeight: 600, fontSize: "0.9rem", color: "#0f172a", textTransform: "capitalize" }}>{a.patient_name}</td>
                        <td style={{ padding: "0.9rem 1rem", fontSize: "0.88rem", color: "#475569" }}>{a.doctor_name ?? "—"}</td>
                        <td style={{ padding: "0.9rem 1rem", fontSize: "0.88rem", color: "#475569" }}>{a.visit_type ?? "—"}</td>
                        <td style={{ padding: "0.9rem 1rem", fontSize: "0.85rem", color: "#94a3b8" }}>{formatDateTime(a.appointment_date)}</td>
                        <td style={{ padding: "0.9rem 1rem" }}><StatusBadge status={a.status ?? "—"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Prescription Upload Modal ── */}
      {uploadPrescriptionPatient && (
        <PrescriptionUploadModal
          patientId={uploadPrescriptionPatient.id}
          patientName={uploadPrescriptionPatient.name}
          doctorName={uploadPrescriptionPatient.doctorName}
          setNotice={setNotice}
          onClose={() => setUploadPrescriptionPatient(null)}
        />
      )}

      {/* ── Global Keyframe Styles ── */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </section>
  );
}
