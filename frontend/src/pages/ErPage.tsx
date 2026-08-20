import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  FiArrowLeft,
  FiPlus,
  FiRefreshCw,
  FiUser,
  FiUserPlus,
  FiHelpCircle,
  FiSearch,
  FiClipboard,
  FiActivity,
  FiAlertTriangle,
  FiZap,
  FiUserCheck,
  FiFileText,
  FiFlag,
  FiClock,
  FiCheck,
  FiUsers,
  FiWatch,
  FiBell,
  FiHome,
} from "react-icons/fi";
import {
  Button,
  Input,
  Label,
  Modal,
  Select,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TabsTrigger,
  Textarea,
} from "../components/ui";
import PrescriptionUploadModal from "../components/PrescriptionUploadModal";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTimeIST } from "../lib/format";
import type { Notice, Patient } from "../types";

type Props = {
  setNotice: (notice: Notice | null) => void;
  onNavigate?: (page: string, extraData?: any) => void;
  // Handed back by AddPatientPage after a patient registered via the "New"
  // mode card below completes -- see App.tsx's navigateToPage. Lets Quick
  // Intake pick up exactly where staff left off instead of making them
  // search for the patient they just registered.
  prefillPatient?: { patient_id: string; name: string; last_name?: string } | null;
};

type ErVisit = {
  id: number;
  visit_no: string;
  patient_id: string | null;
  is_unknown_patient: boolean;
  unknown_patient_label: string | null;
  arrival_mode: string | null;
  condition_at_arrival: string | null;
  arrival_at: string | null;
  status: string;
  assigned_doctor_name: string | null;
  assigned_specialty: string | null;
  doctor_accepted_at: string | null;
  triage_category: string | null;
  triage_bed_label: string | null;
};

type ErComplaint = {
  id: number;
  complaint: string;
  severity: string | null;
  case_category: string | null;
  duration: string | null;
  created_at: string;
};

type ErVitals = {
  id: number;
  recorded_at: string;
  recorded_by: string | null;
  heart_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  respiratory_rate: number | null;
  spo2: number | null;
  temperature: number | null;
  consciousness_level: string | null;
  pain_score: number | null;
  gcs: number | null;
  notes: string | null;
};

type ErTriage = {
  category: string;
  triage_bed_label: string | null;
  reason: string | null;
  triaged_at: string;
  assigned_by: string | null;
} | null;

type ErTreatment = {
  id: number;
  intervention_type: string;
  description: string | null;
  performed_at: string;
  administered_by: string | null;
};

type ErClinicalNote = {
  id: number;
  note_type: string;
  author: string | null;
  content: string;
  created_at: string;
};

type ErDisposition = {
  outcome: string;
  required_specialty: string | null;
  clinical_reason: string;
  decided_at: string;
  priority: string | null;
} | null;

type ErBedRequest = {
  id: number;
  status: string;
  requested_level_of_care: string;
  requested_specialty: string | null;
  requested_at: string;
  allocated_bed_id: number | null;
  allocated_at: string | null;
};

type ErVisitDetail = ErVisit & {
  complaints: ErComplaint[];
  vitals: ErVitals[];
  triage: ErTriage;
  treatments: ErTreatment[];
  clinical_notes: ErClinicalNote[];
  disposition: ErDisposition;
  bed_requests: ErBedRequest[];
};

type TriageCategory = {
  id: number;
  category_code: string;
  category_label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
};

// A patient's general condition at arrival, not the more granular AVPU
// consciousness scale recorded per vitals reading below -- kept as a fixed
// dropdown so triage reads consistently across staff instead of everyone
// typing their own phrasing of "conscious", and so it's fast to fill in.
const ARRIVAL_CONDITION_OPTIONS = [
  "Conscious & Oriented",
  "Conscious but Distressed",
  "Drowsy",
  "Semi-conscious",
  "Unconscious",
  "Actively Convulsing",
  "Cardiac Arrest / No Pulse",
];

const OUTCOMES_REQUIRING_BED = new Set(["ward", "icu", "ot", "observation"]);
const OUTCOME_OPTIONS = [
  { value: "discharge", label: "Discharge" },
  { value: "observation", label: "Observation" },
  { value: "ward", label: "Ward" },
  { value: "icu", label: "ICU" },
  { value: "ot", label: "OT / Surgery" },
  { value: "specialized_department", label: "Specialized Department" },
  { value: "referral", label: "Referral" },
  { value: "transfer", label: "Transfer" },
  { value: "death", label: "Death" },
  { value: "other", label: "Other" },
];

const STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  triaged: "Triaged",
  under_treatment: "Under Treatment",
  doctor_assigned: "Doctor Assigned",
  under_investigation: "Under Investigation",
  stabilized: "Stabilized",
  awaiting_disposition: "Awaiting Disposition",
  bed_requested: "Bed Requested",
  bed_allocated: "Bed Allocated",
  transferred: "Transferred",
  closed: "Closed",
};

// Five semantic groups a status falls into, for the badge color -- see
// styles.css's "Emergency Room" section for the intake/active/pending/
// resolved/closed color scale this drives.
const STATUS_GROUP: Record<string, string> = {
  registered: "intake",
  triaged: "intake",
  under_treatment: "active",
  doctor_assigned: "active",
  under_investigation: "active",
  stabilized: "active",
  awaiting_disposition: "pending",
  bed_requested: "pending",
  bed_allocated: "resolved",
  transferred: "resolved",
  closed: "closed",
};

const CORE_STEPS = [
  { key: "registered", label: "Registered", hint: "Intake" },
  { key: "triaged", label: "Triaged", hint: "Priority set" },
  { key: "under_treatment", label: "Treatment", hint: "Stabilizing" },
  { key: "doctor_assigned", label: "Doctor", hint: "Assessment" },
  { key: "awaiting_disposition", label: "Disposition", hint: "Next step" },
];

function coreStepIndex(status: string): number {
  switch (status) {
    case "registered":
      return 0;
    case "triaged":
      return 1;
    case "under_treatment":
    case "under_investigation":
    case "stabilized":
      return 2;
    case "doctor_assigned":
      return 3;
    default:
      // awaiting_disposition, bed_requested, bed_allocated, transferred, closed
      return 4;
  }
}

