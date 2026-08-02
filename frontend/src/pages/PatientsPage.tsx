import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { FiEye, FiTrash2 } from "react-icons/fi";
import MarkdownReport from "../components/MarkdownReport";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input, Select, Table, TableCell, TableHead, TableRow, Tabs, TabsContent, TabsTrigger, Textarea } from "../components/ui";
import { API_BASE, SUPPORTED_DOCUMENT_ACCEPT, SUPPORTED_DOCUMENT_EXTENSIONS } from "../lib/constants";
import { apiFetch, reportError, withAuthHeaders } from "../lib/api";
import { formatDate, formatDateTimeIST, getISTDateTimeKey, getTimestamp, stripUploadTimestampPrefix } from "../lib/format";
import type { Admission, BedAllocation, Certificate, DocumentItem, Encounter, MedicationSchedule, Notice, ObservationNote, Patient, PatientMovement } from "../types";

type Props = {
  patients: Patient[];
  onSelect: (patient: Patient | null) => void;
  onDelete: (patientId: string) => Promise<void>;
  onPatientUpdated: (patientId?: string) => Promise<void>;
  onExportCsv: (query?: string) => Promise<void>;
  selectedPatient: Patient | null;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  canEdit: boolean;
  canDelete: boolean;
  canReadBilling: boolean;
  canReadLab: boolean;
  ocrLanguage: string;
  languages: Record<string, string>;
  refreshToken: number;
};

