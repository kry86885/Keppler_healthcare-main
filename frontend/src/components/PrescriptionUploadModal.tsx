import { useState, useRef } from "react";
import { Button, Input, Table, TableCell, TableHead, TableRow, Textarea } from "./ui";
import { apiFetch, withAuthHeaders } from "../lib/api";
import { API_BASE } from "../lib/constants";
import type { Notice } from "../types";

type Props = {
  patientId: string;
  patientName: string;
  doctorName?: string;
  onClose: () => void;
  setNotice: (notice: Notice | null) => void;
};

type ParsedMedicine = {
  name: string;
  quantity: number;
  dosage: string;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes for large scanned/multi-page documents

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PrescriptionUploadModal({ patientId, patientName, doctorName, onClose, setNotice }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [medicines, setMedicines] = useState<ParsedMedicine[]>([]);
  const [step, setStep] = useState<"upload" | "review" | "verify" | "done">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("blueprint", "Universal OCR (Any Text)");

      const uploadRes = await fetch(`${API_BASE}/api/ocr-portal/upload`, {
        method: "POST",
        body: formData,
        headers: withAuthHeaders({}, "POST"),
        credentials: "include",
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload prescription");
      }

      const { job_id } = await uploadRes.json();

      // Poll for job completion. The OCR service reports status in upper case
      // (PENDING/PROCESSING/COMPLETED/FAILED).
      let finalStatus = "";
      let errorMessage = "";
      for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        await sleep(POLL_INTERVAL_MS);
        const statusData = await apiFetch<{ status: string; error_message?: string }>(
          `/api/ocr-portal/jobs/${job_id}`
        );
        const status = (statusData.status || "").toUpperCase();
        if (status === "COMPLETED") {
          finalStatus = status;
          break;
        } else if (status === "FAILED") {
          errorMessage = statusData.error_message || "OCR processing failed.";
          break;
        }
      }

      if (errorMessage) {
        throw new Error(errorMessage);
      }
      if (finalStatus !== "COMPLETED") {
        throw new Error("OCR is taking longer than expected. Please try again shortly.");
      }

      const resultData = await apiFetch<{ combined_markdown?: string }>(
        `/api/ocr-portal/jobs/${job_id}/result`
      );
      const extractedText = resultData.combined_markdown || "";

      if (!extractedText) {
        throw new Error("No text extracted from OCR.");
      }

      setOcrText(extractedText);
      setStep("review");
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to process prescription." });
    } finally {
      setUploading(false);
    }
  };

  const handlePrint = async () => {
    if (!ocrText.trim()) return;
    setPrinting(true);
    try {
      const res = await fetch(`${API_BASE}/api/export/pdf`, {
        method: "POST",
        headers: withAuthHeaders({ "Content-Type": "application/json" }, "POST"),
        credentials: "include",
        body: JSON.stringify({
          patient_name: patientName,
          doc_type: "Prescription",
          ocr_text: ocrText,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate the prescription PDF.");
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, "_blank");
      if (!printWindow) {
        setNotice({ type: "warning", message: "Allow pop-ups to print the prescription." });
        return;
      }
      // Blob-URL PDFs opened via window.open don't reliably fire "load" on the
      // opener side across browsers, so give the built-in PDF viewer a moment
      // to render before invoking print.
      setTimeout(() => {
        printWindow.print();
      }, 800);
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to print prescription." });
    } finally {
      setPrinting(false);
    }
  };

  const handleSaveText = async () => {
    if (!file) return;
    setSavingText(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("doc_type", "prescriptions");
      formData.append("ocr_text", ocrText);
      if (doctorName) {
        formData.append("doctor_name", doctorName);
      }

      const res = await fetch(`${API_BASE}/api/patients/${patientId}/documents`, {
        method: "POST",
        body: formData,
        headers: withAuthHeaders({}, "POST"),
        credentials: "include",
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save prescription text.");
      }

      setNotice({ type: "success", message: "Prescription saved. The patient will be notified on WhatsApp shortly." });
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to save prescription text." });
    } finally {
      setSavingText(false);
    }
  };

  const handleParseMedicines = async () => {
    setParsing(true);
    try {
      const parseData = await apiFetch<{ medicines: ParsedMedicine[] }>("/api/ocr-portal/parse-prescription", {
        method: "POST",
        body: JSON.stringify({ text: ocrText }),
      });

      setMedicines(parseData.medicines || []);
      setStep("verify");
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to parse medicines." });
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    try {
      await apiFetch("/api/pharmacy/prescriptions", {
        method: "POST",
        body: JSON.stringify({
          patient_id: patientId,
          medicines_json: JSON.stringify(medicines),
        }),
      });
      setNotice({ type: "success", message: "Prescription sent to pharmacy successfully." });
      setStep("done");
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to send prescription." });
    }
  };

  const handleMedicineChange = (index: number, field: keyof ParsedMedicine, value: any) => {
    setMedicines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: "600px", background: "var(--color-bg)", padding: "1.5rem", borderRadius: "8px", position: "relative", zIndex: 1000, margin: "10% auto" }}>
        <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h2>Upload Prescription for {patientName}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal" style={{ cursor: "pointer", background: "none", border: "none", fontSize: "1.5rem" }}>
            &times;
          </button>
        </div>

        {step === "upload" && (
          <div>
            <p>Select a scanned image or photo of the prescription to digitize.</p>
            <input
              type="file"
              accept="image/*,.pdf"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ display: "block", marginBottom: "1rem" }}
            />
            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!file || uploading}>
                {uploading ? "Extracting..." : "Upload & Extract Text"}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div>
            <p>Review the extracted text below. Correct any OCR mistakes before saving.</p>
            <Textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={12}
              style={{ width: "100%", marginBottom: "1rem", fontFamily: "monospace" }}
            />
            <div style={{ display: "flex", gap: "1rem", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Button onClick={handleParseMedicines} disabled={parsing || !ocrText.trim()}>
                {parsing ? "Parsing..." : "Parse Medicines for Pharmacy"}
              </Button>
              <div style={{ display: "flex", gap: "1rem" }}>
                <Button onClick={onClose}>Close</Button>
                <Button onClick={handlePrint} disabled={printing || !ocrText.trim()}>
                  {printing ? "Preparing..." : "Print"}
                </Button>
                <Button onClick={handleSaveText} disabled={savingText || !ocrText.trim()}>
                  {savingText ? "Saving..." : "Save & Notify Patient"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "verify" && (
          <div>
            <p>Review the extracted medicines. You can edit them before sending to pharmacy.</p>
            <Table style={{ marginBottom: "1rem" }}>
              <TableHead>
                <TableCell>Medicine</TableCell>
                <TableCell>Dosage</TableCell>
                <TableCell>Qty</TableCell>
                <TableCell>Action</TableCell>
              </TableHead>
              {medicines.map((med, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={med.name}
                      onChange={(e) => handleMedicineChange(i, "name", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={med.dosage}
                      onChange={(e) => handleMedicineChange(i, "dosage", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={med.quantity}
                      onChange={(e) => handleMedicineChange(i, "quantity", Number(e.target.value))}
                      style={{ width: "60px" }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button onClick={() => setMedicines(medicines.filter((_, idx) => idx !== i))}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "space-between" }}>
              <Button onClick={() => setMedicines([...medicines, { name: "", dosage: "", quantity: 1 }])}>
                Add Medicine
              </Button>
              <div style={{ display: "flex", gap: "1rem" }}>
                <Button onClick={() => setStep("review")}>Back</Button>
                <Button onClick={handleConfirm}>Confirm & Send to Pharmacy</Button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <h3>Success!</h3>
            <p>Prescription has been sent to the pharmacy queue.</p>
          </div>
        )}
      </div>
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 999;
          overflow-y: auto;
        }
      `}</style>
    </div>
  );
}