function elapsedSince(iso: string | null): string {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const group = STATUS_GROUP[status] || "closed";
  return (
    <span className={`er-status-badge er-status-${group}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function triageColorFor(category: string | null | undefined, categories: TriageCategory[]): string {
  if (!category) return "#c3cbd6";
  return categories.find((c) => c.category_code === category)?.color || "#6b7280";
}

function TriageChip({
  category,
  categories,
  bedLabel,
  compact,
}: {
  category: string;
  categories: TriageCategory[];
  bedLabel?: string | null;
  compact?: boolean;
}) {
  const cat = categories.find((c) => c.category_code === category);
  const color = cat?.color || "#6b7280";
  return (
    <span className="er-triage-chip" style={{ background: `${color}22`, color }}>
      <span className="er-triage-dot" />
      {compact ? category : cat ? `${cat.category_code} — ${cat.category_label}` : category}
      {!compact && bedLabel ? ` · ${bedLabel}` : ""}
    </span>
  );
}

function isAbnormal(field: string, value: number | null): boolean {
  if (value == null) return false;
  switch (field) {
    case "heart_rate":
      return value < 60 || value > 100;
    case "spo2":
      return value < 94;
    case "bp_systolic":
      return value < 90 || value > 140;
    case "respiratory_rate":
      return value < 12 || value > 20;
    case "temperature":
      return value < 36 || value > 37.8;
    default:
      return false;
  }
}

// Maps an AI urgency label to one of the hospital's own configured triage
// categories -- never invents/assumes a code (e.g. "B1"-"B5") that the
// hospital may not have configured (triage categories are deliberately not
// pre-filled, see TriageConfigPanel). Tries a label-keyword match first,
// falls back to the conventional B-code only if that exact code exists, and
// returns "" (meaning: leave untriaged, staff must set it manually) if
// nothing configured matches -- the same safe-degradation behavior as the
// AI Triage Assistant panel on an existing visit.
function mapUrgencyToTriageCategory(urgency: string, categories: TriageCategory[]): string {
  const lower = (urgency || "").toLowerCase();
  let labelKeyword = "";
  let fallbackCode = "";
  if (lower.includes("critical") || lower.includes("immediate") || lower.includes("resuscitation")) {
    labelKeyword = "immediate";
    fallbackCode = "B1";
  } else if (lower.includes("high") || lower.includes("severe") || lower.includes("emergent")) {
    labelKeyword = "high";
    fallbackCode = "B2";
  } else if (lower.includes("moderate") || lower.includes("medium") || lower.includes("urgent")) {
    labelKeyword = "moderate";
    fallbackCode = "B3";
  } else if (lower.includes("low") || lower.includes("minor") || lower.includes("less urgent")) {
    labelKeyword = "low";
    fallbackCode = "B4";
  }
  if (!labelKeyword) return "";
  const byLabel = categories.find((c) => c.category_label.toLowerCase().includes(labelKeyword));
  if (byLabel) return byLabel.category_code;
  const byCode = categories.find((c) => c.category_code === fallbackCode);
  return byCode ? byCode.category_code : "";
}

// Turns a visit's recorded complaints + most recent vitals into the free-text
// "symptoms" the AI triage prompt reasons over -- the same shape Quick Intake,
// the AI Triage Assistant panel, and Doctor Assignment's AI suggestion all
// feed it, so a doctor/department suggestion is only ever grounded in what's
// actually been charted for this patient.
function buildSymptomsSummary(complaints: ErComplaint[], vitals: ErVitals[]): string {
  const complaintText = complaints.map((c) => c.complaint).join(", ");
  const vitalsParts: string[] = [];
  const latest = vitals[vitals.length - 1];
  if (latest) {
    if (latest.heart_rate) vitalsParts.push(`HR: ${latest.heart_rate}`);
    if (latest.bp_systolic && latest.bp_diastolic) vitalsParts.push(`BP: ${latest.bp_systolic}/${latest.bp_diastolic}`);
    if (latest.spo2 != null) vitalsParts.push(`SpO2: ${latest.spo2}%`);
    if (latest.temperature != null) vitalsParts.push(`Temp: ${latest.temperature}C`);
  }
  const vitalsText = vitalsParts.length > 0 ? `Vitals: ${vitalsParts.join(", ")}` : "No vitals recorded.";
  return `Complaints: ${complaintText || "None"}. ${vitalsText}`;
}

// Single source of truth for "ask the AI which department/doctor fits this
// patient" -- fetches the real department/doctor lists (department_name is
// the actual field on /api/registration/departments; a prior bug read a
// nonexistent `.name` here and silently sent the AI an empty list) and calls
// the triage endpoint. Used by Quick Intake, the AI Triage Assistant panel,
// and Doctor Assignment's AI suggestion so all three reason from identical data.
async function fetchAiTriageSuggestion(
  symptoms: string,
): Promise<{ department: string; urgency: string; reasoning: string; doctor: string }> {
  const deptsRes = await apiFetch<{ departments: { department_name: string }[] }>("/api/registration/departments");
  const docsRes = await apiFetch<{ doctors: { doctor_name: string; department: string }[] }>("/api/op/doctors");
  const available_departments = deptsRes.departments.map((d) => d.department_name);
  // "Name (Department)" -- required by the shared doctor-matching backstop
  // (match_doctor_to_department in utils/database.py): it only fires when the
  // model itself doesn't return a doctor, and without the "(Department)"
  // suffix it can never match anything.
  const available_doctors = docsRes.doctors.map((d) => `${d.doctor_name} (${d.department || "General"})`);
  return apiFetch<{ department: string; urgency: string; reasoning: string; doctor: string }>(
    "/api/symptom-ai/triage",
    { method: "POST", body: JSON.stringify({ symptoms, available_departments, available_doctors }) },
  );
}

export default function ErPage({ setNotice, onNavigate, prefillPatient }: Props) {
  const [tab, setTab] = useState<"queue" | "config">("queue");
  const [visits, setVisits] = useState<ErVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVisitId, setSelectedVisitId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ErVisitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newVisitOpen, setNewVisitOpen] = useState(false);
  const [categories, setCategories] = useState<TriageCategory[]>([]);
  const [prescriptionTarget, setPrescriptionTarget] = useState<{
    id: string;
    name: string;
    doctorName?: string;
  } | null>(null);

  const loadVisits = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ visits: ErVisit[] }>(
        "/api/er/visits?active_only=true",
      );
      setVisits(data.visits);
    } catch (error: any) {
      reportError(setNotice, error, "Failed to load ER visits.");
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await apiFetch<{ categories: TriageCategory[] }>(
        "/api/er/triage-config",
      );
      setCategories(data.categories);
    } catch (error: any) {
      reportError(setNotice, error, "Failed to load triage categories.");
    }
  };

  const loadDetail = async (visitId: number) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<ErVisitDetail>(`/api/er/visits/${visitId}`);
      setDetail(data);
    } catch (error: any) {
      reportError(setNotice, error, "Failed to load this ER visit.");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadVisits();
    loadCategories();
  }, []);

  useEffect(() => {
    if (selectedVisitId) loadDetail(selectedVisitId);
  }, [selectedVisitId]);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const v of visits) {
      if (v.status !== "closed") byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    }
    return byStatus;
  }, [visits]);

  const refreshAfterAction = async () => {
    await loadVisits();
    if (selectedVisitId) await loadDetail(selectedVisitId);
  };

  if (selectedVisitId && detail) {
    return (
      <VisitDetailPanel
        detail={detail}
        loading={detailLoading}
        categories={categories}
        setNotice={setNotice}
        onBack={() => {
          setSelectedVisitId(null);
          setDetail(null);
          loadVisits();
        }}
        onRefresh={refreshAfterAction}
        onOrderMedication={() =>
          setPrescriptionTarget({
            id: detail.patient_id || "",
            name: detail.patient_id
              ? detail.patient_id
              : detail.unknown_patient_label || detail.visit_no,
            doctorName: detail.assigned_doctor_name || undefined,
          })
        }
      />
    );
  }

  const activeCount = visits.filter((v) => v.status !== "closed").length;
  const awaitingDoctorCount = (summary["registered"] || 0) + (summary["triaged"] || 0);
  const bedRequestedCount = summary["bed_requested"] || 0;
  const bedAllocatedCount = summary["bed_allocated"] || 0;

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <p className="muted">
          One board for every patient in the department right now — triaged by
          acuity, tracked from arrival to disposition. Reception allocates the
          physical bed in Bed Management once a bed is requested here.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button variant="ghost" onClick={loadVisits}>
            <FiRefreshCw aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      <div className="er-dashboard-layout">
        <div className="er-intake-sidebar">
          <QuickIntakePanel
            setNotice={setNotice}
            categories={categories}
            prefillPatient={prefillPatient}
            onCreated={(visitId) => {
              loadVisits();
              setSelectedVisitId(visitId);
            }}
            onNavigate={onNavigate}
          />
        </div>

        <div className="er-queue-area" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="er-stat-grid" style={{ gap: "1.5rem" }}>
            <div className="er-stat-tile-modern er-stat-tile-neutral">
              <span className="er-stat-icon"><FiUsers aria-hidden /></span>
              <div>
                <p>Active Visits</p>
                <h3>{activeCount}</h3>
              </div>
            </div>
            <div className="er-stat-tile-modern er-stat-tile-active">
              <span className="er-stat-icon"><FiWatch aria-hidden /></span>
              <div>
                <p>Awaiting Doctor</p>
                <h3>{awaitingDoctorCount}</h3>
              </div>
            </div>
            <div className="er-stat-tile-modern er-stat-tile-pending">
              <span className="er-stat-icon"><FiBell aria-hidden /></span>
              <div>
                <p>Bed Requested</p>
                <h3>{bedRequestedCount}</h3>
              </div>
            </div>
            <div className="er-stat-tile-modern er-stat-tile-resolved">
              <span className="er-stat-icon"><FiHome aria-hidden /></span>
              <div>
                <p>Bed Allocated</p>
                <h3>{bedAllocatedCount}</h3>
              </div>
            </div>
          </div>

          <div className="panel">
            <Tabs>
              <TabsTrigger active={tab === "queue"} onClick={() => setTab("queue")}>
                Queue
              </TabsTrigger>
              <TabsTrigger active={tab === "config"} onClick={() => setTab("config")}>
                Triage Configuration
              </TabsTrigger>
            </Tabs>

            {tab === "queue" ? (
              loading ? (
                <p className="muted">Loading ER visits...</p>
              ) : visits.length === 0 ? (
                <div className="module-empty-state">
                  <p className="module-empty-state-title">No active ER visits</p>
                  <p className="module-empty-state-hint">
                    Register a new ER visit to get started.
                  </p>
                </div>
              ) : (
                <div className="er-queue-table">
                  <Table>
                    <TableHead>
                      <TableCell>Visit</TableCell>
                      <TableCell>Triage</TableCell>
                      <TableCell>Patient</TableCell>
                      <TableCell>Arrived</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Doctor</TableCell>
                      <TableCell />
                    </TableHead>
                    {visits.map((v) => (
                      <TableRow
                        key={v.id}
                        className="er-queue-row-modern"
                        style={{ boxShadow: `inset 4px 0 0 0 ${triageColorFor(v.triage_category, categories)}` }}
                      >
                        <TableCell style={{ fontWeight: 700 }}>{v.visit_no}</TableCell>
                        <TableCell>
                          {v.triage_category ? (
                            <TriageChip category={v.triage_category} categories={categories} compact />
                          ) : (
                            <span className="muted" style={{ fontSize: "0.8rem" }}>Not triaged</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {v.is_unknown_patient ? (
                            <span>
                              <FiHelpCircle aria-hidden style={{ marginRight: "0.3rem", color: "#b3451f" }} />
                              <span className="er-queue-patient-name">{v.unknown_patient_label || "Unknown patient"}</span>
                            </span>
                          ) : (
                            <span className="er-queue-patient-id">{v.patient_id}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="er-elapsed">
                            <FiClock aria-hidden style={{ marginRight: "0.3rem" }} />
                            {elapsedSince(v.arrival_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={v.status} />
                        </TableCell>
                        <TableCell>
                          {v.assigned_doctor_name || (
                            <span className="muted">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSelectedVisitId(v.id)}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Table>
                </div>
              )
            ) : (
              <TriageConfigPanel
                categories={categories}
                setNotice={setNotice}
                onCreated={loadCategories}
              />
            )}
          </div>
        </div>
      </div>

      {prescriptionTarget && (
        <PrescriptionUploadModal
          patientId={prescriptionTarget.id}
          patientName={prescriptionTarget.name}
          doctorName={prescriptionTarget.doctorName}
          mode="manual"
          setNotice={setNotice}
          onClose={() => setPrescriptionTarget(null)}
        />
      )}
    </section>
  );
}

// ==================== Quick Intake ====================

type PatientMode = "existing" | "new" | "unknown";

function QuickIntakePanel({
  setNotice,
  categories,
  prefillPatient,
  onCreated,
  onNavigate,
}: {
  setNotice: (notice: Notice | null) => void;
  categories: TriageCategory[];
  prefillPatient?: { patient_id: string; name: string; last_name?: string } | null;
  onCreated: (visitId: number) => void;
  onNavigate?: (page: string, extraData?: any) => void;
}) {
  const [patientMode, setPatientMode] = useState<PatientMode>("existing");

  // Existing patient search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // A patient just registered via "New" mode (see the registration-redirect
  // card below) comes back here already known -- skip straight to having
  // them selected instead of making staff search for who they just typed in.
  useEffect(() => {
    if (!prefillPatient) return;
    setPatientMode("existing");
    setSelectedPatient(prefillPatient as Patient);
  }, [prefillPatient]);

  // Unknown patient
  const [unknownLabel, setUnknownLabel] = useState("");

  // Clinical Intake
  const [arrivalMode, setArrivalMode] = useState("walk-in");
  const [conditionAtArrival, setConditionAtArrival] = useState("");
  const [complaint, setComplaint] = useState("");
  const [vitalsHr, setVitalsHr] = useState("");
  const [vitalsBpSys, setVitalsBpSys] = useState("");
  const [vitalsBpDia, setVitalsBpDia] = useState("");
  const [vitalsSpo2, setVitalsSpo2] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (patientMode !== "existing" || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const data = await apiFetch<{ patients: Patient[] }>(
          `/api/patients?q=${encodeURIComponent(searchQuery.trim())}`,
        );
        setSearchResults((data.patients || []).slice(0, 8));
      } catch (error) {
        console.error(error);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [searchQuery, patientMode]);

  const submit = async () => {
    if (patientMode === "existing" && !selectedPatient) {
      setNotice({ type: "error", message: "Select a patient first." });
      return;
    }
    if (patientMode === "unknown" && !unknownLabel.trim()) {
      setNotice({ type: "error", message: "Describe the unknown patient (e.g. \"Unknown male, approx 35-40\")." });
      return;
    }

    setSaving(true);
    try {
      let patientId: string | undefined;

      // 1. Resolve Patient (new patients are registered via the Patient
      // Registration module itself -- see the "new" mode card below -- so
      // by the time this form submits, patientMode is only ever "existing"
      // or "unknown".)
      if (patientMode === "existing") {
        patientId = selectedPatient!.patient_id;
      }

      // 2. Create ER Visit
      const payload: Record<string, unknown> = {
        arrival_mode: arrivalMode,
        condition_at_arrival: conditionAtArrival || undefined,
      };
      if (patientMode === "unknown") {
        payload.is_unknown_patient = true;
        payload.unknown_patient_label = unknownLabel.trim();
      } else {
        payload.patient_id = patientId;
      }

      const visitRes = await apiFetch<{ id: number; visit_no: string }>(
        "/api/er/visits",
        { method: "POST", body: JSON.stringify(payload) },
      );
      const visitId = visitRes.id;

      let symptomsText = "";

      // 3. Add Complaints
      if (complaint.trim()) {
        await apiFetch(`/api/er/visits/${visitId}/complaints`, {
          method: "POST",
          body: JSON.stringify({ complaint: complaint.trim() })
        });
        symptomsText += `Complaints: ${complaint.trim()}. `;
      }

      // 4. Add Vitals
      let vitalsRecorded = false;
      const vPayload: any = {};
      if (vitalsHr.trim()) { vPayload.heart_rate = parseInt(vitalsHr); vitalsRecorded = true; }
      if (vitalsBpSys.trim()) { vPayload.bp_systolic = parseInt(vitalsBpSys); vitalsRecorded = true; }
      if (vitalsBpDia.trim()) { vPayload.bp_diastolic = parseInt(vitalsBpDia); vitalsRecorded = true; }
      if (vitalsSpo2.trim()) { vPayload.spo2 = parseInt(vitalsSpo2); vitalsRecorded = true; }

      let vitalsParts = [];
      if (vitalsRecorded) {
        await apiFetch(`/api/er/visits/${visitId}/vitals`, {
          method: "POST",
          body: JSON.stringify(vPayload)
        });
        
        if (vPayload.heart_rate) vitalsParts.push(`HR: ${vPayload.heart_rate}`);
        if (vPayload.bp_systolic && vPayload.bp_diastolic) vitalsParts.push(`BP: ${vPayload.bp_systolic}/${vPayload.bp_diastolic}`);
        if (vPayload.spo2) vitalsParts.push(`SpO2: ${vPayload.spo2}%`);
        symptomsText += `Vitals: ${vitalsParts.join(", ")}`;
      }

      // 5. Trigger AI Triage
      if (symptomsText.trim()) {
        const aiRes = await fetchAiTriageSuggestion(symptomsText);

        // Apply Triage -- only if the AI's urgency maps to a category this
        // hospital has actually configured; otherwise leave it untriaged so
        // staff set it manually via the Triage panel (see mapUrgencyToTriageCategory).
        const categoryCode = mapUrgencyToTriageCategory(aiRes.urgency, categories);
        if (categoryCode) {
          await apiFetch(`/api/er/visits/${visitId}/triage`, {
            method: "POST",
            body: JSON.stringify({
              category: categoryCode,
              reason: (aiRes.reasoning || "AI Triage applied").substring(0, 200)
            })
          });
        }

        // Assign Doctor
        if (aiRes.doctor || aiRes.department) {
          await apiFetch(`/api/er/visits/${visitId}/assign-doctor`, {
            method: "POST",
            body: JSON.stringify({
              specialty: aiRes.department || "Emergency",
              doctor_name: aiRes.doctor || undefined
            })
          });
        }
      }

      setNotice({ type: "success", message: `ER visit ${visitRes.visit_no} registered & AI triaged.` });
      // Reset form
      setSearchQuery("");
      setSelectedPatient(null);
      setUnknownLabel("");
      setComplaint("");
      setVitalsHr("");
      setVitalsBpSys("");
      setVitalsBpDia("");
      setVitalsSpo2("");
      
      onCreated(visitId);
    } catch (error: any) {
      reportError(
        setNotice,
        error,
        "Failed to complete the Quick Intake process."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="er-intake-panel" style={{ maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
      <h3 style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "0.5rem", marginBottom: "1rem" }}><FiPlus /> Unified ER Intake</h3>
      
      {/* 1. Identity Section */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Label>1. Patient Identity</Label>
        <div className="er-mode-grid" style={{ marginBottom: "1rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            className={`er-mode-card${patientMode === "existing" ? " er-mode-card-active" : ""}`}
            onClick={() => setPatientMode("existing")}
          >
            <FiSearch aria-hidden />
            Search
          </button>
          <button
            type="button"
            className={`er-mode-card${patientMode === "new" ? " er-mode-card-active" : ""}`}
            onClick={() => setPatientMode("new")}
          >
            <FiUserPlus aria-hidden />
            New
          </button>
          <button
            type="button"
            className={`er-mode-card${patientMode === "unknown" ? " er-mode-card-active" : ""}`}
            onClick={() => setPatientMode("unknown")}
          >
            <FiHelpCircle aria-hidden />
            Unknown
          </button>
        </div>

        {patientMode === "existing" && (
          <div>
            {selectedPatient ? (
              <div className="er-selected-patient">
                <span>
                  {selectedPatient.name} {selectedPatient.last_name} — {selectedPatient.patient_id}
                </span>
                <Button size="sm" variant="ghost" onClick={() => { setSelectedPatient(null); setSearchQuery(""); }}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="ai-search-bar">
                  <FiSearch className="ai-search-icon" aria-hidden />
                  <Input
                    className="ai-search-input"
                    placeholder="Search name, ID, phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="er-patient-search-results">
                    {searchResults.map((p) => (
                      <button
                        key={p.patient_id}
                        type="button"
                        className="er-patient-search-row"
                        onClick={() => setSelectedPatient(p)}
                      >
                        <span>
                          {p.name} {p.last_name}
                        </span>
                        <span className="muted">{p.patient_id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {patientMode === "new" && (
          <div className="er-registration-redirect">
            <p className="muted" style={{ marginTop: 0 }}>
              New patients are registered through the hospital's Patient
              Registration module, so their record stays consistent everywhere
              else in the system — ER doesn't keep a separate copy.
            </p>
            <Button
              onClick={() => onNavigate?.("add", { returnTo: "er" })}
              disabled={!onNavigate}
            >
              <FiUserPlus aria-hidden /> Open Patient Registration
            </Button>
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
              Once registered, you'll be brought straight back here with them
              selected — no need to search.
            </p>
          </div>
        )}

        {patientMode === "unknown" && (
          <div>
            <Label htmlFor="er-unknown-label">Description</Label>
            <Input
              id="er-unknown-label"
              placeholder="e.g. Unknown male, approx 35-40"
              value={unknownLabel}
              onChange={(e) => setUnknownLabel(e.target.value)}
            />
          </div>
        )}
      </div>

      {patientMode !== "new" && (
        <>
          {/* 2. Clinical Intake Section */}
          <div style={{ marginBottom: "1.5rem" }}>
            <Label>2. Arrival & Complaints</Label>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", marginBottom: "0.5rem" }}>
              <div style={{ flex: 1 }}>
                <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Mode</Label>
                <Select value={arrivalMode} onChange={(e) => setArrivalMode(e.target.value)}>
                  <option value="walk-in">Walk-in</option>
                  <option value="ambulance">Ambulance</option>
                  <option value="police">Police</option>
                  <option value="referral">Referral</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Condition on arrival</Label>
                <Select value={conditionAtArrival} onChange={(e) => setConditionAtArrival(e.target.value)}>
                  <option value="">Select...</option>
                  {ARRIVAL_CONDITION_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Chief Complaints</Label>
              <Textarea
                rows={2}
                placeholder="e.g. Severe chest pain radiating to left arm..."
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
              />
            </div>
          </div>

          {/* 3. Vitals Section */}
          <div style={{ marginBottom: "1.5rem" }}>
            <Label>3. Initial Vitals</Label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.5rem" }}>
              <div>
                <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>HR (bpm)</Label>
                <Input type="number" placeholder="80" value={vitalsHr} onChange={e => setVitalsHr(e.target.value)} />
              </div>
              <div>
                <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>SpO2 (%)</Label>
                <Input type="number" placeholder="98" value={vitalsSpo2} onChange={e => setVitalsSpo2(e.target.value)} />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Sys BP</Label>
                  <Input type="number" placeholder="120" value={vitalsBpSys} onChange={e => setVitalsBpSys(e.target.value)} />
                </div>
                <span style={{ marginTop: "1.2rem", color: "#94a3b8" }}>/</span>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Dia BP</Label>
                  <Input type="number" placeholder="80" value={vitalsBpDia} onChange={e => setVitalsBpDia(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <Button
              style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
              onClick={submit}
              disabled={saving || (patientMode === "unknown" && !unknownLabel.trim())}
            >
              {saving ? "Processing Intake..." : "Admit & Auto-Triage"}
            </Button>
            <p className="muted" style={{ fontSize: "0.75rem", textAlign: "center", marginTop: "0.5rem" }}>
              Identity, Complaints, Vitals, and AI Triage will be processed instantly.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== Triage Configuration ====================

function TriageConfigPanel({
  categories,
  setNotice,
  onCreated,
}: {
  categories: TriageCategory[];
  setNotice: (notice: Notice | null) => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#c0392b");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!code.trim() || !label.trim()) {
      setNotice({ type: "error", message: "Category code and label are required." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/er/triage-config", {
        method: "POST",
        body: JSON.stringify({
          category_code: code.trim(),
          category_label: label.trim(),
          description: description.trim() || undefined,
          color,
          sort_order: categories.length,
        }),
      });
      setCode("");
      setLabel("");
      setDescription("");
      setNotice({ type: "success", message: "Triage category added." });
      onCreated();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to add triage category.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {categories.length === 0 ? (
        <div className="module-empty-state">
          <p className="module-empty-state-title">No triage categories configured</p>
          <p className="module-empty-state-hint">
            Triage can't be used until your hospital's clinical team defines its own
            priority categories (e.g. B1-B4) below — nothing is pre-filled on purpose.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {categories.map((c) => (
            <div key={c.id} title={c.description || undefined}>
              <TriageChip category={c.category_code} categories={categories} />
            </div>
          ))}
        </div>
      )}

      <div className="module-form-grid">
        <div>
          <Label htmlFor="triage-code">Category code</Label>
          <Input id="triage-code" placeholder="B1" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="triage-label">Label</Label>
          <Input
            id="triage-label"
            placeholder="Immediate / Life-threatening"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="triage-desc">Clinical criteria / description</Label>
          <Textarea
            id="triage-desc"
            placeholder="Describe your hospital's own criteria for this category"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="triage-color">Color</Label>
          <Input id="triage-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
      </div>
      <Button onClick={submit} disabled={saving} style={{ marginTop: "0.75rem" }}>
        {saving ? "Adding..." : "Add Triage Category"}
      </Button>
    </div>
  );
}

// ==================== Visit Detail ====================

function SectionHead({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="er-section-head">
      <span className="er-section-icon">{icon}</span>
      <h3>{title}</h3>
      {action && <div className="er-section-head-actions">{action}</div>}
    </div>
  );
}

function VisitDetailPanel({
  detail,
  loading,
  categories,
  setNotice,
  onBack,
  onRefresh,
  onOrderMedication,
}: {
  detail: ErVisitDetail;
  loading: boolean;
  categories: TriageCategory[];
  setNotice: (notice: Notice | null) => void;
  onBack: () => void;
  onRefresh: () => void;
  onOrderMedication: () => void;
}) {
  const patientLabel = detail.is_unknown_patient
    ? detail.unknown_patient_label || "Unknown patient"
    : detail.patient_id;

  const pendingBedRequest = detail.bed_requests.find((r) => r.status === "pending");
  const closedOrNoBedNeeded =
    detail.disposition && !OUTCOMES_REQUIRING_BED.has(detail.disposition.outcome);
  const currentStep = coreStepIndex(detail.status);

  return (
    <section className="module-page">
      <div>
        <Button variant="ghost" onClick={onBack} className="er-visit-header-back">
          <FiArrowLeft aria-hidden /> Back to Queue
        </Button>
      </div>

      <div className="er-visit-header">
        <div>
          <h2 className="er-visit-no">{detail.visit_no}</h2>
          <p className="er-visit-sub">
            {detail.is_unknown_patient && <FiHelpCircle aria-hidden style={{ marginRight: "0.3rem" }} />}
            {patientLabel} &middot; Arrived {formatDateTimeIST(detail.arrival_at)}
            {detail.arrival_mode ? ` (${detail.arrival_mode})` : ""}
          </p>
        </div>
        <div className="er-visit-header-meta">
          <StatusBadge status={detail.status} />
          {detail.triage && (
            <TriageChip
              category={detail.triage.category}
              categories={categories}
              bedLabel={detail.triage.triage_bed_label}
            />
          )}
        </div>
      </div>

      <div className="journey-steps" role="list" aria-label="ER visit progress">
        {CORE_STEPS.map((s, index) => {
          const isDone = index < currentStep;
          const isActive = index === currentStep;
          const state = isActive
            ? "journey-step-active"
            : isDone
              ? "journey-step-completed"
              : "journey-step-upcoming";
          return (
            <div className="journey-step-wrap" key={s.key}>
              <div className={`journey-step ${state}`}>
                <span className="journey-step-circle">
                  {isDone ? <FiCheck aria-hidden /> : index + 1}
                </span>
                <span className="journey-step-text">
                  <span className="journey-step-label">{s.label}</span>
                  <span className="journey-step-hint">{s.hint}</span>
                </span>
              </div>
              {index < CORE_STEPS.length - 1 && (
                <span className={isDone ? "journey-step-connector filled" : "journey-step-connector"} />
              )}
            </div>
          );
        })}
      </div>

      {loading && <p className="muted">Refreshing...</p>}

      <div className="er-detail-layout">
        <div className="er-detail-sidebar">
          {detail.is_unknown_patient && (
            <MergeUnknownPatient
              visitId={detail.id}
              setNotice={setNotice}
              onMerged={onRefresh}
            />
          )}

          <div className="panel">
            <SectionHead icon={<FiActivity aria-hidden />} title="Vitals" />
            <VitalsList vitals={detail.vitals} />
            <AddVitalsForm visitId={detail.id} setNotice={setNotice} onAdded={onRefresh} />
          </div>

          <div className="panel">
            <SectionHead icon={<FiAlertTriangle aria-hidden />} title="Triage" />
            {detail.triage ? (
              <p>
                <TriageChip category={detail.triage.category} categories={categories} bedLabel={detail.triage.triage_bed_label} />
                <br />
                <span className="muted" style={{ display: "inline-block", marginTop: "0.4rem" }}>
                  {detail.triage.reason} &middot; {formatDateTimeIST(detail.triage.triaged_at)}
                </span>
              </p>
            ) : (
              <p className="muted">Not yet triaged.</p>
            )}
            <TriageForm
              visitId={detail.id}
              categories={categories}
              existing={detail.triage}
              setNotice={setNotice}
              onSaved={onRefresh}
            />
          </div>
        </div>

        <div className="er-detail-main">
          <AITriagePanel
            detail={detail}
            categories={categories}
            setNotice={setNotice}
            onRefresh={onRefresh}
          />

          <div className="panel">
            <SectionHead icon={<FiClipboard aria-hidden />} title="Chief Complaints" />
            <ComplaintList complaints={detail.complaints} />
            <AddComplaintForm visitId={detail.id} setNotice={setNotice} onAdded={onRefresh} />
          </div>

          <div className="panel">
            <SectionHead
              icon={<FiZap aria-hidden />}
              title="Emergency Treatment"
              action={
                <Button size="sm" onClick={onOrderMedication}>
                  Order Medication
                </Button>
              }
            />
            <TreatmentList treatments={detail.treatments} />
            <AddTreatmentForm visitId={detail.id} setNotice={setNotice} onAdded={onRefresh} />
          </div>

          <div className="panel">
            <SectionHead icon={<FiUserCheck aria-hidden />} title="Doctor Assignment" />
            <p>
              {detail.assigned_doctor_name ? (
                <>
                  <strong>{detail.assigned_doctor_name}</strong> ({detail.assigned_specialty})
                  {detail.doctor_accepted_at ? (
                    <span className="er-status-badge er-status-resolved" style={{ marginLeft: "0.5rem" }}>Accepted</span>
                  ) : (
                    <span className="er-status-badge er-status-pending" style={{ marginLeft: "0.5rem" }}>Pending accept</span>
                  )}
                </>
              ) : (
                <span className="muted">No doctor assigned yet.</span>
              )}
            </p>
            <DoctorAssignForm
              visitId={detail.id}
              complaints={detail.complaints}
              vitals={detail.vitals}
              setNotice={setNotice}
              onSaved={onRefresh}
            />
            {detail.assigned_doctor_name && !detail.doctor_accepted_at && (
              <Button
                size="sm"
                variant="secondary"
                style={{ marginTop: "0.5rem" }}
                onClick={async () => {
                  try {
                    await apiFetch(`/api/er/visits/${detail.id}/accept`, { method: "POST" });
                    onRefresh();
                  } catch (error: any) {
                    reportError(setNotice, error, "Failed to accept the assignment.");
                  }
                }}
              >
                Doctor Accepts Patient
              </Button>
            )}
          </div>

          <div className="panel">
            <SectionHead icon={<FiFileText aria-hidden />} title="Clinical Notes" />
            <NotesList notes={detail.clinical_notes} />
            <AddNoteForm visitId={detail.id} setNotice={setNotice} onAdded={onRefresh} />
          </div>

          <div className="panel">
            <SectionHead icon={<FiFlag aria-hidden />} title="Disposition" />
            {detail.disposition ? (
              <p>
                <strong>{OUTCOME_OPTIONS.find((o) => o.value === detail.disposition!.outcome)?.label || detail.disposition.outcome}</strong>
                <br />
                <span className="muted">{detail.disposition.clinical_reason}</span>
              </p>
            ) : (
              <p className="muted">No disposition recorded yet.</p>
            )}

            {!detail.disposition && (
              <DispositionForm visitId={detail.id} setNotice={setNotice} onSaved={onRefresh} />
            )}

            {pendingBedRequest && (
              <p className="muted">
                Bed request sent to Bed Management ({pendingBedRequest.requested_level_of_care.toUpperCase()}) —
                awaiting allocation.
              </p>
            )}

            {closedOrNoBedNeeded && detail.status !== "closed" && (
              <CloseVisitPanel visitId={detail.id} setNotice={setNotice} onClosed={onRefresh} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MergeUnknownPatient({
  visitId,
  setNotice,
  onMerged,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onMerged: () => void;
}) {
  const [patientId, setPatientId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!patientId.trim()) {
      setNotice({ type: "error", message: "Enter the confirmed patient ID." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/merge-unknown`, {
        method: "POST",
        body: JSON.stringify({ patient_id: patientId.trim() }),
      });
      setNotice({ type: "success", message: "Visit merged into the confirmed patient record." });
      onMerged();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to merge this visit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel" style={{ borderColor: "#e67e22" }}>
      <SectionHead icon={<FiHelpCircle aria-hidden />} title="Identity Not Yet Confirmed" />
      <p className="muted">
        Once this patient's identity is confirmed, merge this visit into their real
        patient record. Everything recorded so far stays exactly where it is.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <Label htmlFor="merge-patient-id">Confirmed patient ID</Label>
          <Input
            id="merge-patient-id"
            placeholder="PAT-100001"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={saving}>
          {saving ? "Merging..." : "Merge"}
        </Button>
      </div>
    </div>
  );
}

