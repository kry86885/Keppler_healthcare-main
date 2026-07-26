import { Fragment, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import MarkdownReport from "../components/MarkdownReport";
import { Button, Checkbox, Input, Label, Select, Table, TableCell, TableHead, TableRow, Textarea } from "../components/ui";
import { API_BASE, DOC_TYPES, SUPPORTED_DOCUMENT_ACCEPT, SUPPORTED_DOCUMENT_EXTENSIONS, isSupportedDocumentFile } from "../lib/constants";
import { apiFetch, reportError, withAuthHeaders } from "../lib/api";
import { formatDateTimeIST, getISTDateTimeKey, getTimestamp, stripUploadTimestampPrefix } from "../lib/format";
import type { DocumentItem, Notice, Patient } from "../types";

type ProfileUpdates = {
  age: number | string;
  weight: number | string;
  height: number | string;
  phone: string;
  allergies: string;
  symptoms: string;
  gender: string;
  pregnant: boolean;
};

type Props = {
  onSelect: (patient: Patient) => void;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onReadmitComplete?: (patientId?: string) => Promise<void>;
  ocrLanguage: string;
};

type OcrResultMap = Record<string, { text?: string; file?: File }>;

const IMAGE_NAME_PATTERN = /\.(png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i;

function OriginalDocumentPreview({ file }: { file?: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) {
    return <p className="muted">No source document available.</p>;
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = mime.startsWith("image/") || IMAGE_NAME_PATTERN.test(file.name);

  if (isImage) {
    return <img className="ocr-source-image" src={url} alt={file.name} />;
  }

  if (isPdf) {
    return <iframe className="ocr-source-pdf" src={url} title={`Preview ${file.name}`} />;
  }

  return (
    <a className="link" href={url} target="_blank" rel="noreferrer">
      Open original document
    </a>
  );
}

export default function ReadmitPage({ onSelect, setNotice, onReadmitComplete, ocrLanguage }: Props) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [notes, setNotes] = useState("");
  const [profileUpdates, setProfileUpdates] = useState<ProfileUpdates>({
    age: "",
    weight: "",
    height: "",
    phone: "",
    allergies: "",
    symptoms: "",
    gender: "Female",
    pregnant: false,
  });
  const [docFiles, setDocFiles] = useState<Record<string, File>>({});
  const [ocrResults, setOcrResults] = useState<OcrResultMap>({});
  const [ocrStatus, setOcrStatus] = useState<Record<string, string>>({});
  const [previousDocuments, setPreviousDocuments] = useState<DocumentItem[]>([]);
  const [previousDocumentsLoading, setPreviousDocumentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const normalizeProfile = (patient: Patient): ProfileUpdates => ({
    age: patient?.age ?? "",
    weight: patient?.weight ?? "",
    height: patient?.height ?? "",
    phone: patient?.phone || "",
    allergies: patient?.allergies || "",
    symptoms: patient?.symptoms || "",
    gender: patient?.gender || "Female",
    pregnant: patient?.pregnant === 1 || patient?.pregnant === true,
  });

  useEffect(() => {
    const loadPatients = async () => {
      try {
        const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
        setPatients(data.patients || []);
      } catch (error) {
        reportError(setNotice, error as { message?: string; status?: number }, "Unable to load patients.");
      }
    };
    void loadPatients();
  }, [setNotice]);

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? patients.filter((patient) => {
        const fields = [patient.name, patient.middle_name, patient.last_name, patient.patient_id, patient.phone, patient.dob]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        return fields.some((value) => value.includes(normalizedQuery));
      })
    : patients;

  const previousDocumentGroups = useMemo(() => {
    const sorted = [...previousDocuments].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at));
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
  }, [previousDocuments]);

  const loadPreviousDocuments = async (patientId: string) => {
    setPreviousDocumentsLoading(true);
    try {
      const data = await apiFetch<{ documents?: DocumentItem[] }>(`/api/patients/${patientId}/documents`);
      setPreviousDocuments(data.documents || []);
    } catch {
      setPreviousDocuments([]);
      setNotice({ type: "warning", message: "Unable to load previous documents." });
    } finally {
      setPreviousDocumentsLoading(false);
    }
  };

  const handleSelect = async (patient: Patient) => {
    setActivePatient(patient);
    setProfileUpdates(normalizeProfile(patient));
    setDocFiles({});
    setOcrResults({});
    setOcrStatus({});
    setPreviousDocuments([]);
    onSelect(patient);
    void loadPreviousDocuments(patient.patient_id);
    try {
      const detail = await apiFetch<{ patient?: Patient }>(`/api/patients/${patient.patient_id}`);
      if (detail?.patient) {
        setActivePatient(detail.patient);
        setProfileUpdates(normalizeProfile(detail.patient));
      }
    } catch {
      setNotice({ type: "warning", message: "Loaded limited patient details for readmission edit." });
    }
  };

  const handleFileSelect = (docType: string) => (file: File | null) => {
    if (!file) {
      setDocFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      setOcrResults((prev) => {
        if (!prev[docType]) return prev;
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      setOcrStatus((prev) => ({ ...prev, [docType]: "" }));
      return;
    }

    if (!isSupportedDocumentFile(file)) {
      setOcrStatus((prev) => ({ ...prev, [docType]: "Unsupported file type. Use PDF, JPG, PNG, WEBP, TIFF, BMP, GIF, HEIC, or HEIF." }));
      setDocFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      return;
    }
    setOcrStatus((prev) => ({ ...prev, [docType]: "" }));
    setDocFiles((prev) => ({ ...prev, [docType]: file }));
  };

  const handleOCR = async (docType: string) => {
    const file = docFiles[docType];
    if (!file) return;
    setOcrStatus((prev) => ({ ...prev, [docType]: "Processing OCR..." }));
    const body = new FormData();
    body.append("file", file);
    body.append("language", ocrLanguage);
    body.append("doc_type", docType);

    try {
      const response = await fetch(`${API_BASE}/api/ocr`, { method: "POST", headers: withAuthHeaders({}, "POST"), body, credentials: "include" });
      const data = await response.json();
      setOcrResults((prev) => ({
        ...prev,
        [docType]: { text: data.text || "", file },
      }));
      setOcrStatus((prev) => ({ ...prev, [docType]: "OCR complete. Text will be saved with readmission." }));
    } catch {
      setOcrStatus((prev) => ({ ...prev, [docType]: "OCR failed." }));
    }
  };

  const handleOcrTextChange = (docType: string) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setOcrResults((prev) => ({
      ...prev,
      [docType]: { ...prev[docType], text: value },
    }));
  };

  const clearOcrEntry = (docType: string) => {
    setOcrResults((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  };

  const handleProfileChange = (field: keyof ProfileUpdates) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = field === "pregnant" ? (event.target as HTMLInputElement).checked : event.target.value;
    setProfileUpdates((prev) => ({ ...prev, [field]: value }));
  };

  const handleReadmit = async () => {
    if (!activePatient) return;
    setSubmitting(true);
    try {
      const numberOrNull = (value: number | string) => {
        if (value === "" || value === null || value === undefined) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      await apiFetch(`/api/patients/${activePatient.patient_id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...activePatient,
          age: numberOrNull(profileUpdates.age),
          weight: numberOrNull(profileUpdates.weight),
          height: numberOrNull(profileUpdates.height),
          phone: profileUpdates.phone,
          allergies: profileUpdates.allergies,
          symptoms: profileUpdates.symptoms,
          gender: profileUpdates.gender,
          pregnant: profileUpdates.pregnant,
        }),
      });
      const data = await apiFetch<{ admission_id: string }>(`/api/patients/${activePatient.patient_id}/admissions`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      });

      const docsToUpload = DOC_TYPES.filter((doc) => docFiles[doc.value]).map((doc) => doc.value);
      let uploadedCount = 0;
      for (const docType of docsToUpload) {
        const file = docFiles[docType];
        if (!file) continue;
        const body = new FormData();
        body.append("file", file);
        body.append("doc_type", docType);
        body.append("admission_id", data.admission_id);
        body.append("ocr_text", ocrResults[docType]?.text || "");
        body.append("ocr_language", ocrLanguage);
        const uploadResponse = await fetch(`${API_BASE}/api/patients/${activePatient.patient_id}/documents`, {
          method: "POST",
          headers: withAuthHeaders({}, "POST"),
          body,
          credentials: "include",
        });
        if (!uploadResponse.ok) {
          throw new Error("Unable to upload readmission document.");
        }
        uploadedCount += 1;
      }

      setNotice({
        type: "success",
        message: uploadedCount
          ? `Re-admitted. Admission ${data.admission_id}. Uploaded ${uploadedCount} document${uploadedCount === 1 ? "" : "s"}.`
          : `Re-admitted. Admission ${data.admission_id}.`,
      });
      setNotes("");
      setDocFiles({});
      setOcrResults({});
      setOcrStatus({});
      await loadPreviousDocuments(activePatient.patient_id);
      onSelect({ ...activePatient, ...profileUpdates, admission_id: data.admission_id });
      await onReadmitComplete?.(activePatient.patient_id);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to re-admit patient.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel">
      <h3>Re-admit Patient</h3>
      <div className="search-bar">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, phone, or DOB" />
      </div>
      <div className="list-meta">
        <p className="muted">
          {query.trim()
            ? `Showing ${results.length} search result${results.length === 1 ? "" : "s"}.`
            : `Showing ${results.length} patient${results.length === 1 ? "" : "s"}.`}
        </p>
      </div>
      <div className="search-results">
        <Table>
          <TableHead>
            <TableCell>Patient</TableCell>
            <TableCell>Age</TableCell>
            <TableCell>Gender</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableHead>
          {results.map((patient) => {
            const expanded = activePatient?.patient_id === patient.patient_id;
            return (
              <Fragment key={patient.patient_id}>
                <TableRow className={expanded ? "active" : ""}>
                  <TableCell>
                    {patient.name} {patient.last_name}
                  </TableCell>
                  <TableCell>{patient.age || "-"}</TableCell>
                  <TableCell>{patient.gender || "-"}</TableCell>
                  <TableCell>{patient.phone || "-"}</TableCell>
                  <TableCell>{formatDateTimeIST(patient.created_at)}</TableCell>
                  <TableCell className="row-actions">
                    <Button
                      variant={expanded ? "ghost" : "primary"}
                      size="sm"
                      onClick={() => {
                        if (expanded) {
                          setActivePatient(null);
                          return;
                        }
                        void handleSelect(patient);
                      }}
                    >
                      {expanded ? "Hide" : "Readmit"}
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded && activePatient && (
                  <div className="table-row-expand">
                    <div className="readmit-form">
                      <h4>
                        Re-admitting: {activePatient.name} {activePatient.last_name}
                      </h4>
                      <Label>
                        Admission Notes
                        <Textarea className="readmit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
                      </Label>
                      <h5>Update Patient Details</h5>
                      <div className="readmit-profile-grid">
                        <Label>
                          Age
                          <Input type="number" value={profileUpdates.age} onChange={handleProfileChange("age")} />
                        </Label>
                        <Label>
                          Weight (kg)
                          <Input type="number" value={profileUpdates.weight} onChange={handleProfileChange("weight")} />
                        </Label>
                        <Label>
                          Height (cm)
                          <Input type="number" value={profileUpdates.height} onChange={handleProfileChange("height")} />
                        </Label>
                        <Label>
                          Phone
                          <Input value={profileUpdates.phone} onChange={handleProfileChange("phone")} />
                        </Label>
                        <Label>
                          Gender
                          <Select value={profileUpdates.gender} onChange={handleProfileChange("gender")}>
                            <option>Male</option>
                            <option>Female</option>
                            <option>Other</option>
                          </Select>
                        </Label>
                        <Label className="checkbox">
                          <Checkbox checked={profileUpdates.pregnant} onChange={handleProfileChange("pregnant")} />
                          Pregnant
                        </Label>
                        <Label className="span-2">
                          Allergies
                          <Textarea value={profileUpdates.allergies} onChange={handleProfileChange("allergies")} rows={2} />
                        </Label>
                        <Label className="span-2">
                          Current Symptoms
                          <Textarea value={profileUpdates.symptoms} onChange={handleProfileChange("symptoms")} rows={3} />
                        </Label>
                      </div>

                      <h4>Upload Documents</h4>
                      <p className="muted">Same workflow as admission: choose per type, run OCR, edit text, then confirm re-admission.</p>

                      <div className="documents">
                        <h4>Previous Documents</h4>
                        {previousDocumentsLoading ? (
                          <p className="muted">Loading previous documents...</p>
                        ) : previousDocuments.length === 0 ? (
                          <p className="muted">No previous documents found.</p>
                        ) : (
                          previousDocumentGroups.map((group) => (
                            <details key={group.key} className="doc-date-section" open>
                              <summary>
                                {group.label} ({group.items.length})
                              </summary>
                              <div className="doc-date-content">
                                {group.items.map((doc) => {
                                  const label = DOC_TYPES.find((item) => item.value === doc.doc_type)?.label || doc.doc_type;
                                  return (
                                    <details key={doc.id} className="doc-item">
                                      <summary>
                                        {label.toLowerCase()}
                                      </summary>
                                      {doc.file_name && <p className="muted">File: {stripUploadTimestampPrefix(doc.file_name)}</p>}
                                      {doc.ocr_language && <p className="muted">OCR Language: {doc.ocr_language}</p>}
                                      <div className="form-actions">
                                        <a className="link" href={`${API_BASE}/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
                                          Open file
                                        </a>
                                      </div>
                                      {doc.ocr_text && (
                                        <details>
                                          <summary>View OCR Text</summary>
                                          <div className="ocr-text-display">
                                            <MarkdownReport text={doc.ocr_text} />
                                          </div>
                                        </details>
                                      )}
                                    </details>
                                  );
                                })}
                              </div>
                            </details>
                          ))
                        )}
                      </div>

                      <div className="doc-grid">
                        {DOC_TYPES.map((doc) => (
                          <div key={doc.value} className="doc-card">
                            <h4>{doc.label}</h4>
                            <DocumentUploadDropzone
                              accept={SUPPORTED_DOCUMENT_ACCEPT}
                              file={docFiles[doc.value]}
                              helperText={`Supported: ${SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", ")}`}
                              onFileSelect={handleFileSelect(doc.value)}
                            />
                            <Button variant="secondary" type="button" onClick={() => void handleOCR(doc.value)}>
                              Process OCR
                            </Button>
                            {ocrStatus[doc.value] && <p className="muted">{ocrStatus[doc.value]}</p>}
                          </div>
                        ))}
                      </div>

                      {Object.keys(ocrResults).length > 0 && (
                        <div className="ocr-results">
                          <h4>OCR Results</h4>
                          {Object.entries(ocrResults).map(([docType, data]) => {
                            const label = DOC_TYPES.find((item) => item.value === docType)?.label || docType;
                            return (
                              <details key={docType} className="doc-item" open>
                                <summary>{label}</summary>
                                <div className="ocr-side-by-side">
                                  <div className="ocr-preview">
                                    <p className="muted">Original Document</p>
                                    <OriginalDocumentPreview file={data.file} />
                                  </div>
                                  <div className="ocr-preview">
                                    <p className="muted">Markdown Preview</p>
                                    <MarkdownReport text={data.text || ""} />
                                  </div>
                                </div>
                                <Textarea className="ocr-text" value={data.text || ""} onChange={handleOcrTextChange(docType)} />
                                <div className="form-actions">
                                  <Button variant="secondary" type="button" onClick={() => clearOcrEntry(docType)}>
                                    Clear
                                  </Button>
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      )}

                      <Button variant="primary" onClick={() => void handleReadmit()} disabled={submitting}>
                        {submitting ? "Submitting..." : "Confirm Re-admission"}
                      </Button>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </Table>
      </div>
    </section>
  );
}
