import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import MarkdownReport from "../components/MarkdownReport";
import { Alert, Button, Select, Textarea } from "../components/ui";
import { API_BASE, SUPPORTED_DOCUMENT_ACCEPT, SUPPORTED_DOCUMENT_EXTENSIONS } from "../lib/constants";
import { reportError, withAuthHeaders } from "../lib/api";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  ocrLanguage?: string;
  onNavigate: (page: string) => void;
};

const IMAGE_NAME_PATTERN = /\.(png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i;

const OCR_DOC_TYPES = [
  { value: "demographics", label: "Patient ID / Demographics Card" },
  { value: "prescriptions", label: "Medical Prescription" },
  { value: "lab_report", label: "Lab / Diagnostic Report" },
  { value: "xray_mri", label: "X-Ray / MRI Report" },
  { value: "general", label: "General Medical Document" },
];

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

function normalizeDateToIso(raw: string): string | null {
  const cleaned = raw.replace(/[.]/g, "/").replace(/-/g, "/").trim();
  const parts = cleaned.split("/").map((part) => part.trim());
  if (parts.length !== 3) return null;

  let day = 0;
  let month = 0;
  let year = 0;

  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else if (parts[2].length === 4) {
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
  } else {
    return null;
  }

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  const valid =
    candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
  if (!valid) return null;

  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (candidate.getTime() > utcToday.getTime()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDobFromText(text: string): string | null {
  const labeledPatterns = [
    /(?:date\s*of\s*birth|dob|d\.o\.b)\s*[:\-]?\s*((?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})|(?:\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}))/i,
    /(?:birth\s*date)\s*[:\-]?\s*((?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})|(?:\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}))/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const iso = normalizeDateToIso(match[1]);
    if (iso) return iso;
  }

  const genericDatePattern = /\b((?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})|(?:\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}))\b/g;
  const matches = text.match(genericDatePattern) || [];
  for (const raw of matches) {
    const iso = normalizeDateToIso(raw);
    if (iso) return iso;
  }
  return null;
}

function extractAgeFromText(text: string): string {
  const match = text.match(/(?:age|aged)\s*[:\-]?\s*(\d{1,3})\b/i);
  if (!match?.[1]) return "";
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 0 || value > 150) return "";
  return String(value);
}

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
    return <p className="muted">No source document selected.</p>;
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = mime.startsWith("image/") || IMAGE_NAME_PATTERN.test(file.name);

  if (isImage) {
    return <img className="ocr-source-image" src={url} alt={file.name} style={{ maxWidth: "100%", maxHeight: "400px", borderRadius: "8px", border: "1px solid var(--border-color)" }} />;
  }

  if (isPdf) {
    return <iframe className="ocr-source-pdf" src={url} title={`Preview ${file.name}`} style={{ width: "100%", height: "400px", borderRadius: "8px", border: "1px solid var(--border-color)" }} />;
  }

  return (
    <a className="link" href={url} target="_blank" rel="noreferrer">
      Open original document
    </a>
  );
}

