import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, KeyboardEvent, SetStateAction } from "react";
import { Alert, Button, Checkbox, Input, Label, Select, Textarea } from "../components/ui";
import { EMPTY_PATIENT_FORM } from "../lib/constants";
import { apiFetch, reportError } from "../lib/api";
import type { Notice, PatientForm } from "../types";

type Props = {
  onCreate: (
    payload: Record<string, unknown>,
    setForm: Dispatch<SetStateAction<PatientForm>>,
    setDuplicateInfo: Dispatch<SetStateAction<any>>,
    refreshPatientId: () => Promise<void>
  ) => Promise<{ patient_id: string; admission_id?: string } | null>;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate: (page: string) => void;
};

type Department = {
  id: number;
  department_name?: string;
};

const DEFAULT_APPOINTMENT_FORM = {
  create_appointment: true,
  visit_type: "OP",
  department: "",
  doctor_name: "",
  appointment_date: "",
  consultation_fee: "",
};

function nowLocalDatetimeString(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function calculateAgeFromDob(dob: string): string {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "";

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const birthdayPassed = monthDiff > 0 || (monthDiff === 0 && today.getDate() >= birthDate.getDate());
  if (!birthdayPassed) {
    age -= 1;
  }
  if (age < 0) return "";
  return String(age);
}

export default function AddPatientPage({ onCreate, setNotice, onNavigate }: Props) {
  const registrationFormId = "patient-registration-form";
  const [form, setForm] = useState<PatientForm>(EMPTY_PATIENT_FORM);
  const [patientId, setPatientId] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<any>(null);
  const [appointmentForm, setAppointmentForm] = useState({ ...DEFAULT_APPOINTMENT_FORM, appointment_date: nowLocalDatetimeString() });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctorSuggestions, setDoctorSuggestions] = useState<string[]>([]);

  const refreshPatientId = async () => {
    try {
      const data = await apiFetch<{ patient_id?: string }>("/api/patients/next-id");
      setPatientId(data.patient_id || "");
    } catch {
      setPatientId("");
    }
  };

  useEffect(() => {
    refreshPatientId();
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("ocr_demographics");
    if (!raw) return;
    sessionStorage.removeItem("ocr_demographics");
    try {
      const extracted = JSON.parse(raw) as { dob?: string; age?: string; notes?: string };
      setForm((prev) => ({
        ...prev,
        dob: extracted.dob || prev.dob,
        age: extracted.age || prev.age,
        symptoms: extracted.notes ? [extracted.notes, prev.symptoms].filter(Boolean).join("\n\n") : prev.symptoms,
      }));
    } catch {
      // malformed sessionStorage payload — ignore and leave the form blank
    }
  }, []);

  useEffect(() => {
    apiFetch<{ departments?: Department[] }>("/api/registration/departments")
      .then((data) => setDepartments(data.departments || []))
      .catch(() => setDepartments([]));
    apiFetch<{ schedules?: { doctor_name?: string | null }[] }>("/api/op/doctor-schedules")
      .then((data) => {
        const names = new Set<string>();
        (data.schedules || []).forEach((row) => {
          const value = (row.doctor_name || "").trim();
          if (value) names.add(value);
        });
        setDoctorSuggestions(Array.from(names).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => setDoctorSuggestions([]));
  }, []);

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const tagName = (event.target as HTMLElement).tagName;
    if (event.key === "Enter" && tagName !== "TEXTAREA" && tagName !== "BUTTON") {
      event.preventDefault();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const allergies = [form.allergy1, form.allergy2, form.allergy3].filter(Boolean).join(", ");
    const payload: Record<string, unknown> = {
      ...form,
      allergies,
    };
    delete payload.allergy1;
    delete payload.allergy2;
    delete payload.allergy3;
    const patientName = `${form.name} ${form.middle_name || ""} ${form.last_name}`.trim();
    const createdPatient = await onCreate(payload, setForm, setDuplicateInfo, refreshPatientId);
    if (!createdPatient?.patient_id) return;

    if (appointmentForm.create_appointment && appointmentForm.appointment_date) {
      const consultationFee = Number(appointmentForm.consultation_fee);
      try {
        const appointmentData = await apiFetch<{ token_no: number }>("/api/appointments", {
          method: "POST",
          body: JSON.stringify({
            patient_id: createdPatient.patient_id,
            patient_name: patientName,
            visit_type: appointmentForm.visit_type,
            department: appointmentForm.department.trim() || undefined,
            doctor_name: appointmentForm.doctor_name.trim() || undefined,
            appointment_date: appointmentForm.appointment_date,
          }),
        });
        if (!Number.isNaN(consultationFee) && consultationFee > 0) {
          try {
            await apiFetch("/api/billing/invoices", {
              method: "POST",
              body: JSON.stringify({
                patient_id: createdPatient.patient_id,
                module: "OP",
                doctor_name: appointmentForm.doctor_name.trim() || undefined,
                total_amount: consultationFee,
                payment_status: "due",
              }),
            });
          } catch (invoiceError) {
            reportError(
              setNotice,
              invoiceError as { message?: string; status?: number },
              "Appointment scheduled, but billing the consultation fee failed. Raise it manually from Billing."
            );
          }
        }
        setNotice({
          type: "success",
          message: `Patient ${createdPatient.patient_id} registered. Token #${appointmentData.token_no} scheduled, consultation fee billed.`,
        });
      } catch (error) {
        reportError(
          setNotice,
          error as { message?: string; status?: number },
          "Patient registered, but scheduling the appointment failed. Use Appointment In Desk to retry."
        );
      }
    }

    setAppointmentForm({ ...DEFAULT_APPOINTMENT_FORM, appointment_date: nowLocalDatetimeString() });
    onNavigate("queue");
  };

  const handleChange = (field: keyof PatientForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = field === "pregnant" ? (event.target as HTMLInputElement).checked : event.target.value;
    setForm((prev) => {
      if (field === "dob") {
        return {
          ...prev,
          dob: typeof value === "string" ? value : prev.dob,
          age: typeof value === "string" ? calculateAgeFromDob(value) : prev.age,
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleClearForm = () => {
    setForm(EMPTY_PATIENT_FORM);
    setDuplicateInfo(null);
    void refreshPatientId();
    setAppointmentForm({ ...DEFAULT_APPOINTMENT_FORM, appointment_date: nowLocalDatetimeString() });
  };

  return (
    <section className="form-layout">
      <div className="panel">
        <h3>Patient Registration</h3>
        <p className="muted">Patient ID: {patientId || "Will be generated on save"}</p>
        {duplicateInfo && (
          <Alert variant="warning">
            Possible duplicate found: {duplicateInfo.name} {duplicateInfo.last_name} (ID: {duplicateInfo.patient_id})
          </Alert>
        )}
        <form id={registrationFormId} className="grid-form patient-grid-form" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          <Label>
            First Name
            <Input value={form.name} onChange={handleChange("name")} required />
          </Label>
          <Label>
            Middle Name
            <Input value={form.middle_name} onChange={handleChange("middle_name")} />
          </Label>
          <Label>
            Last Name
            <Input value={form.last_name} onChange={handleChange("last_name")} required />
          </Label>
          <Label>
            Date of Birth
            <Input type="date" value={form.dob} onChange={handleChange("dob")} />
          </Label>
          <Label>
            Age
            <Input type="number" value={form.age} onChange={handleChange("age")} />
          </Label>
          <Label>
            Phone
            <Input value={form.phone} onChange={handleChange("phone")} />
          </Label>
          <Label>
            Weight (kg)
            <Input type="number" value={form.weight} onChange={handleChange("weight")} />
          </Label>
          <Label>
            Height (cm)
            <Input type="number" value={form.height} onChange={handleChange("height")} />
          </Label>
          <Label>
            Gender
            <Select value={form.gender} onChange={handleChange("gender")}>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
          </Label>
          <Label className="checkbox">
            <Checkbox checked={form.pregnant} onChange={handleChange("pregnant")} />
            Pregnant
          </Label>
          <Label>
            Allergy 1
            <Input value={form.allergy1} onChange={handleChange("allergy1")} placeholder="e.g., Penicillin" />
          </Label>
          <Label>
            Allergy 2
            <Input value={form.allergy2} onChange={handleChange("allergy2")} placeholder="e.g., Gluten" />
          </Label>
          <Label>
            Allergy 3
            <Input value={form.allergy3} onChange={handleChange("allergy3")} placeholder="e.g., Pollen" />
          </Label>
          <Label className="span-2">
            Symptoms
            <Textarea value={form.symptoms} onChange={handleChange("symptoms")} rows={3} />
          </Label>

          <Label className="checkbox span-2">
            <Checkbox
              checked={appointmentForm.create_appointment}
              onChange={(event) => setAppointmentForm((prev) => ({ ...prev, create_appointment: event.target.checked }))}
            />
            Also schedule an appointment and send to queue
          </Label>
          {appointmentForm.create_appointment ? (
            <>
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
              <Label>
                Department
                <Select
                  value={appointmentForm.department}
                  onChange={(event) => setAppointmentForm((prev) => ({ ...prev, department: event.target.value }))}
                >
                  <option value="">Select department</option>
                  {departments.map((department) => {
                    const name = (department.department_name || "").trim();
                    if (!name) return null;
                    return (
                      <option key={department.id} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </Select>
              </Label>
              <Label>
                Doctor
                <Input
                  value={appointmentForm.doctor_name}
                  onChange={(event) => setAppointmentForm((prev) => ({ ...prev, doctor_name: event.target.value }))}
                  list="add-patient-doctors"
                  placeholder="Type doctor name (guest allowed)"
                />
                <datalist id="add-patient-doctors">
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
                  min="1"
                  step="0.01"
                  required
                  value={appointmentForm.consultation_fee}
                  onChange={(event) => setAppointmentForm((prev) => ({ ...prev, consultation_fee: event.target.value }))}
                  placeholder="Consultation amount"
                />
              </Label>
            </>
          ) : null}
        </form>

        <div className="form-actions patient-form-actions patient-actions-bottom">
          <Button variant="primary" type="submit" form={registrationFormId}>
            Register Patient
          </Button>
          <Button variant="secondary" type="button" onClick={handleClearForm}>
            Clear
          </Button>
        </div>
      </div>
    </section>
  );
}
