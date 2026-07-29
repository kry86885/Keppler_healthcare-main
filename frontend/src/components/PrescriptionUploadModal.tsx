import { useState, useRef } from "react";
import { Button, Input, Table, TableCell, TableHead, TableRow } from "./ui";
import { apiFetch } from "../lib/api";
import type { Notice } from "../types";

type Props = {
  patientId: string;
  patientName: string;
  onClose: () => void;
  setNotice: (notice: Notice | null) => void;
};

type ParsedMedicine = {
  name: string;
  quantity: number;
  dosage: string;
};

export default function PrescriptionUploadModal({ patientId, patientName, onClose, setNotice }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [medicines, setMedicines] = useState<ParsedMedicine[]>([]);
  const [step, setStep] = useState<"upload" | "verify" | "done">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("blueprint", "Universal OCR (Any Text)");

      const uploadRes = await fetch("/api/ocr-portal/upload", {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem("token")}`,
        },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload prescription");
      }
      
      const { job_id } = await uploadRes.json();
      
      // Poll for job completion
      let ocrText = "";
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusData = await apiFetch<{ status: string; result_text?: string }>(`/api/ocr-portal/jobs/${job_id}`);
        if (statusData.status === "completed") {
          ocrText = statusData.result_text || "";
          break;
        } else if (statusData.status === "failed") {
          throw new Error("OCR processing failed.");
        }
      }

      if (!ocrText) {
        throw new Error("No text extracted from OCR.");
      }

      setUploading(false);
      setParsing(true);

      const parseData = await apiFetch<{ medicines: ParsedMedicine[] }>("/api/ocr-portal/parse-prescription", {
        method: "POST",
        body: JSON.stringify({ text: ocrText }),
      });

      setMedicines(parseData.medicines || []);
      setStep("verify");
    } catch (err: any) {
      setNotice({ type: "error", message: err.message || "Failed to process prescription." });
    } finally {
      setUploading(false);
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
              <Button onClick={handleUpload} disabled={!file || uploading || parsing}>
                {uploading ? "Extracting..." : parsing ? "Parsing..." : "Upload & Analyze"}
              </Button>
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
                <Button onClick={onClose}>Cancel</Button>
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