export default function OcrPage({ setNotice, ocrLanguage = "eng", onNavigate }: Props) {
  const [selectedDocType, setSelectedDocType] = useState("demographics");
  const [file, setFile] = useState<File | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [status, setStatus] = useState("");
  const [extractedDob, setExtractedDob] = useState("");
  const [extractedAge, setExtractedAge] = useState("");

  const handleFileSelect = (selectedFile?: File) => {
    setFile(selectedFile);
    setOcrText("");
    setStatus("");
    setExtractedDob("");
    setExtractedAge("");
  };

  const handleProcessOcr = async () => {
    if (!file) {
      setStatus("Please upload an image or document first.");
      return;
    }

    setIsProcessing(true);
    setStatus("Running AI Optical Character Recognition (OCR)...");
    setOcrText("");
    setExtractedDob("");
    setExtractedAge("");

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("language", ocrLanguage);
      body.append("doc_type", selectedDocType);

      const response = await fetch(`${API_BASE}/api/ocr`, {
        method: "POST",
        headers: withAuthHeaders({}, "POST"),
        body,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      const text = data.text || "";
      setOcrText(text);
      setStatus("OCR processing completed successfully!");

      // Try to extract DOB and Age
      const dob = extractDobFromText(text) || "";
      let age = extractAgeFromText(text);
      if (dob && !age) {
        age = calculateAgeFromDob(dob);
      }

      setExtractedDob(dob);
      setExtractedAge(age);

      if (dob || age) {
        setNotice({
          type: "success",
          message: `Demographics detected! DOB: ${dob || "N/A"}, Age: ${age || "N/A"}`,
        });
      }
    } catch (err) {
      reportError(setNotice, err as { message?: string }, "Failed to process OCR on the document.");
      setStatus("OCR processing failed. Please check backend server connection.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceedToRegistration = () => {
    sessionStorage.setItem(
      "ocr_demographics",
      JSON.stringify({
        dob: extractedDob,
        age: extractedAge,
        notes: ocrText ? `[OCR Extracted Notes]:\n${ocrText}` : "",
      })
    );
    setNotice({
      type: "success",
      message: "Pre-filling Patient Registration form with extracted OCR demographics...",
    });
    onNavigate("add");
  };

  const handleClear = () => {
    setFile(undefined);
    setOcrText("");
    setStatus("");
    setExtractedDob("");
    setExtractedAge("");
  };

  return (
    <section className="page-section ocr-scanner-page">
      <div className="section-header">
        <div>
          <h2>Intelligent OCR Scanner</h2>
          <p className="muted">
            Upload medical ID cards, prescriptions, lab reports, or referral letters for instant AI text extraction and demographics processing.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "2rem", padding: "1.5rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <div style={{ flex: "1 1 250px" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Document Category</label>
            <Select value={selectedDocType} onChange={(e) => setSelectedDocType(e.target.value)}>
              {OCR_DOC_TYPES.map((doc) => (
                <option key={doc.value} value={doc.value}>
                  {doc.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>Upload Image / PDF Document</label>
          <DocumentUploadDropzone
            accept={SUPPORTED_DOCUMENT_ACCEPT}
            file={file}
            helperText={`Supported formats: ${SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", ")}`}
            onFileSelect={handleFileSelect}
          />
        </div>

        <div className="form-actions" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Button variant="primary" type="button" onClick={() => void handleProcessOcr()} disabled={!file || isProcessing}>
            {isProcessing ? "Processing OCR..." : "Start OCR Scanning"}
          </Button>
          <Button variant="secondary" type="button" onClick={handleClear} disabled={!file && !ocrText}>
            Clear / Reset
          </Button>
          {status && <span className="muted" style={{ marginLeft: "0.5rem" }}>{status}</span>}
        </div>
      </div>

      {(extractedDob || extractedAge) && (
        <div className="card" style={{ marginBottom: "2rem", padding: "1.5rem", borderLeft: "4px solid var(--primary-color)", backgroundColor: "var(--card-bg-alt, rgba(0, 120, 212, 0.05))" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--primary-color)" }}>✨ Patient Demographics Detected!</h4>
              <p style={{ margin: 0 }}>
                <strong>Date of Birth:</strong> {extractedDob || "Not found"} &nbsp;|&nbsp; <strong>Calculated Age:</strong> {extractedAge ? `${extractedAge} yrs` : "Not found"}
              </p>
            </div>
            <Button variant="primary" type="button" onClick={handleProceedToRegistration}>
              Register Patient with These Details ➔
            </Button>
          </div>
        </div>
      )}

      {(file || ocrText) && (
        <div className="card" style={{ padding: "1.5rem" }}>
          <h3 style={{ marginTop: 0, marginBottom: "1.5rem" }}>OCR Analysis & Extraction Results</h3>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "2rem", marginBottom: "1.5rem" }}>
            <div>
              <h4 className="muted" style={{ marginTop: 0 }}>Source Document</h4>
              <OriginalDocumentPreview file={file} />
            </div>
            <div>
              <h4 className="muted" style={{ marginTop: 0 }}>Formatted AI Output</h4>
              <div style={{ maxHeight: "400px", overflowY: "auto", padding: "1rem", border: "1px solid var(--border-color)", borderRadius: "8px", background: "var(--bg-color)" }}>
                {ocrText ? <MarkdownReport text={ocrText} /> : <p className="muted">Processing text...</p>}
              </div>
            </div>
          </div>

          <div>
            <h4 className="muted" style={{ marginTop: 0 }}>Raw Extracted Text (Editable)</h4>
            <Textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={8}
              placeholder="Extracted OCR text will appear here once processing completes..."
              style={{ width: "100%", fontFamily: "monospace" }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