const IMAGE_NAME_PATTERN = /\.(png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i;
type DeleteTarget = { patientId: string; label: string };
type DeleteDocumentTarget = { id: number; label: string };
type PatientInvoice = {
  id: number;
  invoice_no?: string;
  module?: string;
  total_amount?: number;
  paid_amount?: number;
  due_amount?: number;
  payment_status?: string;
  created_at?: string;
};
type PatientDiagnostic = {
  id: number;
  invoice_no?: string;
  test_name?: string;
  amount?: number;
  paid_amount?: number;
  due_amount?: number;
  status?: string;
  created_at?: string;
};

function SavedDocumentPreview({ doc }: { doc: DocumentItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setError("");
    setUrl(null);

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/documents/${doc.id}/file`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("preview unavailable");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setError("Original file preview unavailable.");
      }
    };
    void load();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);

  if (error) return <p className="muted">{error}</p>;
  if (!url) return <p className="muted">Loading file preview...</p>;

  const mime = (doc.mime_type || "").toLowerCase();
  const name = (doc.file_name || doc.file_path || "").toLowerCase();
  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
  const isImage = mime.startsWith("image/") || IMAGE_NAME_PATTERN.test(name);

  if (isImage) return <img className="ocr-source-image" src={url} alt={doc.file_name || "Document"} />;
  if (isPdf) return <iframe className="ocr-source-pdf" src={url} title={`Document ${doc.id}`} />;

  return (
    <a className="link" href={url} target="_blank" rel="noreferrer">
      Open document
    </a>
  );
}

export default function PatientsPage({
  patients,
  onSelect,
  onDelete,
  onPatientUpdated,
  onExportCsv,
  selectedPatient,
  setNotice,
  canEdit,
  canDelete,
  canReadBilling,
  canReadLab,
  ocrLanguage,
  languages,
  refreshToken,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deletingPatient, setDeletingPatient] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const latestQueryRef = useRef("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) {
      latestQueryRef.current = "";
      setResults([]);
      setSearched(false);
      setActiveQuery("");
      setLoading(false);
      return;
    }

    latestQueryRef.current = trimmed;
    setActiveQuery(trimmed);
    setLoading(true);
    setSearched(true);
    try {
      const data = await apiFetch<{ patients?: Patient[] }>(`/api/patients?q=${encodeURIComponent(trimmed)}`);
      if (latestQueryRef.current !== trimmed) return;
      setResults(data.patients || []);
    } catch (error) {
      if (latestQueryRef.current !== trimmed) return;
      setResults([]);
      reportError(setNotice, error as { message?: string; status?: number }, "Search failed.");
    } finally {
      if (latestQueryRef.current === trimmed) {
        setLoading(false);
      }
    }
  };

  const handleSearch = async () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    await runSearch(query);
  };

  useEffect(() => {
    const term = query.trim();
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (!term) {
      void runSearch("");
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
  }, [query]);

  const handleClearSearch = () => {
    setQuery("");
    setResults([]);
    setSearched(false);
    setActiveQuery("");
    setLoading(false);
    latestQueryRef.current = "";
  };

  const trimmedQuery = query.trim();
  const displayPatients = trimmedQuery ? (activeQuery === trimmedQuery ? results : []) : patients;
  const handleConfirmDeletePatient = async () => {
    if (!deleteTarget) return;
    setDeletingPatient(true);
    try {
      await onDelete(deleteTarget.patientId);
      setDeleteTarget(null);
    } finally {
      setDeletingPatient(false);
    }
  };

  return (
    <section className="patient-page">
      <div className="patient-header panel">
        <div>
          <h3>Patients</h3>
          <p className="muted">Search, review, and manage patient records.</p>
        </div>
        <div className="patient-toolbar">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="Search by name, phone, or ID"
          />
          <Button variant="primary" onClick={() => void handleSearch()}>
            Search
          </Button>
          <Button variant="secondary" onClick={handleClearSearch}>
            Clear
          </Button>
          <Button variant="secondary" onClick={() => void onExportCsv(query)}>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="panel">
        <div className="list-meta">
          <p className="muted">
            {query.trim()
              ? `Showing ${displayPatients.length} search result${displayPatients.length === 1 ? "" : "s"}.`
              : `Showing ${displayPatients.length} patient${displayPatients.length === 1 ? "" : "s"}.`}
          </p>
          {loading && <Badge>Searching</Badge>}
        </div>

        <div className="overflow-x-auto w-full">
          <Table className="patient-list-table">
            <TableHead>
              <TableCell>Patient</TableCell>
              <TableCell className="text-center">Age</TableCell>
              <TableCell className="text-center">Gender</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell className="text-center">Actions</TableCell>
              <TableCell>Created</TableCell>
            </TableHead>
            {displayPatients.map((patient) => {
              const expanded = selectedPatient?.patient_id === patient.patient_id;
              return (
                <Fragment key={patient.patient_id}>
                  <TableRow className={`hover:bg-muted/50 ${expanded ? "active" : ""}`}>
                    <TableCell>
                      <div className="font-medium text-foreground">{patient.name} {patient.last_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{patient.patient_id}</div>
                    </TableCell>
                    <TableCell className="text-center">{patient.age || "—"}</TableCell>
                    <TableCell className="text-center">{patient.gender || "—"}</TableCell>
                    <TableCell>{patient.phone || "—"}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-muted-foreground hover:text-foreground flex items-center gap-1"
                          onClick={() => onSelect(expanded ? null : patient)}
                          title={expanded ? "Hide details" : "View details"}
                        >
                          <FiEye className="h-4 w-4" />
                          <span>View</span>
                        </Button>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-destructive hover:bg-destructive/10 flex items-center gap-1"
                            onClick={() =>
                              setDeleteTarget({
                                patientId: patient.patient_id,
                                label: `${patient.name} ${patient.last_name || ""}`.trim() || patient.patient_id,
                              })
                            }
                            title="Delete patient"
                          >
                            <FiTrash2 className="h-4 w-4" />
                            <span>Delete</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDateTimeIST(patient.created_at)}</TableCell>
                  </TableRow>
                  {expanded && (
                    <div className="table-row-expand">
                      <PatientDetail
                        patientRef={patient}
                        setNotice={setNotice}
                        canEdit={canEdit}
                        canReadBilling={canReadBilling}
                        canReadLab={canReadLab}
                        ocrLanguage={ocrLanguage}
                        languages={languages}
                        canDelete={canDelete}
                        onRequestDelete={(fullPatient) =>
                          setDeleteTarget({
                            patientId: fullPatient.patient_id,
                            label: `${fullPatient.name} ${fullPatient.last_name || ""}`.trim() || fullPatient.patient_id,
                          })
                        }
                        onPatientUpdated={onPatientUpdated}
                        refreshToken={refreshToken}
                      />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </Table>
        </div>

        <div className="module-mobile-list patient-list-mobile" aria-label="Patient list cards">
          {displayPatients.map((patient) => {
            const expanded = selectedPatient?.patient_id === patient.patient_id;
            return (
              <article className="module-mobile-card" key={`mobile-${patient.patient_id}`}>
                <h4>{patient.name} {patient.last_name}</h4>
                <p><strong>Age:</strong> {patient.age || "-"}</p>
                <p><strong>Gender:</strong> {patient.gender || "-"}</p>
                <p><strong>Phone:</strong> {patient.phone || "-"}</p>
                <p><strong>Created:</strong> {formatDateTimeIST(patient.created_at)}</p>
                <div className="module-card-actions">
                  <Button type="button" size="sm" onClick={() => onSelect(expanded ? null : patient)}>
                    {expanded ? "Hide" : "View"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      setDeleteTarget({
                        patientId: patient.patient_id,
                        label: `${patient.name} ${patient.last_name || ""}`.trim() || patient.patient_id,
                      })
                    }
                    disabled={!canDelete}
                    title={!canDelete ? "Only Owner / MD / CEO can delete patients." : ""}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        {!loading && searched && displayPatients.length === 0 && <p className="muted">No patients found.</p>}
        {!loading && !searched && displayPatients.length === 0 && <p className="muted">No patients registered yet.</p>}
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeletePatient}
        loading={deletingPatient}
        title="Delete patient record?"
        description={
          deleteTarget
            ? `This will permanently remove ${deleteTarget.label}. This action cannot be undone.`
            : "This action cannot be undone."
        }
        confirmLabel="Delete Patient"
      />
    </section>
  );
}

type PatientDetailProps = {
  patientRef: Patient | string;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  canEdit: boolean;
  canReadBilling: boolean;
  canReadLab: boolean;
  ocrLanguage: string;
  languages: Record<string, string>;
  canDelete: boolean;
  onRequestDelete: (patient: Patient) => void;
  onPatientUpdated: (patientId?: string) => Promise<void>;
  refreshToken?: number;
};

type PatientEditForm = {
  name: string;
  middle_name: string;
  last_name: string;
  dob: string;
  age: string;
  weight: string;
  height: string;
  gender: string;
  pregnant: boolean;
  allergies: string;
  symptoms: string;
  phone: string;
  address: string;
  blood_group: string;
  emergency_contact: string;
  aadhar_number: string;
};

const toEditForm = (patient: Patient): PatientEditForm => ({
  name: patient.name || "",
  middle_name: patient.middle_name || "",
  last_name: patient.last_name || "",
  dob: patient.dob || "",
  age: patient.age === undefined || patient.age === null ? "" : String(patient.age),
  weight: patient.weight === undefined || patient.weight === null ? "" : String(patient.weight),
  height: patient.height === undefined || patient.height === null ? "" : String(patient.height),
  gender: patient.gender || "Female",
  pregnant: patient.pregnant === true || patient.pregnant === 1,
  allergies: patient.allergies || "",
  symptoms: patient.symptoms || "",
  phone: patient.phone || "",
  address: patient.address || "",
  blood_group: patient.blood_group || "",
  emergency_contact: patient.emergency_contact || "",
  aadhar_number: patient.aadhar_number || "",
});

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

function PatientDetail({
  patientRef,
  setNotice,
  canEdit,
  canReadBilling,
  canReadLab,
  ocrLanguage,
  languages,
  canDelete,
  onRequestDelete,
  onPatientUpdated,
  refreshToken = 0,
}: PatientDetailProps) {
  const patientId = typeof patientRef === "string" ? patientRef : patientRef.patient_id;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [movements, setMovements] = useState<PatientMovement[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [beds, setBeds] = useState<BedAllocation[]>([]);
  const [medications, setMedications] = useState<MedicationSchedule[]>([]);
  const [notes, setNotes] = useState<ObservationNote[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [billingInvoices, setBillingInvoices] = useState<PatientInvoice[]>([]);
  const [diagnosticTransactions, setDiagnosticTransactions] = useState<PatientDiagnostic[]>([]);
  const [downloadReady, setDownloadReady] = useState<Record<number, Record<string, boolean>>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [careTab, setCareTab] = useState("encounters");
  const [addingMovement, setAddingMovement] = useState(false);
  const [savingEncounter, setSavingEncounter] = useState(false);
  const [savingBed, setSavingBed] = useState(false);
  const [savingMedication, setSavingMedication] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingCertificate, setSavingCertificate] = useState(false);
  const [deletingCertificateId, setDeletingCertificateId] = useState<number | null>(null);
  const [movementForm, setMovementForm] = useState({
    admission_id: "",
    from_department: "",
    to_department: "",
  });
  const [encounterForm, setEncounterForm] = useState({
    encounter_type: "OP",
    insurance_provider: "",
    insurance_policy_no: "",
    referral_source: "",
    referral_name: "",
    is_accident: false,
  });
  const [bedForm, setBedForm] = useState({
    admission_id: "",
    ward: "",
    room_no: "",
    bed_no: "",
    status: "active",
  });
  const [medicationForm, setMedicationForm] = useState({
    medicine_name: "",
    dosage: "",
    schedule_time: "",
    administered: false,
    alert_enabled: true,
    notes: "",
  });
  const [noteForm, setNoteForm] = useState({
    admission_id: "",
    doctor_name: "",
    note: "",
    treatment_plan: "",
  });
  const [certificateForm, setCertificateForm] = useState({
    admission_id: "",
    certificate_type: "medical_certificate",
    title: "",
    body: "",
  });
  const [editForm, setEditForm] = useState<PatientEditForm | null>(null);
  const [uploadDocType, setUploadDocType] = useState("document");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null);
  const [processingOcrDocId, setProcessingOcrDocId] = useState<number | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Record<number, boolean>>({});
  const [deleteDocumentTarget, setDeleteDocumentTarget] = useState<DeleteDocumentTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    if (!patientId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const p = await apiFetch<{ patient: Patient }>(`/api/patients/${patientId}`);
      setPatient(p.patient);
      const requests: Promise<unknown>[] = [
        apiFetch<{ documents?: DocumentItem[] }>(`/api/patients/${patientId}/documents`),
        apiFetch<{ admissions?: Admission[] }>(`/api/patients/${patientId}/admissions`),
        apiFetch<{ movements?: PatientMovement[] }>(`/api/patients/${patientId}/movements`),
        apiFetch<{ encounters?: Encounter[] }>(`/api/patients/${patientId}/encounters`),
        apiFetch<{ beds?: BedAllocation[] }>(`/api/patients/${patientId}/beds`),
        apiFetch<{ medications?: MedicationSchedule[] }>(`/api/patients/${patientId}/medications`),
        apiFetch<{ notes?: ObservationNote[] }>(`/api/patients/${patientId}/notes`),
        apiFetch<{ certificates?: Certificate[] }>(`/api/patients/${patientId}/certificates`),
      ];
      if (canReadBilling) {
        requests.push(apiFetch<{ invoices?: PatientInvoice[] }>(`/api/billing/invoices?patient_id=${encodeURIComponent(patientId)}`));
      }
      if (canReadLab) {
        requests.push(apiFetch<{ diagnostics?: PatientDiagnostic[] }>(`/api/lab/diagnostics?patient_id=${encodeURIComponent(patientId)}`));
      }
      const results = await Promise.all(requests);
      const [docs, adm, mv, enc, bedData, med, noteData, certificateData, maybeInvoices, maybeDiagnostics] = results as [
        { documents?: DocumentItem[] },
        { admissions?: Admission[] },
        { movements?: PatientMovement[] },
        { encounters?: Encounter[] },
        { beds?: BedAllocation[] },
        { medications?: MedicationSchedule[] },
        { notes?: ObservationNote[] },
        { certificates?: Certificate[] },
        ({ invoices?: PatientInvoice[] } | undefined)?,
        ({ diagnostics?: PatientDiagnostic[] } | undefined)?,
      ];
      setDocuments(docs.documents || []);
      setAdmissions(adm.admissions || []);
      setMovements(mv.movements || []);
      setEncounters(enc.encounters || []);
      setBeds(bedData.beds || []);
      setMedications(med.medications || []);
      setNotes(noteData.notes || []);
      setCertificates(certificateData.certificates || []);
      setBillingInvoices(canReadBilling ? maybeInvoices?.invoices || [] : []);
      setDiagnosticTransactions(canReadLab ? maybeDiagnostics?.diagnostics || [] : []);
    } catch (error) {
      setPatient(null);
      setDocuments([]);
      setAdmissions([]);
      setMovements([]);
      setEncounters([]);
      setBeds([]);
      setMedications([]);
      setNotes([]);
      setCertificates([]);
      setBillingInvoices([]);
      setDiagnosticTransactions([]);
      const typedError = error as { status?: number; message?: string };
      if (typedError.status !== 401) {
        setLoadError(typedError.message || "Failed to load patient details.");
      }
      reportError(setNotice, typedError, "Failed to load patient details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [patientId, refreshToken, canReadBilling, canReadLab]);

  const parseNumber = (label: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} must be a valid number.`);
    }
    return parsed;
  };

  const startEdit = () => {
    if (!patient) return;
    setEditForm(toEditForm(patient));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditForm(patient ? toEditForm(patient) : null);
  };

  const handleSaveEdit = async () => {
    if (!patient || !editForm) return;
    const name = editForm.name.trim();
    const lastName = editForm.last_name.trim();
    if (!name || !lastName) {
      setNotice({ type: "warning", message: "First name and last name are required." });
      return;
    }

    let age: number | null = null;
    let weight: number | null = null;
    let height: number | null = null;
    try {
      age = parseNumber("Age", editForm.age);
      weight = parseNumber("Weight", editForm.weight);
      height = parseNumber("Height", editForm.height);
    } catch (error) {
      setNotice({ type: "warning", message: (error as Error).message });
      return;
    }

    const payload = {
      name,
      middle_name: editForm.middle_name.trim(),
      last_name: lastName,
      dob: editForm.dob || null,
      age,
      weight,
      height,
      gender: editForm.gender,
      pregnant: editForm.pregnant,
      allergies: editForm.allergies.trim(),
      symptoms: editForm.symptoms.trim(),
      phone: editForm.phone.trim(),
      address: editForm.address.trim(),
      blood_group: editForm.blood_group.trim(),
      emergency_contact: editForm.emergency_contact.trim(),
      aadhar_number: editForm.aadhar_number.trim(),
    };

    setSaving(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setIsEditing(false);
      setNotice({ type: "success", message: "Patient details updated." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Failed to update patient.");
    } finally {
      setSaving(false);
    }
  };

  const handleExportDoc = async (doc: DocumentItem, type: "pdf" | "word") => {
    if (!doc?.ocr_text || !patient) {
      setNotice({ type: "error", message: "No OCR text available for export." });
      return;
    }
    const payload = {
      patient_name: `${patient.name} ${patient.last_name || ""}`.trim(),
      doc_type: doc.doc_type,
      ocr_text: doc.ocr_text,
      date: doc.created_at,
    };
    const response = await fetch(`${API_BASE}/api/export/${type}`, {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }, "POST"),
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${patient.patient_id}_${doc.doc_type}.${type === "pdf" ? "pdf" : "docx"}`;
    link.click();
    window.URL.revokeObjectURL(url);
    setDownloadReady((prev) => ({
      ...prev,
      [doc.id]: { ...(prev[doc.id] || {}), [type]: false },
    }));
  };

  const handleUploadDocument = async () => {
    if (!patient || !uploadFile) {
      setNotice({ type: "warning", message: "Select a file to upload." });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("doc_type", uploadDocType);
      const response = await fetch(`${API_BASE}/api/patients/${patient.patient_id}/documents`, {
        method: "POST",
        headers: withAuthHeaders({}, "POST"),
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Unable to upload document.");
      }
      setUploadFile(null);
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Document uploaded." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const handleProcessDocumentOcr = async (doc: DocumentItem) => {
    if (!patient) return;
    setProcessingOcrDocId(doc.id);
    try {
      const data = await apiFetch<{ document_id: number; ocr_text: string; ocr_language: string }>(`/api/documents/${doc.id}/ocr`, {
        method: "POST",
        body: JSON.stringify({ language: ocrLanguage || doc.ocr_language || "en" }),
      });

      setDocuments((prev) =>
        prev.map((item) =>
          item.id === data.document_id
            ? {
                ...item,
                ocr_text: data.ocr_text,
                ocr_language: data.ocr_language,
              }
            : item
        )
      );
      setNotice({ type: "success", message: "OCR processed and saved." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to process OCR.");
    } finally {
      setProcessingOcrDocId(null);
    }
  };

  const handleDeleteDocument = async () => {
    if (!patient) return;
    if (!deleteDocumentTarget) return;
    setDeletingDocId(deleteDocumentTarget.id);
    try {
      await apiFetch(`/api/documents/${deleteDocumentTarget.id}`, { method: "DELETE" });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setDeleteDocumentTarget(null);
      setNotice({ type: "success", message: "Document removed." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to remove document.");
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleAddMovement = async () => {
    if (!patient) return;
    const toDepartment = movementForm.to_department.trim();
    if (!toDepartment) {
      setNotice({ type: "warning", message: "Destination department is required." });
      return;
    }
    setAddingMovement(true);
    try {
      const payload: { admission_id?: number; from_department?: string; to_department: string } = {
        to_department: toDepartment,
      };
      if (movementForm.admission_id.trim()) {
        payload.admission_id = Number(movementForm.admission_id);
      }
      if (movementForm.from_department.trim()) {
        payload.from_department = movementForm.from_department.trim();
      }

      await apiFetch(`/api/patients/${patient.patient_id}/movements`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setMovementForm({
        admission_id: "",
        from_department: "",
        to_department: "",
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Patient movement recorded." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save patient movement.");
    } finally {
      setAddingMovement(false);
    }
  };

  const handleCreateEncounter = async () => {
    if (!patient) return;
    setSavingEncounter(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}/encounters`, {
        method: "POST",
        body: JSON.stringify({
          encounter_type: encounterForm.encounter_type,
          insurance_provider: encounterForm.insurance_provider.trim() || undefined,
          insurance_policy_no: encounterForm.insurance_policy_no.trim() || undefined,
          referral_source: encounterForm.referral_source.trim() || undefined,
          referral_name: encounterForm.referral_name.trim() || undefined,
          is_accident: encounterForm.is_accident,
        }),
      });
      setEncounterForm({
        encounter_type: "OP",
        insurance_provider: "",
        insurance_policy_no: "",
        referral_source: "",
        referral_name: "",
        is_accident: false,
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Encounter created." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create encounter.");
    } finally {
      setSavingEncounter(false);
    }
  };

  const handleAssignBed = async () => {
    if (!patient) return;
    if (!bedForm.admission_id || !bedForm.ward.trim() || !bedForm.room_no.trim() || !bedForm.bed_no.trim()) {
      setNotice({ type: "warning", message: "Admission, ward, room, and bed are required." });
      return;
    }
    setSavingBed(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}/beds`, {
        method: "POST",
        body: JSON.stringify({
          admission_id: Number(bedForm.admission_id),
          ward: bedForm.ward.trim(),
          room_no: bedForm.room_no.trim(),
          bed_no: bedForm.bed_no.trim(),
          status: bedForm.status,
        }),
      });
      setBedForm({
        admission_id: "",
        ward: "",
        room_no: "",
        bed_no: "",
        status: "active",
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Bed assignment saved." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to assign bed.");
    } finally {
      setSavingBed(false);
    }
  };

  const handleAddMedication = async () => {
    if (!patient) return;
    if (!medicationForm.medicine_name.trim()) {
      setNotice({ type: "warning", message: "Medicine name is required." });
      return;
    }
    setSavingMedication(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}/medications`, {
        method: "POST",
        body: JSON.stringify({
          medicine_name: medicationForm.medicine_name.trim(),
          dosage: medicationForm.dosage.trim() || undefined,
          schedule_time: medicationForm.schedule_time || undefined,
          administered: medicationForm.administered,
          alert_enabled: medicationForm.alert_enabled,
          notes: medicationForm.notes.trim() || undefined,
        }),
      });
      setMedicationForm({
        medicine_name: "",
        dosage: "",
        schedule_time: "",
        administered: false,
        alert_enabled: true,
        notes: "",
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Medication schedule saved." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save medication schedule.");
    } finally {
      setSavingMedication(false);
    }
  };

  const handleAddNote = async () => {
    if (!patient) return;
    if (!noteForm.note.trim()) {
      setNotice({ type: "warning", message: "Clinical note is required." });
      return;
    }
    setSavingNote(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}/notes`, {
        method: "POST",
        body: JSON.stringify({
          admission_id: noteForm.admission_id ? Number(noteForm.admission_id) : undefined,
          doctor_name: noteForm.doctor_name.trim() || undefined,
          note: noteForm.note.trim(),
          treatment_plan: noteForm.treatment_plan.trim() || undefined,
        }),
      });
      setNoteForm({
        admission_id: "",
        doctor_name: "",
        note: "",
        treatment_plan: "",
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Observation note saved." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save observation note.");
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateCertificate = async () => {
    if (!patient) return;
    if (!certificateForm.title.trim() || !certificateForm.body.trim()) {
      setNotice({ type: "warning", message: "Certificate title and content are required." });
      return;
    }
    setSavingCertificate(true);
    try {
      await apiFetch(`/api/patients/${patient.patient_id}/certificates`, {
        method: "POST",
        body: JSON.stringify({
          admission_id: certificateForm.admission_id ? Number(certificateForm.admission_id) : undefined,
          certificate_type: certificateForm.certificate_type,
          title: certificateForm.title.trim(),
          body: certificateForm.body.trim(),
        }),
      });
      setCertificateForm({
        admission_id: "",
        certificate_type: "medical_certificate",
        title: "",
        body: "",
      });
      await loadData();
      await onPatientUpdated(patient.patient_id);
      setNotice({ type: "success", message: "Certificate created." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create certificate.");
    } finally {
      setSavingCertificate(false);
    }
  };

  const handleDeleteCertificate = async (certificateId: number) => {
    setDeletingCertificateId(certificateId);
    try {
      await apiFetch(`/api/certificates/${certificateId}`, { method: "DELETE" });
      await loadData();
      await onPatientUpdated(patient?.patient_id);
      setNotice({ type: "success", message: "Certificate deleted." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete certificate.");
    } finally {
      setDeletingCertificateId(null);
    }
  };

  const documentGroups = useMemo(() => {
    const sorted = [...documents].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at));
    const groups = new Map<string, { label: string; items: DocumentItem[] }>();
    sorted.forEach((doc) => {
      const key = getISTDateTimeKey(doc.created_at) || "unknown";
      const label = formatDateTimeIST(doc.created_at);
      if (!groups.has(key)) {
        groups.set(key, { label, items: [] });
      }
      groups.get(key)?.items.push(doc);
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }, [documents]);

  const visitTimeline = useMemo(() => {
    const events: { key: string; label: string; at?: string | null; detail: string }[] = [];
    admissions.forEach((adm) =>
      events.push({
        key: `admission-${adm.id}`,
        label: adm.discharge_date ? "Discharge" : "Admission",
        at: adm.discharge_date || adm.admission_date,
        detail: adm.notes || `Admission #${adm.id}`,
      })
    );
    encounters.forEach((enc) =>
      events.push({
        key: `encounter-${enc.id}`,
        label: `${enc.encounter_type} Encounter`,
        at: enc.arrival_at,
        detail: enc.referral_name || enc.referral_source || enc.status || "Visit created",
      })
    );
    movements.forEach((mv) =>
      events.push({
        key: `movement-${mv.id}`,
        label: "Department Transfer",
        at: mv.moved_at,
        detail: `${mv.from_department || "Unknown"} to ${mv.to_department}`,
      })
    );
    notes.forEach((entry) =>
      events.push({
        key: `note-${entry.id}`,
        label: "Clinical Note",
        at: entry.created_at,
        detail: entry.note,
      })
    );
    documents.forEach((doc) =>
      events.push({
        key: `document-${doc.id}`,
        label: "Document Added",
        at: doc.created_at,
        detail: doc.doc_type.replace(/_/g, " "),
      })
    );
    return events.sort((a, b) => getTimestamp(b.at || "") - getTimestamp(a.at || ""));
  }, [admissions, encounters, movements, notes, documents]);

  if (loading) {
    return (
      <section className="panel">
        <p className="muted">Loading patient details...</p>
      </section>
    );
  }

  if (loadError) {
      return (
        <section className="panel">
        <Alert variant="error">{loadError}</Alert>
        </section>
      );
  }

  if (!patient) return null;

  return (
    <section className="panel patient-detail-panel">
      <h3>
        {patient.name} {patient.last_name}
      </h3>
      <div className="form-actions patient-detail-actions">
        <Button
          variant="secondary"
          onClick={() => {
            if (isEditing) {
              cancelEdit();
              return;
            }
            startEdit();
          }}
          disabled={!canEdit || saving}
          title={!canEdit ? "Requires patient write access." : ""}
        >
          {isEditing ? "Cancel Edit" : "Edit Patient"}
        </Button>
        {canEdit && isEditing && (
          <Button variant="primary" onClick={() => void handleSaveEdit()} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
        <Button
          variant="destructive"
          onClick={() => onRequestDelete(patient)}
          disabled={!canDelete}
          title={!canDelete ? "Only Owner / MD / CEO can delete patients." : ""}
        >
          Delete Patient
        </Button>
      </div>
      <div className="detail-grid">
        <div>
          <h4>Personal Info</h4>
          {isEditing && editForm ? (
            <>
              <p className="muted">First Name</p>
              <Input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
              <p className="muted">Middle Name</p>
              <Input value={editForm.middle_name} onChange={(event) => setEditForm({ ...editForm, middle_name: event.target.value })} />
              <p className="muted">Last Name</p>
              <Input value={editForm.last_name} onChange={(event) => setEditForm({ ...editForm, last_name: event.target.value })} />
              <p className="muted">DOB</p>
              <Input type="date" value={editForm.dob} onChange={(event) => setEditForm({ ...editForm, dob: event.target.value })} />
              <p className="muted">Age</p>
              <Input value={editForm.age} onChange={(event) => setEditForm({ ...editForm, age: event.target.value })} />
              <p className="muted">Gender</p>
              <Select value={editForm.gender} onChange={(event) => setEditForm({ ...editForm, gender: event.target.value })}>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </Select>
              <p className="muted">Phone</p>
              <Input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} />
              <p className="muted">Weight (kg)</p>
              <Input value={editForm.weight} onChange={(event) => setEditForm({ ...editForm, weight: event.target.value })} />
              <p className="muted">Height (cm)</p>
              <Input value={editForm.height} onChange={(event) => setEditForm({ ...editForm, height: event.target.value })} />
              <p className="muted">Pregnant</p>
              <Checkbox checked={editForm.pregnant} onChange={(event) => setEditForm({ ...editForm, pregnant: event.target.checked })} />
              <p className="muted">Blood Group</p>
              <Input value={editForm.blood_group} onChange={(event) => setEditForm({ ...editForm, blood_group: event.target.value })} />
              <p className="muted">Emergency Contact</p>
              <Input value={editForm.emergency_contact} onChange={(event) => setEditForm({ ...editForm, emergency_contact: event.target.value })} />
              <p className="muted">Aadhar Number</p>
              <Input value={editForm.aadhar_number} onChange={(event) => setEditForm({ ...editForm, aadhar_number: event.target.value })} />
              <p className="muted">Address</p>
              <Textarea value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} />
            </>
          ) : (
            <>
              <p>Age: {patient.age || "-"}</p>
              <p>Gender: {patient.gender || "-"}</p>
              <p>DOB: {formatDate(patient.dob)}</p>
              <p>Phone: {patient.phone || "-"}</p>
              <p>Blood Group: {patient.blood_group || "-"}</p>
              <p>Emergency Contact: {patient.emergency_contact || "-"}</p>
              <p>Aadhar Number: {patient.aadhar_number || "Not provided"}</p>
              <p>Address: {patient.address || "-"}</p>
              <p>Weight: {patient.weight || "-"} kg</p>
              <p>Height: {patient.height || "-"} cm</p>
              <p>Pregnant: {patient.pregnant ? "Yes" : "No"}</p>
            </>
          )}
        </div>
        <div>
          <h4>Medical Info</h4>
          {isEditing && editForm ? (
            <>
              <p className="muted">Allergies</p>
              <Textarea value={editForm.allergies} onChange={(event) => setEditForm({ ...editForm, allergies: event.target.value })} />
              <p className="muted">Symptoms</p>
              <Textarea value={editForm.symptoms} onChange={(event) => setEditForm({ ...editForm, symptoms: event.target.value })} />
            </>
          ) : (
            <>
              <p>Allergies: {patient.allergies || "None"}</p>
              <p>Symptoms: {patient.symptoms || "None"}</p>
            </>
          )}
        </div>
        <div>
          <h4>Admissions</h4>
          {admissions.map((adm) => (
            <p key={adm.id}>
              {formatDateTimeIST(adm.admission_date)} · {adm.notes || "No notes"}{" "}
              {adm.discharge_date ? `(Discharged: ${formatDateTimeIST(adm.discharge_date)})` : "(Active)"}
            </p>
          ))}
        </div>
        <div>
          <h4>Department Movements</h4>
          {canEdit && (
            <div className="form-actions">
              <Select
                value={movementForm.admission_id}
                onChange={(event) => setMovementForm((prev) => ({ ...prev, admission_id: event.target.value }))}
                disabled={addingMovement}
              >
                <option value="">Link Admission (Optional)</option>
                {admissions.map((adm) => (
                  <option key={adm.id} value={adm.id}>
                    #{adm.id} {adm.discharge_date ? "(Discharged)" : "(Active)"}
                  </option>
                ))}
              </Select>
              <Input
                placeholder="From department (optional)"
                value={movementForm.from_department}
                onChange={(event) => setMovementForm((prev) => ({ ...prev, from_department: event.target.value }))}
                disabled={addingMovement}
              />
              <Input
                placeholder="To department"
                value={movementForm.to_department}
                onChange={(event) => setMovementForm((prev) => ({ ...prev, to_department: event.target.value }))}
                disabled={addingMovement}
              />
              <Button variant="secondary" onClick={() => void handleAddMovement()} disabled={addingMovement}>
                {addingMovement ? "Saving..." : "Add Movement"}
              </Button>
            </div>
          )}
          {movements.length === 0 ? (
            <p className="muted">No movement records yet.</p>
          ) : (
            movements.map((movement) => (
              <p key={movement.id}>
                {formatDateTimeIST(movement.moved_at)} · {movement.from_department || "Unknown"} to {movement.to_department}
                {movement.admission_id ? ` · Admission #${movement.admission_id}` : ""}
                {movement.moved_by ? ` · by ${movement.moved_by}` : ""}
              </p>
            ))
          )}
        </div>
      </div>
      <div className="patient-care-section panel">
        <div className="module-panel-head">
          <div>
            <h4>Clinical Operations</h4>
            <p className="muted">Manage OP/IP encounters, beds, medications, and observation notes.</p>
          </div>
        </div>
        <Tabs>
          <TabsTrigger active={careTab === "encounters"} onClick={() => setCareTab("encounters")}>
            Encounters
          </TabsTrigger>
          <TabsTrigger active={careTab === "beds"} onClick={() => setCareTab("beds")}>
            Beds
          </TabsTrigger>
          <TabsTrigger active={careTab === "medications"} onClick={() => setCareTab("medications")}>
            Medications
          </TabsTrigger>
          <TabsTrigger active={careTab === "notes"} onClick={() => setCareTab("notes")}>
            Notes
          </TabsTrigger>
        </Tabs>
        <TabsContent className="care-tab-content">
          {careTab === "encounters" && (
            <div className="care-panel-grid">
              {canEdit && (
                <div className="care-entry panel">
                  <h4>Create Encounter</h4>
                  <div className="form-actions stacked-actions">
                    <Select
                      value={encounterForm.encounter_type}
                      onChange={(event) => setEncounterForm((prev) => ({ ...prev, encounter_type: event.target.value }))}
                    >
                      <option value="OP">OP</option>
                      <option value="IP">IP</option>
                    </Select>
                    <Input
                      placeholder="Insurance provider"
                      value={encounterForm.insurance_provider}
                      onChange={(event) => setEncounterForm((prev) => ({ ...prev, insurance_provider: event.target.value }))}
                    />
                    <Input
                      placeholder="Insurance policy no."
                      value={encounterForm.insurance_policy_no}
                      onChange={(event) => setEncounterForm((prev) => ({ ...prev, insurance_policy_no: event.target.value }))}
                    />
                    <Input
                      placeholder="Referral source"
                      value={encounterForm.referral_source}
                      onChange={(event) => setEncounterForm((prev) => ({ ...prev, referral_source: event.target.value }))}
                    />
                    <Input
                      placeholder="Referral name"
                      value={encounterForm.referral_name}
                      onChange={(event) => setEncounterForm((prev) => ({ ...prev, referral_name: event.target.value }))}
                    />
                    <label className="checkbox-line">
                      <Checkbox
                        checked={encounterForm.is_accident}
                        onChange={(event) => setEncounterForm((prev) => ({ ...prev, is_accident: event.target.checked }))}
                      />
                      <span>Accident case</span>
                    </label>
                    <Button variant="secondary" onClick={() => void handleCreateEncounter()} disabled={savingEncounter}>
                      {savingEncounter ? "Saving..." : "Add Encounter"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="care-entry panel">
                <h4>Encounter History</h4>
                {encounters.length === 0 ? (
                  <p className="muted">No encounters recorded yet.</p>
                ) : (
                  <Table>
                    <TableHead>
                      <TableCell>Type</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Insurance</TableCell>
                      <TableCell>Referral</TableCell>
                      <TableCell>Accident</TableCell>
                      <TableCell>Arrival</TableCell>
                    </TableHead>
                    {encounters.map((encounter) => (
                      <TableRow key={encounter.id}>
                        <TableCell>{encounter.encounter_type}</TableCell>
                        <TableCell>{encounter.status || "active"}</TableCell>
                        <TableCell>{encounter.insurance_provider || "-"}</TableCell>
                        <TableCell>{encounter.referral_name || encounter.referral_source || "-"}</TableCell>
                        <TableCell>{encounter.is_accident ? "Yes" : "No"}</TableCell>
                        <TableCell>{formatDateTimeIST(encounter.arrival_at)}</TableCell>
                      </TableRow>
                    ))}
                  </Table>
                )}
              </div>
            </div>
          )}
          {careTab === "beds" && (
            <div className="care-panel-grid">
              {canEdit && (
                <div className="care-entry panel">
                  <h4>Assign Bed</h4>
                  <div className="form-actions stacked-actions">
                    <Select
                      value={bedForm.admission_id}
                      onChange={(event) => setBedForm((prev) => ({ ...prev, admission_id: event.target.value }))}
                    >
                      <option value="">Select Admission</option>
                      {admissions.map((adm) => (
                        <option key={adm.id} value={adm.id}>
                          Admission #{adm.id}
                        </option>
                      ))}
                    </Select>
                    <Input placeholder="Ward" value={bedForm.ward} onChange={(event) => setBedForm((prev) => ({ ...prev, ward: event.target.value }))} />
                    <Input placeholder="Room No." value={bedForm.room_no} onChange={(event) => setBedForm((prev) => ({ ...prev, room_no: event.target.value }))} />
                    <Input placeholder="Bed No." value={bedForm.bed_no} onChange={(event) => setBedForm((prev) => ({ ...prev, bed_no: event.target.value }))} />
                    <Select value={bedForm.status} onChange={(event) => setBedForm((prev) => ({ ...prev, status: event.target.value }))}>
                      <option value="active">Active</option>
                      <option value="released">Released</option>
                    </Select>
                    <Button variant="secondary" onClick={() => void handleAssignBed()} disabled={savingBed}>
                      {savingBed ? "Saving..." : "Assign Bed"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="care-entry panel">
                <h4>Bed Allocation History</h4>
                {beds.length === 0 ? (
                  <p className="muted">No bed allocations recorded yet.</p>
                ) : (
                  <Table>
                    <TableHead>
                      <TableCell>Admission</TableCell>
                      <TableCell>Ward</TableCell>
                      <TableCell>Room</TableCell>
                      <TableCell>Bed</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Allocated</TableCell>
                    </TableHead>
                    {beds.map((bed) => (
                      <TableRow key={bed.id}>
                        <TableCell>#{bed.admission_id}</TableCell>
                        <TableCell>{bed.ward}</TableCell>
                        <TableCell>{bed.room_no}</TableCell>
                        <TableCell>{bed.bed_no}</TableCell>
                        <TableCell>{bed.status || "active"}</TableCell>
                        <TableCell>{formatDateTimeIST(bed.allocated_at)}</TableCell>
                      </TableRow>
                    ))}
                  </Table>
                )}
              </div>
            </div>
          )}
          {careTab === "medications" && (
            <div className="care-panel-grid">
              {canEdit && (
                <div className="care-entry panel">
                  <h4>Add Medication Schedule</h4>
                  <div className="form-actions stacked-actions">
                    <Input
                      placeholder="Medicine name"
                      value={medicationForm.medicine_name}
                      onChange={(event) => setMedicationForm((prev) => ({ ...prev, medicine_name: event.target.value }))}
                    />
                    <Input
                      placeholder="Dosage"
                      value={medicationForm.dosage}
                      onChange={(event) => setMedicationForm((prev) => ({ ...prev, dosage: event.target.value }))}
                    />
                    <Input
                      type="datetime-local"
                      value={medicationForm.schedule_time}
                      onChange={(event) => setMedicationForm((prev) => ({ ...prev, schedule_time: event.target.value }))}
                    />
                    <Textarea
                      placeholder="Notes"
                      value={medicationForm.notes}
                      onChange={(event) => setMedicationForm((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                    <label className="checkbox-line">
                      <Checkbox
                        checked={medicationForm.administered}
                        onChange={(event) => setMedicationForm((prev) => ({ ...prev, administered: event.target.checked }))}
                      />
                      <span>Already administered</span>
                    </label>
                    <label className="checkbox-line">
                      <Checkbox
                        checked={medicationForm.alert_enabled}
                        onChange={(event) => setMedicationForm((prev) => ({ ...prev, alert_enabled: event.target.checked }))}
                      />
                      <span>Alert enabled</span>
                    </label>
                    <Button variant="secondary" onClick={() => void handleAddMedication()} disabled={savingMedication}>
                      {savingMedication ? "Saving..." : "Save Schedule"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="care-entry panel">
                <h4>Medication Timeline</h4>
                {medications.length === 0 ? (
                  <p className="muted">No medications scheduled yet.</p>
                ) : (
                  <Table>
                    <TableHead>
                      <TableCell>Medicine</TableCell>
                      <TableCell>Dosage</TableCell>
                      <TableCell>Schedule</TableCell>
                      <TableCell>Administered</TableCell>
                      <TableCell>Alerts</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableHead>
                    {medications.map((medication) => (
                      <TableRow key={medication.id}>
                        <TableCell>{medication.medicine_name}</TableCell>
                        <TableCell>{medication.dosage || "-"}</TableCell>
                        <TableCell>{formatDateTimeIST(medication.schedule_time)}</TableCell>
                        <TableCell>{medication.administered ? "Yes" : "No"}</TableCell>
                        <TableCell>{medication.alert_enabled ? "On" : "Off"}</TableCell>
                        <TableCell>{medication.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </Table>
                )}
              </div>
            </div>
          )}
          {careTab === "notes" && (
            <div className="care-panel-grid">
              {canEdit && (
                <div className="care-entry panel">
                  <h4>Add Observation Note</h4>
                  <div className="form-actions stacked-actions">
                    <Select
                      value={noteForm.admission_id}
                      onChange={(event) => setNoteForm((prev) => ({ ...prev, admission_id: event.target.value }))}
                    >
                      <option value="">Link Admission (Optional)</option>
                      {admissions.map((adm) => (
                        <option key={adm.id} value={adm.id}>
                          Admission #{adm.id}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder="Doctor name"
                      value={noteForm.doctor_name}
                      onChange={(event) => setNoteForm((prev) => ({ ...prev, doctor_name: event.target.value }))}
                    />
                    <Textarea
                      placeholder="Clinical note"
                      value={noteForm.note}
                      onChange={(event) => setNoteForm((prev) => ({ ...prev, note: event.target.value }))}
                    />
                    <Textarea
                      placeholder="Treatment plan"
                      value={noteForm.treatment_plan}
                      onChange={(event) => setNoteForm((prev) => ({ ...prev, treatment_plan: event.target.value }))}
                    />
                    <Button variant="secondary" onClick={() => void handleAddNote()} disabled={savingNote}>
                      {savingNote ? "Saving..." : "Save Note"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="care-entry panel">
                <h4>Observation Notes</h4>
                {notes.length === 0 ? (
                  <p className="muted">No observation notes yet.</p>
                ) : (
                  <div className="care-note-list">
                    {notes.map((entry) => (
                      <div key={entry.id} className="care-note-card">
                        <div className="care-note-head">
                          <strong>{entry.doctor_name || "Care Team"}</strong>
                          <span className="muted">{formatDateTimeIST(entry.created_at)}</span>
                        </div>
                        <p>{entry.note}</p>
                        {entry.treatment_plan ? <p className="muted">Plan: {entry.treatment_plan}</p> : null}
                        {entry.admission_id ? <p className="muted">Admission #{entry.admission_id}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </div>
      <div className="split patient-history-grid">
        <div className="panel">
          <div className="module-panel-head">
            <h4>Visit Timeline</h4>
          </div>
          {visitTimeline.length === 0 ? (
            <p className="muted">No timeline events yet.</p>
          ) : (
            <div className="care-note-list">
              {visitTimeline.slice(0, 12).map((event) => (
                <div key={event.key} className="care-note-card">
                  <div className="care-note-head">
                    <strong>{event.label}</strong>
                    <span className="muted">{formatDateTimeIST(event.at)}</span>
                  </div>
                  <p>{event.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h4>Transaction History</h4>
          </div>
          {!canReadBilling && !canReadLab ? (
            <p className="muted">No billing or diagnostics access for transaction history.</p>
          ) : (
            <>
              {canReadBilling && billingInvoices.length > 0 ? (
                <div className="transaction-group">
                  <h5>Billing</h5>
                  <div className="care-note-list">
                    {billingInvoices.slice(0, 6).map((invoice) => (
                      <div key={`invoice-${invoice.id}`} className="care-note-card">
                        <div className="care-note-head">
                          <strong>{invoice.invoice_no || `INV-${invoice.id}`}</strong>
                          <span className="muted">{formatDateTimeIST(invoice.created_at)}</span>
                        </div>
                        <p>
                          {invoice.module || "Invoice"} · Total {formatCurrency(invoice.total_amount)} · Paid {formatCurrency(invoice.paid_amount)} · Due{" "}
                          {formatCurrency(invoice.due_amount)}
                        </p>
                        <p className="muted">Status: {invoice.payment_status || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {canReadLab && diagnosticTransactions.length > 0 ? (
                <div className="transaction-group">
                  <h5>Diagnostics</h5>
                  <div className="care-note-list">
                    {diagnosticTransactions.slice(0, 6).map((record) => (
                      <div key={`diagnostic-${record.id}`} className="care-note-card">
                        <div className="care-note-head">
                          <strong>{record.test_name || `Diagnostic #${record.id}`}</strong>
                          <span className="muted">{formatDateTimeIST(record.created_at)}</span>
                        </div>
                        <p>
                          {record.invoice_no || "No invoice"} · Amount {formatCurrency(record.amount)} · Paid {formatCurrency(record.paid_amount)} · Due{" "}
                          {formatCurrency(record.due_amount)}
                        </p>
                        <p className="muted">Status: {record.status || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {((canReadBilling && billingInvoices.length === 0) && (canReadLab && diagnosticTransactions.length === 0)) ||
              (canReadBilling && !canReadLab && billingInvoices.length === 0) ||
              (!canReadBilling && canReadLab && diagnosticTransactions.length === 0) ? (
                <p className="muted">No transactions recorded yet.</p>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="patient-care-section panel">
        <div className="module-panel-head">
          <div>
            <h4>Certificates</h4>
            <p className="muted">Discharge summaries, medical certificates, insurance documents, and fit-to-work records.</p>
          </div>
        </div>
        <div className="care-panel-grid">
          {canEdit ? (
            <div className="care-entry panel">
              <h4>Create Certificate</h4>
              <div className="form-actions stacked-actions">
                <Select
                  value={certificateForm.admission_id}
                  onChange={(event) => setCertificateForm((prev) => ({ ...prev, admission_id: event.target.value }))}
                >
                  <option value="">Link Admission (Optional)</option>
                  {admissions.map((adm) => (
                    <option key={`cert-adm-${adm.id}`} value={adm.id}>
                      Admission #{adm.id}
                    </option>
                  ))}
                </Select>
                <Select
                  value={certificateForm.certificate_type}
                  onChange={(event) => setCertificateForm((prev) => ({ ...prev, certificate_type: event.target.value }))}
                >
                  <option value="discharge_summary">Discharge Summary</option>
                  <option value="medical_certificate">Medical Certificate</option>
                  <option value="insurance_document">Insurance Document</option>
                  <option value="fit_to_work">Fit to Work</option>
                </Select>
                <Input
                  placeholder="Certificate title"
                  value={certificateForm.title}
                  onChange={(event) => setCertificateForm((prev) => ({ ...prev, title: event.target.value }))}
                />
                <Textarea
                  placeholder="Certificate content"
                  value={certificateForm.body}
                  onChange={(event) => setCertificateForm((prev) => ({ ...prev, body: event.target.value }))}
                  rows={6}
                />
                <Button variant="secondary" onClick={() => void handleCreateCertificate()} disabled={savingCertificate}>
                  {savingCertificate ? "Saving..." : "Create Certificate"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="care-entry panel">
            <h4>Certificate History</h4>
            {certificates.length === 0 ? (
              <p className="muted">No certificates created yet.</p>
            ) : (
              <div className="care-note-list">
                {certificates.map((certificate) => (
                  <div key={certificate.id} className="care-note-card">
                    <div className="care-note-head">
                      <strong>{certificate.title}</strong>
                      <span className="muted">{formatDateTimeIST(certificate.created_at)}</span>
                    </div>
                    <p className="muted">
                      {certificate.certificate_type.replace(/_/g, " ")}
                      {certificate.admission_id ? ` · Admission #${certificate.admission_id}` : ""}
                      {certificate.issued_by ? ` · Issued by ${certificate.issued_by}` : ""}
                    </p>
                    <p>{certificate.body}</p>
                    {canEdit ? (
                      <div className="module-inline-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDeleteCertificate(certificate.id)}
                          disabled={deletingCertificateId === certificate.id}
                        >
                          {deletingCertificateId === certificate.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="documents">
        <h4>Documents</h4>
        {canEdit && isEditing && (
          <div className="form-actions">
            <Select value={uploadDocType} onChange={(event) => setUploadDocType(event.target.value)}>
              <option value="test_docs">Test Docs</option>
              <option value="xray_mri">X-Ray / MRI</option>
              <option value="prescriptions">Prescriptions</option>
              <option value="document">Document</option>
            </Select>
            <DocumentUploadDropzone
              accept={SUPPORTED_DOCUMENT_ACCEPT}
              file={uploadFile || undefined}
              helperText={`Supported: ${SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", ")}`}
              disabled={uploading}
              onFileSelect={setUploadFile}
            />
            <Button variant="secondary" onClick={() => void handleUploadDocument()} disabled={uploading || !uploadFile}>
              {uploading ? "Uploading..." : "Add Document"}
            </Button>
          </div>
        )}
        {documents.length === 0 ? (
          <p className="muted">No documents uploaded.</p>
        ) : (
          documentGroups.map((group) => (
            <details key={group.key} className="doc-date-section" open>
              <summary>
                {group.label} ({group.items.length})
              </summary>
              <div className="doc-date-content">
                {group.items.map((doc) => (
                  <details
                    key={doc.id}
                    className="doc-item"
                    open={!!expandedDocs[doc.id]}
                    onToggle={(event) => {
                      const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                      setExpandedDocs((prev) => ({ ...prev, [doc.id]: isOpen }));
                    }}
                  >
                    <summary>
                      <span>{doc.doc_type.replace("_", " ")}</span>
                      <span className="summary-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setExpandedDocs((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }));
                          }}
                        >
                          {expandedDocs[doc.id] ? "Close" : "Open"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            window.open(`${API_BASE}/api/documents/${doc.id}/file`, "_blank", "noopener,noreferrer");
                          }}
                        >
                          Open Original
                        </Button>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setDeleteDocumentTarget({
                                id: doc.id,
                                label: stripUploadTimestampPrefix(doc.file_name) || doc.doc_type.replace("_", " "),
                              });
                            }}
                            disabled={deletingDocId === doc.id}
                          >
                            {deletingDocId === doc.id ? "Removing..." : "Delete"}
                          </Button>
                        )}
                      </span>
                    </summary>
                    <p className="muted">Language: {languages?.[doc.ocr_language || ""] || "English"}</p>
                    <div className="ocr-side-by-side">
                      <div className="ocr-preview">
                        <p className="muted">Original Document</p>
                        <SavedDocumentPreview doc={doc} />
                      </div>
                      <div className={`ocr-preview ocr-markdown-preview ${!(doc.ocr_text || "").trim() ? "ocr-markdown-needs-ocr" : ""}`}>
                        <p className="muted">Markdown OCR</p>
                        {!(doc.ocr_text || "").trim() ? (
                          <div className="ocr-empty-state">
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => void handleProcessDocumentOcr(doc)}
                              disabled={!canEdit || processingOcrDocId === doc.id}
                              title={!canEdit ? "Requires patient write access." : ""}
                            >
                              {processingOcrDocId === doc.id ? "Processing..." : "Process OCR"}
                            </Button>
                          </div>
                        ) : (
                          <div className="ocr-markdown-content">
                            <MarkdownReport text={doc.ocr_text || "No OCR data"} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="row-actions">
                      <Button variant="secondary" onClick={() => setDownloadReady((prev) => ({ ...prev, [doc.id]: { ...(prev[doc.id] || {}), pdf: true } }))}>
                        Prepare PDF
                      </Button>
                      <Button variant="secondary" onClick={() => setDownloadReady((prev) => ({ ...prev, [doc.id]: { ...(prev[doc.id] || {}), word: true } }))}>
                        Prepare Word
                      </Button>
                      {downloadReady[doc.id]?.pdf && (
                        <Button variant="secondary" onClick={() => void handleExportDoc(doc, "pdf")}>
                          Download PDF
                        </Button>
                      )}
                      {downloadReady[doc.id]?.word && (
                        <Button variant="secondary" onClick={() => void handleExportDoc(doc, "word")}>
                          Download Word
                        </Button>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))
        )}
      </div>
      <ConfirmDialog
        open={!!deleteDocumentTarget}
        onClose={() => setDeleteDocumentTarget(null)}
        onConfirm={handleDeleteDocument}
        loading={deletingDocId !== null}
        title="Delete document?"
        description={
          deleteDocumentTarget
            ? `This will permanently remove "${deleteDocumentTarget.label}". This action cannot be undone.`
            : "This action cannot be undone."
        }
        confirmLabel="Delete Document"
      />
    </section>
  );
}
