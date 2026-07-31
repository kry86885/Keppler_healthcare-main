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
    const { patient, medical_history, encounters, notes, vitals, diagnoses, prescriptions, labs } = emrData;
    return (
      <div className="emr-page print-container max-w-5xl mx-auto">
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
            .emr-page { padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
            .card { border: none !important; box-shadow: none !important; padding: 0 !important; }
          }
          @media screen {
            .print-only { display: none !important; }
          }
        `}</style>
        <div className="flex justify-between items-center mb-6 no-print">
          <Button variant="outline" onClick={() => setSelectedPatient(null)}>Back to Search</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" /> Print EMR</Button>
            <Button variant="outline" onClick={handleExportPdf}><FileText className="w-4 h-4 mr-2" /> Export PDF</Button>
            <Button variant="primary" onClick={handleShareWhatsApp}><Share2 className="w-4 h-4 mr-2" /> Share EMR</Button>
            <Button variant="outline" onClick={handleShareEmail}>Email</Button>
          </div>
        </div>

        <div className="print-only mb-6 border-b pb-4">
          <h1 className="text-3xl font-bold mb-2">HospAI Hospital</h1>
          <p className="text-gray-600">Electronic Medical Record</p>
        </div>

        <Card className="mb-6 p-6">
          <div className="flex items-center gap-4 border-b pb-4 mb-4">
            <User className="w-12 h-12 text-gray-400" />
            <div>
              <h2 className="text-2xl font-bold">{patient.name} {patient.last_name}</h2>
              <p className="text-gray-500">UHID: {patient.patient_id}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><strong>Age:</strong> {patient.age || "-"}</div>
            <div><strong>Gender:</strong> {patient.gender || "-"}</div>
            <div><strong>Mobile:</strong> {patient.phone || "-"}</div>
            <div><strong>Blood Group:</strong> {patient.blood_group || "-"}</div>
            <div><strong>Address:</strong> {patient.address || "-"}</div>
            <div><strong>Emergency Contact:</strong> {patient.emergency_contact || "-"}</div>
          </div>
          <div className="mt-4 border-t pt-4 text-sm">
            <h3 className="font-bold mb-2 text-gray-700">Medical Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><strong>Allergies:</strong> {medical_history?.allergies || patient.allergies || "None"}</div>
              <div><strong>Existing Diseases:</strong> {medical_history?.existing_diseases || "-"}</div>
              <div><strong>Chronic Conditions:</strong> {medical_history?.chronic_conditions || "-"}</div>
              <div><strong>Previous Surgeries:</strong> {medical_history?.previous_surgeries || "-"}</div>
            </div>
          </div>
        </Card>

        <div className="flex justify-between items-center mb-4 no-print">
          <Button onClick={handleGenerateAiSummary} variant="outline" className="text-purple-600 border-purple-600 bg-purple-50">
            <Zap className="w-4 h-4 mr-2" /> Generate AI Summary
          </Button>
        </div>
        {aiSummary && (
          <Card className="mb-6 p-4 bg-purple-50 border-purple-200">
            <h3 className="font-bold text-purple-800 mb-2 flex items-center"><Zap className="w-4 h-4 mr-2" /> AI Summary</h3>
            <p className="text-purple-900 text-sm leading-relaxed">{aiSummary}</p>
          </Card>
        )}

        <Tabs className="mb-6 no-print">
          <div className="flex gap-2 overflow-x-auto pb-2 border-b">
            {["overview", "medical-history", "consultation", "notes", "vitals", "diagnosis", "prescriptions", "labs", "imaging", "discharge"].map((tab) => (
              <TabsTrigger key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} className="whitespace-nowrap px-4 py-2">
                {tab.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </TabsTrigger>
            ))}
          </div>
        </Tabs>

        {activeTab === "overview" && (
          <div className="timeline-container">
            <h3 className="text-xl font-bold mb-4 text-gray-800">Clinical Timeline</h3>
            {encounters.length === 0 && <p className="text-gray-500 italic">No encounters found.</p>}
            {encounters.map((enc: any) => {
              const encNotes = notes.filter((n: any) => n.encounter_id === enc.id);
              const encVitals = vitals.filter((v: any) => v.encounter_id === enc.id);
              const encDiagnoses = diagnoses.filter((d: any) => d.encounter_id === enc.id);
              
              return (
                <Card key={enc.id} className="mb-4 p-4 border-l-4 border-l-blue-500">
                  <div className="flex justify-between border-b pb-2 mb-3">
                    <div>
                      <strong className="text-blue-700">{new Date(enc.created_at).toLocaleDateString()}</strong> - <span className="font-medium">{enc.encounter_type || "OP Consultation"}</span>
                    </div>
                    <Badge variant="success">{enc.status}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold text-gray-700 text-sm mb-1">Vitals</h4>
                      {encVitals.map((v: any) => (
                        <div key={v.id} className="text-sm bg-gray-50 p-2 rounded">BP: {v.bp} | Pulse: {v.pulse} | Temp: {v.temperature}</div>
                      ))}
                      {encVitals.length === 0 && <span className="text-sm text-gray-400">No vitals recorded</span>}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-700 text-sm mb-1">Diagnosis</h4>
                      {encDiagnoses.map((d: any) => (
                        <div key={d.id} className="text-sm bg-gray-50 p-2 rounded">{d.diagnosis_name}</div>
                      ))}
                      {encDiagnoses.length === 0 && <span className="text-sm text-gray-400">No diagnosis recorded</span>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <h4 className="font-semibold text-gray-700 text-sm mb-1">Clinical Notes</h4>
                    {encNotes.map((n: any) => (
                      <div key={n.id} className="text-sm italic border-l-2 border-gray-300 pl-3 py-1 text-gray-600 mb-1">{n.notes}</div>
                    ))}
                    {encNotes.length === 0 && <span className="text-sm text-gray-400">No clinical notes</span>}
                  </div>
                </Card>
              );
            })}
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
                        <Button size="sm" onClick={() => handleSelectPatient(p.patient_id)} variant="outline">Open EMR</Button>
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
