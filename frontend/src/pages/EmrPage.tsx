import React, { useState } from "react";
import { Button, Input, Table, Badge, Card, Tabs, TabsTrigger } from "../components/ui";
import { apiFetch } from "../lib/api";
import { FiSearch as Search, FiPrinter as Printer, FiFileText as FileText, FiShare2 as Share2, FiActivity as Activity, FiUser as User, FiZap as Zap } from "react-icons/fi";
import type { Patient } from "../types";

export default function EmrPage({ setNotice }: { setNotice: (msg: any) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [emrData, setEmrData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState("");

  const handleSearch = async () => {
    if (!searchQuery) return;
    setLoading(true);
    try {
      const results = await apiFetch<Patient[]>(`/api/emr/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(results);
    } catch (err) {
      setNotice({ type: "error", message: "Failed to search patient." });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPatient = async (patientId: string) => {
    setSelectedPatient(patientId);
    setLoading(true);
    try {
      const data = await apiFetch<any>(`/api/emr/${patientId}`);
      setEmrData(data);
      // Log access
      apiFetch("/api/emr/access-log", {
        method: "POST",
        body: JSON.stringify({ patient_id: patientId, action: "viewed" })
      }).catch(console.error);
    } catch (err) {
      setNotice({ type: "error", message: "Failed to load EMR data." });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAiSummary = async () => {
    if (!selectedPatient) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/api/emr/${selectedPatient}/ai-summary`, { method: "POST" });
      setAiSummary(res.summary);
    } catch (err) {
      setNotice({ type: "error", message: "Failed to generate AI summary." });
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();
  const handleExportPdf = () => window.print(); // Using browser print-to-pdf
  const handleShareWhatsApp = () => {
    if (!emrData) return;
    const text = `Dear ${emrData.patient.name}, your medical record from HospAI Hospital is attached. Please find your EMR report.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };
  const handleShareEmail = () => {
    if (!emrData) return;
    const body = `Dear ${emrData.patient.name},\n\nYour medical record from HospAI Hospital is attached.\nPlease find your EMR report.\n\nThank you.`;
    window.location.href = `mailto:?subject=HospAI EMR Report&body=${encodeURIComponent(body)}`;
  };

  if (selectedPatient && emrData) {
    const { patient, medical_history, encounters, notes, vitals, diagnoses, prescriptions, labs, documents = [], pharmacy_sales = [] } = emrData;

    const timelineEvents = [
      ...encounters.map((enc: any) => {
        const encDiagnoses = diagnoses.filter((d: any) => d.encounter_id === enc.id);
        const description = encDiagnoses.length > 0
          ? `Diagnosis: ${encDiagnoses.map((d: any) => d.diagnosis_name).join(', ')}`
          : "Encounter recorded successfully";
        return {
          id: `enc-${enc.id}`,
          type: enc.encounter_type || "Consultation",
          description,
          timestamp: enc.created_at,
          handledBy: enc.doctor_name || "Doctor",
          status: enc.status || "Completed"
        };
      }),
      ...documents.map((doc: any) => ({
        id: `doc-${doc.id}`,
        type: "Document (OCR)",
        description: `${doc.doc_type || 'File'}: ${doc.file_name}${doc.ocr_text ? ' - ' + doc.ocr_text.substring(0, 100) + '...' : ''}`,
        timestamp: doc.created_at,
        handledBy: "System",
        status: "Uploaded"
      })),
      ...pharmacy_sales.map((sale: any) => ({
        id: `pharm-${sale.id}`,
        type: "Pharmacy Sale",
        description: `Purchased: ${sale.medicine_name} x${sale.quantity} (Total: ₹${sale.amount})`,
        timestamp: sale.sold_at || sale.created_at,
        handledBy: "Pharmacist",
        status: "Dispensed"
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return (
      <div className="emr-page print-container max-w-5xl mx-auto">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .emr-page, .emr-page * { visibility: visible; }
            .emr-page { position: absolute; left: 0; top: 0; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
            .no-print, .no-print * { display: none !important; }
            .print-only { display: block !important; }
          }
          @media screen {
            .print-only { display: none !important; }
          }
        `}</style>
        <div className="flex justify-between items-center mb-6 no-print">
          <Button variant="secondary" onClick={() => setSelectedPatient(null)}>Back to Search</Button>
          <div className="flex gap-2">
            <Button variant="primary" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" /> Print EMR</Button>
            <Button variant="secondary" onClick={handleExportPdf}><FileText className="w-4 h-4 mr-2" /> Export PDF</Button>
          </div>
        </div>

        <div className="mb-8 pb-4 flex justify-between items-start" style={{ borderBottom: '2px solid var(--primary)' }}>
          <div>
            <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--primary)' }}>Patient Journey Report</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Complete Patient Flow & Interaction Summary</p>
          </div>
          <div className="text-sm" style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', columnGap: '12px', rowGap: '6px', color: 'var(--text)' }}>
            <div className="text-right font-medium">Print Date</div>
            <div className="text-center text-gray-400">|</div>
            <div className="text-left">{new Date().toLocaleDateString('en-GB')}</div>

            <div className="text-right font-medium">Generated By</div>
            <div className="text-center text-gray-400">|</div>
            <div className="text-left">HospAI System</div>

            <div className="text-right font-medium">Generated Time</div>
            <div className="text-center text-gray-400">|</div>
            <div className="text-left">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</div>
          </div>
        </div>

        <h2 className="text-lg font-bold mb-3" style={{ color: 'var(--primary)' }}>Patient Details</h2>
        <table className="emr-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '32px', fontSize: '14px', backgroundColor: 'var(--surface)', borderRadius: '8px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          <tbody>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold', width: '18%' }}>Patient ID</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '30px' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', width: '32%' }}>{patient.patient_id}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold', width: '18%' }}>Patient Name</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '30px' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.name} {patient.last_name}</td>
            </tr>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Age / Gender</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.age} Y / {patient.gender}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Mobile No.</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.phone}</td>
            </tr>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Address</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.address || "-"}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Registered On</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.created_at ? new Date(patient.created_at).toLocaleString('en-GB') : new Date().toLocaleString('en-GB')}</td>
            </tr>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Blood Group</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.blood_group || "-"}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Emergency Contact</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{patient.emergency_contact || "-"}</td>
            </tr>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Aadhar Number</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }} colSpan={4}>{patient.aadhar_number || "-"}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="text-lg font-bold mb-3" style={{ color: 'var(--primary)' }}>Medical Information</h2>
        <table className="emr-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '32px', fontSize: '14px', backgroundColor: 'var(--surface)', borderRadius: '8px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          <tbody>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold', width: '18%' }}>Allergies</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '30px' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', width: '32%' }}>{medical_history?.allergies || patient.allergies || "None"}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold', width: '18%' }}>Existing Diseases</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '30px' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{medical_history?.existing_diseases || "-"}</td>
            </tr>
            <tr>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Chronic Conditions</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{medical_history?.chronic_conditions || "-"}</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', fontWeight: 'bold' }}>Previous Surgeries</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center' }}>:</td>
              <td style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>{medical_history?.previous_surgeries || "-"}</td>
            </tr>
          </tbody>
        </table>

        <div className="flex justify-end mb-4 no-print">
          <Button onClick={handleGenerateAiSummary} variant="secondary" className="text-purple-700 border-purple-700 bg-purple-50">
            <Zap className="w-4 h-4 mr-2" /> Generate AI Summary
          </Button>
        </div>
        {aiSummary && (
          <div className="mb-8 p-4" style={{ border: '1px solid black', backgroundColor: '#f9f9f9', fontFamily: 'Arial, sans-serif' }}>
            <h3 className="font-bold text-black mb-2 flex items-center"><Zap className="w-4 h-4 mr-2" /> AI Summary</h3>
            <p className="text-black text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
          </div>
        )}

        <Tabs className="mb-6 no-print">
          <div className="flex gap-2 overflow-x-auto pb-2 border-b-2 border-gray-200">
            {["overview", "medical-history", "consultation", "notes", "vitals", "diagnosis", "prescriptions", "labs", "imaging", "discharge"].map((tab) => (
              <TabsTrigger key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} className="whitespace-nowrap px-4 py-2">
                {tab.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </TabsTrigger>
            ))}
          </div>
        </Tabs>

        {activeTab === "overview" && (
          <div className="timeline-container relative bg-white rounded-xl shadow-sm border border-[var(--border)] p-4">
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--primary)' }}>Journey Timeline</h2>

            <table className="emr-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '60px' }}>Sl.No</th>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'left', width: '200px' }}>Stage</th>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'left' }}>Description</th>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '140px' }}>Date & Time</th>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'left', width: '140px' }}>Handled By</th>
                  <th style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', textAlign: 'center', width: '100px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {timelineEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ border: '1px solid black', padding: '12px', textAlign: 'center', fontStyle: 'italic' }}>No events found in journey.</td>
                  </tr>
                ) : (
                  timelineEvents.map((evt: any, index: number) => {
                    return (
                      <tr key={evt.id}>
                        <td style={{ border: '1px solid black', padding: '10px', textAlign: 'center' }}>{index + 1}</td>
                        <td style={{ border: '1px solid black', padding: '10px' }}>
                          <div className="flex items-center gap-2">
                            <span style={{ border: '1px solid black', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>{index + 1}</span>
                            <span>{evt.type}</span>
                          </div>
                        </td>
                        <td style={{ border: '1px solid black', padding: '10px' }}>{evt.description}</td>
                        <td style={{ border: '1px solid black', padding: '10px', textAlign: 'center' }}>
                          <div>{new Date(evt.timestamp).toLocaleDateString('en-GB')}</div>
                          <div>{new Date(evt.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>
                        <td style={{ border: '1px solid black', padding: '10px' }}>{evt.handledBy}</td>
                        <td style={{ border: '1px solid black', padding: '10px', textAlign: 'center' }}>
                          <span style={{ border: '1px solid black', borderRadius: '4px', padding: '2px 8px', display: 'inline-block' }}>
                            {evt.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab !== "overview" && (
          <Card className="p-8 text-center text-gray-500 bg-gray-50 border-dashed">
            Select the Overview tab to view the complete clinical timeline. This tab isolates specific historical records.
          </Card>
        )}

        <div className="mt-12 text-center text-xs text-gray-400 print-only border-t pt-4">
          Generated securely from HospAI EMR System
        </div>
      </div>
    );
  }

  return (
    <div className="emr-page max-w-4xl mx-auto py-8">
      <Card className="p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">EMR Search</h2>
        </div>
        <p className="text-gray-600 mb-6">Search patient by Name, last 4 digits of mobile number, UHID, or Patient ID.</p>

        <div className="flex gap-4 mb-8">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search e.g. John Smith or 9876"
            className="flex-1"
            onKeyDown={e => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={loading} variant="primary">
            {loading ? "Searching..." : <><Search className="w-4 h-4 mr-2" /> Search</>}
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="mt-8 border-t pt-6">
            <h3 className="font-bold mb-4 text-gray-700">Search Results</h3>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <th>Patient ID</th>
                    <th>Name</th>
                    <th>Mobile</th>
                    <th>Age/Gender</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map(p => (
                    <tr key={p.id}>
                      <td className="font-medium text-gray-600">{p.patient_id}</td>
                      <td>{p.name} {p.last_name}</td>
                      <td>{p.phone}</td>
                      <td>{p.age} / {p.gender}</td>
                      <td>
                        <Button size="sm" onClick={() => handleSelectPatient(p.patient_id)} variant="secondary">Open EMR</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
        {searchResults.length === 0 && searchQuery && !loading && (
          <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed mt-6">
            <Search className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p>No patients found matching your search.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
