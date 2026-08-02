import React, { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import StatCard from "../components/StatCard";
import { Button, Card, CardHeader, CardTitle, CardContent, Table, TableHead, TableRow, TableCell, Badge } from "../components/ui";

export default function PatientExperiencePage({ setNotice }: { setNotice: (msg: string | null) => void }) {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total_responses: 0, average_rating: 0, unresolved_low_rated: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("All");

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
        setNotice("Failed to load patient experience data.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateStatus = async (id: number, newStatus: string) => {
    try {
      await apiFetch(`/api/whatsapp/feedback/${id}/status`, {
        method: "PUT",
        body: { status: newStatus }
      });
      setNotice("Status updated successfully.");
      loadData();
    } catch (err: any) {
      setNotice(err.message || "Failed to update status.");
    }
  };

  const exportCSV = () => {
    const headers = ["Patient ID", "Patient Name", "Rating", "Comment", "Status", "Received At", "WhatsApp Msg ID", "Phone"];
    const rows = filteredFeedback.map(f => [
      f.patient_id || "",
      f.patient_name || "Unknown",
      f.rating || "N/A",
      (f.comment || "").replace(/"/g, '""'),
      f.status,
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
    const ratingA = a.rating || 99;
    const ratingB = b.rating || 99;
    if (ratingA !== ratingB) return ratingA - ratingB;
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
  });

  const filteredFeedback = sortedFeedback.filter(f => filterStatus === "All" || f.status === filterStatus);

  if (loading) {
    return (
      <div className="page-container">
        <header className="page-header">
          <h1>Patient Experience</h1>
          <p className="muted">Loading dashboard...</p>
        </header>
      </div>
    );
  }

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>Patient Experience</h1>
          <p className="muted">Monitor and manage patient feedback from WhatsApp</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card)" }}
          >
            <option value="All">All Statuses</option>
            <option value="New">New</option>
            <option value="Escalated">Escalated</option>
            <option value="Reviewed">Reviewed</option>
            <option value="Resolved">Resolved</option>
          </select>
          <Button onClick={exportCSV} variant="primary">Export CSV</Button>
        </div>
      </header>

      <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "24px", marginBottom: "24px" }}>
        <StatCard 
          label="Average Rating (out of 5)" 
          value={summary.average_rating ? summary.average_rating.toFixed(1) : "0.0"} 
        />
        <StatCard 
          label="Total Responses" 
          value={summary.total_responses} 
        />
        <StatCard 
          label="Needs Follow-up (Ratings 1-2)" 
          value={summary.unresolved_low_rated} 
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </thead>
            <tbody>
              {filteredFeedback.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} style={{ textAlign: "center", padding: "32px", color: "var(--muted-foreground)" }}>
                    No feedback found matching the filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFeedback.map((f, i) => {
                  const isLowRating = f.rating === 1 || f.rating === 2;
                  
                  return (
                    <TableRow key={i} style={{ backgroundColor: isLowRating && f.status === 'Escalated' ? 'rgba(220, 38, 38, 0.05)' : undefined }}>
                      <TableCell>
                        <div style={{ fontWeight: 600 }}>{f.patient_name || "Unknown Patient"}</div>
                        <div className="muted" style={{ fontSize: "0.85em" }}>ID: {f.patient_id}</div>
                        {f.phone_number && <div className="muted" style={{ fontSize: "0.85em" }}>{f.phone_number}</div>}
                      </TableCell>
                      <TableCell>
                        {f.rating ? (
                          <Badge variant={isLowRating ? "destructive" : "success"}>
                            {f.rating} / 5
                          </Badge>
                        ) : (
                          <span className="muted" style={{ fontSize: "0.85em", fontStyle: "italic" }}>No Rating</span>
                        )}
                      </TableCell>
                      <TableCell style={{ maxWidth: "300px", whiteSpace: "normal", wordWrap: "break-word" }}>
                        {f.comment || <span className="muted" style={{ fontStyle: "italic" }}>No comment provided</span>}
                      </TableCell>
                      <TableCell>
                        <div>{new Date(f.received_at).toLocaleDateString()}</div>
                        <div className="muted" style={{ fontSize: "0.85em" }}>{new Date(f.received_at).toLocaleTimeString()}</div>
                      </TableCell>
                      <TableCell>
                        <select
                          value={f.status}
                          onChange={(e) => updateStatus(f.id, e.target.value)}
                          style={{ 
                            padding: "6px 10px", 
                            borderRadius: "6px", 
                            border: "1px solid var(--border)", 
                            background: f.status === 'Escalated' ? 'var(--destructive)' : 'var(--card)',
                            color: f.status === 'Escalated' ? 'white' : 'inherit'
                          }}
                        >
                          <option value="New">New</option>
                          <option value="Reviewed">Reviewed</option>
                          <option value="Escalated">Escalated</option>
                          <option value="Resolved">Resolved</option>
                        </select>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
