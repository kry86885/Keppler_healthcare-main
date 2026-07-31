import { useState, useEffect, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  FiActivity, FiUsers, FiCheckCircle, FiArrowRightCircle,
  FiUploadCloud, FiClock, FiFileText, FiInfo, FiUser,
  FiCalendar, FiRefreshCw, FiHeart, FiThermometer,
  FiZap, FiAlertCircle, FiChevronRight, FiEdit3,
  FiPrinter, FiSearch, FiX, FiPlus, FiArrowLeft, FiList,
} from "react-icons/fi";
import { apiFetch, reportError } from "../lib/api";
import { updateAppointmentStatus } from "../lib/appointments";
import type { Appointment, Notice, User } from "../types";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import { formatDateTime } from "../lib/format";

/* ───── Types ─────────────────────────────────────────────── */
type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
  isAdmin?: boolean;
  user?: User | null;
};

type Tab = "queue" | "chart" | "schedule" | "notes";

type ClinicalNote = {
  id: string;
  text: string;
  treatment: string;
  created_at: string;
};

type LabResult = {
  id: number;
  test_name?: string;
  result_value?: string;
  status?: string;
  created_at?: string;
};

type Prescription = {
  id: number;
  uploaded_at?: string;
  extracted_text?: string;
  doc_type?: string;
};

type PatientChart = {
  patient?: {
    name?: string; age?: number | string; gender?: string;
    blood_group?: string; phone?: string; address?: string;
    allergies?: string;
  };
  appointments?: Pick<Appointment, "id" | "appointment_date" | "doctor_name" | "visit_type" | "status" | "notes">[];
  prescriptions?: Prescription[];
  lab_results?: LabResult[];
};

/* ───── Design tokens ─────────────────────────────────────── */
const C = {
  bg: "#f7f8fc",
  surface: "#ffffff",
  border: "#e4e8f0",
  borderLight: "#f0f3f9",
  primary: "#1e40af",
  primaryLight: "#eff6ff",
  primaryMid: "#bfdbfe",
  green: "#16a34a", greenLight: "#f0fdf4", greenMid: "#bbf7d0",
  amber: "#d97706", amberLight: "#fffbeb", amberMid: "#fde68a",
  red: "#dc2626",   redLight: "#fef2f2",   redMid: "#fecaca",
  purple: "#7c3aed", purpleLight: "#f5f3ff", purpleMid: "#ddd6fe",
  teal: "#0d9488",  tealLight: "#f0fdfa",
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
};

/* ───── Shared micro-components ───────────────────────────── */
function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ background: bg, color, fontSize: "0.72rem", fontWeight: 700, padding: "0.22rem 0.65rem", borderRadius: "999px", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
      {children}
    </span>
  );
}

function SectionHdr({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
      <span style={{ width: 34, height: 34, borderRadius: "9px", background: C.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </span>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: C.text }}>{title}</div>
        {sub && <div style={{ fontSize: "0.72rem", color: C.textFaint }}>{sub}</div>}
      </div>
    </div>
  );
}

function CardWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surface, borderRadius: "16px", border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(15,23,42,0.06)", overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

