import { FiCheck } from "react-icons/fi";

type JourneyStepId = "add" | "appointment-in" | "queue" | "doctor-prescription";

type JourneyStep = {
  id: JourneyStepId;
  label: string;
  hint: string;
};

const STEPS: JourneyStep[] = [
  { id: "add", label: "Register", hint: "Capture patient details" },
  { id: "appointment-in", label: "Book Appointment", hint: "Assign doctor & token" },
  { id: "queue", label: "Queue", hint: "Track waiting status" },
  { id: "doctor-prescription", label: "Consultation", hint: "Doctor visit & prescription" },
];

type Props = {
  current: JourneyStepId;
  onNavigate?: (page: string) => void;
};

export default function PatientJourneySteps({ current, onNavigate }: Props) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <nav className="journey-steps" aria-label="Patient journey progress">
      {STEPS.map((step, index) => {
        const status = index < currentIndex ? "completed" : index === currentIndex ? "active" : "upcoming";
        const clickable = Boolean(onNavigate) && status === "completed";

        return (
          <div className="journey-step-wrap" key={step.id}>
            <div
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={`journey-step journey-step-${status} ${clickable ? "journey-step-clickable" : ""}`}
              onClick={clickable ? () => onNavigate?.(step.id) : undefined}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onNavigate?.(step.id);
                      }
                    }
                  : undefined
              }
            >
              <span className="journey-step-circle">{status === "completed" ? <FiCheck aria-hidden /> : index + 1}</span>
              <span className="journey-step-text">
                <span className="journey-step-label">{step.label}</span>
                <span className="journey-step-hint">{step.hint}</span>
              </span>
            </div>
            {index < STEPS.length - 1 ? <span className={`journey-step-connector ${index < currentIndex ? "filled" : ""}`} /> : null}
          </div>
        );
      })}
    </nav>
  );
}