function ComplaintList({ complaints }: { complaints: ErComplaint[] }) {
  if (complaints.length === 0) return <p className="muted">No complaints recorded.</p>;
  return (
    <ul className="er-list">
      {complaints.map((c) => (
        <li key={c.id}>
          <strong>{c.complaint}</strong>
          {c.severity ? ` (${c.severity})` : ""}
          {c.case_category ? ` — ${c.case_category}` : ""}
          <span className="muted"> &middot; {formatDateTimeIST(c.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

function AddComplaintForm({
  visitId,
  setNotice,
  onAdded,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onAdded: () => void;
}) {
  const [complaint, setComplaint] = useState("");
  const [severity, setSeverity] = useState("");
  const [caseCategory, setCaseCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!complaint.trim()) {
      setNotice({ type: "error", message: "Enter a complaint." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/complaints`, {
        method: "POST",
        body: JSON.stringify({
          complaint: complaint.trim(),
          severity: severity || undefined,
          case_category: caseCategory || undefined,
        }),
      });
      setComplaint("");
      setSeverity("");
      setCaseCategory("");
      onAdded();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to add complaint.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-form-grid" style={{ marginTop: "0.75rem" }}>
      <Input placeholder="Complaint (e.g. Chest pain)" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
      <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
        <option value="">Severity</option>
        <option value="mild">Mild</option>
        <option value="moderate">Moderate</option>
        <option value="severe">Severe</option>
      </Select>
      <Select value={caseCategory} onChange={(e) => setCaseCategory(e.target.value)}>
        <option value="">Case category</option>
        <option value="cardiac">Cardiac</option>
        <option value="trauma">Trauma / Accident</option>
        <option value="rta">Road Traffic Accident</option>
        <option value="poisoning">Poisoning</option>
        <option value="hanging">Hanging / Strangulation</option>
        <option value="drowning">Drowning</option>
        <option value="farm_injury">Farm / Agricultural Injury</option>
        <option value="pregnancy">Pregnancy-related</option>
        <option value="seizure">Seizure</option>
        <option value="neurological">Neurological</option>
        <option value="other">Other</option>
      </Select>
      <Button size="sm" onClick={submit} disabled={saving}>
        {saving ? "Adding..." : "Add Complaint"}
      </Button>
    </div>
  );
}

function formatTimeShortIST(iso: string | null): string {
  if (!iso) return "-";
  const hasOffset = /([zZ]|[+-]\d{2}:\d{2})$/.test(iso);
  const parsed = new Date(hasOffset ? iso : `${iso}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function VitalChip({
  label,
  value,
  abnormal,
}: {
  label: string;
  value: string | number | null | undefined;
  abnormal?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <span className={`er-vital-chip${abnormal ? " er-vital-chip-abnormal" : ""}`}>
      <span className="er-vital-chip-label">{label}</span>
      <span className="er-vital-chip-value">{value}</span>
    </span>
  );
}

function VitalsList({ vitals }: { vitals: ErVitals[] }) {
  if (vitals.length === 0) return <p className="muted">No vitals recorded yet.</p>;
  const mostRecentFirst = [...vitals].reverse();
  return (
    <div className="er-vitals-timeline">
      {mostRecentFirst.map((v, idx) => (
        <div key={v.id} className={`er-vitals-reading${idx === 0 ? " er-vitals-reading-latest" : ""}`}>
          <div className="er-vitals-reading-time">
            <FiClock aria-hidden />
            {formatTimeShortIST(v.recorded_at)}
            {idx === 0 && <span className="er-vitals-latest-tag">Latest</span>}
          </div>
          <div className="er-vitals-reading-chips">
            <VitalChip
              label="BP"
              value={v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : null}
              abnormal={isAbnormal("bp_systolic", v.bp_systolic)}
            />
            <VitalChip label="HR" value={v.heart_rate} abnormal={isAbnormal("heart_rate", v.heart_rate)} />
            <VitalChip
              label="SpO2"
              value={v.spo2 != null ? `${v.spo2}%` : null}
              abnormal={isAbnormal("spo2", v.spo2)}
            />
            <VitalChip
              label="RR"
              value={v.respiratory_rate}
              abnormal={isAbnormal("respiratory_rate", v.respiratory_rate)}
            />
            <VitalChip
              label="Temp"
              value={v.temperature != null ? `${v.temperature}°C` : null}
              abnormal={isAbnormal("temperature", v.temperature)}
            />
            <VitalChip
              label="AVPU"
              value={v.consciousness_level}
              abnormal={!!v.consciousness_level && v.consciousness_level !== "Alert"}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const CONSCIOUSNESS_OPTIONS = [
  { value: "Alert", label: "Alert (A) — fully conscious" },
  { value: "Verbal", label: "Verbal (V) — responds to voice" },
  { value: "Pain", label: "Pain (P) — responds to pain only" },
  { value: "Unresponsive", label: "Unresponsive (U)" },
];

function AddVitalsForm({
  visitId,
  setNotice,
  onAdded,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onAdded: () => void;
}) {
  const [heartRate, setHeartRate] = useState("");
  const [bpSystolic, setBpSystolic] = useState("");
  const [bpDiastolic, setBpDiastolic] = useState("");
  const [spo2, setSpo2] = useState("");
  const [rr, setRr] = useState("");
  const [temp, setTemp] = useState("");
  const [consciousness, setConsciousness] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/vitals`, {
        method: "POST",
        body: JSON.stringify({
          heart_rate: heartRate ? Number(heartRate) : undefined,
          bp_systolic: bpSystolic ? Number(bpSystolic) : undefined,
          bp_diastolic: bpDiastolic ? Number(bpDiastolic) : undefined,
          spo2: spo2 ? Number(spo2) : undefined,
          respiratory_rate: rr ? Number(rr) : undefined,
          temperature: temp ? Number(temp) : undefined,
          consciousness_level: consciousness || undefined,
        }),
      });
      setHeartRate("");
      setBpSystolic("");
      setBpDiastolic("");
      setSpo2("");
      setRr("");
      setTemp("");
      setConsciousness("");
      onAdded();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to record vitals.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="er-sidebar-form" style={{ marginTop: "0.75rem" }}>
      <div className="er-sidebar-form-row">
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>HR (bpm)</Label>
          <Input type="number" placeholder="80" value={heartRate} onChange={(e) => setHeartRate(e.target.value)} />
        </div>
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>SpO2 (%)</Label>
          <Input type="number" placeholder="98" value={spo2} onChange={(e) => setSpo2(e.target.value)} />
        </div>
      </div>
      <div className="er-sidebar-form-row">
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>BP systolic</Label>
          <Input type="number" placeholder="120" value={bpSystolic} onChange={(e) => setBpSystolic(e.target.value)} />
        </div>
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>BP diastolic</Label>
          <Input type="number" placeholder="80" value={bpDiastolic} onChange={(e) => setBpDiastolic(e.target.value)} />
        </div>
      </div>
      <div className="er-sidebar-form-row">
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Resp. rate</Label>
          <Input type="number" placeholder="16" value={rr} onChange={(e) => setRr(e.target.value)} />
        </div>
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Temp (°C)</Label>
          <Input type="number" placeholder="37.0" value={temp} onChange={(e) => setTemp(e.target.value)} />
        </div>
      </div>
      <div>
        <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Consciousness (AVPU)</Label>
        <Select value={consciousness} onChange={(e) => setConsciousness(e.target.value)}>
          <option value="">Not assessed</option>
          {CONSCIOUSNESS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>
      <Button size="sm" onClick={submit} disabled={saving} style={{ width: "100%" }}>
        {saving ? "Saving..." : "Record Vitals"}
      </Button>
    </div>
  );
}

function TriageForm({
  visitId,
  categories,
  existing,
  setNotice,
  onSaved,
}: {
  visitId: number;
  categories: TriageCategory[];
  existing: ErTriage;
  setNotice: (notice: Notice | null) => void;
  onSaved: () => void;
}) {
  // Already triaged -> this form is only for a correction (e.g. condition
  // changed, or the wrong category was picked), not a required step, so it
  // stays collapsed behind an explicit toggle instead of always showing a
  // second full form under the triage that's already been recorded.
  const [open, setOpen] = useState(!existing);
  const [category, setCategory] = useState(existing?.category || "");
  const [bedLabel, setBedLabel] = useState(existing?.triage_bed_label || "");
  const [reason, setReason] = useState(existing?.reason || "");
  const [saving, setSaving] = useState(false);

  if (categories.length === 0) {
    return (
      <p className="muted">
        No triage categories configured yet — an admin must add them under the
        Triage Configuration tab before this visit can be triaged.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        style={{ marginTop: "0.6rem" }}
        onClick={() => {
          setCategory(existing?.category || "");
          setBedLabel(existing?.triage_bed_label || "");
          setReason(existing?.reason || "");
          setOpen(true);
        }}
      >
        Correct / update triage
      </Button>
    );
  }

  const submit = async () => {
    if (!category) {
      setNotice({ type: "error", message: "Select a triage category." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/triage`, {
        method: "POST",
        body: JSON.stringify({
          category,
          triage_bed_label: bedLabel || undefined,
          reason: reason || undefined,
        }),
      });
      if (existing) setOpen(false);
      onSaved();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to save triage.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="er-sidebar-form" style={{ marginTop: "0.75rem" }}>
      {!existing && (
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.2rem" }}>
          Required before treatment can proceed.
        </p>
      )}
      <div>
        <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Category</Label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.category_code}>
              {c.category_code} — {c.category_label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Triage bay (optional)</Label>
        <Input placeholder="e.g. B1" value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} />
      </div>
      <div>
        <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Reason</Label>
        <Input placeholder="Clinical reason for this category" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button size="sm" onClick={submit} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Saving..." : existing ? "Save Correction" : "Save Triage"}
        </Button>
        {existing && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function AITriagePanel({
  detail,
  categories,
  setNotice,
  onRefresh,
}: {
  detail: ErVisitDetail;
  categories: TriageCategory[];
  setNotice: (notice: Notice | null) => void;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    category: string;
    reasoning: string;
    department: string;
    doctor: string;
  } | null>(null);

  const runAITriage = async () => {
    setLoading(true);
    setAiResult(null);
    try {
      const symptoms = buildSymptomsSummary(detail.complaints, detail.vitals);
      const aiRes = await fetchAiTriageSuggestion(symptoms);
      const categoryMatch = mapUrgencyToTriageCategory(aiRes.urgency, categories);

      setAiResult({
        category: categoryMatch,
        reasoning: aiRes.reasoning,
        department: aiRes.department,
        doctor: aiRes.doctor,
      });

    } catch (error: any) {
      reportError(setNotice, error, "AI Triage failed.");
    } finally {
      setLoading(false);
    }
  };

  const applyAiResult = async () => {
    if (!aiResult) return;
    try {
      if (aiResult.category) {
        await apiFetch(`/api/er/visits/${detail.id}/triage`, {
          method: "POST",
          body: JSON.stringify({
            category: aiResult.category,
            reason: aiResult.reasoning,
          }),
        });
      }
      
      if (aiResult.department || aiResult.doctor) {
        await apiFetch(`/api/er/visits/${detail.id}/assign-doctor`, {
          method: "POST",
          body: JSON.stringify({
            specialty: aiResult.department || "General",
            doctor_name: aiResult.doctor || undefined,
          }),
        });
      }
      
      setNotice({ type: "success", message: "AI Triage applied successfully." });
      setAiResult(null);
      onRefresh();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to apply AI Triage.");
    }
  };

  return (
    <div className="panel" style={{ borderColor: "#8b5cf6", backgroundColor: "#f5f3ff", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0, color: "#6d28d9", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <FiZap /> AI Triage Assistant
        </h4>
        <Button size="sm" onClick={runAITriage} disabled={loading} style={{ backgroundColor: "#8b5cf6" }}>
          {loading ? "Analyzing..." : "Run AI Analysis"}
        </Button>
      </div>

      {aiResult && (
        <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "white", borderRadius: "8px", border: "1px solid #ddd6fe" }}>
          <p style={{ margin: "0 0 0.5rem 0" }}><strong>Reasoning:</strong> {aiResult.reasoning}</p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {aiResult.category && (
              <div>
                <span className="muted" style={{ fontSize: "0.85rem" }}>Suggested Triage:</span><br/>
                <TriageChip category={aiResult.category} categories={categories} compact={false} />
              </div>
            )}
            {aiResult.department && (
              <div>
                <span className="muted" style={{ fontSize: "0.85rem" }}>Department:</span><br/>
                <strong>{aiResult.department}</strong>
              </div>
            )}
            {aiResult.doctor && (
              <div>
                <span className="muted" style={{ fontSize: "0.85rem" }}>Doctor:</span><br/>
                <strong>{aiResult.doctor}</strong>
              </div>
            )}
          </div>
          <Button size="sm" onClick={applyAiResult} style={{ width: "100%", backgroundColor: "#7c3aed" }}>
            Apply Suggestions
          </Button>
        </div>
      )}
    </div>
  );
}

function TreatmentList({ treatments }: { treatments: ErTreatment[] }) {
  if (treatments.length === 0) return <p className="muted">No interventions logged.</p>;
  return (
    <ul className="er-list">
      {treatments.map((t) => (
        <li key={t.id}>
          <strong>{t.intervention_type}</strong>
          {t.description ? ` — ${t.description}` : ""}
          <span className="muted"> &middot; {formatDateTimeIST(t.performed_at)}</span>
        </li>
      ))}
    </ul>
  );
}

function AddTreatmentForm({
  visitId,
  setNotice,
  onAdded,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onAdded: () => void;
}) {
  const [interventionType, setInterventionType] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!interventionType) {
      setNotice({ type: "error", message: "Select an intervention type." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/treatments`, {
        method: "POST",
        body: JSON.stringify({
          intervention_type: interventionType,
          description: description || undefined,
        }),
      });
      setInterventionType("");
      setDescription("");
      onAdded();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to log intervention.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-form-grid" style={{ marginTop: "0.75rem" }}>
      <Select value={interventionType} onChange={(e) => setInterventionType(e.target.value)}>
        <option value="">Intervention</option>
        <option value="oxygen">Oxygen</option>
        <option value="iv_access">IV Access</option>
        <option value="fluids">Fluids</option>
        <option value="cpr">CPR</option>
        <option value="defibrillation">Defibrillation</option>
        <option value="airway_management">Airway Management</option>
        <option value="other">Other</option>
      </Select>
      <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Button size="sm" onClick={submit} disabled={saving}>
        {saving ? "Logging..." : "Log Intervention"}
      </Button>
    </div>
  );
}

function DoctorAssignForm({
  visitId,
  complaints,
  vitals,
  setNotice,
  onSaved,
}: {
  visitId: number;
  complaints: ErComplaint[];
  vitals: ErVitals[];
  setNotice: (notice: Notice | null) => void;
  onSaved: () => void;
}) {
  const [departments, setDepartments] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<{ doctor_name: string; department: string }[]>([]);
  const [specialty, setSpecialty] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionReason, setSuggestionReason] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const deptsRes = await apiFetch<{ departments: { department_name: string }[] }>("/api/registration/departments");
        const docsRes = await apiFetch<{ doctors: { doctor_name: string; department: string }[] }>("/api/op/doctors");
        setDepartments(deptsRes.departments.map((d) => d.department_name));
        setDoctors(docsRes.doctors);
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

  // Doctor dropdown narrows to the chosen specialty when that department has
  // at least one doctor on staff; otherwise it shows everyone -- so staff
  // can still hand-pick a covering doctor for a specialty nobody's assigned
  // to yet, same "general doctor covers" fallback the backend applies.
  const doctorsInSpecialty = specialty
    ? doctors.filter((d) => (d.department || "").toLowerCase() === specialty.toLowerCase())
    : doctors;
  const doctorOptions = doctorsInSpecialty.length > 0 ? doctorsInSpecialty : doctors;

  const suggest = async () => {
    if (complaints.length === 0 && vitals.length === 0) {
      setNotice({ type: "error", message: "Record a chief complaint or vitals first -- there's nothing for the AI to reason from yet." });
      return;
    }
    setSuggesting(true);
    setSuggestionReason("");
    try {
      const symptoms = buildSymptomsSummary(complaints, vitals);
      const aiRes = await fetchAiTriageSuggestion(symptoms);
      setSpecialty(aiRes.department || "");
      setDoctorName(aiRes.doctor || "");
      setSuggestionReason(aiRes.reasoning || "");
      if (!aiRes.department && !aiRes.doctor) {
        setNotice({ type: "warning", message: "AI couldn't suggest a department/doctor from what's charted so far -- select one manually below." });
      }
    } catch (error: any) {
      reportError(setNotice, error, "AI suggestion failed.");
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    if (!specialty.trim()) {
      setNotice({ type: "error", message: "Select the required specialty." });
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<{ doctor_name: string; matched_specialty: string; used_fallback: boolean }>(
        `/api/er/visits/${visitId}/assign-doctor`,
        {
          method: "POST",
          body: JSON.stringify({
            specialty: specialty.trim(),
            doctor_name: doctorName.trim() || undefined,
          }),
        },
      );
      let message: string;
      if (!result.doctor_name) {
        message = "No doctor is on staff at all yet -- add one under Doctor Scheduling, or assign one manually once available.";
      } else if (result.used_fallback) {
        message = `No ${specialty.trim()} specialist on staff -- assigned ${result.doctor_name} (${result.matched_specialty}) as the covering doctor instead. Confirm or override before they accept.`;
      } else {
        message = `Suggested doctor: ${result.doctor_name}. Confirm or override before the doctor accepts.`;
      }
      setNotice({ type: result.doctor_name ? "success" : "warning", message });
      setSuggestionReason("");
      onSaved();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to assign a doctor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <Button size="sm" variant="secondary" onClick={suggest} disabled={suggesting}>
        <FiZap aria-hidden /> {suggesting ? "Analyzing complaints & vitals..." : "Suggest from complaints & vitals"}
      </Button>
      {suggestionReason && (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
          AI reasoning: {suggestionReason}
        </p>
      )}
      <div className="er-sidebar-form" style={{ marginTop: "0.6rem" }}>
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Required specialty</Label>
          <Select
            value={specialty}
            onChange={(e) => { setSpecialty(e.target.value); setDoctorName(""); }}
          >
            <option value="">Select specialty...</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label style={{ fontSize: "0.8rem", color: "#64748b" }}>Doctor (optional -- overrides suggestion)</Label>
          <Select value={doctorName} onChange={(e) => setDoctorName(e.target.value)}>
            <option value="">Auto -- let the system pick</option>
            {doctorOptions.map((d) => (
              <option key={d.doctor_name} value={d.doctor_name}>
                {d.doctor_name} ({d.department})
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={submit} disabled={saving} style={{ width: "100%" }}>
          {saving ? "Assigning..." : "Assign Doctor"}
        </Button>
      </div>
    </div>
  );
}

function NotesList({ notes }: { notes: ErClinicalNote[] }) {
  if (notes.length === 0) return <p className="muted">No clinical notes yet.</p>;
  return (
    <ul className="er-list">
      {notes.map((n) => (
        <li key={n.id}>
          <strong>{n.note_type === "reassessment" ? "Reassessment" : "Assessment"}</strong>
          {n.author ? ` — Dr. ${n.author}` : ""}
          <span className="muted"> &middot; {formatDateTimeIST(n.created_at)}</span>
          <br />
          {n.content}
        </li>
      ))}
    </ul>
  );
}

function AddNoteForm({
  visitId,
  setNotice,
  onAdded,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onAdded: () => void;
}) {
  const [noteType, setNoteType] = useState<"assessment" | "reassessment">("assessment");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!content.trim()) {
      setNotice({ type: "error", message: "Enter note content." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/er/visits/${visitId}/notes`, {
        method: "POST",
        body: JSON.stringify({ note_type: noteType, content: content.trim() }),
      });
      setContent("");
      onAdded();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to add note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-form-grid" style={{ marginTop: "0.75rem" }}>
      <Select value={noteType} onChange={(e) => setNoteType(e.target.value as "assessment" | "reassessment")}>
        <option value="assessment">Assessment</option>
        <option value="reassessment">Reassessment</option>
      </Select>
      <Textarea placeholder="Clinical note" value={content} onChange={(e) => setContent(e.target.value)} />
      <Button size="sm" onClick={submit} disabled={saving}>
        {saving ? "Saving..." : "Add Note"}
      </Button>
    </div>
  );
}

function DispositionForm({
  visitId,
  setNotice,
  onSaved,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [requiredSpecialty, setRequiredSpecialty] = useState("");
  const [clinicalReason, setClinicalReason] = useState("");
  const [priority, setPriority] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!outcome || !clinicalReason.trim()) {
      setNotice({ type: "error", message: "Select an outcome and enter the clinical reason." });
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<{ bed_request_id: number | null }>(
        `/api/er/visits/${visitId}/disposition`,
        {
          method: "POST",
          body: JSON.stringify({
            outcome,
            required_specialty: requiredSpecialty || undefined,
            clinical_reason: clinicalReason.trim(),
            priority: priority || undefined,
          }),
        },
      );
      setNotice({
        type: "success",
        message: result.bed_request_id
          ? "Disposition recorded. A bed request has been sent to Bed Management."
          : "Disposition recorded.",
      });
      onSaved();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to record disposition.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-form-grid" style={{ marginTop: "0.75rem" }}>
      <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
        <option value="">Select outcome</option>
        {OUTCOME_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {outcome && OUTCOMES_REQUIRING_BED.has(outcome) && (
        <Input
          placeholder="Required specialty"
          value={requiredSpecialty}
          onChange={(e) => setRequiredSpecialty(e.target.value)}
        />
      )}
      <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="">Priority</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </Select>
      <Textarea
        placeholder="Clinical reason for this decision"
        value={clinicalReason}
        onChange={(e) => setClinicalReason(e.target.value)}
      />
      <Button onClick={submit} disabled={saving}>
        {saving ? "Recording..." : "Record Disposition"}
      </Button>
    </div>
  );
}

function CloseVisitPanel({
  visitId,
  setNotice,
  onClosed,
}: {
  visitId: number;
  setNotice: (notice: Notice | null) => void;
  onClosed: () => void;
}) {
  const [consultationFee, setConsultationFee] = useState("500");
  const [items, setItems] = useState<{ label: string; amount: number }[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [closing, setClosing] = useState(false);

  const preview = async () => {
    setLoadingPreview(true);
    try {
      const data = await apiFetch<{ items: { label: string; amount: number }[]; total: number }>(
        `/api/er/visits/${visitId}/charges?consultation_fee=${encodeURIComponent(consultationFee || "0")}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error: any) {
      reportError(setNotice, error, "Failed to compute charges.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const confirmClose = async () => {
    setClosing(true);
    try {
      const result = await apiFetch<{ invoice_id: number | null; total: number }>(
        `/api/er/visits/${visitId}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            consultation_fee: Number(consultationFee) || 0,
            total_amount: total,
          }),
        },
      );
      setNotice({
        type: "success",
        message: result.invoice_id
          ? `Visit closed. Invoice raised for ${result.total}.`
          : "Visit closed.",
      });
      onClosed();
    } catch (error: any) {
      reportError(setNotice, error, "Failed to close the visit.");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="panel" style={{ marginTop: "0.75rem" }}>
      <h4 style={{ marginTop: 0 }}>Close Visit &amp; Raise Invoice</h4>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <div>
          <Label htmlFor="er-consultation-fee">Consultation fee</Label>
          <Input
            id="er-consultation-fee"
            value={consultationFee}
            onChange={(e) => setConsultationFee(e.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={preview} disabled={loadingPreview}>
          {loadingPreview ? "Calculating..." : "Preview Charges"}
        </Button>
      </div>

      {items && (
        <>
          <Table>
            <TableHead>
              <TableCell>Item</TableCell>
              <TableCell>Amount</TableCell>
            </TableHead>
            {items.map((item, idx) => (
              <TableRow key={idx}>
                <TableCell>{item.label}</TableCell>
                <TableCell>{item.amount}</TableCell>
              </TableRow>
            ))}
          </Table>
          <div style={{ margin: "0.5rem 0" }}>
            <Label htmlFor="er-total-review">Total (editable)</Label>
            <Input
              id="er-total-review"
              value={total}
              onChange={(e) => setTotal(Number(e.target.value) || 0)}
            />
          </div>
          <Button onClick={confirmClose} disabled={closing}>
            {closing ? "Closing..." : "Confirm Close & Raise Invoice"}
          </Button>
        </>
      )}
    </div>
  );
}
