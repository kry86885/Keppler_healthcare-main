import React, { useState } from "react";
import { apiFetch, reportError } from "../lib/api";
import { API_BASE } from "../lib/constants";
import { Button, Input, Modal, Tabs, TabsTrigger, Textarea } from "../components/ui";
import {
  FiSearch as Search,
  FiPrinter as Printer,
  FiShare2 as Share2,
  FiZap as Zap,
  FiChevronLeft as Back,
  FiDownload as Download,
  FiUserPlus,
  FiCalendar,
  FiActivity,
  FiHome,
  FiClipboard,
  FiPackage,
  FiFileText,
  FiDollarSign,
  FiCircle,
  FiAlertCircle,
} from "react-icons/fi";
import type { Notice, Patient } from "../types";

/* ─── journey timeline stage styling ─── */
const STAGE_ICON: Record<string, typeof FiCircle> = {
  registration: FiUserPlus,
  queue: FiCalendar,
  consultation: FiActivity,
  bed: FiHome,
  clinical: FiClipboard,
  pharmacy: FiPackage,
  documents: FiFileText,
  billing: FiDollarSign,
  lab: FiActivity,
  er: FiAlertCircle,
};
const STAGE_COLOR: Record<string, string> = {
  registration: "#0369a1",
  queue: "#854d0e",
  consultation: "#5b21b6",
  bed: "#be123c",
  clinical: "#166534",
  pharmacy: "#0891b2",
  documents: "#475569",
  billing: "#065f46",
  lab: "#9333ea",
  er: "#dc2626",
};

/* ─── helpers ─── */
const fmt = (ts: string) =>
  ts
    ? new Date(ts).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtDt = (ts: string) =>
  ts
    ? new Date(ts).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";
const money = (v: any) => `₹${Number(v || 0).toFixed(2)}`;

