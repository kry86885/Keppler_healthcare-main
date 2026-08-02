import React, { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import StatCard from "../components/StatCard";
import { Button, Card, CardHeader, CardTitle, CardContent, Table, TableHead, TableRow, TableCell, Badge, Modal, Input, Label } from "../components/ui";

export default function PatientExperiencePage({ setNotice }: { setNotice: any }) {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total_responses: 0, average_rating: 0, unresolved_low_rated: 0 });
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualFeedback, setManualFeedback] = useState({ patient_id: "", comment: "" });
  const [saving, setSaving] = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      apiFetch<{ feedback: any[] }>("/api/whatsapp/feedback"),
      apiFetch<any>("/api/whatsapp/feedback/summary")
    ])
      .then(([fData, sData]) => {
        setFeedback(fData.feedback || []);
        setSummary(sData || { total_responses: 0, average_rating: 0, unresolved_low_rated: 0 });
      })
      .catch((err) => {
        console.error(err);
        setNotice({ type: "error", message: "Failed to load patient experience data." });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);



  const exportCSV = () => {
    const headers = ["Patient ID", "Patient Name", "Feedback", "Received At", "WhatsApp Msg ID", "Phone"];
    const rows = filteredFeedback.map(f => [
      f.patient_id || "",
      f.patient_name || "Unknown",
      (f.comment || "").replace(/"/g, '""'),
      f.received_at,
      f.whatsapp_message_id || "",
      f.phone_number || ""
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(e => `"${e.join('","')}"`)
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `patient_feedback_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sortedFeedback = [...feedback].sort((a, b) => {
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
  });

  const filteredFeedback = sortedFeedback;

  const submitManualFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFeedback.comment) return;
    setSaving(true);
    try {
      await apiFetch("/api/whatsapp/feedback", {
        method: "POST",
        body: JSON.stringify(manualFeedback)
      });
      setNotice({ type: "success", message: "Feedback logged successfully." });
      setShowAddModal(false);
      setManualFeedback({ patient_id: "", comment: "" });
      loadData();
    } catch (err) {
      setNotice({ type: "error", message: "Failed to log feedback." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: "flex", justifyContent: "center", padding: "40px", color: "var(--muted-foreground)" }}>
          <p>Loading patient insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container fade-in">
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "24px", gap: "12px" }}>
        <Button onClick={() => setShowAddModal(true)} variant="secondary">Log Feedback</Button>
        <Button onClick={exportCSV} variant="primary">Export CSV</Button>
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Log Patient Feedback">
        <form onSubmit={submitManualFeedback} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <Label>Patient ID (Optional)</Label>
            <Input 
              placeholder="e.g. PAT-100001" 
              value={manualFeedback.patient_id} 
              onChange={e => setManualFeedback(prev => ({...prev, patient_id: e.target.value}))} 
            />
          </div>
          <div>
            <Label>Feedback Comment</Label>
            <textarea 
              className="input" 
              style={{ minHeight: "100px", width: "100%" }}
              placeholder="Enter patient feedback here..." 
              required
              value={manualFeedback.comment} 
              onChange={e => setManualFeedback(prev => ({...prev, comment: e.target.value}))} 
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
            <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save Feedback"}</Button>
          </div>
        </form>
      </Modal>

      <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "24px", marginBottom: "24px" }}>
        <StatCard 
          label="Total Feedback Received" 
          value={feedback.length} 
        />
        <StatCard 
          label="New Submissions" 
          value={feedback.filter(f => f.status === 'New').length} 
        />
        <StatCard 
          label="Escalated Issues" 
          value={feedback.filter(f => f.status === 'Escalated').length} 
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Patient Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Feedback</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
              {filteredFeedback.length === 0 ? (
                <TableRow>
                  <td style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--muted-foreground)" }}>
                    No patient insights found.
                  </td>
                </TableRow>
              ) : (
                filteredFeedback.map((f, i) => (
                  <TableRow key={i} style={{ backgroundColor: f.status === 'Escalated' ? 'rgba(220, 38, 38, 0.04)' : undefined }}>
                    <TableCell>
                      <div style={{ fontWeight: 600, color: "var(--foreground)" }}>{f.patient_name || "Unknown Patient"}</div>
                      <div className="muted" style={{ fontSize: "0.85em", marginTop: "4px" }}>ID: {f.patient_id}</div>
                      {f.phone_number && <div className="muted" style={{ fontSize: "0.85em" }}>{f.phone_number}</div>}
                    </TableCell>
                    <TableCell style={{ maxWidth: "400px", whiteSpace: "normal", wordWrap: "break-word", lineHeight: "1.5" }}>
                      {f.comment || <span className="muted" style={{ fontStyle: "italic" }}>No written feedback provided</span>}
                    </TableCell>
                    <TableCell>
                      <div style={{ fontWeight: 500 }}>{new Date(f.received_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <div className="muted" style={{ fontSize: "0.85em", marginTop: "4px" }}>{new Date(f.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </TableCell>
                  </TableRow>
                ))
              )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
