import { useEffect, useRef, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import {
  FiCheck,
  FiLoader,
  FiSearch,
  FiUploadCloud,
  FiUsers,
} from "react-icons/fi";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import {
  Button,
  Modal,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Textarea,
} from "../components/ui";
import {
  apiFetch,
  getHospitalCode,
  getCsrfToken,
  reportError,
} from "../lib/api";
import { API_BASE } from "../lib/constants";
import type { Notice } from "../types";

type Props = {
  setNotice: (notice: Notice | null) => void;
};

type StepKey = "upload" | "processing" | "query";

type JobStatus = {
  id: number;
  status: "IMPORTING" | "EXTRACTING" | "AWAITING_PROMPT" | "DONE" | "FAILED";
  kind?: "spreadsheet" | "document";
  processed_rows?: number;
  imported_count?: number;
  skipped_count?: number;
  error?: string;
};

type BulkPatientRow = {
  patient_id: string;
  name: string;
  last_name: string;
  phone: string;
  age?: number;
  gender?: string;
  area?: string;
  medical_condition?: string;
};

const JOB_ID_STORAGE_KEY = "hospai_bulk_import_job_id";
const POLL_INTERVAL_MS = 2000;
const PAGE_SIZE = 150;

const SPREADSHEET_STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "upload", label: "Upload", hint: "Add your file" },
  { key: "processing", label: "Import", hint: "AI reads & imports" },
  { key: "query", label: "Search", hint: "Find & contact" },
];

