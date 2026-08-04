import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Button, Input, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import type { Notice, OpSummary } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  canEdit: boolean;
};

type Department = {
  id: number;
  department_name?: string;
};

type Doctor = {
  id: number;
  doctor_name: string;
  department: string;
  consultation_fee: number;
  review_fee: number;
  status: string;
  source?: string;
};

type DoctorForm = {
  id: string;
  doctor_name: string;
  department: string;
  consultation_fee: string;
  review_fee: string;
  status: string;
};

const EMPTY_SUMMARY: OpSummary = {
  date: "",
  total_appointments: 0,
  follow_ups: 0,
  active_queue: 0,
  no_shows: 0,
  reminders_sent: 0,
  available_doctors: 0,
};

const DEFAULT_DOCTOR_FORM: DoctorForm = {
  id: "",
  doctor_name: "",
  department: "",
  consultation_fee: "0",
  review_fee: "0",
  status: "available",
};

export default function DoctorSchedulingPage({ setNotice, canEdit }: Props) {
  const [summary, setSummary] = useState<OpSummary>(EMPTY_SUMMARY);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [doctorForm, setDoctorForm] = useState<DoctorForm>(DEFAULT_DOCTOR_FORM);
  const [savingDoctor, setSavingDoctor] = useState(false);
  
  const [departmentInput, setDepartmentInput] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [savingDepartment, setSavingDepartment] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryData, deptData, doctorsData] = await Promise.all([
        apiFetch<OpSummary>(`/api/op/summary?date=${selectedDate}`),
        apiFetch<{ departments?: Department[] }>("/api/registration/departments"),
        apiFetch<{ doctors?: Doctor[] }>("/api/op/doctors"),
      ]);
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setDepartments(deptData.departments || []);
      setDoctors(doctorsData.doctors || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleAddDepartment = async () => {
    if (!departmentInput.trim()) {
      setNotice({ type: "error", message: "Department name is required." });
      return;
    }
    setSavingDepartment(true);
    try {
      await apiFetch("/api/registration/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: departmentInput.trim() }),
      });
      setNotice({ type: "success", message: "Department added." });
      setDepartmentInput("");
      const deptData = await apiFetch<{ departments?: Department[] }>("/api/registration/departments");
      setDepartments(deptData.departments || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to add department.");
    } finally {
      setSavingDepartment(false);
    }
  };

  const handleDoctorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!doctorForm.doctor_name.trim() || !doctorForm.department.trim()) {
      setNotice({ type: "error", message: "Doctor name and department are required." });
      return;
    }
    setSavingDoctor(true);
    try {
      const doctorId = Number(doctorForm.id);
      const path = doctorId ? `/api/op/doctors/${doctorId}` : "/api/op/doctors";
      await apiFetch(path, {
        method: doctorId ? "PUT" : "POST",
        body: JSON.stringify({
          doctor_name: doctorForm.doctor_name.trim(),
          department: doctorForm.department.trim(),
          consultation_fee: Number(doctorForm.consultation_fee) || 0,
          review_fee: Number(doctorForm.review_fee) || 0,
          status: doctorForm.status,
        }),
      });
      setDoctorForm(DEFAULT_DOCTOR_FORM);
      setNotice({ type: "success", message: doctorId ? "Doctor updated." : "Doctor added." });
      const doctorsData = await apiFetch<{ doctors?: Doctor[] }>("/api/op/doctors");
      setDoctors(doctorsData.doctors || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save doctor.");
    } finally {
      setSavingDoctor(false);
    }
  };

  const handleEditDoctor = (doc: Doctor) => {
    setDoctorForm({
      id: String(doc.id),
      doctor_name: doc.doctor_name,
      department: doc.department || "",
      consultation_fee: String(doc.consultation_fee || 0),
      review_fee: String(doc.review_fee || 0),
      status: doc.status || "available",
    });
  };

  const handleDeleteDoctor = async (doctorId: number) => {
    if (!confirm("Are you sure you want to delete this doctor?")) return;
    try {
      await apiFetch(`/api/op/doctors/${doctorId}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Doctor deleted." });
      const doctorsData = await apiFetch<{ doctors?: Doctor[] }>("/api/op/doctors");
      setDoctors(doctorsData.doctors || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete doctor.");
    }
  };

  if (loading && !summary.total_appointments) {
    return <div className="page-loading">Loading scheduling data...</div>;
  }

  return (
    <section className="module-page">
      <div className="module-panel-head" style={{ borderBottom: 'none' }}>
        <div>
          <h3>OP Desk</h3>
        </div>
        <div className="module-inline-actions">
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          <Select value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
            <option value="">All doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.doctor_name}>
                {d.doctor_name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard label="OP APPOINTMENTS" value={summary.total_appointments} />
        <StatCard label="FOLLOW-UPS" value={summary.follow_ups} />
        <StatCard label="ACTIVE QUEUE" value={summary.active_queue} />
        <StatCard label="NO-SHOWS" value={summary.no_shows} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem", marginTop: "1.5rem" }}>
        {/* Left Column: Add / Edit Doctor Form */}
        <div className="panel" style={{ padding: "1.5rem", background: "#FFFFFF", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem", color: "#0F172A", fontWeight: 600 }}>
            {doctorForm.id ? "✏️ Edit Doctor Profile" : "➕ Add New Doctor"}
          </h4>
          <p className="muted" style={{ margin: "0 0 1.25rem 0", fontSize: "0.875rem" }}>
            Add doctors to the administrative roster. They will automatically be available in Appointments & Symptom AI.
          </p>

          <form onSubmit={(e) => void handleDoctorSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
                Full Name *
              </label>
              <Input
                value={doctorForm.doctor_name}
                onChange={(e) => setDoctorForm((prev) => ({ ...prev, doctor_name: e.target.value }))}
                placeholder="Enter doctor's full name..."
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
                Department / Specialty *
              </label>
              <Select
                value={doctorForm.department}
                onChange={(e) => setDoctorForm((prev) => ({ ...prev, department: e.target.value }))}
                required
              >
                <option value="">Select department...</option>
                {departments.map((dept) => (
                  <option key={dept.id || dept.department_name} value={dept.department_name}>
                    {dept.department_name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
                  Consult Fee ($)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={doctorForm.consultation_fee}
                  onChange={(e) => setDoctorForm((prev) => ({ ...prev, consultation_fee: e.target.value }))}
                  placeholder="150"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
                  Review Fee ($)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={doctorForm.review_fee}
                  onChange={(e) => setDoctorForm((prev) => ({ ...prev, review_fee: e.target.value }))}
                  placeholder="75"
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
                Status
              </label>
              <Select
                value={doctorForm.status}
                onChange={(e) => setDoctorForm((prev) => ({ ...prev, status: e.target.value as "available" | "leave" }))}
              >
                <option value="available">Available for Appointments</option>
                <option value="leave">On Leave / Unavailable</option>
              </Select>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <Button type="submit" disabled={savingDoctor} style={{ flex: 1 }}>
                {savingDoctor ? "Saving..." : doctorForm.id ? "Save Changes" : "Add Doctor to List"}
              </Button>
              {doctorForm.id && (
                <Button type="button" variant="secondary" onClick={() => setDoctorForm(DEFAULT_DOCTOR_FORM)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          <hr style={{ border: "none", borderTop: "1px solid #E2E8F0", margin: "1.5rem 0" }} />

          {/* Quick Department Add */}
          <div>
            <h5 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#334155" }}>Add New Department</h5>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Input
                value={departmentInput}
                onChange={(event) => setDepartmentInput(event.target.value)}
                placeholder="Department name..."
                aria-label="Department name"
              />
              <Button type="button" variant="secondary" onClick={() => void handleAddDepartment()} disabled={savingDepartment}>
                {savingDepartment ? "Adding..." : "Add"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: Doctors List Table */}
        <div className="panel" style={{ padding: "1.5rem", background: "#FFFFFF", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h4 style={{ margin: 0, fontSize: "1.15rem", color: "#0F172A", fontWeight: 600 }}>
                📋 Doctors Roster ({doctors.length})
              </h4>
              <p className="muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
                All active doctors — from Roster and Staff directory.
              </p>
            </div>
          </div>

          <Table>
            <TableHead>
              <TableRow>
                <TableCell>DOCTOR NAME</TableCell>
                <TableCell>DEPARTMENT</TableCell>
                <TableCell>CONSULT FEE</TableCell>
                <TableCell>REVIEW FEE</TableCell>
                <TableCell>STATUS</TableCell>
                <TableCell style={{ textAlign: "right" }}>ACTIONS</TableCell>
              </TableRow>
            </TableHead>
            <div>
              {doctors.map((doc) => (
                <TableRow key={doc.id} style={{ transition: "background 0.15s" }}>
                  <TableCell style={{ fontWeight: 600, color: "#1E293B" }}>{doc.doctor_name}</TableCell>
                  <TableCell>
                    <span style={{ padding: "0.2rem 0.6rem", background: "#F1F5F9", borderRadius: "4px", fontSize: "0.85rem", fontWeight: 500, color: "#334155" }}>
                      {doc.department || "General"}
                    </span>
                  </TableCell>
                  <TableCell style={{ fontWeight: 500, color: "#059669" }}>₹{Number(doc.consultation_fee || 0).toFixed(0)}</TableCell>
                  <TableCell style={{ color: "#64748B" }}>₹{Number(doc.review_fee || 0).toFixed(0)}</TableCell>
                  <TableCell>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          borderRadius: "12px",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          backgroundColor: doc.status === "available" || doc.status === "active" ? "#DEF7EC" : "#FDE8E8",
                          color: doc.status === "available" || doc.status === "active" ? "#03543F" : "#9B1C1C",
                          display: "inline-block",
                        }}
                      >
                        {doc.status === "available" || doc.status === "active" ? "● Available" : "○ On Leave"}
                      </span>
                      {doc.source === "users" && (
                        <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 500 }}>Staff</span>
                      )}
                      {doc.source === "roster" && (
                        <span style={{ fontSize: "0.7rem", color: "#3b82f6", fontWeight: 500 }}>Roster</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    <div className="module-inline-actions" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
                      <Button variant="secondary" size="sm" onClick={() => handleEditDoctor(doc)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void handleDeleteDoctor(doc.id)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {doctors.length === 0 && (
                <TableRow>
                  <TableCell className="muted" style={{ padding: "2rem", textAlign: "center" }}>
                    No doctors added yet. Use the form on the left to add doctors to the hospital roster.
                  </TableCell>
                </TableRow>
              )}
            </div>
          </Table>
        </div>
      </div>
    </section>
  );
}
