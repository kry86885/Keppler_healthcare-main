import type { Patient } from "../types";
import { Badge, ListItemActions, ListItemContent } from "./ui";

type Props = {
  patient: Patient;
};

export default function PatientCard({ patient }: Props) {
  return (
    <article className="patient-card">
      <ListItemContent className="patient-card-main">
        <h4>
          {patient.name} {patient.middle_name || ""} {patient.last_name || ""}
        </h4>
        <p className="patient-card-meta">
          ID: {patient.patient_id} · {patient.gender || "-"} · Age {patient.age || "-"}
        </p>
      </ListItemContent>
      <ListItemActions className="patient-card-side">
        <Badge className="chip" variant="outline">
          {patient.phone || "No phone"}
        </Badge>
      </ListItemActions>
    </article>
  );
}