const DOCUMENT_STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "upload", label: "Upload", hint: "Add your file" },
  { key: "processing", label: "Extract Text", hint: "Reading document" },
  { key: "query", label: "Ask AI", hint: "Prompt & review" },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BulkPatientAiPage({ setNotice }: Props) {
  const [step, setStep] = useState<StepKey>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [jobKind, setJobKind] = useState<"spreadsheet" | "document">(
    "spreadsheet",
  );
  const [prompt, setPrompt] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<BulkPatientRow[]>([]);
  const [answer, setAnswer] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [whatsappTarget, setWhatsappTarget] = useState<BulkPatientRow | null>(
    null,
  );
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const pollingRef = useRef(false);

  const STEPS = jobKind === "document" ? DOCUMENT_STEPS : SPREADSHEET_STEPS;
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const startPolling = (id: number) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    (async () => {
      while (pollingRef.current) {
        try {
          const data = await apiFetch<JobStatus>(`/api/bulk-import/jobs/${id}`);
          setJob(data);
          if (data.kind) setJobKind(data.kind);
          if (data.status === "AWAITING_PROMPT") {
            setStep("query");
            pollingRef.current = false;
            return;
          }
          if (data.status === "DONE") {
            setStep("query");
            pollingRef.current = false;
            return;
          }
          if (data.status === "FAILED") {
            setNotice({
              type: "error",
              message: data.error || "Bulk import failed.",
            });
            pollingRef.current = false;
            return;
          }
          if (data.status === "IMPORTING" || data.status === "EXTRACTING") {
            setStep("processing");
          }
        } catch (error) {
          reportError(
            setNotice,
            error as { message?: string; status?: number },
            "Unable to check import status.",
          );
          pollingRef.current = false;
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    })();
  };

  useEffect(() => {
    const stored = localStorage.getItem(JOB_ID_STORAGE_KEY);
    if (stored) {
      const id = Number(stored);
      setJobId(id);
      startPolling(id);
    }
    return () => {
      pollingRef.current = false;
    };
  }, []);

  const handleUpload = () => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/bulk-import/upload`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Hospital-Code", getHospitalCode());
    const csrfToken = getCsrfToken();
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        localStorage.setItem(JOB_ID_STORAGE_KEY, String(data.job_id));
        setJobId(data.job_id);
        startPolling(data.job_id);
      } else {
        const payload = JSON.parse(xhr.responseText || "{}");
        setNotice({
          type: "error",
          message: payload.error || "Upload failed.",
        });
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setNotice({
        type: "error",
        message: "Upload failed. Check your connection and try again.",
      });
    };

    xhr.send(formData);
  };

  const runSearch = async (targetPage: number, append: boolean) => {
    try {
      const data = await apiFetch<{ results: BulkPatientRow[]; total: number }>(
        "/api/bulk-import/query",
        {
          method: "POST",
          body: JSON.stringify({
            prompt,
            job_id: jobId,
            page: targetPage,
            page_size: PAGE_SIZE,
          }),
        },
      );
      setResults((prev) =>
        append ? [...prev, ...(data.results || [])] : data.results || [],
      );
      setTotal(data.total || 0);
      setPage(targetPage);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to run that search.",
      );
    }
  };

  const handleAskDocument = async () => {
    if (!jobId || !prompt.trim()) return;
    setSearching(true);
    try {
      const data = await apiFetch<{
        results: BulkPatientRow[];
        total: number;
        answer?: string;
      }>(`/api/bulk-import/jobs/${jobId}/ask`, {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setResults(data.results || []);
      setTotal(data.total || 0);
      setAnswer(data.answer || "");
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to answer that prompt.",
      );
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async () => {
    if (jobKind === "document") {
      await handleAskDocument();
      return;
    }
    setSearching(true);
    await runSearch(1, false);
    setSearching(false);
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await runSearch(page + 1, true);
    setLoadingMore(false);
  };

  const handleStartOver = () => {
    localStorage.removeItem(JOB_ID_STORAGE_KEY);
    pollingRef.current = false;
    setJobId(null);
    setJob(null);
    setJobKind("spreadsheet");
    setFile(null);
    setPrompt("");
    setResults([]);
    setAnswer("");
    setTotal(0);
    setPage(1);
    setStep("upload");
  };

  const openWhatsappModal = (row: BulkPatientRow) => {
    setWhatsappTarget(row);
    const name = `${row.name || ""} ${row.last_name || ""}`.trim() || "there";
    setWhatsappMessage(
      row.medical_condition
        ? `Hello ${name}, our records show: ${row.medical_condition}. Please contact us or visit for a follow-up.`
        : `Hello ${name}, please contact us at your earliest convenience for a follow-up.`,
    );
  };

  const handleSendWhatsapp = () => {
    if (!whatsappTarget?.phone) return;
    const digits = whatsappTarget.phone.replace(/\D/g, "");
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(whatsappMessage)}`,
      "_blank",
    );
    setWhatsappTarget(null);
  };

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <div>
          <p className="muted">
            Upload a large patient list (.xlsx or .csv, up to 200MB) -- the AI
            automatically detects which column is phone/name/age/etc. and
            imports it, no manual setup needed -- then search it with a
            plain-English prompt like "diabetic patients in Koramangala". Or
            upload a PDF/DOCX document (discharge summary, referral letter,
            etc.) and ask questions about what's in it.
          </p>
        </div>
        {jobId && (
          <Button variant="secondary" onClick={handleStartOver}>
            <FiUploadCloud aria-hidden /> Reupload
          </Button>
        )}
      </div>

      <div className="journey-steps" role="list" aria-label="AI Mode steps">
        {STEPS.map((s, index) => {
          const isDone =
            index < stepIndex || (step === "query" && s.key !== "query");
          const isActive = index === stepIndex;
          const state = isActive
            ? "journey-step-active"
            : isDone
              ? "journey-step-completed"
              : "journey-step-upcoming";
          return (
            <div className="journey-step-wrap" key={s.key}>
              <div className={`journey-step ${state}`}>
                <span className="journey-step-circle">
                  {isDone ? <FiCheck aria-hidden /> : index + 1}
                </span>
                <span className="journey-step-text">
                  <span className="journey-step-label">{s.label}</span>
                  <span className="journey-step-hint">{s.hint}</span>
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <span
                  className={
                    isDone
                      ? "journey-step-connector filled"
                      : "journey-step-connector"
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {step === "upload" && (
        <div className="panel">
          <div className="module-panel-head">
            <h4>1. Upload a patient list</h4>
          </div>
          <DocumentUploadDropzone
            accept=".xlsx,.csv,.pdf,.docx"
            file={file || undefined}
            disabled={uploading}
            helperText="Accepts .xlsx or .csv (up to 200MB, rows without a phone number will be skipped) or a .pdf/.docx document to ask questions about."
            onFileSelect={setFile}
          />
          {uploading && (
            <div className="ai-upload-progress">
              <div className="trend-bar-track">
                <div
                  className="trend-bar-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="muted">Uploading... {uploadProgress}%</span>
            </div>
          )}
          <div style={{ marginTop: "1.1rem" }}>
            <Button onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? (
                "Uploading..."
              ) : (
                <>
                  <FiUploadCloud aria-hidden /> Upload &amp; Analyze
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="panel ai-processing-panel">
          <div className="ai-processing-spinner">
            <FiLoader aria-hidden />
          </div>
          {jobKind === "document" ? (
            <>
              <div className="module-panel-head">
                <h4>2. Extracting text from your document...</h4>
              </div>
              <p className="muted">
                Reading and OCR'ing your document -- this only takes a moment.
                Feel free to leave this page and come back.
              </p>
            </>
          ) : (
            <>
              <div className="module-panel-head">
                <h4>2. Reading columns &amp; importing patient records...</h4>
              </div>
              <p className="muted">
                The AI is detecting which column is phone/name/age/etc. and
                importing automatically -- no manual setup needed. Processed{" "}
                {job?.processed_rows ?? 0} rows so far (
                {job?.imported_count ?? 0} contactable,{" "}
                {job?.skipped_count ?? 0} skipped for missing phone numbers).
                This can take a while for large files -- feel free to leave this
                page and come back.
              </p>
            </>
          )}
          <div style={{ marginTop: "1rem" }}>
            <Button variant="secondary" onClick={handleStartOver}>
              <FiUploadCloud aria-hidden /> Reupload
            </Button>
          </div>
        </div>
      )}

      {step === "query" && (
        <>
          <div className="panel">
            <div className="module-panel-head">
              <h4>
                {jobKind === "document"
                  ? "3. Ask about your document"
                  : "3. Search your uploaded list"}
              </h4>
              <Button variant="ghost" onClick={handleStartOver}>
                <FiUploadCloud aria-hidden /> Reupload
              </Button>
            </div>
            <div className="ai-search-bar">
              <FiSearch className="ai-search-icon" aria-hidden />
              <Textarea
                rows={1}
                className="ai-search-input"
                placeholder={
                  jobKind === "document"
                    ? "e.g. list every patient mentioned with their phone number and condition"
                    : "e.g. diabetic patients in Koramangala"
                }
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSearch();
                  }
                }}
              />
              <Button
                onClick={handleSearch}
                disabled={
                  searching || (jobKind === "document" && !prompt.trim())
                }
              >
                {searching
                  ? jobKind === "document"
                    ? "Asking..."
                    : "Searching..."
                  : jobKind === "document"
                    ? "Ask"
                    : "Search"}
              </Button>
            </div>
          </div>

          {jobKind === "document" && answer && (
            <div className="panel">
              <div className="module-panel-head">
                <h4>Answer</h4>
              </div>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {answer}
              </p>
            </div>
          )}

          <div className="panel">
            {results.length === 0 ? (
              <div className="module-empty-state">
                <span className="module-empty-state-icon">
                  <FiUsers aria-hidden />
                </span>
                <p className="module-empty-state-title">No results yet</p>
                <p className="module-empty-state-hint">
                  {jobKind === "document"
                    ? "Ask a question above about the people or details in this document."
                    : "Try a search prompt above, or leave it blank to browse the full uploaded list."}
                </p>
              </div>
            ) : (
              <>
                <div className="module-panel-head">
                  <p className="muted">
                    {jobKind === "document"
                      ? `Found ${results.length} matching patient${results.length === 1 ? "" : "s"} in this document`
                      : `Showing ${results.length} of ${total} matching patient${total === 1 ? "" : "s"}`}
                  </p>
                </div>
                <Table
                  className="module-table module-table-bulk-ai"
                  role="table"
                  aria-label="Bulk patient search results"
                >
                  <TableHead>
                    <TableCell>Name</TableCell>
                    <TableCell>Phone</TableCell>
                    <TableCell>Area</TableCell>
                    <TableCell>Medical Condition</TableCell>
                    <TableCell>Age</TableCell>
                    <TableCell>Gender</TableCell>
                    <TableCell>Contact</TableCell>
                  </TableHead>
                  {results.map((row) => (
                    <TableRow key={row.patient_id}>
                      <TableCell>
                        {`${row.name || ""} ${row.last_name || ""}`.trim() ||
                          "-"}
                      </TableCell>
                      <TableCell>{row.phone || "-"}</TableCell>
                      <TableCell>{row.area || "-"}</TableCell>
                      <TableCell>{row.medical_condition || "-"}</TableCell>
                      <TableCell>{row.age ?? "-"}</TableCell>
                      <TableCell>{row.gender || "-"}</TableCell>
                      <TableCell>
                        {row.phone ? (
                          <button
                            type="button"
                            className="ai-whatsapp-btn"
                            aria-label={`Message ${row.name} on WhatsApp`}
                            onClick={() => openWhatsappModal(row)}
                          >
                            <FaWhatsapp />
                          </button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Table>
                {jobKind === "spreadsheet" && results.length < total && (
                  <div className="ai-load-more">
                    <Button
                      variant="secondary"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore
                        ? "Loading..."
                        : `Load more (${total - results.length} remaining)`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <Modal
        open={!!whatsappTarget}
        onClose={() => setWhatsappTarget(null)}
        title={`Message ${whatsappTarget ? `${whatsappTarget.name || ""} ${whatsappTarget.last_name || ""}`.trim() : ""}`}
        description="Edit the message before it opens in WhatsApp -- nothing is sent automatically."
      >
        <Textarea
          rows={5}
          value={whatsappMessage}
          onChange={(event) => setWhatsappMessage(event.target.value)}
          style={{ width: "100%" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
            marginTop: "1rem",
          }}
        >
          <Button variant="ghost" onClick={() => setWhatsappTarget(null)}>
            Cancel
          </Button>
          <Button onClick={handleSendWhatsapp}>Send via WhatsApp</Button>
        </div>
      </Modal>
    </section>
  );
}