/* ─── STATUS BADGE ─── */
const StatusBadge = ({ status }: { status: string }) => {
  const s = (status || "").toLowerCase();
  const palette: Record<string, string> = {
    completed: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    paid: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    settled: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    approved: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    fulfilled: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    active: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    dispensed: "background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd",
    uploaded: "background:#dbeafe;color:#1e40af;border:1px solid #93c5fd",
    partial: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
    scheduled: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
    pending: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
    submitted: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
    confirmed: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    due: "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
    rejected: "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
    cancelled: "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
    released: "background:#e2e8f0;color:#334155;border:1px solid #cbd5e1",
  };
  const key = Object.keys(palette).find((k) => s.includes(k)) || "scheduled";
  return (
    <span
      style={{
        ...Object.fromEntries(
          palette[key].split(";").map((p) => p.split(":") as [string, string]),
        ),
        borderRadius: "20px",
        padding: "3px 10px",
        fontSize: "11px",
        fontWeight: 700,
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {status || "—"}
    </span>
  );
};

const EmptyRow = ({ colSpan, label }: { colSpan: number; label: string }) => (
  <tr>
    <td colSpan={colSpan} style={{ textAlign: "center", padding: "16px", color: "#94a3b8" }}>
      {label}
    </td>
  </tr>
);

/* ────────────────────────────────────── PRINT STYLES ─── */
const PRINT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#111;}

@media print{
  @page{size:A4;margin:14mm 12mm 14mm 12mm;}
  body *{visibility:hidden;}
  #emr-printable,#emr-printable *{visibility:visible!important;}
  #emr-printable{position:fixed;top:0;left:0;width:100%;height:auto;background:#fff;}
  .no-print{display:none!important;}
  .tab-panel{display:block!important;}
}

/* ── Report Chrome ── */
.rpt-wrap{max-width:960px;margin:0 auto;padding:28px;background:#fff;}

/* header */
.rpt-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:16px;margin-bottom:18px;}
.rpt-logo-name{font-size:22px;font-weight:800;color:#1e3a5f;letter-spacing:-0.5px;}
.rpt-logo-sub{font-size:11px;color:#64748b;margin-top:2px;}
.rpt-doc-title{font-size:13px;font-weight:700;color:#fff;background:#1e3a5f;padding:4px 12px;border-radius:20px;display:inline-block;margin-top:6px;}
.rpt-meta{text-align:right;font-size:11.5px;color:#374151;line-height:1.9;}
.rpt-meta strong{color:#1e3a5f;}

/* section title */
.sec-title{font-size:11.5px;font-weight:700;color:#fff;background:#1e3a5f;padding:5px 12px;margin:18px 0 0;letter-spacing:.06em;text-transform:uppercase;}

/* grid info table */
.info-grid{width:100%;border-collapse:collapse;border:1px solid #cbd5e1;font-size:12.5px;margin-bottom:0;}
.info-grid td{padding:7px 11px;border:1px solid #cbd5e1;vertical-align:top;}
.info-grid td.lbl{font-weight:600;color:#374151;background:#f1f5f9;width:18%;white-space:nowrap;}

/* data table */
.data-tbl{width:100%;border-collapse:collapse;font-size:12px;border:1px solid #cbd5e1;margin-bottom:0;}
.data-tbl thead tr{background:#1e3a5f;}
.data-tbl thead th{color:#fff;font-weight:700;padding:8px 10px;text-align:left;border-right:1px solid #2d4f7a;white-space:nowrap;}
.data-tbl tbody td{padding:7px 10px;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:top;color:#1e293b;}
.data-tbl tbody tr:nth-child(even) td{background:#f8fafc;}
.data-tbl tbody tr:last-child td{border-bottom:none;}
.data-tbl tfoot td{padding:8px 10px;font-weight:700;color:#065f46;background:#f0fdf4;border-top:2px solid #1e3a5f;}

/* financial box */
.fin-box{border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-bottom:0;}
.fin-row{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;}
.fin-row:last-child{border-bottom:none;font-weight:800;font-size:15px;color:#065f46;background:#f0fdf4;padding:10px 14px;}
.fin-row.sub{color:#374151;}

/* footer */
.rpt-footer{margin-top:28px;padding-top:10px;border-top:2px solid #1e3a5f;display:flex;justify-content:space-between;font-size:10.5px;color:#64748b;}
.rpt-footer-center{text-align:center;color:#94a3b8;font-size:10px;}

/* tab panels -- all mounted, only the active one shows on screen; print forces all visible (see @media print above) */
.tab-panel{display:none;}
.tab-panel.active{display:block;}

/* AI summary */
.ai-summary-box{white-space:pre-wrap;border:1px solid #c4b5fd;border-radius:8px;padding:14px;font-size:12.5px;line-height:1.7;color:#374151;background:#faf5ff;}
.ai-summary-editor textarea{width:100%;min-height:260px;font-family:'Inter',Arial,sans-serif;font-size:13px;line-height:1.6;}
.ai-cert-list{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
.ai-cert-item{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:12.5px;cursor:pointer;background:#fff;}
.ai-cert-item:hover{background:#f8fafc;}

/* whatsapp share modal */
.wa-modal-body{padding:6px 0;}
.wa-big-btn{display:flex;align-items:center;gap:14px;background:#25d366;color:#fff;border:none;border-radius:12px;padding:18px 22px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:background .2s;}
.wa-big-btn:hover{background:#1ebe5d;}
.wa-big-btn svg{width:28px;height:28px;}
.wa-note{margin-top:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#166534;line-height:1.6;}

/* journey timeline */
.timeline-track{position:relative;padding-left:6px;margin-top:4px;}
.timeline-node{position:relative;display:flex;gap:12px;padding:0 0 18px 26px;}
.timeline-node:last-child{padding-bottom:2px;}
.timeline-node::before{content:"";position:absolute;left:9px;top:20px;bottom:-2px;width:1.5px;background:#e2e8f0;}
.timeline-node:last-child::before{display:none;}
.timeline-node-icon{position:absolute;left:0;top:0;width:20px;height:20px;border-radius:50%;background:#fff;border:1.5px solid currentColor;display:flex;align-items:center;justify-content:center;}
.timeline-node-content{flex:1;min-width:0;}
.timeline-node-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;}
.timeline-node-label{font-size:12.5px;font-weight:700;color:#1e293b;}
.timeline-node-time{font-size:11px;color:#94a3b8;white-space:nowrap;}
.timeline-node-detail{font-size:11.5px;color:#64748b;margin-top:2px;line-height:1.5;}

@media screen{
  .rpt-wrap{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);}
}
`;

type TabKey =
  | "overview"
  | "clinical"
  | "medications"
  | "documents"
  | "billing"
  | "ai-summary";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "clinical", label: "Clinical" },
  { key: "medications", label: "Medications" },
  { key: "documents", label: "Documents" },
  { key: "billing", label: "Billing" },
  { key: "ai-summary", label: "AI Summary" },
];

/* ═══════════════════════════════════════ MAIN COMPONENT ═════════════════════════════════ */
export default function EmrPage({
  setNotice,
}: {
  setNotice: (msg: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const [aiSummary, setAiSummary] = useState("");
  const [aiTitle, setAiTitle] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [manualShareOpen, setManualShareOpen] = useState(false);
  const [manualShareReason, setManualShareReason] = useState("");

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch<Patient[]>(
        `/api/emr/search?q=${encodeURIComponent(query)}`,
      );
      setResults(res);
    } catch {
      setNotice({ type: "error", message: "Search failed." });
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (patientId: string) => {
    setPid(patientId);
    setActiveTab("overview");
    setAiSummary("");
    setAiTitle("");
    setLoading(true);
    try {
      const d = await apiFetch<any>(`/api/emr/${patientId}`);
      setData(d);
      // Prefill the AI Summary tab with the most recently generated one, if any.
      const latestCert = (d.certificates || [])[0];
      if (latestCert) {
        setAiSummary(latestCert.body || "");
        setAiTitle(latestCert.title || "AI Clinical Summary");
      }
      apiFetch("/api/emr/access-log", {
        method: "POST",
        body: JSON.stringify({ patient_id: patientId, action: "viewed" }),
      }).catch(() => {});
    } catch {
      setNotice({ type: "error", message: "Failed to load EMR." });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAiSummary = async () => {
    if (!pid) return;
    setAiLoading(true);
    try {
      const r = await apiFetch<{
        summary: string;
        title: string;
        certificate_id: number;
      }>(`/api/emr/${pid}/ai-summary`, { method: "POST" });
      setAiSummary(r.summary);
      setAiTitle(r.title);
      setActiveTab("ai-summary");
      setNotice({ type: "success", message: `${r.title} generated.` });
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "AI summary generation failed.",
      );
    } finally {
      setAiLoading(false);
    }
  };

  const buildFallbackShareText = () => {
    const patient = data?.patient;
    return (
      `Dear ${patient?.name || "Patient"},\n\nYour ${aiTitle || "clinical summary"} from *HospAI Medical Centre* is ready.\n\n` +
      `📋 *Patient ID:* ${patient?.patient_id}\n` +
      `📅 *Date:* ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}\n\n` +
      `_Please save the attached PDF from the print dialog and share it manually._`
    );
  };

  const handleShareWhatsapp = async () => {
    if (!pid) return;
    if (!aiSummary.trim()) {
      setActiveTab("ai-summary");
      setNotice({
        type: "error",
        message: "Generate an AI summary first, then share it.",
      });
      return;
    }
    setSharing(true);
    try {
      await apiFetch(`/api/emr/${pid}/share-whatsapp`, {
        method: "POST",
        body: JSON.stringify({
          summary: aiSummary,
          title: aiTitle || "AI Clinical Summary",
        }),
      });
      setNotice({ type: "success", message: "Sent via WhatsApp." });
    } catch (error) {
      const err = error as { message?: string; payload?: { fallback?: string } };
      if (err.payload?.fallback === "manual") {
        setManualShareReason(err.message || "WhatsApp isn't available right now.");
        setManualShareOpen(true);
      } else {
        reportError(setNotice, error as any, "Unable to share via WhatsApp.");
      }
    } finally {
      setSharing(false);
    }
  };

  const handleManualShare = () => {
    if (!data) return;
    setManualShareOpen(false);
    const phone = (data.patient.phone || "").replace(/\D/g, "");
    window.print();
    const text = buildFallbackShareText();
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    setTimeout(() => window.open(url, "_blank"), 600);
  };

  /* ── Render EMR report ── */
  if (pid && data) {
    const {
      patient,
      medical_history,
      admissions = [],
      bed_history = [],
      encounters = [],
      notes = [],
      vitals = [],
      diagnoses = [],
      prescriptions = [],
      medication_schedules = [],
      observation_notes = [],
      labs = [],
      documents = [],
      pharmacy_sales = [],
      appointments = [],
      invoices = [],
      invoice_payments = [],
      insurance_claims = [],
      certificates = [],
      timeline: rawTimeline = [],
    } = data;

    const currentAdmission =
      admissions.find((a: any) => !a.discharge_date) || admissions[0] || null;
    // Joined by admission_id (not just "any active bed") so a readmission that
    // hasn't been given a bed yet correctly shows "Not currently assigned"
    // instead of picking up an unrelated stay's bed.
    const currentBed =
      bed_history.find(
        (b: any) => b.status === "active" && b.admission_id === currentAdmission?.id,
      ) || null;

    // Journey timeline — built server-side (see get_patient_journey in
    // database.py) from every real event: registration, appointments,
    // checked-in/consultation start/complete, bed admit/transfer/discharge,
    // prescriptions, treatment plan notes, billing, documents. Oldest first.
    const timeline = [...rawTimeline].sort(
      (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const totalFee = appointments.reduce(
      (s: number, a: any) =>
        s + (a.consultation_fee > 0 ? Number(a.consultation_fee) : 0),
      0,
    );
    const totalPharm = pharmacy_sales.reduce(
      (s: number, a: any) => s + Number(a.amount || 0),
      0,
    );
    const totalInvoiced = invoices.reduce(
      (s: number, i: any) => s + Number(i.total_amount || 0),
      0,
    );
    const totalPaidInvoices = invoices.reduce(
      (s: number, i: any) => s + Number(i.paid_amount || 0),
      0,
    );

    // Every invoice already carries which module it's for (OP/IP/LAB/PHARMACY
    // -- pharmacy is never invoiced here, it's tracked directly in
    // pharmacy_sales instead), so the real "total bill" is a sum across every
    // module, not just consultation fees + pharmacy -- bed/room (IP) charges
    // and lab invoices were previously silently excluded from this number.
    const billedByModule = (mod: string) =>
      invoices
        .filter((i: any) => i.module === mod)
        .reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);
    const paidByModule = (mod: string) =>
      invoices
        .filter((i: any) => i.module === mod)
        .reduce((s: number, i: any) => s + Number(i.paid_amount || 0), 0);

    const opBilled = billedByModule("OP");
    const opPaid = paidByModule("OP");
    const ipBilled = billedByModule("IP");
    const ipPaid = paidByModule("IP");
    const labBilled = billedByModule("LAB");
    const labPaid = paidByModule("LAB");

    const grandTotal = opBilled + ipBilled + labBilled + totalPharm;
    const grandPaid = opPaid + ipPaid + labPaid + totalPharm;
    const grandDue = Math.max(grandTotal - grandPaid, 0);

    return (
      <div style={{ padding: "24px 0" }}>
        <style>{PRINT_CSS}</style>

        {/* Top bar – screen only */}
        <div
          className="no-print"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            padding: "0 4px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <button
            onClick={() => {
              setPid(null);
              setData(null);
              setAiSummary("");
              setAiTitle("");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              padding: "8px 16px",
              cursor: "pointer",
              fontWeight: 600,
              color: "#374151",
            }}
          >
            <Back size={16} /> Back to Search
          </button>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={handleGenerateAiSummary}
              disabled={aiLoading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#faf5ff",
                border: "1px solid #c4b5fd",
                borderRadius: "8px",
                padding: "8px 16px",
                cursor: aiLoading ? "default" : "pointer",
                fontWeight: 600,
                color: "#5b21b6",
                fontSize: "14px",
                opacity: aiLoading ? 0.6 : 1,
              }}
            >
              <Zap size={16} /> {aiLoading ? "Generating..." : "AI Summary"}
            </button>
            <button
              onClick={handleShareWhatsapp}
              disabled={sharing}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#25d366",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                cursor: sharing ? "default" : "pointer",
                fontWeight: 700,
                color: "#fff",
                fontSize: "14px",
                opacity: sharing ? 0.7 : 1,
              }}
            >
              <Share2 size={16} /> {sharing ? "Sending..." : "Share via WhatsApp"}
            </button>
            <button
              onClick={() => window.print()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#1e3a5f",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                fontSize: "14px",
              }}
            >
              <Printer size={16} /> Print / PDF
            </button>
          </div>
        </div>

        <div className="no-print" style={{ marginBottom: "16px" }}>
          <Tabs role="tablist" aria-label="EMR sections">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.key}
                type="button"
                active={activeTab === t.key}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </Tabs>
        </div>

        {/* ══════════════ PRINTABLE REPORT ══════════════ */}
        <div id="emr-printable" className="rpt-wrap">
          {/* ── HEADER ── */}
          <div className="rpt-header">
            <div>
              <div className="rpt-logo-name">🏥 HospAI Medical Centre</div>
              <div className="rpt-logo-sub">
                Advanced Healthcare Management System
              </div>
              <div className="rpt-doc-title">PATIENT MEDICAL RECORD</div>
            </div>
            <div className="rpt-meta">
              <div>
                <strong>Report Date:</strong>{" "}
                {new Date().toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div>
                <strong>Patient ID:</strong> {patient.patient_id}
              </div>
              <div>
                <strong>System:</strong> HospAI EMR v3.0
              </div>
            </div>
          </div>

          {/* ══════════════ OVERVIEW ══════════════ */}
          <div className={`tab-panel ${activeTab === "overview" ? "active" : ""}`}>
            <div className="sec-title">Patient Details</div>
            <table className="info-grid">
              <tbody>
                <tr>
                  <td className="lbl">Patient ID</td>
                  <td>
                    <strong>{patient.patient_id}</strong>
                  </td>
                  <td className="lbl">Full Name</td>
                  <td>
                    <strong>
                      {patient.name} {patient.last_name || ""}
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td className="lbl">Age / Gender</td>
                  <td>
                    {patient.age} Yrs / {patient.gender}
                  </td>
                  <td className="lbl">Mobile</td>
                  <td>{patient.phone || "—"}</td>
                </tr>
                <tr>
                  <td className="lbl">Blood Group</td>
                  <td>{patient.blood_group || "—"}</td>
                  <td className="lbl">Registered On</td>
                  <td>{patient.created_at ? fmtDt(patient.created_at) : "—"}</td>
                </tr>
                <tr>
                  <td className="lbl">Address</td>
                  <td>{patient.address || "—"}</td>
                  <td className="lbl">Emergency Contact</td>
                  <td>{patient.emergency_contact || "—"}</td>
                </tr>
                <tr>
                  <td className="lbl">Aadhar No.</td>
                  <td colSpan={3}>{patient.aadhar_number || "—"}</td>
                </tr>
              </tbody>
            </table>

            <div className="sec-title">Medical Information</div>
            <table className="info-grid">
              <tbody>
                <tr>
                  <td className="lbl">Allergies</td>
                  <td>
                    {medical_history?.allergies || patient.allergies || "None"}
                  </td>
                  <td className="lbl">Existing Diseases</td>
                  <td>{medical_history?.existing_diseases || "—"}</td>
                </tr>
                <tr>
                  <td className="lbl">Chronic Conditions</td>
                  <td>{medical_history?.chronic_conditions || "—"}</td>
                  <td className="lbl">Previous Surgeries</td>
                  <td>{medical_history?.previous_surgeries || "—"}</td>
                </tr>
              </tbody>
            </table>

            <div className="sec-title">Current Status</div>
            <table className="info-grid">
              <tbody>
                <tr>
                  <td className="lbl">Admission Status</td>
                  <td>
                    {currentAdmission ? (
                      currentAdmission.discharge_date ? (
                        <StatusBadge status="Discharged" />
                      ) : (
                        <StatusBadge status="Admitted" />
                      )
                    ) : (
                      "No admission on record"
                    )}
                  </td>
                  <td className="lbl">Current Bed</td>
                  <td>
                    {currentBed
                      ? `${currentBed.ward} / Room ${currentBed.room_no} / Bed ${currentBed.bed_no}`
                      : "Not currently assigned"}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="sec-title">
              Journey Timeline — Registration to Discharge
            </div>
            {timeline.length === 0 ? (
              <p style={{ color: "#94a3b8", padding: "16px", textAlign: "center" }}>
                No events found.
              </p>
            ) : (
              <div className="timeline-track">
                {timeline.map((e: any, i: number) => {
                  const Icon = STAGE_ICON[e.stage] || FiCircle;
                  const detail = e.detail as Record<string, any> | undefined;
                  return (
                    <div className="timeline-node" key={i}>
                      <div
                        className="timeline-node-icon"
                        style={{ color: STAGE_COLOR[e.stage] || "#64748b" }}
                      >
                        <Icon size={13} />
                      </div>
                      <div className="timeline-node-content">
                        <div className="timeline-node-head">
                          <span className="timeline-node-label">{e.label}</span>
                          <span className="timeline-node-time">
                            {e.timestamp ? fmtDt(e.timestamp) : "—"}
                          </span>
                        </div>
                        {detail && (
                          <div className="timeline-node-detail">
                            {detail.doctor_name && `Dr. ${detail.doctor_name}`}
                            {detail.department &&
                              (detail.doctor_name ? ` — ${detail.department}` : detail.department)}
                            {detail.note && detail.note}
                            {detail.treatment_plan && (
                              <>
                                {detail.note ? " · " : ""}
                                Treatment plan: {detail.treatment_plan}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {grandTotal > 0 && (
              <>
                <div className="sec-title">Financial Summary</div>
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th style={{ textAlign: "right" }}>Billed</th>
                      <th style={{ textAlign: "right" }}>Paid</th>
                      <th style={{ textAlign: "right" }}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opBilled > 0 && (
                      <tr>
                        <td>Consultation (OP)</td>
                        <td style={{ textAlign: "right" }}>{money(opBilled)}</td>
                        <td style={{ textAlign: "right", color: "#065f46" }}>
                          {money(opPaid)}
                        </td>
                        <td style={{ textAlign: "right", color: opBilled > opPaid ? "#991b1b" : "#94a3b8" }}>
                          {money(Math.max(opBilled - opPaid, 0))}
                        </td>
                      </tr>
                    )}
                    {ipBilled > 0 && (
                      <tr>
                        <td>Bed &amp; Room Charges (IP)</td>
                        <td style={{ textAlign: "right" }}>{money(ipBilled)}</td>
                        <td style={{ textAlign: "right", color: "#065f46" }}>
                          {money(ipPaid)}
                        </td>
                        <td style={{ textAlign: "right", color: ipBilled > ipPaid ? "#991b1b" : "#94a3b8" }}>
                          {money(Math.max(ipBilled - ipPaid, 0))}
                        </td>
                      </tr>
                    )}
                    {labBilled > 0 && (
                      <tr>
                        <td>Lab / Diagnostics</td>
                        <td style={{ textAlign: "right" }}>{money(labBilled)}</td>
                        <td style={{ textAlign: "right", color: "#065f46" }}>
                          {money(labPaid)}
                        </td>
                        <td style={{ textAlign: "right", color: labBilled > labPaid ? "#991b1b" : "#94a3b8" }}>
                          {money(Math.max(labBilled - labPaid, 0))}
                        </td>
                      </tr>
                    )}
                    {totalPharm > 0 && (
                      <tr>
                        <td>Pharmacy</td>
                        <td style={{ textAlign: "right" }}>{money(totalPharm)}</td>
                        <td style={{ textAlign: "right", color: "#065f46" }}>
                          {money(totalPharm)}
                        </td>
                        <td style={{ textAlign: "right", color: "#94a3b8" }}>
                          {money(0)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 800 }}>GRAND TOTAL</td>
                      <td style={{ textAlign: "right", fontWeight: 800 }}>
                        {money(grandTotal)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: "#065f46" }}>
                        {money(grandPaid)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: grandDue > 0 ? "#991b1b" : "#065f46" }}>
                        {money(grandDue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>

          {/* ══════════════ CLINICAL ══════════════ */}
          <div className={`tab-panel ${activeTab === "clinical" ? "active" : ""}`}>
            <div className="sec-title">Encounters &amp; Diagnoses</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Doctor</th>
                  <th>Diagnosis</th>
                  <th>Date</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {encounters.length === 0 ? (
                  <EmptyRow colSpan={6} label="No encounters recorded." />
                ) : (
                  encounters.map((e: any, i: number) => {
                    const dx = diagnoses.filter((d: any) => d.encounter_id === e.id);
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{e.encounter_type}</td>
                        <td>{e.doctor_name || "—"}</td>
                        <td>
                          {dx.length
                            ? dx.map((d: any) => d.diagnosis_name).join(", ")
                            : "—"}
                        </td>
                        <td>{fmt(e.created_at || e.arrival_at)}</td>
                        <td style={{ textAlign: "center" }}>
                          <StatusBadge status={e.status || "Completed"} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {vitals.length > 0 && (
              <>
                <div className="sec-title">Vitals</div>
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Recorded</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitals.map((v: any, i: number) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{fmtDt(v.recorded_at || v.created_at)}</td>
                        <td>
                          {Object.entries(v)
                            .filter(
                              ([k, val]) =>
                                !["id", "patient_id", "recorded_at", "created_at"].includes(k) &&
                                val != null &&
                                val !== "",
                            )
                            .map(([k, val]) => `${k.replace(/_/g, " ")}: ${val}`)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="sec-title">Clinical &amp; Observation Notes</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {notes.length === 0 && observation_notes.length === 0 ? (
                  <EmptyRow colSpan={4} label="No clinical notes recorded." />
                ) : (
                  <>
                    {notes.map((n: any, i: number) => (
                      <tr key={`cn-${i}`}>
                        <td>{i + 1}</td>
                        <td>{fmtDt(n.created_at)}</td>
                        <td>Clinical</td>
                        <td>
                          {[n.chief_complaint, n.notes, n.follow_up]
                            .filter(Boolean)
                            .join(" — ") || "—"}
                        </td>
                      </tr>
                    ))}
                    {observation_notes.map((n: any, i: number) => (
                      <tr key={`on-${i}`}>
                        <td>{notes.length + i + 1}</td>
                        <td>{fmtDt(n.created_at)}</td>
                        <td>{n.doctor_name || "Observation"}</td>
                        <td>
                          {[n.note, n.treatment_plan].filter(Boolean).join(" — ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* ══════════════ MEDICATIONS ══════════════ */}
          <div className={`tab-panel ${activeTab === "medications" ? "active" : ""}`}>
            <div className="sec-title">Prescriptions</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Qty</th>
                  <th>Prescribed By</th>
                  <th>Date</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {prescriptions.length === 0 ? (
                  <EmptyRow colSpan={7} label="No prescriptions recorded." />
                ) : (
                  prescriptions.map((rx: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{rx.medicine_name}</td>
                      <td>{rx.dosage || "—"}</td>
                      <td>{rx.quantity ?? "—"}</td>
                      <td>{rx.doctor_username || "—"}</td>
                      <td>{fmt(rx.created_at)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status={rx.status || "pending"} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="sec-title">Medication Schedule</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Scheduled</th>
                  <th style={{ textAlign: "center" }}>Administered</th>
                </tr>
              </thead>
              <tbody>
                {medication_schedules.length === 0 ? (
                  <EmptyRow colSpan={5} label="No medication schedule recorded." />
                ) : (
                  medication_schedules.map((m: any, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{m.medicine_name}</td>
                      <td>{m.dosage || "—"}</td>
                      <td>{fmtDt(m.schedule_time)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status={m.administered ? "Completed" : "Pending"} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="sec-title">Pharmacy Dispensations</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th style={{ textAlign: "center" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {pharmacy_sales.length === 0 ? (
                  <EmptyRow colSpan={5} label="No pharmacy dispensations recorded." />
                ) : (
                  pharmacy_sales.map((s: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{s.medicine_name}</td>
                      <td style={{ textAlign: "center" }}>{s.quantity}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#065f46" }}>
                        {money(s.amount)}
                      </td>
                      <td>{fmt(s.sold_at || s.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {totalPharm > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      Total Pharmacy Charges:
                    </td>
                    <td style={{ textAlign: "right" }}>{money(totalPharm)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ══════════════ DOCUMENTS ══════════════ */}
          <div className={`tab-panel ${activeTab === "documents" ? "active" : ""}`}>
            <div className="sec-title">Uploaded Documents</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th style={{ textAlign: "center" }}>OCR</th>
                  <th className="no-print" style={{ textAlign: "center" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <EmptyRow colSpan={6} label="No documents uploaded." />
                ) : (
                  documents.map((d: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{d.file_name}</td>
                      <td>{d.doc_type || "—"}</td>
                      <td>{fmt(d.created_at)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status={d.has_ocr_text ? "Completed" : "Pending"} />
                      </td>
                      <td className="no-print" style={{ textAlign: "center" }}>
                        <a
                          href={`${API_BASE}/api/documents/${d.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            color: "#1e3a5f",
                            fontWeight: 600,
                            fontSize: "12px",
                          }}
                        >
                          <Download size={13} /> View
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ══════════════ BILLING ══════════════ */}
          <div className={`tab-panel ${activeTab === "billing" ? "active" : ""}`}>
            {appointments.length > 0 && (
              <>
                <div className="sec-title">Appointment History</div>
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date &amp; Time</th>
                      <th>Department</th>
                      <th>Doctor</th>
                      <th style={{ textAlign: "right" }}>Consultation Fee</th>
                      <th style={{ textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((a: any, i: number) => (
                      <tr key={i}>
                        <td style={{ color: "#64748b", fontWeight: 600 }}>{i + 1}</td>
                        <td>{fmtDt(a.appointment_date || a.created_at)}</td>
                        <td>{a.department || "General"}</td>
                        <td>{a.doctor_name ? `Dr. ${a.doctor_name}` : "—"}</td>
                        <td
                          style={{
                            textAlign: "right",
                            fontWeight: 700,
                            color: a.consultation_fee > 0 ? "#065f46" : "#94a3b8",
                          }}
                        >
                          {a.consultation_fee > 0 ? money(a.consultation_fee) : "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <StatusBadge status={a.status || "Scheduled"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totalFee > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ textAlign: "right" }}>
                          Total Consultation Fees:
                        </td>
                        <td style={{ textAlign: "right" }}>{money(totalFee)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </>
            )}

            <div className="sec-title">Invoices</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Invoice No.</th>
                  <th>Module</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Paid</th>
                  <th style={{ textAlign: "right" }}>Due</th>
                  <th>Date</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <EmptyRow colSpan={8} label="No invoices recorded." />
                ) : (
                  invoices.map((inv: any, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{inv.invoice_no}</td>
                      <td>{inv.module}</td>
                      <td style={{ textAlign: "right" }}>{money(inv.total_amount)}</td>
                      <td style={{ textAlign: "right" }}>{money(inv.paid_amount)}</td>
                      <td style={{ textAlign: "right" }}>{money(inv.due_amount)}</td>
                      <td>{fmt(inv.created_at)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status={inv.payment_status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {invoices.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      Total Invoiced / Paid:
                    </td>
                    <td style={{ textAlign: "right" }}>{money(totalInvoiced)}</td>
                    <td style={{ textAlign: "right" }}>{money(totalPaidInvoices)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>

            <div className="sec-title">Payments Received</div>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {invoice_payments.length === 0 ? (
                  <EmptyRow colSpan={5} label="No payments recorded." />
                ) : (
                  invoice_payments.map((p: any, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#065f46" }}>
                        {money(p.amount)}
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{p.payment_mode}</td>
                      <td>{p.gateway_ref || "—"}</td>
                      <td>{fmtDt(p.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {insurance_claims.length > 0 && (
              <>
                <div className="sec-title">Insurance Claims</div>
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Insurer</th>
                      <th style={{ textAlign: "right" }}>Claimed</th>
                      <th style={{ textAlign: "right" }}>Approved</th>
                      <th>Submitted</th>
                      <th style={{ textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insurance_claims.map((c: any, i: number) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{c.insurer_name}</td>
                        <td style={{ textAlign: "right" }}>{money(c.claim_amount)}</td>
                        <td style={{ textAlign: "right" }}>{money(c.approved_amount)}</td>
                        <td>{fmt(c.submitted_at)}</td>
                        <td style={{ textAlign: "center" }}>
                          <StatusBadge status={c.claim_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {labs.length > 0 && (
              <>
                <div className="sec-title">Lab / Diagnostic Charges</div>
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Test</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th>Date</th>
                      <th style={{ textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labs.map((lab: any, i: number) => (
                      <tr key={i}>
                        <td style={{ color: "#64748b" }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{lab.test_name}</td>
                        <td style={{ textAlign: "right" }}>{money(lab.amount)}</td>
                        <td>{fmt(lab.created_at)}</td>
                        <td style={{ textAlign: "center" }}>
                          <StatusBadge status={lab.status || "due"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* ══════════════ AI SUMMARY ══════════════ */}
          <div className={`tab-panel ${activeTab === "ai-summary" ? "active" : ""}`}>
            <div className="sec-title">{aiTitle || "AI Clinical Summary"}</div>
            {!aiSummary ? (
              <div
                className="no-print"
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: "8px",
                  padding: "24px",
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                <p style={{ marginBottom: "12px" }}>
                  No AI summary generated yet for this patient.
                </p>
                <Button onClick={handleGenerateAiSummary} disabled={aiLoading}>
                  {aiLoading ? "Generating..." : "Generate AI Summary"}
                </Button>
              </div>
            ) : (
              <>
                <div className="no-print ai-summary-editor" style={{ marginTop: "8px" }}>
                  <Textarea
                    value={aiSummary}
                    onChange={(e) => setAiSummary(e.target.value)}
                    rows={14}
                  />
                  <p className="muted" style={{ marginTop: "6px", fontSize: "12px" }}>
                    You can edit this before sharing or printing.
                  </p>
                  <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                    <Button
                      variant="ghost"
                      onClick={handleGenerateAiSummary}
                      disabled={aiLoading}
                    >
                      {aiLoading ? "Regenerating..." : "Regenerate"}
                    </Button>
                    <Button onClick={handleShareWhatsapp} disabled={sharing}>
                      {sharing ? "Sending..." : "Share via WhatsApp"}
                    </Button>
                  </div>
                </div>
                <div className="ai-summary-box" style={{ marginTop: "10px" }}>
                  {aiSummary}
                </div>
              </>
            )}

            {certificates.length > 1 && (
              <div className="no-print" style={{ marginTop: "18px" }}>
                <div className="sec-title" style={{ marginTop: 0 }}>
                  Previous Summaries &amp; Certificates
                </div>
                <div className="ai-cert-list">
                  {certificates.slice(1).map((c: any) => (
                    <div
                      key={c.id}
                      className="ai-cert-item"
                      onClick={() => {
                        setAiSummary(c.body);
                        setAiTitle(c.title);
                      }}
                    >
                      <strong>{c.title}</strong>
                      <span style={{ color: "#64748b" }}>
                        {" "}
                        — {fmtDt(c.created_at)}
                        {c.issued_by ? ` · ${c.issued_by}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── FOOTER ── */}
          <div className="rpt-footer">
            <span>
              HospAI Medical Centre — <em>Confidential Patient Record</em>
            </span>
            <span className="rpt-footer-center">
              This is a system-generated document. No signature required.
            </span>
            <span>Printed: {new Date().toLocaleString("en-IN")}</span>
          </div>
        </div>

        {/* ══════════════ MANUAL SHARE FALLBACK MODAL ══════════════ */}
        <Modal
          open={manualShareOpen}
          onClose={() => setManualShareOpen(false)}
          title="Share Manually via WhatsApp"
          description={manualShareReason}
        >
          <div className="wa-modal-body">
            <p style={{ fontSize: "13.5px", color: "#374151", marginBottom: "16px", lineHeight: 1.6 }}>
              Clicking below will open the Print / Save PDF dialog so you can save the
              summary, then open WhatsApp with a message for{" "}
              <strong>{data?.patient?.name}</strong> to attach it to manually.
            </p>
            <button className="wa-big-btn" onClick={handleManualShare}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.859L.057 23.776l6.079-1.594A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.812 9.812 0 01-5.007-1.372l-.359-.214-3.717.976.993-3.623-.234-.373A9.816 9.816 0 012.182 12c0-5.424 4.394-9.818 9.818-9.818 5.424 0 9.818 4.394 9.818 9.818 0 5.424-4.394 9.818-9.818 9.818z" />
              </svg>
              Save PDF &amp; Open WhatsApp
            </button>
            <div className="wa-note">
              ✅ The PDF print dialog opens automatically first.
              <br />
              ✅ Save the PDF, then attach it to the WhatsApp chat that opens.
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  /* ══════════════ SEARCH VIEW ══════════════ */
  return (
    <section className="module-page">
      <style>{PRINT_CSS}</style>
      <div className="panel registration-desk-panel">
        <p className="muted" style={{ marginBottom: "16px" }}>
          Search patient by Name, last 4 digits of mobile number, UHID, or
          Patient ID.
        </p>
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Gnanesh Babu or PAT-100003 or 9376"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            style={{ flex: 1 }}
          />
          <Button onClick={handleSearch} disabled={loading} variant="primary">
            {loading ? (
              "Searching…"
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Search
              </>
            )}
          </Button>
        </div>

        {results.length > 0 && (
          <>
            <h3
              style={{
                fontWeight: 700,
                color: "#1e3a5f",
                marginBottom: "12px",
              }}
            >
              Search Results
            </h3>
            <table className="data-tbl">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th>Full Name</th>
                  <th>Mobile</th>
                  <th>Age / Gender</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700, color: "#1e3a5f" }}>
                      {p.patient_id}
                    </td>
                    <td>
                      {p.name} {p.last_name}
                    </td>
                    <td>{p.phone}</td>
                    <td>
                      {p.age} / {p.gender}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleOpen(p.patient_id)}
                      >
                        Open EMR
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {results.length === 0 && query && !loading && (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "#94a3b8",
              background: "#f8fafc",
              borderRadius: "10px",
              border: "1px dashed #e2e8f0",
              marginTop: "12px",
            }}
          >
            <Search
              size={32}
              style={{ margin: "0 auto 8px", display: "block" }}
            />
            <p>No patients found matching your search.</p>
          </div>
        )}
      </div>
    </section>
  );
}
