import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { FiCalendar } from "react-icons/fi";
import { Button, Input, Label, Select, Textarea } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { SYMPTOM_API_BASE } from "../lib/constants";
import { updateAppointmentStatus as putAppointmentStatus } from "../lib/appointments";
import { openRazorpayCheckout } from "../lib/razorpay";
import type { Appointment, Notice, Patient } from "../types";
import PatientAutocomplete from "../components/PatientAutocomplete";

import AppointmentQueueCard from "../components/AppointmentQueueCard";
import StatCard from "../components/StatCard";
type RegistrationMode = "appointment-in" | "appointment-out" | "consent" | "insurance";

type Props = {
  mode: RegistrationMode;
  selectedPatient: Patient | null;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string, extraData?: any) => void;
  prefillData?: { doctorName?: string, department?: string } | null;
};

type Department = {
  id: number;
  department_name?: string;
};

type ConsentRecord = {
  id: number;
  patient_id?: string | null;
  patient_name: string;
  consent_type: string;
  signed_by: string;
  relation_to_patient?: string | null;
};

type InsuranceRecord = {
  id: number;
  patient_id?: string | null;
  patient_name: string;
  insurer_name: string;
  policy_number?: string | null;
  member_id?: string | null;
  verification_status: string;
  coverage_notes?: string | null;
};

const DEFAULT_APPOINTMENT_FORM = {
  patient_id: "",
  patient_name: "",
  visit_type: "OP",
  department: "",
  doctor_name: "",
  appointment_date: "",
  consultation_fee: "0",
  payment_mode: "upi",
  notes: "",
};

const DEFAULT_CONSENT_FORM = {
  patient_id: "",
  patient_name: "",
  consent_type: "general",
  signed_by: "",
  relation_to_patient: "",
};

const DEFAULT_INSURANCE_FORM = {
  patient_id: "",
  patient_name: "",
  insurer_name: "",
  policy_number: "",
  member_id: "",
  verification_status: "pending",
  coverage_notes: "",
};

function patientFullName(patient: Patient | null) {
  return `${patient?.name || ""} ${patient?.middle_name || ""} ${patient?.last_name || ""}`.trim();
}