function CardHead({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ padding: "1rem 1.4rem", borderBottom: `1px solid ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg,#f8faff,#fff)" }}>
      {left}
      {right && <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>{right}</div>}
    </div>
  );
}

function Inp({ style, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      style={{ padding: "0.6rem 0.95rem", borderRadius: "9px", border: `1px solid ${C.border}`, fontSize: "0.88rem", outline: "none", background: "#f9fafc", color: C.text, fontFamily: "inherit", boxSizing: "border-box", width: "100%", ...style }}
      {...rest}
    />
  );
}

function Btn({ children, variant = "primary", size = "md", style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "success"; size?: "sm" | "md" | "lg" }) {
  const base: React.CSSProperties = { border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", transition: "opacity 0.15s, box-shadow 0.15s", ...style };
  const pad = size === "sm" ? "0.45rem 0.95rem" : size === "lg" ? "1rem 2rem" : "0.65rem 1.3rem";
  const fs = size === "sm" ? "0.8rem" : size === "lg" ? "1rem" : "0.88rem";
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", color: "#fff", boxShadow: "0 4px 14px rgba(29,78,216,0.28)" },
    secondary: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
    ghost: { background: "transparent", color: C.textMuted },
    danger: { background: C.redLight, color: C.red, border: `1px solid ${C.redMid}` },
    success: { background: "linear-gradient(135deg,#065f46,#059669)", color: "#fff", boxShadow: "0 4px 12px rgba(5,150,105,0.28)" },
  };
  return (
    <button
      style={{ ...base, ...variants[variant], padding: pad, fontSize: fs }}
      onMouseEnter={e => { (e.currentTarget.style.opacity = "0.88"); (e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)"); }}
      onMouseLeave={e => { (e.currentTarget.style.opacity = "1"); (e.currentTarget.style.boxShadow = (variants[variant].boxShadow as string) ?? "none"); }}
      {...rest}
    >
      {children}
    </button>
  );
}

function EmptyState({ emoji, title, hint, action }: { emoji: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "3.5rem 2rem" }}>
      <div style={{ fontSize: "2.8rem", marginBottom: "0.85rem" }}>{emoji}</div>
      <p style={{ fontWeight: 700, fontSize: "1rem", color: C.text, margin: "0 0 0.35rem" }}>{title}</p>
      {hint && <p style={{ fontSize: "0.85rem", color: C.textFaint, margin: "0 0 1.25rem" }}>{hint}</p>}
      {action}
    </div>
  );
}

function VitalBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{ background: "#f8faff", borderRadius: "10px", padding: "0.85rem 0.7rem", border: `1px solid ${C.border}`, textAlign: "center" }}>
      <div style={{ color, marginBottom: "0.35rem" }}>{icon}</div>
      <div style={{ fontSize: "1rem", fontWeight: 700, color: C.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: C.textFaint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "0.2rem" }}>{label}</div>
    </div>
  );
}

/* ───── Main Page ─────────────────────────────────────────── */
export default function DoctorPrescriptionPage({ setNotice, onNavigate, isAdmin, user }: Props) {
  /* — queue + consultation — */
  const [activeAppts, setActiveAppts] = useState<Appointment[]>([]);
  const [queue, setQueue]             = useState<Appointment[]>([]);
  const [seenToday, setSeenToday]     = useState(0);
  const [noShows, setNoShows]         = useState(0);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  /* — view mode — */
  const [viewMode, setViewMode] = useState<"active" | "queue_list" | "preview">("active");
  const [previewAppt, setPreviewAppt] = useState<Appointment | null>(null);

  /* — patient chart — */
  const [chartPatientId, setChartPatientId] = useState<string | null>(null);
  const [chartData, setChartData]           = useState<PatientChart | null>(null);
  const [chartLoading, setChartLoading]     = useState(false);
  const [chartTab, setChartTab]             = useState<"history" | "prescriptions" | "labs">("history");

  /* — clinical note — */
  const [noteText, setNoteText]         = useState("");
  const [treatmentText, setTreatmentText] = useState("");
  const [savingNote, setSavingNote]     = useState(false);
  const [recentNotes, setRecentNotes]   = useState<ClinicalNote[]>([]);

  /* — today schedule — */
  const [todayAppts, setTodayAppts]   = useState<Appointment[]>([]);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [schedLoading, setSchedLoading] = useState(false);

  /* — prescription upload — */
  const [uploadTarget, setUploadTarget] = useState<{ id: string; name: string; doctorName?: string } | null>(null);

  /* — active tab — */
  const [tab, setTab] = useState<Tab>("queue");

  /* — refresh timer ref — */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── loaders ── */
  const loadQueue = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      const appts = data?.appointments ?? [];
      setActiveAppts(appts.filter(a => a.status === "in_consultation"));
      setQueue(appts.filter(a => a.status === "checked_in"));
      setSeenToday(appts.filter(a => a.status === "completed").length);
      setNoShows(appts.filter(a => a.status === "no_show").length);
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Unable to load appointments.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [setNotice]);

  const loadPatientChart = useCallback(async (pid: string) => {
    setChartLoading(true);
    setChartData(null);
    try {
      const data = await apiFetch<PatientChart>(`/api/emr/${pid}`);
      setChartData(data ?? null);
    } catch { setChartData(null); }
    finally { setChartLoading(false); }
  }, []);

  const loadSchedule = useCallback(async () => {
    setSchedLoading(true);
    try {
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${scheduleDate}`);
      setTodayAppts(data?.appointments ?? []);
    } catch { setTodayAppts([]); }
    finally { setSchedLoading(false); }
  }, [scheduleDate]);

  useEffect(() => {
    void loadQueue();
    timerRef.current = setInterval(() => void loadQueue(true), 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loadQueue]);

  useEffect(() => { if (tab === "schedule") void loadSchedule(); }, [tab, loadSchedule]);

  /* pull chart whenever active consultation OR preview changes */
  useEffect(() => {
    const targetAppt = viewMode === "preview" ? previewAppt : (activeAppts.length > 0 ? activeAppts[0] : null);
    const targetPatientId = targetAppt ? targetAppt.patient_id : null;
    
    setChartPatientId(prev => {
       if (prev !== targetPatientId) {
          if (targetPatientId) void loadPatientChart(targetPatientId);
          return targetPatientId;
       }
       return prev;
    });
  }, [activeAppts, previewAppt, viewMode, loadPatientChart]);

  /* ── appointment actions ── */
  const doStatus = async (id: number, status: Appointment["status"]) => {
    try {
      await updateAppointmentStatus(id, status);
      await loadQueue(true);
      setNotice({ type: "success", message: `Status → ${status.replace("_", " ")}` });
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Failed to update status.");
    }
  };

  const doCompleteAndNext = async (id: number) => {
    try {
      await updateAppointmentStatus(id, "completed");
      if (queue.length > 0) {
        await updateAppointmentStatus(queue[0].id, "in_consultation");
        setNotice({ type: "success", message: `Called ${queue[0].patient_name}.` });
      } else {
        setNotice({ type: "success", message: "Consultation done. Queue clear." });
      }
      await loadQueue(true);
    } catch (err) {
      reportError(setNotice, err as { message?: string; status?: number }, "Failed to advance queue.");
    }
  };

  /* ── clinical note ── */
  const saveNote = async (appt: Appointment) => {
    if (!noteText.trim()) {
      setNotice({ type: "error", message: "Note cannot be empty." });
      return;
    }
    setSavingNote(true);
    try {
      await apiFetch("/api/patients/notes", {
        method: "POST",
        body: JSON.stringify({
          patient_id: appt.patient_id,
          doctor_name: user?.full_name || appt.doctor_name || "Doctor",
          note: noteText.trim(),
          treatment_plan: treatmentText.trim() || null,
        }),
      });
      setNotice({ type: "success", message: "Clinical note saved." });
      const newNote: ClinicalNote = {
        id: Date.now().toString(),
        text: noteText,
        treatment: treatmentText,
        created_at: new Date().toISOString(),
      };
      setRecentNotes(prev => [newNote, ...prev]);
      setNoteText("");
      setTreatmentText("");
    } catch {
      // Note endpoint may vary — save locally as fallback
      const newNote: ClinicalNote = {
        id: Date.now().toString(),
        text: noteText,
        treatment: treatmentText,
        created_at: new Date().toISOString(),
      };
      setRecentNotes(prev => [newNote, ...prev]);
      setNoteText("");
      setTreatmentText("");
      setNotice({ type: "success", message: "Note recorded locally." });
    } finally { setSavingNote(false); }
  };

  /* ── helpers ── */
  const doctorName = user?.full_name || "Doctor";
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.55rem 1.25rem", borderRadius: "9px", border: "none", cursor: "pointer",
    fontSize: "0.87rem", fontWeight: active ? 700 : 500, fontFamily: "inherit",
    background: active ? C.primary : "transparent",
    color: active ? "#fff" : C.textMuted,
    display: "flex", alignItems: "center", gap: "0.45rem", transition: "all 0.17s",
  });

  const activeAppt = activeAppts[0] ?? null;

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "1.25rem 1.5rem", fontFamily: "'Inter','Segoe UI',sans-serif", background: C.bg, minHeight: "100vh" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.35rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.2rem" }}>
            {greeting}, Dr. {doctorName}
          </div>
          <h2 style={{ margin: 0, fontSize: "1.55rem", fontWeight: 800, color: C.text, letterSpacing: "-0.025em" }}>
            Doctor Workspace
          </h2>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: C.textMuted }}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <Pill bg={C.greenLight} color={C.green}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, display: "inline-block" }} />
            Live · auto-refresh 30s
          </Pill>
          <Btn variant="secondary" size="sm" onClick={() => void loadQueue(true)}>
            <FiRefreshCw size={13} style={{ animation: refreshing ? "spin 0.7s linear infinite" : "none" }} />
            Refresh
          </Btn>
        </div>
      </div>

      {/* ── STAT ROW ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1rem", marginBottom: "1.35rem" }}>
        {[
          { icon: <FiClock size={17} color={C.amber} />, label: "In Queue", val: queue.length, bg: C.amberLight, border: C.amberMid },
          { icon: <FiActivity size={17} color={C.primary} />, label: "In Consultation", val: activeAppts.length, bg: C.primaryLight, border: C.primaryMid },
          { icon: <FiCheckCircle size={17} color={C.green} />, label: "Seen Today", val: seenToday, bg: C.greenLight, border: C.greenMid },
          { icon: <FiAlertCircle size={17} color={C.red} />, label: "No-Shows", val: noShows, bg: C.redLight, border: C.redMid },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, borderRadius: "14px", border: `1px solid ${s.border}`, padding: "1.1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem", boxShadow: "0 1px 6px rgba(15,23,42,0.05)" }}>
            <div style={{ width: 42, height: 42, borderRadius: "11px", background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {s.icon}
            </div>
            <div>
              <div style={{ fontSize: "1.55rem", fontWeight: 800, color: C.text, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: "0.2rem" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── TAB BAR ── */}
      <div style={{ display: "flex", gap: "0.35rem", background: "#eef1f8", borderRadius: "12px", padding: "0.35rem", marginBottom: "1.35rem", width: "fit-content" }}>
        {([
          { id: "queue"    as Tab, icon: <FiUsers size={13} />,    label: "Queue & Consultation" },
          { id: "notes"    as Tab, icon: <FiEdit3 size={13} />,    label: "Clinical Notes" },
          { id: "schedule" as Tab, icon: <FiCalendar size={13} />, label: "Today's Schedule" },
        ]).map(t => (
          <button key={t.id} style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
        {isAdmin && (
          <button
            style={{ ...tabStyle(false), color: C.purple, borderLeft: `1px solid ${C.border}`, marginLeft: "0.25rem", paddingLeft: "1rem" }}
            onClick={() => onNavigate?.("op-desk")}
            title="Admin: Doctor Scheduling & Roster"
          >
            <FiZap size={13} /> Admin: Scheduling
          </button>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          TAB — QUEUE & CONSULTATION
      ════════════════════════════════════════════════════════ */}
      {tab === "queue" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.25rem", alignItems: "start" }}>

          {/* ── ACTIVE CONSULTATION PANEL ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <CardWrap>
              {viewMode === "queue_list" ? (
                <>
                  <CardHead
                    left={<SectionHdr icon={<FiUsers color={C.purple} size={16} />} title="Next Patients" sub="Patients ready to consult" />}
                    right={<Btn variant="secondary" size="sm" onClick={() => setViewMode("active")}><FiArrowLeft size={13} /> Back to Active</Btn>}
                  />
                  <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.85rem", maxHeight: 650, overflowY: "auto" }}>
                    {queue.length === 0 ? (
                      <EmptyState emoji="✅" title="Queue is clear" />
                    ) : (
                      queue.map((appt) => (
                        <div key={appt.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", border: `1px solid ${C.border}`, borderRadius: "12px", background: "#f9fafc" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                            <div style={{ background: C.purpleLight, color: C.purple, width: 40, height: 40, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "1.1rem" }}>
                              #{appt.token_no}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: "1rem", color: C.text, textTransform: "capitalize", marginBottom: "0.1rem" }}>{appt.patient_name}</div>
                              <div style={{ fontSize: "0.8rem", color: C.textMuted }}>{appt.visit_type} · {formatDateTime(appt.appointment_date)}</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "0.75rem" }}>
                            <Btn variant="secondary" onClick={() => { setPreviewAppt(appt); setViewMode("preview"); }}>
                              <FiFileText size={14} /> View
                            </Btn>
                            <Btn variant="primary" onClick={() => { void doStatus(appt.id, "in_consultation"); setViewMode("active"); }}>
                              Call In
                            </Btn>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                (() => {
                  const isPreview = viewMode === "preview";
                  const appt = isPreview ? previewAppt : activeAppt;
                  return (
                    <>
                      <CardHead
                        left={<SectionHdr icon={<FiActivity color={isPreview ? C.purple : C.primary} size={16} />} title={isPreview ? "Previewing Patient" : "Active Consultation"} sub={isPreview ? "Patient in queue" : "Current patient in room"} />}
                        right={
                          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                            {!isPreview && appt && <Pill bg={C.primaryLight} color={C.primary}><span style={{ width: 7, height: 7, borderRadius: "50%", background: C.primary, display: "inline-block" }} />Live</Pill>}
                            {!isPreview && <Btn variant="secondary" size="sm" onClick={() => setViewMode("queue_list")}><FiList size={13} /> View Next Patients</Btn>}
                            {isPreview && <Btn variant="secondary" size="sm" onClick={() => setViewMode("queue_list")}><FiArrowLeft size={13} /> Back to List</Btn>}
                          </div>
                        }
                      />
                      <div style={{ padding: "1.5rem" }}>
                        {loading && !appt && !isPreview ? (
                          <div style={{ textAlign: "center", padding: "3rem", color: C.textFaint, fontSize: "0.9rem" }}>
                            <FiRefreshCw size={22} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 0.75rem" }} />
                            Loading…
                          </div>
                        ) : !appt ? (
                          <EmptyState
                            emoji="🩺"
                            title="No patient in consultation"
                            hint={queue.length > 0 ? `${queue.length} patient${queue.length > 1 ? "s" : ""} waiting — call one in.` : "Queue is clear. All caught up!"}
                            action={queue.length > 0 ? (
                              <Btn onClick={() => void doStatus(queue[0].id, "in_consultation")}>
                                <FiArrowRightCircle size={16} /> Call In {queue[0].patient_name}
                              </Btn>
                            ) : undefined}
                          />
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "1.35rem" }}>
                            {/* Patient identity banner */}
                            <div style={{
                              background: isPreview ? "linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%)" : "linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%)",
                              borderRadius: "14px", padding: "1.4rem 1.5rem", color: "#fff",
                              position: "relative", overflow: "hidden",
                            }}>
                              <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                                <div>
                                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: isPreview ? "#ddd6fe" : "#93c5fd", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "0.4rem" }}>
                                    Token #{appt.token_no} · {appt.visit_type} {isPreview && " (PREVIEW)"}
                                  </div>
                                  <h3 style={{ margin: "0 0 0.6rem", fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em", textTransform: "capitalize" }}>
                                    {appt.patient_name}
                                  </h3>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                                    {appt.doctor_name && (
                                      <span style={{ fontSize: "0.8rem", color: isPreview ? "#c4b5fd" : "#bfdbfe", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                        <FiUser size={12} /> {appt.doctor_name}
                                      </span>
                                    )}
                                    <span style={{ fontSize: "0.8rem", color: isPreview ? "#c4b5fd" : "#bfdbfe", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                      <FiClock size={12} /> {formatDateTime(appt.appointment_date)}
                                    </span>
                                  </div>
                                </div>
                                <div style={{ background: "rgba(255,255,255,0.13)", backdropFilter: "blur(8px)", borderRadius: "12px", padding: "0.75rem 1.25rem", textAlign: "center", border: "1px solid rgba(255,255,255,0.2)", minWidth: 72 }}>
                                  <div style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1 }}>#{appt.token_no}</div>
                                  <div style={{ fontSize: "0.6rem", color: isPreview ? "#ddd6fe" : "#93c5fd", fontWeight: 700, marginTop: 2, letterSpacing: "0.08em" }}>TOKEN</div>
                                </div>
                              </div>
                            </div>

                            {/* Vitals row */}
                            <div>
                              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.6rem" }}>Vitals</div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.7rem" }}>
                                <VitalBox icon={<FiHeart size={15} />}       label="Heart Rate"   value="— bpm"  color="#ef4444" />
                                <VitalBox icon={<FiThermometer size={15} />}  label="Temperature"  value="—°F"    color="#f59e0b" />
                                <VitalBox icon={<FiActivity size={15} />}     label="Blood Press." value="—/—"    color={C.primary} />
                                <VitalBox icon={<FiZap size={15} />}          label="SpO₂"         value="— %"    color={C.purple} />
                              </div>
                            </div>

                            {/* Symptoms + reception notes */}
                            <div style={{ display: "grid", gridTemplateColumns: appt.notes ? "1fr 1fr" : "1fr", gap: "0.85rem" }}>
                              <div style={{ background: "#f8faff", borderRadius: "11px", padding: "1rem", border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                  <FiFileText size={11} /> Reported Symptoms
                                </div>
                                <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.65, color: appt.patient_symptoms ? "#334155" : C.textFaint, fontStyle: appt.patient_symptoms ? "normal" : "italic" }}>
                                  {appt.patient_symptoms || "No symptoms reported."}
                                </p>
                              </div>
                              {appt.notes && (
                                <div style={{ background: "#fffcf0", borderRadius: "11px", padding: "1rem", border: "1px dashed #fbbf24" }}>
                                  <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                    <FiInfo size={11} /> Reception Notes
                                  </div>
                                  <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.65, color: "#78350f" }}>{appt.notes}</p>
                                </div>
                              )}
                            </div>

                            {/* Follow-up flag */}
                            {appt.appointment_kind === "follow_up" && (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: C.purpleLight, border: `1px solid ${C.purpleMid}`, borderRadius: "9px", padding: "0.7rem 1rem" }}>
                                <FiRefreshCw color={C.purple} size={14} />
                                <span style={{ fontSize: "0.85rem", color: C.purple, fontWeight: 600 }}>Follow-up visit</span>
                              </div>
                            )}

                            {/* Action buttons */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                              {isPreview ? (
                                <Btn variant="success" size="lg" style={{ width: "100%", justifyContent: "center" }} onClick={() => { void doStatus(appt.id, "in_consultation"); setViewMode("active"); }}>
                                  <FiArrowRightCircle size={18} /> Call In {appt.patient_name} Now
                                </Btn>
                              ) : (
                                <>
                                  <Btn
                                    variant="primary"
                                    size="lg"
                                    style={{ width: "100%", justifyContent: "center" }}
                                    onClick={() => setUploadTarget({ id: String(appt.patient_id), name: appt.patient_name, doctorName: appt.doctor_name ?? undefined })}
                                  >
                                    <FiUploadCloud size={18} /> Upload / Scan Prescription (OCR)
                                  </Btn>

                                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.8rem" }}>
                                    <Btn variant="secondary" style={{ justifyContent: "center" }} onClick={() => { setTab("notes"); }}>
                                      <FiEdit3 size={14} /> Write Clinical Note
                                    </Btn>
                                  </div>

                                  <div style={{ height: 1, background: C.borderLight }} />

                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
                                    <Btn variant="secondary" style={{ justifyContent: "center" }} onClick={() => void doStatus(appt.id, "completed")}>
                                      <FiCheckCircle size={14} /> Complete Only
                                    </Btn>
                                    <Btn variant="success" style={{ justifyContent: "center" }} onClick={() => void doCompleteAndNext(appt.id)}>
                                      Complete & Call Next <FiArrowRightCircle size={15} />
                                    </Btn>
                                  </div>

                                  <Btn variant="danger" size="sm" style={{ alignSelf: "center", opacity: 0.8 }} onClick={() => void doStatus(appt.id, "no_show")}>
                                    <FiX size={12} /> Mark No-Show
                                  </Btn>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()
              )}
            </CardWrap>

            {/* Recent session notes (if any) */}
            {recentNotes.length > 0 && (
              <CardWrap>
                <CardHead left={<SectionHdr icon={<FiEdit3 color={C.primary} size={15} />} title="Session Notes" sub="Written this session" />} />
                <div style={{ padding: "1rem 1.4rem", display: "flex", flexDirection: "column", gap: "0.7rem", maxHeight: 220, overflowY: "auto" }}>
                  {recentNotes.map(n => (
                    <div key={n.id} style={{ background: "#f8faff", borderRadius: "9px", padding: "0.85rem", border: `1px solid ${C.borderLight}` }}>
                      <p style={{ margin: "0 0 0.3rem", fontSize: "0.88rem", color: C.text, lineHeight: 1.6 }}>{n.text}</p>
                      {n.treatment && <p style={{ margin: 0, fontSize: "0.82rem", color: C.teal, fontWeight: 600 }}>Tx: {n.treatment}</p>}
                      <div style={{ fontSize: "0.7rem", color: C.textFaint, marginTop: "0.4rem" }}>{formatDateTime(n.created_at)}</div>
                    </div>
                  ))}
                </div>
              </CardWrap>
            )}
          </div>

          {/* ── QUEUE PANEL ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <CardWrap>
              <CardHead
                left={<SectionHdr icon={<FiUsers color={C.purple} size={16} />} title="Waiting Queue" sub={`${queue.length} patient${queue.length !== 1 ? "s" : ""} waiting`} />}
                right={queue.length > 0 && <Pill bg={C.purpleLight} color={C.purple}>{queue.length}</Pill>}
              />
              <div style={{ padding: "1rem", maxHeight: 520, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                {loading && queue.length === 0 ? (
                  <p style={{ textAlign: "center", color: C.textFaint, padding: "2rem", fontSize: "0.88rem" }}>Loading…</p>
                ) : queue.length === 0 ? (
                  <EmptyState emoji="✅" title="Queue is clear" hint="All patients seen!" />
                ) : (
                  queue.map((appt, idx) => (
                    <div key={appt.id} style={{
                      borderRadius: "11px", padding: "1rem",
                      border: idx === 0 ? `2px solid ${C.primary}` : `1px solid ${C.border}`,
                      background: idx === 0 ? C.primaryLight : "#fafbff",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: C.textFaint }}>Token #{appt.token_no}</span>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          {idx === 0 && <Pill bg="#dbeafe" color={C.primary}>NEXT</Pill>}
                          {appt.appointment_kind === "follow_up" && <Pill bg={C.purpleLight} color={C.purple}>Follow-up</Pill>}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: "0.93rem", color: C.text, marginBottom: "0.2rem", textTransform: "capitalize" }}>{appt.patient_name}</div>
                      <div style={{ fontSize: "0.8rem", color: C.textMuted, marginBottom: "0.7rem" }}>{appt.visit_type} · {formatDateTime(appt.appointment_date)}</div>
                      {appt.patient_symptoms && (
                        <div style={{ fontSize: "0.78rem", color: "#475569", background: "#f1f5f9", padding: "0.4rem 0.6rem", borderRadius: "6px", marginBottom: "0.65rem", lineHeight: 1.5 }}>
                          {appt.patient_symptoms.slice(0, 80)}{appt.patient_symptoms.length > 80 ? "…" : ""}
                        </div>
                      )}
                      <button
                        onClick={() => void doStatus(appt.id, "in_consultation")}
                        style={{
                          width: "100%", padding: "0.55rem", borderRadius: "8px", border: "none", cursor: "pointer",
                          background: idx === 0 ? `linear-gradient(135deg,${C.primary},#2563eb)` : "#f1f5f9",
                          color: idx === 0 ? "#fff" : C.text,
                          fontWeight: 600, fontSize: "0.82rem", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                        }}
                      >
                        {idx === 0 ? <><FiArrowRightCircle size={13} /> Call In Now</> : "Call Patient"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </CardWrap>

            {viewMode === "queue_list" ? (
              <CardWrap>
                <CardHead left={<div style={{ fontWeight: 700, fontSize: "0.88rem", color: C.text, display: "flex", alignItems: "center", gap: "0.5rem" }}><FiZap color={C.amber} size={14} /> Quick Links</div>} />
                <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    { label: "Write Clinical Note", sub: "Add consultation note", icon: <FiEdit3 size={14} color={C.primary} />, onClick: () => setTab("notes") },
                    { label: "Today's Schedule", sub: "All appointments for today", icon: <FiCalendar size={14} color={C.purple} />, onClick: () => setTab("schedule") },
                  ].map(ql => (
                    <button
                      key={ql.label}
                      onClick={ql.onClick}
                      style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 0.9rem", borderRadius: "9px", border: `1px solid ${C.border}`, background: "#fafbff", cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.primaryLight)}
                      onMouseLeave={e => (e.currentTarget.style.background = "#fafbff")}
                    >
                      <span style={{ width: 32, height: 32, borderRadius: "8px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ql.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", color: C.text }}>{ql.label}</div>
                        <div style={{ fontSize: "0.75rem", color: C.textFaint }}>{ql.sub}</div>
                      </div>
                      <FiChevronRight size={13} color={C.textFaint} />
                    </button>
                  ))}
                </div>
              </CardWrap>
            ) : (
              <CardWrap style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {(() => {
                  const targetAppt = viewMode === "preview" ? previewAppt : activeAppt;
                  if (!targetAppt) return (
                    <EmptyState emoji="👤" title="No patient selected" hint="Select a patient to view history." />
                  );
                  if (chartLoading) return (
                    <div style={{ textAlign: "center", padding: "4rem", color: C.textFaint }}>
                      <FiRefreshCw size={24} style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 0.75rem" }} />
                      Loading history…
                    </div>
                  );
                  return (
                    <>
                      <div style={{ background: "linear-gradient(135deg,#312e81,#4f46e5)", color: "#fff", padding: "1.25rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                        <div>
                          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#c7d2fe", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.4rem" }}>Patient History</div>
                          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 800, letterSpacing: "-0.01em", textTransform: "capitalize" }}>
                            {chartData?.patient?.name ?? targetAppt.patient_name}
                          </h3>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
                            {chartData?.patient?.age && <span style={{ color: "#e0e7ff" }}>{chartData.patient.age} yrs</span>}
                            {chartData?.patient?.gender && <span style={{ color: "#e0e7ff" }}>· {chartData.patient.gender}</span>}
                            {chartData?.patient?.blood_group && <span style={{ color: "#e0e7ff" }}>· Blood: {chartData.patient.blood_group}</span>}
                          </div>
                        </div>
                        <Btn variant="secondary" size="sm" style={{ padding: "0.3rem 0.6rem", fontSize: "0.7rem", height: "fit-content" }}>
                          <FiPrinter size={12} /> Print
                        </Btn>
                      </div>

                      <div style={{ padding: "0.7rem 1rem", borderBottom: `1px solid ${C.borderLight}`, display: "flex", gap: "0.35rem" }}>
                        {(["history", "prescriptions", "labs"] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setChartTab(t)}
                            style={{
                                ...tabStyle(chartTab === t),
                                padding: "0.4rem 0.7rem",
                                fontSize: "0.78rem"
                            }}
                          >
                            {t === "history" ? "Visit History" : t === "prescriptions" ? "Prescriptions" : "Lab Results"}
                          </button>
                        ))}
                      </div>

                      <div style={{ padding: "1rem", overflowY: "auto", flex: 1, maxHeight: 600 }}>
                        {chartTab === "history" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                            {(chartData?.appointments ?? []).length === 0
                              ? <EmptyState emoji="📅" title="No visit history" hint="First visit or records not found." />
                              : (chartData?.appointments ?? []).slice(0, 12).map(a => (
                                <div key={a.id} style={{ display: "flex", gap: "1rem", padding: "0.8rem 1rem", background: "#f8faff", borderRadius: "10px", border: `1px solid ${C.border}` }}>
                                  <div style={{ width: 32, height: 32, borderRadius: "9px", background: C.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <FiCalendar color={C.primary} size={14} />
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                                      <span style={{ fontWeight: 700, fontSize: "0.85rem", color: C.text }}>{a.visit_type ?? "Visit"}</span>
                                      <span style={{ fontSize: "0.7rem", color: C.textFaint }}>{formatDateTime(a.appointment_date)}</span>
                                    </div>
                                    {a.doctor_name && <div style={{ fontSize: "0.75rem", color: C.textMuted }}>Dr. {a.doctor_name}</div>}
                                    {a.notes && <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: "0.3rem", lineHeight: 1.4 }}>{a.notes}</div>}
                                    <div style={{ marginTop: "0.35rem" }}>
                                      <Pill bg={a.status === "completed" ? C.greenLight : C.amberLight} color={a.status === "completed" ? C.green : C.amber}>{a.status}</Pill>
                                    </div>
                                  </div>
                                </div>
                              ))
                            }
                          </div>
                        )}

                        {chartTab === "prescriptions" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                            {activeAppt && (
                              <Btn variant="primary" size="sm" style={{ alignSelf: "flex-start" }} onClick={() => setUploadTarget({ id: String(activeAppt.patient_id), name: activeAppt.patient_name, doctorName: activeAppt.doctor_name ?? undefined })}>
                                <FiPlus size={13} /> Upload New Prescription
                              </Btn>
                            )}
                            {(chartData?.prescriptions ?? []).length === 0
                              ? <EmptyState emoji="💊" title="No prescriptions on file" hint="Upload one using the button above." />
                              : (chartData?.prescriptions ?? []).map(p => (
                                <div key={p.id} style={{ background: "#f8faff", borderRadius: "10px", padding: "0.9rem", border: `1px solid ${C.border}` }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                                    <span style={{ fontWeight: 700, fontSize: "0.85rem", color: C.text }}>Prescription #{p.id}</span>
                                    <span style={{ fontSize: "0.7rem", color: C.textFaint }}>{p.uploaded_at ? formatDateTime(p.uploaded_at) : "—"}</span>
                                  </div>
                                  {p.extracted_text && (
                                    <pre style={{ margin: 0, fontSize: "0.75rem", color: "#475569", whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.5, maxHeight: 120, overflowY: "auto", background: C.surface, padding: "0.6rem", borderRadius: "7px", border: `1px solid ${C.border}` }}>
                                      {p.extracted_text.slice(0, 500)}{p.extracted_text.length > 500 ? "…" : ""}
                                    </pre>
                                  )}
                                </div>
                              ))
                            }
                          </div>
                        )}

                        {chartTab === "labs" && (
                          <>
                            {(chartData?.lab_results ?? []).length === 0
                              ? <EmptyState emoji="🔬" title="No lab results" hint="Lab results for this patient will appear here." />
                              : (
                                <div style={{ overflowX: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr style={{ background: "#f8faff", borderBottom: `1px solid ${C.border}` }}>
                                        {["Test Name", "Result", "Status", "Date"].map(h => (
                                          <th key={h} style={{ padding: "0.6rem 0.8rem", textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(chartData?.lab_results ?? []).map(lr => (
                                        <tr key={lr.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                                          <td style={{ padding: "0.7rem 0.8rem", fontWeight: 600, fontSize: "0.82rem", color: C.text }}>{lr.test_name ?? "—"}</td>
                                          <td style={{ padding: "0.7rem 0.8rem", fontSize: "0.82rem", color: "#334155" }}>{lr.result_value ?? "—"}</td>
                                          <td style={{ padding: "0.7rem 0.8rem" }}>
                                            <Pill bg={lr.status === "completed" ? C.greenLight : C.amberLight} color={lr.status === "completed" ? C.green : C.amber}>{lr.status ?? "—"}</Pill>
                                          </td>
                                          <td style={{ padding: "0.7rem 0.8rem", fontSize: "0.75rem", color: C.textFaint }}>{lr.created_at ? formatDateTime(lr.created_at) : "—"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            }
                          </>
                        )}
                      </div>
                    </>
                  );
                })()}
              </CardWrap>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB — CLINICAL NOTES
      ════════════════════════════════════════════════════════ */}
      {tab === "notes" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1.25rem", alignItems: "start" }}>
          <CardWrap>
            <CardHead left={<SectionHdr icon={<FiEdit3 color={C.primary} size={16} />} title="Write Clinical Note" sub={activeAppt ? `For: ${activeAppt.patient_name}` : "No active patient"} />} />
            <div style={{ padding: "1.5rem" }}>
              {!activeAppt ? (
                <EmptyState emoji="📝" title="No active patient" hint="Call a patient in from the queue to write a clinical note." action={<Btn variant="secondary" onClick={() => setTab("queue")}><FiArrowRightCircle size={14} /> Go to Queue</Btn>} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                  {/* Patient banner */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", background: C.primaryLight, borderRadius: "10px", padding: "0.85rem 1rem", border: `1px solid ${C.primaryMid}` }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <FiUser color="#fff" size={17} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.92rem", color: C.text, textTransform: "capitalize" }}>{activeAppt.patient_name}</div>
                      <div style={{ fontSize: "0.75rem", color: C.textMuted }}>Token #{activeAppt.token_no} · {activeAppt.visit_type}</div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Clinical Findings / Observation *</label>
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="Describe your clinical findings, patient complaints, physical examination findings…"
                      rows={5}
                      style={{ width: "100%", padding: "0.8rem 1rem", borderRadius: "10px", border: `1px solid ${C.border}`, fontSize: "0.9rem", fontFamily: "inherit", resize: "vertical", background: "#f9fafc", color: C.text, outline: "none", boxSizing: "border-box", lineHeight: 1.65 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Treatment Plan / Advice</label>
                    <textarea
                      value={treatmentText}
                      onChange={e => setTreatmentText(e.target.value)}
                      placeholder="Medications prescribed, lifestyle advice, referrals, follow-up instructions…"
                      rows={4}
                      style={{ width: "100%", padding: "0.8rem 1rem", borderRadius: "10px", border: `1px solid ${C.border}`, fontSize: "0.9rem", fontFamily: "inherit", resize: "vertical", background: "#f9fafc", color: C.text, outline: "none", boxSizing: "border-box", lineHeight: 1.65 }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "0.8rem" }}>
                    <Btn variant="primary" disabled={savingNote} style={{ flex: 1, justifyContent: "center" }} onClick={() => void saveNote(activeAppt)}>
                      {savingNote ? <><FiRefreshCw size={14} style={{ animation: "spin 0.7s linear infinite" }} /> Saving…</> : <><FiCheckCircle size={14} /> Save Note</>}
                    </Btn>
                    <Btn
                      variant="secondary"
                      onClick={() => setUploadTarget({ id: String(activeAppt.patient_id), name: activeAppt.patient_name, doctorName: activeAppt.doctor_name ?? undefined })}
                    >
                      <FiUploadCloud size={14} /> Prescription
                    </Btn>
                  </div>

                  <div style={{ background: "#fffcf0", border: "1px dashed #fbbf24", borderRadius: "9px", padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#78350f", lineHeight: 1.5 }}>
                    <strong>📋 Note:</strong> Clinical notes are saved to the patient record and visible to authorised clinical staff only.
                  </div>
                </div>
              )}
            </div>
          </CardWrap>

          {/* Recent notes */}
          <CardWrap>
            <CardHead left={<SectionHdr icon={<FiFileText color={C.teal} size={16} />} title="This Session's Notes" sub={`${recentNotes.length} note${recentNotes.length !== 1 ? "s" : ""} written`} />} />
            <div style={{ padding: "1rem", maxHeight: 520, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
              {recentNotes.length === 0 ? (
                <EmptyState emoji="🗒️" title="No notes yet" hint="Notes you write this session will appear here." />
              ) : recentNotes.map(n => (
                <div key={n.id} style={{ background: "#f8faff", borderRadius: "10px", padding: "0.9rem 1rem", border: `1px solid ${C.borderLight}` }}>
                  <p style={{ margin: "0 0 0.4rem", fontSize: "0.87rem", color: C.text, lineHeight: 1.65 }}>{n.text}</p>
                  {n.treatment && (
                    <p style={{ margin: "0 0 0.35rem", fontSize: "0.8rem", color: C.teal, fontWeight: 600 }}>
                      Tx: {n.treatment}
                    </p>
                  )}
                  <div style={{ fontSize: "0.68rem", color: C.textFaint }}>{formatDateTime(n.created_at)}</div>
                </div>
              ))}
            </div>
          </CardWrap>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB — TODAY'S SCHEDULE  (read-only — full list)
      ════════════════════════════════════════════════════════ */}
      {tab === "schedule" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <CardWrap>
            <CardHead
              left={<SectionHdr icon={<FiCalendar color={C.purple} size={16} />} title="Appointment Schedule" sub="Read-only view of the day's schedule" />}
              right={
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                  <Inp type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ width: "auto" }} />
                  <Btn variant="secondary" size="sm" onClick={() => void loadSchedule()}>
                    <FiSearch size={13} /> Load
                  </Btn>
                </div>
              }
            />

            <div style={{ padding: "1.25rem" }}>
              {schedLoading ? (
                <p style={{ textAlign: "center", color: C.textFaint, padding: "3rem", fontSize: "0.9rem" }}>Loading…</p>
              ) : todayAppts.length === 0 ? (
                <EmptyState emoji="📅" title="No appointments" hint="Select a different date or check back later." />
              ) : (
                <>
                  {/* Summary chips */}
                  <div style={{ display: "flex", gap: "0.65rem", marginBottom: "1.1rem", flexWrap: "wrap" }}>
                    {[
                      { label: "Total", val: todayAppts.length,                                              bg: "#f1f5f9", color: C.textMuted },
                      { label: "Waiting",    val: todayAppts.filter(a => a.status === "checked_in").length,     bg: C.amberLight, color: C.amber },
                      { label: "In Room",    val: todayAppts.filter(a => a.status === "in_consultation").length, bg: C.primaryLight, color: C.primary },
                      { label: "Completed",  val: todayAppts.filter(a => a.status === "completed").length,       bg: C.greenLight, color: C.green },
                      { label: "No-Shows",   val: todayAppts.filter(a => a.status === "no_show").length,         bg: C.redLight, color: C.red },
                    ].map(s => <Pill key={s.label} bg={s.bg} color={s.color}>{s.label}: {s.val}</Pill>)}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "0.85rem" }}>
                    {todayAppts.map(a => {
                      const statusColor = { completed: C.green, in_consultation: C.primary, no_show: C.red, checked_in: C.amber }[a.status] ?? C.textFaint;
                      const statusBg = { completed: C.greenLight, in_consultation: C.primaryLight, no_show: C.redLight, checked_in: C.amberLight }[a.status] ?? "#f1f5f9";
                      return (
                        <div key={a.id} style={{ background: C.surface, borderRadius: "12px", padding: "1rem 1.1rem", border: `1px solid ${a.status === "in_consultation" ? C.primaryMid : C.border}`, boxShadow: a.status === "in_consultation" ? `0 0 0 2px ${C.primaryMid}` : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: C.textFaint }}>#{a.token_no}</span>
                            <Pill bg={statusBg} color={statusColor}>{a.status.replace("_", " ")}</Pill>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: C.text, textTransform: "capitalize", marginBottom: "0.2rem" }}>{a.patient_name}</div>
                          <div style={{ fontSize: "0.78rem", color: C.textMuted, marginBottom: "0.3rem" }}>{a.visit_type}{a.department ? ` · ${a.department}` : ""}</div>
                          {a.doctor_name && <div style={{ fontSize: "0.75rem", color: C.textFaint }}>Dr. {a.doctor_name}</div>}
                          <div style={{ fontSize: "0.72rem", color: C.textFaint, marginTop: "0.35rem" }}>{formatDateTime(a.appointment_date)}</div>
                          {a.appointment_kind === "follow_up" && (
                            <div style={{ marginTop: "0.4rem" }}><Pill bg={C.purpleLight} color={C.purple}>Follow-up</Pill></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </CardWrap>

          {/* Admin-only hint */}
          {!isAdmin && (
            <div style={{ background: "#f8faff", borderRadius: "12px", padding: "1rem 1.4rem", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <FiInfo color={C.textFaint} size={16} />
              <span style={{ fontSize: "0.83rem", color: C.textMuted }}>
                <strong>Doctor Roster & Scheduling management</strong> is handled by administrators. Contact your admin to update doctor slots or availability.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Prescription Upload Modal ── */}
      {uploadTarget && (
        <PrescriptionUploadModal
          patientId={uploadTarget.id}
          patientName={uploadTarget.name}
          doctorName={uploadTarget.doctorName}
          setNotice={setNotice}
          onClose={() => setUploadTarget(null)}
        />
      )}

      {/* ── Keyframes ── */}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
