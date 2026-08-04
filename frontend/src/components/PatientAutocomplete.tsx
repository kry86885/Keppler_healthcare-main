import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Input } from "./ui";
import { apiFetch } from "../lib/api";
import type { Patient } from "../types";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (patient: Patient) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

export default function PatientAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  ariaLabel,
  disabled,
}: Props) {
  const [suggestions, setSuggestions] = useState<Patient[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const latestQueryRef = useRef("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const term = value.trim();
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (term.length < 2) {
      latestQueryRef.current = "";
      setSuggestions([]);
      setOpen(false);
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      void runSearch(term);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const runSearch = async (term: string) => {
    latestQueryRef.current = term;
    try {
      const data = await apiFetch<{ patients?: Patient[] }>(
        `/api/patients?q=${encodeURIComponent(term)}`,
      );
      if (latestQueryRef.current !== term) return;
      setSuggestions((data.patients || []).slice(0, 8));
      setOpen(true);
      setHighlightedIndex(-1);
    } catch {
      if (latestQueryRef.current !== term) return;
      setSuggestions([]);
    }
  };

  const selectPatient = (patient: Patient) => {
    onChange(patient.patient_id);
    onSelect?.(patient);
    setOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    } else if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      selectPatient(suggestions[highlightedIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="patient-autocomplete">
      <Input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && suggestions.length > 0 ? (
        <ul className="patient-autocomplete-list" role="listbox">
          {suggestions.map((patient, index) => (
            <li
              key={patient.patient_id}
              role="option"
              aria-selected={index === highlightedIndex}
              className={
                index === highlightedIndex
                  ? "patient-autocomplete-option highlighted"
                  : "patient-autocomplete-option"
              }
              onMouseDown={(event) => {
                event.preventDefault();
                selectPatient(patient);
              }}
            >
              <span>
                {[patient.name, patient.last_name].filter(Boolean).join(" ") ||
                  patient.patient_id}
              </span>
              <span className="muted">
                {patient.patient_id}
                {patient.phone ? ` · ${patient.phone}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