export default function RegistrationDeskPage({ mode, selectedPatient, setNotice, onNavigate, prefillData }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [isRazorpayReady, setIsRazorpayReady] = useState(true);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentInput, setDepartmentInput] = useState("");
  const [savingDepartment, setSavingDepartment] = useState(false);

  const [doctorSuggestions, setDoctorSuggestions] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<{ doctor_name?: string | null, department?: string | null, consultation_fee?: string | number, status?: string | null }[]>([]);

  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [insuranceChecks, setInsuranceChecks] = useState<InsuranceRecord[]>([]);
  const [savingConsent, setSavingConsent] = useState(false);
  const [savingInsurance, setSavingInsurance] = useState(false);
  const [editingConsentId, setEditingConsentId] = useState<number | null>(null);
  const [editingInsuranceId, setEditingInsuranceId] = useState<number | null>(null);

  const [appointmentForm, setAppointmentForm] = useState({ ...DEFAULT_APPOINTMENT_FORM });
  const [consentForm, setConsentForm] = useState({ ...DEFAULT_CONSENT_FORM });
  const [insuranceForm, setInsuranceForm] = useState({ ...DEFAULT_INSURANCE_FORM });

  useEffect(() => {
    if (prefillData) {
      setAppointmentForm(prev => {
        let nextFee = prev.consultation_fee;
        if (doctors.length > 0 && prefillData.doctorName) {
          const doc = doctors.find(d => (d.doctor_name || "").toLowerCase() === (prefillData.doctorName || "").toLowerCase());
          if (doc && doc.consultation_fee != null) {
            nextFee = String(doc.consultation_fee);
          }
        }
        return {
          ...prev,
          department: prefillData.department || prev.department,
          doctor_name: prefillData.doctorName || prev.doctor_name,
          consultation_fee: nextFee
        };
      });
    }
  }, [prefillData, doctors]);

  const [symptomsText, setSymptomsText] = useState("");
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageResult, setTriageResult] = useState<{ urgency?: string; reasoning?: string } | null>(null);

  const loadAppointments = async () => {
    setAppointmentsLoading(true);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const data = await apiFetch<{ appointments?: Appointment[] }>(`/api/appointments?date=${today}`);
      setAppointments(data.appointments || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load appointments.");
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const loadDepartmentOptions = async () => {
    try {
      const data = await apiFetch<{ departments?: Department[] }>("/api/registration/departments");
      setDepartments(data.departments || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load departments.");
    }
  };

  const loadDoctorSuggestions = async () => {
    try {
      const doctorsData = await apiFetch<{ doctors?: { doctor_name?: string | null, department?: string | null, consultation_fee?: string | number, status?: string | null }[] }>("/api/op/doctors");
      setDoctors(doctorsData.doctors || []);
      const names = new Set<string>();
      (doctorsData.doctors || []).forEach((row) => {
        const value = (row.doctor_name || "").trim();
        if (value) names.add(value);
      });
      setDoctorSuggestions(Array.from(names).sort((a, b) => a.localeCompare(b)));
    } catch {
      setDoctorSuggestions([]);
      setDoctors([]);
    }
  };

  const handleDepartmentChange = (dept: string) => {
    setAppointmentForm((prev) => {
      // Match case-insensitively against departments list and doctors list
      const matchedDeptObj = departments.find(d => (d.department_name || "").toLowerCase() === (dept || "").toLowerCase());
      const matchedDocDept = doctors.find(d => (d.department || "").toLowerCase() === (dept || "").toLowerCase());
      const targetDeptName = matchedDeptObj ? matchedDeptObj.department_name : (matchedDocDept?.department || dept);

      let nextDoctor = prev.doctor_name;
      let nextFee = prev.consultation_fee;

      if (targetDeptName && doctors.length > 0) {
        // Find doctors belonging to target department (case-insensitive)
        const inDeptDocs = doctors.filter(d => (d.department || "").toLowerCase() === targetDeptName.toLowerCase());
        const isCurrentDoctorInDept = inDeptDocs.some(d => (d.doctor_name || "").toLowerCase() === (prev.doctor_name || "").toLowerCase());

        if (!isCurrentDoctorInDept && inDeptDocs.length > 0) {
          const availableDocs = inDeptDocs.filter(d => d.status === "available");
          const targetDoc = availableDocs.length > 0 ? availableDocs[0] : inDeptDocs[0];
          
          if (targetDoc) {
            nextDoctor = targetDoc.doctor_name || "";
            nextFee = targetDoc.consultation_fee != null ? String(targetDoc.consultation_fee) : "0";
          }
        } else if (inDeptDocs.length === 0 && dept !== "General") {
          // If the AI returned a department that has no doctors, fallback to General
          const generalDocs = doctors.filter(d => (d.department || "").toLowerCase() === "general");
          if (generalDocs.length > 0) {
            const availableDocs = generalDocs.filter(d => d.status === "available");
            const targetDoc = availableDocs.length > 0 ? availableDocs[0] : generalDocs[0];
            if (targetDoc) {
              nextDoctor = targetDoc.doctor_name || "";
              nextFee = targetDoc.consultation_fee != null ? String(targetDoc.consultation_fee) : "0";
            }
          }
        }
      }

      return { ...prev, department: targetDeptName || "General", doctor_name: nextDoctor, consultation_fee: nextFee };
    });
  };

  const handleDoctorChange = (docName: string) => {
    setAppointmentForm((prev) => {
      let nextDept = prev.department;
      let nextFee = prev.consultation_fee;

      if (docName && doctors.length > 0) {
        const foundDoc = doctors.find(d => (d.doctor_name || "").toLowerCase() === docName.toLowerCase());
        if (foundDoc) {
          nextDept = foundDoc.department || prev.department;
          nextFee = foundDoc.consultation_fee != null ? String(foundDoc.consultation_fee) : prev.consultation_fee;
        }
      }

      return { ...prev, doctor_name: docName, department: nextDept, consultation_fee: nextFee };
    });
  };

  const loadRegistrationOps = async () => {
    try {
      const patientId = selectedPatient?.patient_id || "";
      const suffix = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : "";
      const [consentData, insuranceData] = await Promise.all([
        apiFetch<{ consents?: ConsentRecord[] }>(`/api/registration/consents${suffix}`),
        apiFetch<{ verifications?: InsuranceRecord[] }>(`/api/registration/insurance${suffix}`),
      ]);
      setConsents(consentData.consents || []);
      setInsuranceChecks(insuranceData.verifications || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load registration records.");
    }
  };

  useEffect(() => {
    void loadAppointments();
    void loadDepartmentOptions();
    void loadDoctorSuggestions();
    void loadRegistrationOps();
  }, []);

  useEffect(() => {
    apiFetch<{ configured?: boolean }>("/api/payments/razorpay/config")
      .then((data) => setIsRazorpayReady(data.configured !== false))
      .catch(() => setIsRazorpayReady(true));
  }, []);

  const handleAITriage = async () => {
    if (!symptomsText.trim()) {
      setNotice({ type: "warning", message: "Please enter patient symptoms first." });
      return;
    }
    setTriageLoading(true);
    try {
      // Build list of departments that actually have registered doctors
      const availableDepartments = Array.from(
        new Set([
          ...doctors.map((doc) => doc.department)
        ])
      ).filter(Boolean) as string[];

      const res = await apiFetch<{ department?: string; urgency?: string; reasoning?: string }>("/api/symptom-ai/triage", {
        method: "POST",
        body: JSON.stringify({ symptoms: symptomsText, available_departments: availableDepartments }),
      });
      if (res.department) {
        handleDepartmentChange(res.department);
      }
      setTriageResult({ urgency: res.urgency, reasoning: res.reasoning });
    } catch (error) {
      reportError(setNotice, error as { message?: string }, "Unable to get AI triage recommendation.");
    } finally {
      setTriageLoading(false);
    }
  };

  const ensureRazorpayConfigured = async () => {
    try {
      const config = await apiFetch<{ configured?: boolean }>("/api/payments/razorpay/config");
      const configured = config.configured !== false;
      setIsRazorpayReady(configured);
      if (!configured) {
        setNotice({ type: "warning", message: "Razorpay is not configured. Add keys in backend .env." });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  useEffect(() => {
    const defaultPatientName = patientFullName(selectedPatient);
    setAppointmentForm((prev) => ({
      ...prev,
      patient_id: selectedPatient?.patient_id || "",
      patient_name: defaultPatientName || prev.patient_name,
    }));
    setConsentForm((prev) => ({
      ...prev,
      patient_id: selectedPatient?.patient_id || "",
      patient_name: defaultPatientName || prev.patient_name,
    }));
    setInsuranceForm((prev) => ({
      ...prev,
      patient_id: selectedPatient?.patient_id || "",
      patient_name: defaultPatientName || prev.patient_name,
    }));
  }, [selectedPatient]);

  const handleAddDepartment = async () => {
    const departmentName = departmentInput.trim();
    if (!departmentName) {
      setNotice({ type: "warning", message: "Department name is required." });
      return;
    }
    setSavingDepartment(true);
    try {
      const data = await apiFetch<{ department_id: number; department_name?: string; already_exists?: boolean }>("/api/registration/departments", {
        method: "POST",
        body: JSON.stringify({ department_name: departmentName }),
      });
      setDepartmentInput("");
      await loadDepartmentOptions();
      if (data.already_exists) {
        setNotice({ type: "warning", message: `Department ${data.department_name || departmentName} already exists.` });
      } else {
        setNotice({ type: "success", message: `Department ${departmentName} added.` });
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to add department.");
    } finally {
      setSavingDepartment(false);
    }
  };

  const handleCreateAppointment = async () => {
    const patientName = appointmentForm.patient_name.trim() || patientFullName(selectedPatient);
    if (!patientName || !appointmentForm.appointment_date) {
      setNotice({ type: "warning", message: "Patient name and appointment date/time are required." });
      return;
    }
    setSavingAppointment(true);
    try {
      const data = await apiFetch<{ token_no: number }>("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: appointmentForm.patient_id.trim() || selectedPatient?.patient_id || undefined,
          patient_name: patientName,
          visit_type: appointmentForm.visit_type,
          department: appointmentForm.department.trim() || undefined,
          doctor_name: appointmentForm.doctor_name.trim() || undefined,
          appointment_date: appointmentForm.appointment_date,
          status: "checked_in",
          notes: appointmentForm.notes.trim() || undefined,
        }),
      });
      setAppointmentForm((prev) => ({
        ...DEFAULT_APPOINTMENT_FORM,
        patient_id: selectedPatient?.patient_id || "",
        patient_name: patientName,
        department: prev.department,
        doctor_name: prev.doctor_name,
      }));
      await loadAppointments();
      await loadDoctorSuggestions();
      setNotice({ type: "success", message: `Appointment scheduled. Token #${data.token_no}. Redirecting to queue...` });
      onNavigate?.("queue");
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to schedule appointment.");
    } finally {
      setSavingAppointment(false);
    }
  };

  const handleCreateAppointmentWithRazorpay = async () => {
    if (!(await ensureRazorpayConfigured())) {
      return;
    }
    const patientName = appointmentForm.patient_name.trim() || patientFullName(selectedPatient);
    if (!patientName || !appointmentForm.appointment_date) {
      setNotice({ type: "warning", message: "Patient name and appointment date/time are required." });
      return;
    }
    const consultationFee = Number(appointmentForm.consultation_fee) || 0;
    if (consultationFee <= 0) {
      setNotice({ type: "warning", message: "Consultation fee must be greater than zero for Razorpay payment." });
      return;
    }

    const appointmentPayload = {
      patient_id: appointmentForm.patient_id.trim() || selectedPatient?.patient_id || undefined,
      patient_name: patientName,
      visit_type: appointmentForm.visit_type,
      department: appointmentForm.department.trim() || undefined,
      doctor_name: appointmentForm.doctor_name.trim() || undefined,
      appointment_date: appointmentForm.appointment_date,
      notes: appointmentForm.notes.trim() || undefined,
    };

    setSavingAppointment(true);
    try {
      const order = await apiFetch<{
        key_id: string;
        order_id: string;
        amount: number;
        currency: string;
      }>("/api/appointments/razorpay/order", {
        method: "POST",
        body: JSON.stringify({
          amount: consultationFee,
          notes: {
            patient_name: appointmentPayload.patient_name,
            doctor_name: appointmentPayload.doctor_name || "",
            appointment_date: appointmentPayload.appointment_date,
          },
        }),
      });

      const paymentResult = await openRazorpayCheckout({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "HospAI Registration Desk",
        description: "Appointment Booking",
        order_id: order.order_id,
        prefill: {
          name: appointmentPayload.patient_name,
        },
        notes: {
          patient_id: appointmentPayload.patient_id || "",
        },
        theme: {
          color: "#0f766e",
        },
      });

      const verification = await apiFetch<{ token_no: number }>("/api/appointments/razorpay/verify", {
        method: "POST",
        body: JSON.stringify({
          amount: consultationFee,
          payment_mode: appointmentForm.payment_mode,
          appointment: appointmentPayload,
          razorpay_order_id: paymentResult.razorpay_order_id,
          razorpay_payment_id: paymentResult.razorpay_payment_id,
          razorpay_signature: paymentResult.razorpay_signature,
        }),
      });

      setAppointmentForm((prev) => ({
        ...DEFAULT_APPOINTMENT_FORM,
        patient_id: selectedPatient?.patient_id || "",
        patient_name: patientName,
        visit_type: prev.visit_type,
        department: prev.department,
        doctor_name: prev.doctor_name,
      }));
      await loadAppointments();
      await loadDoctorSuggestions();
      setNotice({ type: "success", message: `Appointment scheduled with Razorpay. Token #${verification.token_no}. Redirecting to queue...` });
      onNavigate?.("queue");
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to schedule appointment via Razorpay.");
    } finally {
      setSavingAppointment(false);
    }
  };

  const updateAppointmentStatus = async (appointmentId: number, status: string) => {
    try {
      await putAppointmentStatus(appointmentId, status);
      await loadAppointments();
      setNotice({ type: "success", message: `Token status updated to ${status.replace("_", " ")}.` });
      // Starting the visit hands the patient off to the doctor's consultation
      // desk; "completed" is only reachable from the appointment-out desk
      // itself, so there's nowhere further to send the operator for that one.
      if (status === "in_consultation") {
        onNavigate?.("doctor-prescription");
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update appointment status.");
    }
  };

  const handleSaveConsent = async () => {
    const patientName = consentForm.patient_name.trim() || patientFullName(selectedPatient);
    if (!patientName || !consentForm.signed_by.trim()) {
      setNotice({ type: "warning", message: "Patient name and signer are required for consent." });
      return;
    }
    setSavingConsent(true);
    try {
      const body = JSON.stringify({
        patient_id: consentForm.patient_id.trim() || selectedPatient?.patient_id || undefined,
        patient_name: patientName,
        consent_type: consentForm.consent_type,
        signed_by: consentForm.signed_by.trim(),
        relation_to_patient: consentForm.relation_to_patient.trim() || undefined,
      });
      if (editingConsentId != null) {
        await apiFetch(`/api/registration/consents/${editingConsentId}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/registration/consents", { method: "POST", body });
      }
      setConsentForm({
        ...DEFAULT_CONSENT_FORM,
        patient_id: selectedPatient?.patient_id || "",
        patient_name: patientName,
      });
      setEditingConsentId(null);
      await loadRegistrationOps();
      setNotice({ type: "success", message: editingConsentId != null ? "Consent updated." : "Digital consent recorded." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save consent.");
    } finally {
      setSavingConsent(false);
    }
  };

  const handleEditConsent = (consent: ConsentRecord) => {
    setEditingConsentId(consent.id);
    setConsentForm({
      patient_id: consent.patient_id || "",
      patient_name: consent.patient_name || "",
      consent_type: consent.consent_type || "general",
      signed_by: consent.signed_by || "",
      relation_to_patient: consent.relation_to_patient || "",
    });
  };

  const handleCancelConsentEdit = () => {
    setEditingConsentId(null);
    setConsentForm({
      ...DEFAULT_CONSENT_FORM,
      patient_id: selectedPatient?.patient_id || "",
      patient_name: patientFullName(selectedPatient),
    });
  };

  const handleSaveInsuranceVerification = async () => {
    const patientName = insuranceForm.patient_name.trim() || patientFullName(selectedPatient);
    if (!patientName || !insuranceForm.insurer_name.trim()) {
      setNotice({ type: "warning", message: "Patient name and insurer are required for insurance verification." });
      return;
    }
    setSavingInsurance(true);
    try {
      const body = JSON.stringify({
        patient_id: insuranceForm.patient_id.trim() || selectedPatient?.patient_id || undefined,
        patient_name: patientName,
        insurer_name: insuranceForm.insurer_name.trim(),
        policy_number: insuranceForm.policy_number.trim() || undefined,
        member_id: insuranceForm.member_id.trim() || undefined,
        verification_status: insuranceForm.verification_status,
        coverage_notes: insuranceForm.coverage_notes.trim() || undefined,
      });
      if (editingInsuranceId != null) {
        await apiFetch(`/api/registration/insurance/${editingInsuranceId}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/registration/insurance", { method: "POST", body });
      }
      setInsuranceForm({
        ...DEFAULT_INSURANCE_FORM,
        patient_id: selectedPatient?.patient_id || "",
        patient_name: patientName,
      });
      setEditingInsuranceId(null);
      await loadRegistrationOps();
      setNotice({ type: "success", message: editingInsuranceId != null ? "Insurance verification updated." : "Insurance verification saved." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save insurance verification.");
    } finally {
      setSavingInsurance(false);
    }
  };

  const handleEditInsurance = (check: InsuranceRecord) => {
    setEditingInsuranceId(check.id);
    setInsuranceForm({
      patient_id: check.patient_id || "",
      patient_name: check.patient_name || "",
      insurer_name: check.insurer_name || "",
      policy_number: check.policy_number || "",
      member_id: check.member_id || "",
      verification_status: check.verification_status || "pending",
      coverage_notes: check.coverage_notes || "",
    });
  };

  const handleCancelInsuranceEdit = () => {
    setEditingInsuranceId(null);
    setInsuranceForm({
      ...DEFAULT_INSURANCE_FORM,
      patient_id: selectedPatient?.patient_id || "",
      patient_name: patientFullName(selectedPatient),
    });
  };

  const appointmentInQueue = useMemo(
    () => appointments.filter((item) => ["scheduled", "checked_in", "in_consultation"].includes(item.status)),
    [appointments]
  );

  const appointmentOutActiveQueue = useMemo(
    () => appointments.filter((item) => ["checked_in", "in_consultation"].includes(item.status)),
    [appointments]
  );

  const appointmentOutCompletedQueue = useMemo(
    () => appointments.filter((item) => item.status === "completed"),
    [appointments]
  );

  const allDepartments = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach(d => {
      const name = (d.department_name || "").trim();
      if (name) map.set(name.toLowerCase(), name);
    });
    doctors.forEach(d => {
      const name = (d.department || "").trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), name);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [departments, doctors]);

  if (mode === "consent") {
    return (
      <section className="module-page">
        <div className="module-panel-head">
          <h3>Consent Desk</h3>
        </div>
        <div className="panel registration-desk-panel">
          <div className="grid-form">
            <Label>
              Patient Name
              <Input
                value={consentForm.patient_name}
                onChange={(event) => setConsentForm((prev) => ({ ...prev, patient_name: event.target.value }))}
                placeholder="Patient or guardian context"
              />
            </Label>
            <Label>
              Consent Type
              <Select
                value={consentForm.consent_type}
                onChange={(event) => setConsentForm((prev) => ({ ...prev, consent_type: event.target.value }))}
              >
                <option value="general">General</option>
                <option value="procedure">Procedure</option>
                <option value="privacy">Privacy</option>
                <option value="insurance">Insurance</option>
              </Select>
            </Label>
            <Label>
              Signed By
              <Input
                value={consentForm.signed_by}
                onChange={(event) => setConsentForm((prev) => ({ ...prev, signed_by: event.target.value }))}
                placeholder="Patient / Guardian"
              />
            </Label>
            <Label>
              Relation
              <Input
                value={consentForm.relation_to_patient}
                onChange={(event) => setConsentForm((prev) => ({ ...prev, relation_to_patient: event.target.value }))}
                placeholder="Self / Spouse / Parent"
              />
            </Label>
          </div>
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => void handleSaveConsent()} disabled={savingConsent}>
              {savingConsent ? "Saving Consent..." : editingConsentId != null ? "Update Consent" : "Save Consent"}
            </Button>
            {editingConsentId != null ? (
              <Button variant="ghost" type="button" onClick={handleCancelConsentEdit} disabled={savingConsent}>
                Cancel Edit
              </Button>
            ) : null}
          </div>
          {consents.slice(0, 10).map((consent) => (
            <div key={consent.id} className="module-inline-actions" style={{ justifyContent: "space-between" }}>
              <p className="muted">
                {consent.patient_name} · {consent.consent_type} · {consent.signed_by}
              </p>
              <Button variant="ghost" size="sm" type="button" onClick={() => handleEditConsent(consent)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mode === "insurance") {
    return (
      <section className="module-page">
        <div className="module-panel-head">
          <h3>Insurance Desk</h3>
        </div>
        <div className="panel registration-desk-panel">
          <div className="grid-form">
            <Label>
              Patient Name
              <Input
                value={insuranceForm.patient_name}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, patient_name: event.target.value }))}
                placeholder="Patient name"
              />
            </Label>
            <Label>
              Insurer
              <Input
                value={insuranceForm.insurer_name}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, insurer_name: event.target.value }))}
                placeholder="Insurance provider"
              />
            </Label>
            <Label>
              Policy Number
              <Input
                value={insuranceForm.policy_number}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, policy_number: event.target.value }))}
                placeholder="Policy no."
              />
            </Label>
            <Label>
              Member ID
              <Input
                value={insuranceForm.member_id}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, member_id: event.target.value }))}
                placeholder="Member ID"
              />
            </Label>
            <Label>
              Status
              <Select
                value={insuranceForm.verification_status}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, verification_status: event.target.value }))}
              >
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Label>
            <Label className="span-2">
              Coverage Notes
              <Textarea
                value={insuranceForm.coverage_notes}
                onChange={(event) => setInsuranceForm((prev) => ({ ...prev, coverage_notes: event.target.value }))}
                rows={2}
              />
            </Label>
          </div>
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => void handleSaveInsuranceVerification()} disabled={savingInsurance}>
              {savingInsurance ? "Saving Verification..." : editingInsuranceId != null ? "Update Verification" : "Save Verification"}
            </Button>
            {editingInsuranceId != null ? (
              <Button variant="ghost" type="button" onClick={handleCancelInsuranceEdit} disabled={savingInsurance}>
                Cancel Edit
              </Button>
            ) : null}
          </div>
          {insuranceChecks.slice(0, 10).map((check) => (
            <div key={check.id} className="module-inline-actions" style={{ justifyContent: "space-between" }}>
              <p className="muted">
                {check.patient_name} · {check.insurer_name} · {check.verification_status}
              </p>
              <Button variant="ghost" size="sm" type="button" onClick={() => handleEditInsurance(check)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const queue = mode === "appointment-in" ? appointmentInQueue : appointmentOutActiveQueue;

  return (
    <section className="module-page">
      
      {mode === "appointment-in" && (
        <div className="module-panel-head">
          <h3>Appointment In Desk</h3>
        </div>
      )}

      {mode === "appointment-out" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <StatCard label="Completed Consultations Today" value={appointmentOutCompletedQueue.length} />
        </div>
      )}


      {mode === "appointment-in" ? (
        <div className="panel registration-desk-panel">
          <h4>Schedule Appointment</h4>
          <div className="grid-form">
            <Label>
              Patient ID
              <PatientAutocomplete
                value={appointmentForm.patient_id}
                onChange={(val) => setAppointmentForm((prev) => ({ ...prev, patient_id: val }))}
                onSelect={(patient) => setAppointmentForm((prev) => ({ ...prev, patient_id: patient.patient_id, patient_name: patientFullName(patient) }))}
                placeholder="Search by ID (last 4 digits)"
              />
            </Label>
            <Label>
              Patient Name
              <PatientAutocomplete
                value={appointmentForm.patient_name}
                onChange={(val) => setAppointmentForm((prev) => ({ ...prev, patient_name: val }))}
                onSelect={(patient) => setAppointmentForm((prev) => ({ ...prev, patient_id: patient.patient_id, patient_name: patientFullName(patient) }))}
                placeholder="Walk-in or existing patient"
              />
            </Label>
            <Label>
              Visit Type
              <Select
                value={appointmentForm.visit_type}
                onChange={(event) => setAppointmentForm((prev) => ({ ...prev, visit_type: event.target.value }))}
              >
                <option value="OP">OP</option>
                <option value="IP">IP</option>
              </Select>
            </Label>
            <Label className="span-2">
              Patient Symptoms (AI Triage)
              <div style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
                <Textarea
                  value={symptomsText}
                  onChange={(e) => setSymptomsText(e.target.value)}
                  placeholder="Describe patient symptoms here to auto-assign department..."
                  rows={2}
                />
                <Button variant="secondary" type="button" onClick={() => void handleAITriage()} disabled={triageLoading}>
                  {triageLoading ? "Analyzing..." : "🪄 AI Triage"}
                </Button>
                {triageResult && (
                  <div className="notice success">
                    <strong>Urgency:</strong> {triageResult.urgency}<br />
                    <strong>Reasoning:</strong> {triageResult.reasoning}
                  </div>
                )}
              </div>
            </Label>
            <Label>
              Department
              <Select
                value={appointmentForm.department}
                onChange={(event) => handleDepartmentChange(event.target.value)}
              >
                <option value="">Select department</option>
                {allDepartments.map((deptName) => (
                  <option key={deptName} value={deptName}>
                    {deptName}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Doctor
              <Input
                value={appointmentForm.doctor_name}
                onChange={(event) => handleDoctorChange(event.target.value)}
                list="registration-doctors"
                placeholder="Type doctor name (guest allowed)"
              />
              <datalist id="registration-doctors">
                {doctorSuggestions.map((doctor) => (
                  <option key={doctor} value={doctor} />
                ))}
              </datalist>
            </Label>
            <Label>
              Appointment Time
              <Input
                type="datetime-local"
                value={appointmentForm.appointment_date}
                onChange={(event) => setAppointmentForm((prev) => ({ ...prev, appointment_date: event.target.value }))}
              />
            </Label>
            <Label>
              Consultation Fee
              <Input
                type="number"
                min={0}
                value={appointmentForm.consultation_fee}
                onChange={(event) => setAppointmentForm((prev) => ({ ...prev, consultation_fee: event.target.value }))}
                placeholder="Consultation amount"
              />
            </Label>
            <Label>
              Payment Mode
              <Select
                value={appointmentForm.payment_mode}
                onChange={(event) => setAppointmentForm((prev) => ({ ...prev, payment_mode: event.target.value }))}
              >
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
                <option value="cash">Cash</option>
              </Select>
            </Label>
            <Label className="span-2">
              Notes
              <Textarea
                value={appointmentForm.notes}
                onChange={(event) => setAppointmentForm((prev) => ({ ...prev, notes: event.target.value }))}
                rows={2}
              />
            </Label>
          </div>
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={() => void handleCreateAppointment()} disabled={savingAppointment}>
              {savingAppointment ? "Scheduling..." : "Schedule & Assign Token"}
            </Button>
            <Button variant="primary" type="button" onClick={() => void handleCreateAppointmentWithRazorpay()} disabled={savingAppointment || !isRazorpayReady}>
              {savingAppointment ? "Processing..." : "Pay via Razorpay & Schedule"}
            </Button>
          </div>
          {!isRazorpayReady ? <p className="muted">Razorpay payments are disabled until backend keys are configured.</p> : null}
        </div>
      ) : null}

      {(mode === "appointment-in" || mode === "appointment-out") ? (
      <div className="panel registration-desk-panel">
        <h4>{mode === "appointment-in" ? "Appointment Queue (In)" : "Active Consultations"}</h4>
        {appointmentsLoading ? <p className="muted">Loading queue...</p> : null}
        {!appointmentsLoading && queue.length === 0 ? (
          <div className="module-empty-state">
            <span className="module-empty-state-icon">
              <FiCalendar aria-hidden />
            </span>
            <p className="module-empty-state-title">No appointments found for today</p>
            <p className="module-empty-state-hint">
              {mode === "appointment-in"
                ? "Schedule an appointment above to assign a token and send the patient to the queue."
                : "Checked-in patients will appear here once they're ready to be marked out."}
            </p>
          </div>
        ) : null}
        {!appointmentsLoading && queue.length > 0 ? (
          <div className="queue-card-list">
            {queue.map((appointment) => (
              <AppointmentQueueCard
                key={appointment.id}
                appointment={appointment}
                actions={
                  <>
                    {mode === "appointment-in" && appointment.status === "scheduled" ? (
                      <Button type="button" size="sm" onClick={() => void updateAppointmentStatus(appointment.id, "checked_in")}>
                        Check In
                      </Button>
                    ) : null}
                    {mode === "appointment-in" && appointment.status === "checked_in" ? (
                      <Button type="button" size="sm" onClick={() => void updateAppointmentStatus(appointment.id, "in_consultation")}>
                        Start Visit
                      </Button>
                    ) : null}
                    {mode === "appointment-out" && (appointment.status === "checked_in" || appointment.status === "in_consultation") ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => void updateAppointmentStatus(appointment.id, "completed")}>
                        Complete
                      </Button>
                    ) : null}
                    {(mode === "appointment-in" || mode === "appointment-out") && appointment.status !== "completed" && appointment.status !== "cancelled" ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void updateAppointmentStatus(appointment.id, "cancelled")}>
                        Cancel
                      </Button>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        ) : null}
      </div>
      ) : null}

      {mode === "appointment-out" && (
        <div className="panel registration-desk-panel">
          <h4>Completed Consultations</h4>
          {appointmentOutCompletedQueue.length === 0 ? (
            <div className="module-empty-state">
              <span className="module-empty-state-icon">
                <FiCalendar aria-hidden />
              </span>
              <p className="module-empty-state-title">No completed consultations today</p>
            </div>
          ) : (
            <div className="queue-card-list">
              {appointmentOutCompletedQueue.map((appointment) => (
                <AppointmentQueueCard
                  key={appointment.id}
                  appointment={appointment}
                  actions={null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
