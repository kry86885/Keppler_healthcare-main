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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
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
      <div className="module-panel-head">
        <div>
          <h3>Doctor Scheduling</h3>
          <p className="text-sm text-gray-500">Manage doctors and outpatient schedules.</p>
        </div>
      </div>

      <div className="module-panel-head" style={{ marginTop: '1rem', borderBottom: 'none' }}>
        <div>
          <h3>OP Desk</h3>
        </div>
        <div className="flex gap-2 items-center">
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

      <div className="panel registration-desk-panel">
        <h4>Manage Departments</h4>
        <div className="module-inline-actions">
          <Input
            value={departmentInput}
            onChange={(event) => setDepartmentInput(event.target.value)}
            placeholder="Enter new department name"
            aria-label="Department name"
            disabled={!canEdit}
          />
          <Button type="button" onClick={() => void handleAddDepartment()} disabled={savingDepartment || !canEdit}>
            {savingDepartment ? "Adding..." : "Add Department"}
          </Button>
        </div>
      </div>

      <div className="panel">
        <form onSubmit={(e) => void handleDoctorSubmit(e)} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <Input
            value={doctorForm.doctor_name}
            onChange={(e) => setDoctorForm((prev) => ({ ...prev, doctor_name: e.target.value }))}
            placeholder="Doctor name"
            required
            disabled={!canEdit}
          />
          <Select
            value={doctorForm.department}
            onChange={(e) => setDoctorForm((prev) => ({ ...prev, department: e.target.value }))}
            required
            disabled={!canEdit}
          >
            <option value="">Select department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.department_name}>
                {dept.department_name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min="0"
            value={doctorForm.consultation_fee}
            onChange={(e) => setDoctorForm((prev) => ({ ...prev, consultation_fee: e.target.value }))}
            placeholder="Consultation fee"
            required
            disabled={!canEdit}
          />
          <Input
            type="number"
            min="0"
            value={doctorForm.review_fee}
            onChange={(e) => setDoctorForm((prev) => ({ ...prev, review_fee: e.target.value }))}
            placeholder="Review fee"
            required
            disabled={!canEdit}
          />
          <Select
            value={doctorForm.status}
            onChange={(e) => setDoctorForm((prev) => ({ ...prev, status: e.target.value as "available" | "leave" }))}
            disabled={!canEdit}
          >
            <option value="available">Available</option>
            <option value="leave">On Leave</option>
          </Select>
          <div style={{ gridColumn: '1 / 2' }}>
            <Button type="submit" disabled={savingDoctor || !canEdit} style={{ width: '100%' }}>
              {savingDoctor ? "Saving..." : doctorForm.id ? "Update" : "Add"}
            </Button>
            {doctorForm.id && (
              <Button type="button" variant="secondary" onClick={() => setDoctorForm(DEFAULT_DOCTOR_FORM)} style={{ width: '100%', marginTop: '0.5rem' }}>
                Cancel Edit
              </Button>
            )}
          </div>
        </form>

        <div className="table-container mt-6">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell component="th">DOCTOR</TableCell>
                <TableCell component="th">DEPARTMENT</TableCell>
                <TableCell component="th">CONSULT FEE</TableCell>
                <TableCell component="th">REVIEW FEE</TableCell>
                <TableCell component="th">STATUS</TableCell>
                <TableCell component="th">ACTIONS</TableCell>
              </TableRow>
            </TableHead>
            <tbody>
              {doctors.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>{doc.doctor_name}</TableCell>
                  <TableCell>{doc.department || "-"}</TableCell>
                  <TableCell>₹{doc.consultation_fee}</TableCell>
                  <TableCell>₹{doc.review_fee}</TableCell>
                  <TableCell>{doc.status}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEditDoctor(doc)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => void handleDeleteDoctor(doc.id)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {doctors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-500 py-4">
                    No doctors added yet.
                  </TableCell>
                </TableRow>
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </section>
  );
}
