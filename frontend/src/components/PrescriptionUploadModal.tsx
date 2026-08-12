import { useEffect, useState, useRef } from "react";
import {
  Button,
  Input,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Textarea,
} from "./ui";
import { apiFetch, withAuthHeaders } from "../lib/api";
import { API_BASE } from "../lib/constants";
import type { Notice } from "../types";

type Props = {
  patientId: string;
  patientName: string;
  doctorName?: string;
  onClose: () => void;
  setNotice: (notice: Notice | null) => void;
  // "ocr" (default) is the original scan-and-digitize flow. "manual" skips
  // straight to the medicine table with a blank row so a doctor can write a
  // fresh prescription during consultation, without needing a document to
  // upload first.
  mode?: "ocr" | "manual";
};

type ParsedMedicine = {
  name: string;
  quantity: number;
  dosage: string;
};

type InventoryItem = {
  id: number;
  medicine_name: string;
  quantity?: number;
  reorder_level?: number;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes for large scanned/multi-page documents

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PrescriptionUploadModal({
  patientId,
  patientName,
  doctorName,
  onClose,
  setNotice,
  mode = "ocr",
}: Props) {
  const isManual = mode === "manual";
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [medicines, setMedicines] = useState<ParsedMedicine[]>(
    isManual ? [{ name: "", dosage: "", quantity: 1 }] : [],
  );
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [step, setStep] = useState<"upload" | "review" | "verify" | "done">(
    isManual ? "verify" : "upload",
  );
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isManual) return;
    apiFetch<{ items?: InventoryItem[] }>("/api/pharmacy/inventory")
      .then((data) => setInventory(data.items || []))
      .catch(() => setInventory([]));
  }, [isManual]);

  const stockFor = (medicineName: string) => {
    const name = medicineName.trim().toLowerCase();
    if (!name) return null;
    return (
      inventory.find((item) => item.medicine_name.trim().toLowerCase() === name) ||
      null
    );
  };

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
        const statusData = await apiFetch<{
          status: string;
          error_message?: string;
        }>(`/api/ocr-portal/jobs/${job_id}`);
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
        throw new Error(
          "OCR is taking longer than expected. Please try again shortly.",
        );
      }

      const resultData = await apiFetch<{ combined_markdown?: string }>(
        `/api/ocr-portal/jobs/${job_id}/result`,
      );
      const extractedText = resultData.combined_markdown || "";

      if (!extractedText) {
        throw new Error("No text extracted from OCR.");
      }

      setOcrText(extractedText);
      setStep("review");
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err.message || "Failed to process prescription.",
      });
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
        headers: withAuthHeaders(
          { "Content-Type": "application/json" },
          "POST",
        ),
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
        setNotice({
          type: "warning",
          message: "Allow pop-ups to print the prescription.",
        });
        return;
      }
      // Blob-URL PDFs opened via window.open don't reliably fire "load" on the
      // opener side across browsers, so give the built-in PDF viewer a moment
      // to render before invoking print.
      setTimeout(() => {
        printWindow.print();
      }, 800);
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err.message || "Failed to print prescription.",
      });
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

      const res = await fetch(
        `${API_BASE}/api/patients/${patientId}/documents`,
        {
          method: "POST",
          body: formData,
          headers: withAuthHeaders({}, "POST"),
          credentials: "include",
        },
      );

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Failed to save prescription text.");
      }

      if (payload.document_id) {
        setDocumentId(payload.document_id);
      }

      setNotice({
        type: "success",
        message:
          "Prescription saved. The patient will be notified on WhatsApp shortly.",
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err.message || "Failed to save prescription text.",
      });
    } finally {
      setSavingText(false);
    }
  };

  const handleParseMedicines = async () => {
    setParsing(true);
    try {
      const parseData = await apiFetch<{ medicines: ParsedMedicine[] }>(
        "/api/ocr-portal/parse-prescription",
        {
          method: "POST",
          body: JSON.stringify({ text: ocrText }),
        },
      );

      setMedicines(parseData.medicines || []);
      setStep("verify");
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err.message || "Failed to parse medicines.",
      });
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    const finalMedicines = medicines.filter((med) => med.name.trim());
    if (finalMedicines.length === 0) {
      setNotice({
        type: "warning",
        message: "Add at least one medicine before sending to pharmacy.",
      });
      return;
    }
    try {
      await apiFetch("/api/pharmacy/prescriptions", {
        method: "POST",
        body: JSON.stringify({
          patient_id: patientId,
          medicines_json: JSON.stringify(finalMedicines),
          doc_id: documentId,
        }),
      });
      setNotice({
        type: "success",
        message: "Prescription sent to pharmacy successfully.",
      });
      setStep("done");
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setNotice({
        type: "error",
        message: err.message || "Failed to send prescription.",
      });
    }
  };

  const handleMedicineChange = (
    index: number,
    field: keyof ParsedMedicine,
    value: any,
  ) => {
    setMedicines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content"
        style={{
          width: "90%",
          maxWidth: "600px",
          background: "var(--color-bg)",
          padding: "1.5rem",
          borderRadius: "8px",
          position: "relative",
          zIndex: 1000,
          margin: "10vh auto",
        }}
      >
        <div
          className="modal-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <h2>
            {isManual ? "Write Prescription for" : "Upload Prescription for"}{" "}
            {patientName}
          </h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              cursor: "pointer",
              background: "none",
              border: "none",
              fontSize: "1.5rem",
            }}
          >
            &times;
          </button>
        </div>

        {step === "upload" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.5rem",
            }}
          >
            <p
              style={{
                textAlign: "center",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Select a scanned image or photo of the prescription to digitize.
            </p>
            <div
              style={{
                border: "2px dashed hsl(var(--border))",
                borderRadius: "12px",
                padding: "3rem 2rem",
                width: "100%",
                textAlign: "center",
                background: "hsl(var(--card))",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = "hsl(var(--accent))";
                e.currentTarget.style.background = "hsl(var(--accent-tint))";
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = "hsl(var(--border))";
                e.currentTarget.style.background = "hsl(var(--card))";
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = "hsl(var(--border))";
                e.currentTarget.style.background = "hsl(var(--card))";
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  setFile(e.dataTransfer.files[0]);
                  e.dataTransfer.clearData();
                }
              }}
            >
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: "hsl(var(--background))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 1.5rem auto",
                  boxShadow: "0 4px 12px -4px rgba(0,0,0,0.1)",
                }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              <h3
                style={{
                  margin: "0 0 0.75rem 0",
                  color: "hsl(var(--foreground))",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                }}
              >
                Click or drag and drop to upload
              </h3>
              <p
                style={{
                  margin: 0,
                  color: "hsl(var(--muted-foreground))",
                  fontSize: "0.95rem",
                }}
              >
                SVG, PNG, JPG or PDF
              </p>

              {file && (
                <div
                  style={{
                    marginTop: "2rem",
                    padding: "1rem",
                    background: "hsl(var(--background))",
                    borderRadius: "8px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    boxShadow: "0 2px 8px -2px rgba(0,0,0,0.05)",
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                  >
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                  </svg>
                  <span
                    style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
                  >
                    {file.name}
                  </span>
                </div>
              )}
              <input
                type="file"
                accept="image/*,.pdf"
                ref={fileInputRef}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{
                  opacity: 0,
                  width: 0,
                  height: 0,
                  position: "absolute",
                  overflow: "hidden",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "flex-end",
                width: "100%",
                marginTop: "0.5rem",
              }}
            >
              <Button
                variant="secondary"
                onClick={onClose}
                style={{ padding: "0.75rem 1.5rem" }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{ padding: "0.75rem 1.5rem", minWidth: "200px" }}
              >
                {uploading ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span
                      className="spinner"
                      style={{
                        width: "16px",
                        height: "16px",
                        border: "2px solid currentColor",
                        borderRightColor: "transparent",
                        borderRadius: "50%",
                        animation: "spin 0.75s linear infinite",
                      }}
                    ></span>
                    Extracting...
                  </span>
                ) : (
                  "Upload & Extract Text"
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div>
            <p>
              Review the extracted text below. Correct any OCR mistakes before
              saving.
            </p>
            <Textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={12}
              style={{
                width: "100%",
                marginBottom: "1rem",
                fontFamily: "monospace",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <Button
                onClick={handleParseMedicines}
                disabled={parsing || !ocrText.trim()}
              >
                {parsing ? "Parsing..." : "Parse Medicines for Pharmacy"}
              </Button>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <Button onClick={onClose}>Close</Button>
                <Button
                  onClick={handlePrint}
                  disabled={printing || !ocrText.trim()}
                >
                  {printing ? "Preparing..." : "Print"}
                </Button>
                <Button
                  onClick={handleSaveText}
                  disabled={savingText || !ocrText.trim()}
                >
                  {savingText ? "Saving..." : "Save & Notify Patient"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "verify" && (
          <div>
            <p>
              {isManual
                ? "Write out the medicines for this patient. Stock is shown from current pharmacy inventory."
                : "Review the extracted medicines. You can edit them before sending to pharmacy."}
            </p>
            {isManual && (
              <datalist id="prescription-medicine-names">
                {inventory.map((item) => (
                  <option key={item.id} value={item.medicine_name} />
                ))}
              </datalist>
            )}
            <div
              style={{ overflowX: "auto", marginBottom: "1rem", width: "100%" }}
            >
              <Table>
                <TableHead>
                  <TableCell>Medicine</TableCell>
                  {isManual && <TableCell>Stock</TableCell>}
                  <TableCell>Dosage</TableCell>
                  <TableCell>Qty</TableCell>
                  <TableCell>Action</TableCell>
                </TableHead>
                {medicines.map((med, i) => {
                  const stockItem = isManual ? stockFor(med.name) : null;
                  const quantity = Number(stockItem?.quantity ?? 0);
                  const reorderLevel = Number(stockItem?.reorder_level ?? 0);
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={med.name}
                          list={isManual ? "prescription-medicine-names" : undefined}
                          placeholder={isManual ? "Medicine name" : undefined}
                          onChange={(e) =>
                            handleMedicineChange(i, "name", e.target.value)
                          }
                        />
                      </TableCell>
                      {isManual && (
                        <TableCell>
                          {!med.name.trim() ? (
                            <span className="muted">—</span>
                          ) : !stockItem ? (
                            <span className="pharmacy-badge pharmacy-badge-warning">
                              Not in inventory
                            </span>
                          ) : quantity <= 0 ? (
                            <span className="pharmacy-badge pharmacy-badge-danger">
                              Out of stock
                            </span>
                          ) : quantity <= reorderLevel ? (
                            <span className="pharmacy-badge pharmacy-badge-warning">
                              Low ({quantity})
                            </span>
                          ) : (
                            <span className="pharmacy-badge pharmacy-badge-success">
                              {quantity} in stock
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Input
                          value={med.dosage}
                          placeholder={isManual ? "e.g. 1-0-1, 5 days" : undefined}
                          onChange={(e) =>
                            handleMedicineChange(i, "dosage", e.target.value)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={med.quantity}
                          onChange={(e) =>
                            handleMedicineChange(
                              i,
                              "quantity",
                              Number(e.target.value),
                            )
                          }
                          style={{ width: "60px" }}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() =>
                            setMedicines(medicines.filter((_, idx) => idx !== i))
                          }
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Table>
            </div>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <Button
                onClick={() =>
                  setMedicines([
                    ...medicines,
                    { name: "", dosage: "", quantity: 1 },
                  ])
                }
              >
                Add Medicine
              </Button>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {!isManual && (
                  <Button onClick={() => setStep("review")}>Back</Button>
                )}
                <Button onClick={handleConfirm}>
                  Confirm & Send to Pharmacy
                </Button>
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
