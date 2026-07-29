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



  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const tagName = (event.target as HTMLElement).tagName;
    if (event.key === "Enter" && tagName !== "TEXTAREA" && tagName !== "BUTTON") {
      event.preventDefault();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      ...form,
    };
    const createdPatient = await onCreate(payload, setForm, setDuplicateInfo, refreshPatientId);
    if (!createdPatient?.patient_id) return;

    setNotice({
      type: "success",
      message: `Patient ${createdPatient.patient_id} registered.`,
    });

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
