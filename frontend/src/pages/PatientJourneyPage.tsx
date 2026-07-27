import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import PatientAutocomplete from "../components/PatientAutocomplete";
import StatCard from "../components/StatCard";
import { Label } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Notice, Patient, PatientJourney } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

const STAGE_LABELS: Record<string, string> = {
  registration: "Registration",
  queue: "Queue",
  consultation: "Consultation",
  billing: "Billing",
  lab: "Lab",
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

export default function PatientJourneyPage({ setNotice }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [journey, setJourney] = useState<PatientJourney | null>(null);
  const [loading, setLoading] = useState(false);

  const loadJourney = async (patient: Patient) => {
    setLoading(true);
    try {
      const data = await apiFetch<PatientJourney>(`/api/patients/${encodeURIComponent(patient.patient_id)}/journey`);
      setJourney(data);
    } catch (error) {
      setJourney(null);
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load patient journey.");
    } finally {
      setLoading(false);
    }
  };

  const patient = journey?.patient;

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <h3>Patient Journey</h3>
      </div>

      <div className="panel">
        <Label>
          Search Patient
          <PatientAutocomplete
            value={searchTerm}
            onChange={setSearchTerm}
            onSelect={(selected) => {
              setSearchTerm(`${selected.name} ${selected.last_name || ""}`.trim());
              void loadJourney(selected);
            }}
            placeholder="Search by name, phone, or patient ID"
            ariaLabel="Patient journey search"
          />
        </Label>
      </div>

      {loading ? <p className="muted">Loading journey...</p> : null}

      {!loading && patient ? (
        <div className="panel">
          <h4>
            {patient.name} {patient.last_name || ""}
          </h4>
          <p className="muted">
            {patient.patient_id} · Age {patient.age ?? "-"} · {patient.gender || "-"}
          </p>
        </div>
      ) : null}

      {!loading && journey ? (
        <div className="stat-grid module-stat-grid">
          <StatCard label="Consultation Fees" value={formatCurrency(journey.summary.consultation_billed)} />
          <StatCard label="Lab / Diagnostics Fees" value={formatCurrency(journey.summary.lab_billed)} />
          <StatCard label="Total Paid" value={formatCurrency(journey.summary.total_paid)} />
          <StatCard label="Total Due" value={formatCurrency(journey.summary.total_due)} />
        </div>
      ) : null}

      {!loading && journey && journey.events.length > 0 ? (
        <div className="panel">
          <div className="module-panel-head">
            <h4>Timeline</h4>
          </div>
          <div className="module-mobile-list" style={{ display: "grid" }}>
            {journey.events.map((event, index) => (
              <article className="module-mobile-card" key={`${event.stage}-${index}`}>
                <h4>{STAGE_LABELS[event.stage] || event.stage}</h4>
                <p>{event.label}</p>
                <p className="muted">{formatDateTime(event.timestamp)}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && journey && journey.events.length === 0 ? (
        <p className="muted">No recorded activity for this patient yet.</p>
      ) : null}
    </section>
  );
}
