import React, { useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import { Button, Input, Modal } from "../components/ui";
import {
  FiSearch as Search,
  FiPrinter as Printer,
  FiShare2 as Share2,
  FiZap as Zap,
  FiChevronLeft as Back,
} from "react-icons/fi";
import type { Patient } from "../types";

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

/* ─── STATUS BADGE ─── */
const StatusBadge = ({ status }: { status: string }) => {
  const s = (status || "").toLowerCase();
  const palette: Record<string, string> = {
    completed: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    dispensed: "background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd",
    uploaded: "background:#dbeafe;color:#1e40af;border:1px solid #93c5fd",
    scheduled: "background:#fef9c3;color:#854d0e;border:1px solid #fde047",
    confirmed: "background:#dcfce7;color:#166534;border:1px solid #86efac",
    cancelled: "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
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
}

/* ── Report Chrome ── */
.rpt-wrap{max-width:900px;margin:0 auto;padding:28px;background:#fff;}

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

/* whatsapp share modal */
.wa-modal-body{padding:6px 0;}
.wa-big-btn{display:flex;align-items:center;gap:14px;background:#25d366;color:#fff;border:none;border-radius:12px;padding:18px 22px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:background .2s;}
.wa-big-btn:hover{background:#1ebe5d;}
.wa-big-btn svg{width:28px;height:28px;}
.wa-note{margin-top:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#166534;line-height:1.6;}

@media screen{
  .rpt-wrap{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10);}
}
`;

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
  const [aiSum, setAiSum] = useState("");
  const [showModal, setShowModal] = useState(false);

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
    setLoading(true);
    try {
      const d = await apiFetch<any>(`/api/emr/${patientId}`);
      setData(d);
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

  const handleAI = async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const r = await apiFetch<any>(`/api/emr/${pid}/ai-summary`, {
        method: "POST",
      });
      setAiSum(r.summary);
    } catch {
      setNotice({ type: "error", message: "AI summary failed." });
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsApp = async () => {
    if (!data) return;
    setShowModal(false);
    const phone = (data.patient.phone || "").replace(/\D/g, "");
    // Init feedback on backend
    if (phone) {
      apiFetch("/api/whatsapp/init_feedback", {
        method: "POST",
        body: JSON.stringify({
          patient_id: data.patient.patient_id || data.patient.id,
          phone,
        }),
      }).catch(() => {});
    }
    // 1. Auto-open print → user saves PDF
    window.print();
    // 2. After brief delay, open WhatsApp with feedback text
    const text =
      `Dear ${data.patient.name},\n\nYour complete Patient Journey Report from *HospAI Medical Centre* has been generated and shared with you.\n\n` +
      `📋 *Patient ID:* ${data.patient.patient_id}\n` +
      `📅 *Report Date:* ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}\n\n` +
      `We value your feedback! Please reply with:\n` +
      `💬 Any comments about your experience\n\n` +
      `Thank you for choosing HospAI Medical Centre.\n\n_This is an automated message. Please save the PDF from your print dialog._`;
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
      encounters = [],
      diagnoses = [],
      prescriptions = [],
      labs = [],
      documents = [],
      pharmacy_sales = [],
      appointments = [],
    } = data;

    // Timeline – OLDEST FIRST
    const timeline = [
      ...encounters.map((e: any) => {
        const dx = diagnoses.filter((d: any) => d.encounter_id === e.id);
        return {
          type: e.encounter_type || "Encounter",
          desc: dx.length
            ? `Diagnosis: ${dx.map((d: any) => d.diagnosis_name).join(", ")}`
            : "Clinical encounter",
          ts: e.created_at,
          by: e.doctor_name || "Doctor",
          status: e.status || "Completed",
          amt: null,
        };
      }),
      ...appointments.map((a: any) => ({
        type: "Appointment",
        desc: `${a.department || "General"} — Dr. ${a.doctor_name || "—"}`,
        ts: a.appointment_date || a.created_at,
        by: a.doctor_name || "—",
        status: a.status || "Scheduled",
        amt: a.consultation_fee > 0 ? Number(a.consultation_fee) : null,
      })),
      ...pharmacy_sales.map((s: any) => ({
        type: "Pharmacy",
        desc: `${s.medicine_name} × ${s.quantity}`,
        ts: s.sold_at || s.created_at,
        by: "Pharmacist",
        status: "Dispensed",
        amt: Number(s.amount || 0),
      })),
      ...documents.map((d: any) => ({
        type: "Document",
        desc: `${d.doc_type || "File"}: ${d.file_name}`,
        ts: d.created_at,
        by: "System",
        status: "Uploaded",
        amt: null,
      })),
    ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const totalFee = appointments.reduce(
      (s: number, a: any) =>
        s + (a.consultation_fee > 0 ? Number(a.consultation_fee) : 0),
      0,
    );
    const totalPharm = pharmacy_sales.reduce(
      (s: number, a: any) => s + Number(a.amount || 0),
      0,
    );
    const grandTotal = totalFee + totalPharm;

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
            marginBottom: "20px",
            padding: "0 4px",
          }}
        >
          <button
            onClick={() => {
              setPid(null);
              setData(null);
              setAiSum("");
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
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={handleAI}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#faf5ff",
                border: "1px solid #c4b5fd",
                borderRadius: "8px",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: 600,
                color: "#5b21b6",
                fontSize: "14px",
              }}
            >
              <Zap size={16} /> AI Summary
            </button>
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#25d366",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                cursor: "pointer",
                fontWeight: 700,
                color: "#fff",
                fontSize: "14px",
              }}
            >
              <Share2 size={16} /> Share via WhatsApp
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

        {/* ══════════════ PRINTABLE REPORT ══════════════ */}
        <div id="emr-printable" className="rpt-wrap">
          {/* ── HEADER ── */}
          <div className="rpt-header">
            <div>
              <div className="rpt-logo-name">🏥 HospAI Medical Centre</div>
              <div className="rpt-logo-sub">
                Advanced Healthcare Management System
              </div>
              <div className="rpt-doc-title">PATIENT JOURNEY REPORT</div>
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
                <strong>Generated At:</strong>{" "}
                {new Date().toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </div>
              <div>
                <strong>Patient ID:</strong> {patient.patient_id}
              </div>
              <div>
                <strong>System:</strong> HospAI EMR v2.0
              </div>
            </div>
          </div>

          {/* ── PATIENT DETAILS ── */}
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

          {/* ── MEDICAL INFORMATION ── */}
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

          {/* ── AI SUMMARY (if generated) ── */}
          {aiSum && (
            <>
              <div className="sec-title">AI Clinical Summary</div>
              <div
                style={{
                  border: "1px solid #c4b5fd",
                  background: "#faf5ff",
                  borderRadius: "0 0 6px 6px",
                  padding: "12px 14px",
                  fontSize: "12.5px",
                  color: "#374151",
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                }}
              >
                {aiSum}
              </div>
            </>
          )}

          {/* ── APPOINTMENTS ── */}
          {appointments.length > 0 && (
            <>
              <div className="sec-title">Appointment History</div>
              <table className="data-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date & Time</th>
                    <th>Department</th>
                    <th>Doctor</th>
                    <th style={{ textAlign: "right" }}>Consultation Fee</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b", fontWeight: 600 }}>
                        {i + 1}
                      </td>
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
                        {a.consultation_fee > 0
                          ? `₹${Number(a.consultation_fee).toFixed(2)}`
                          : "—"}
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
                      <td style={{ textAlign: "right" }}>
                        ₹{totalFee.toFixed(2)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}

          {/* ── PRESCRIPTIONS ── */}
          {prescriptions.length > 0 && (
            <>
              <div className="sec-title">Prescriptions</div>
              <table className="data-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Medicine</th>
                    <th>Dosage</th>
                    <th>Frequency</th>
                    <th>Duration</th>
                    <th>Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {prescriptions.map((rx: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{rx.medicine_name}</td>
                      <td>{rx.dosage || "—"}</td>
                      <td>{rx.frequency || "—"}</td>
                      <td>{rx.duration || "—"}</td>
                      <td>{rx.instructions || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ── LAB REPORTS ── */}
          {labs.length > 0 && (
            <>
              <div className="sec-title">Laboratory Reports</div>
              <table className="data-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Test Name</th>
                    <th>Result</th>
                    <th>Normal Range</th>
                    <th>Date</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.map((lab: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{lab.test_name}</td>
                      <td>{lab.result || "—"}</td>
                      <td>{lab.normal_range || "—"}</td>
                      <td>{fmt(lab.created_at)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status={lab.status || "Done"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ── PHARMACY ── */}
          {pharmacy_sales.length > 0 && (
            <>
              <div className="sec-title">Pharmacy Dispensations</div>
              <table className="data-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Medicine</th>
                    <th style={{ textAlign: "center" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                    <th>Date</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmacy_sales.map((s: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: "#64748b" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{s.medicine_name}</td>
                      <td style={{ textAlign: "center" }}>{s.quantity}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#065f46",
                        }}
                      >
                        ₹{Number(s.amount).toFixed(2)}
                      </td>
                      <td>{fmt(s.sold_at || s.created_at)}</td>
                      <td style={{ textAlign: "center" }}>
                        <StatusBadge status="Dispensed" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totalPharm > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ textAlign: "right" }}>
                        Total Pharmacy Charges:
                      </td>
                      <td style={{ textAlign: "right" }}>
                        ₹{totalPharm.toFixed(2)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}

          {/* ── JOURNEY TIMELINE ── */}
          <div className="sec-title">
            Journey Timeline — Chronological (Oldest to Newest)
          </div>
          <table className="data-tbl">
            <thead>
              <tr>
                <th style={{ width: "36px" }}>#</th>
                <th style={{ width: "110px" }}>Stage</th>
                <th>Description</th>
                <th style={{ width: "130px" }}>Date & Time</th>
                <th style={{ width: "110px" }}>Handled By</th>
                <th style={{ width: "90px", textAlign: "right" }}>Amount</th>
                <th style={{ width: "100px", textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "20px",
                      color: "#94a3b8",
                    }}
                  >
                    No events found.
                  </td>
                </tr>
              ) : (
                timeline.map((e: any, i: number) => (
                  <tr key={i}>
                    <td
                      style={{
                        color: "#64748b",
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: "#1e3a5f",
                        fontSize: "12px",
                      }}
                    >
                      {e.type}
                    </td>
                    <td style={{ fontSize: "12px" }}>{e.desc}</td>
                    <td style={{ fontSize: "11.5px" }}>
                      <div style={{ fontWeight: 600 }}>
                        {e.ts ? fmt(e.ts) : "—"}
                      </div>
                      <div style={{ color: "#64748b" }}>
                        {e.ts
                          ? new Date(e.ts).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: true,
                            })
                          : ""}
                      </div>
                    </td>
                    <td style={{ fontSize: "12px" }}>{e.by}</td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        color: e.amt != null ? "#065f46" : "#cbd5e1",
                        fontSize: "12px",
                      }}
                    >
                      {e.amt != null ? `₹${Number(e.amt).toFixed(2)}` : "—"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <StatusBadge status={e.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {timeline.some((e: any) => e.amt != null) && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: "right" }}>
                    Grand Total:
                  </td>
                  <td style={{ textAlign: "right" }}>
                    ₹
                    {timeline
                      .filter((e: any) => e.amt != null)
                      .reduce((s: number, e: any) => s + Number(e.amt), 0)
                      .toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>

          {/* ── FINANCIAL SUMMARY ── */}
          {grandTotal > 0 && (
            <>
              <div className="sec-title">Financial Summary</div>
              <div className="fin-box">
                {totalFee > 0 && (
                  <div className="fin-row sub">
                    <span>
                      Consultation Fees (
                      {
                        appointments.filter((a: any) => a.consultation_fee > 0)
                          .length
                      }{" "}
                      visit{appointments.length > 1 ? "s" : ""})
                    </span>
                    <span style={{ fontWeight: 700, color: "#065f46" }}>
                      ₹{totalFee.toFixed(2)}
                    </span>
                  </div>
                )}
                {totalPharm > 0 && (
                  <div className="fin-row sub">
                    <span>
                      Pharmacy Charges ({pharmacy_sales.length} item
                      {pharmacy_sales.length > 1 ? "s" : ""})
                    </span>
                    <span style={{ fontWeight: 700, color: "#065f46" }}>
                      ₹{totalPharm.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="fin-row">
                  <span>TOTAL AMOUNT PAYABLE</span>
                  <span>₹{grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

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

        {/* ══════════════ WHATSAPP MODAL ══════════════ */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title="Share Patient Report via WhatsApp"
        >
          <div className="wa-modal-body">
            <p
              style={{
                fontSize: "13.5px",
                color: "#374151",
                marginBottom: "16px",
                lineHeight: 1.6,
              }}
            >
              Clicking the button below will:
              <br />
              <strong>1.</strong> Automatically open the{" "}
              <strong>Print / Save PDF dialog</strong> so you can save the
              report
              <br />
              <strong>2.</strong> Open <strong>WhatsApp</strong> with a
              personalised feedback message for{" "}
              <strong>{data?.patient?.name}</strong>
            </p>
            <button className="wa-big-btn" onClick={handleWhatsApp}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.859L.057 23.776l6.079-1.594A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.812 9.812 0 01-5.007-1.372l-.359-.214-3.717.976.993-3.623-.234-.373A9.816 9.816 0 012.182 12c0-5.424 4.394-9.818 9.818-9.818 5.424 0 9.818 4.394 9.818 9.818 0 5.424-4.394 9.818-9.818 9.818z" />
              </svg>
              Send Report + Feedback Request on WhatsApp
            </button>
            <div className="wa-note">
              ✅ The PDF print dialog will open automatically first.
              <br />
              ✅ Save the PDF, then attach it to the WhatsApp message that
              opens.
              <br />✅ The message includes a personalised feedback request for
              the patient.
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
