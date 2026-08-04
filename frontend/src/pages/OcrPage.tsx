import { useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import MarkdownReport from "../components/MarkdownReport";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "../components/ui";
import { API_BASE, SUPPORTED_DOCUMENT_ACCEPT, SUPPORTED_DOCUMENT_EXTENSIONS } from "../lib/constants";
import { apiFetch, reportError, withAuthHeaders } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type OcrJob = {
  job_id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  error_message?: string | null;
};

type OcrJobResult = {
  filename: string;
  combined_markdown: string;
  entities: unknown[];
  confidence_score: number | null;
};

type VaultDoc = {
  id: number;
  filename: string;
  doc_category: string | null;
  confidence_score: number | null;
  extraction_date: string | null;
};

type VaultDocDetail = {
  id: number;
  markdown: string;
};

type KbDoc = {
  doc_id: number;
  filename: string;
  category: string | null;
  chunk_count: number;
};

type ChatCitation = {
  doc_id: number;
  filename: string;
  page_label?: string | null;
  snippet?: string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
};

const EXPORT_FORMATS: { value: string; label: string }[] = [
  { value: "md", label: "Markdown" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "xlsx", label: "Excel" },
];

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Icon({ name, size = 18 }: { name: "upload" | "folder" | "chat" | "file" | "check" | "clock" | "alert"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    upload: (
      <>
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" {...STROKE} />
        <path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16" {...STROKE} />
      </>
    ),
    folder: (
      <>
        <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" {...STROKE} />
      </>
    ),
    chat: (
      <>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 14.5Z" {...STROKE} />
      </>
    ),
    file: (
      <>
        <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" {...STROKE} />
        <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" {...STROKE} />
      </>
    ),
    check: <path d="M5 12.5l4.5 4.5L19 7" {...STROKE} />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" {...STROKE} />
        <path d="M12 8v4l3 2" {...STROKE} />
      </>
    ),
    alert: (
      <>
        <path d="M12 8.5v4.2" {...STROKE} />
        <path d="M10.3 4.3 2.9 17.5A1.8 1.8 0 0 0 4.5 20h15a1.8 1.8 0 0 0 1.6-2.5L13.7 4.3a1.8 1.8 0 0 0-3.4 0Z" {...STROKE} />
        <circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function confidenceVariant(score: number | null): "default" | "secondary" | "destructive" {
  if (score == null) return "secondary";
  if (score >= 90) return "default";
  if (score >= 70) return "secondary";
  return "destructive";
}

function jobStatusMeta(status: OcrJob["status"]): { label: string; variant: "default" | "secondary" | "destructive"; icon: "clock" | "check" | "alert" } {
  switch (status) {
    case "COMPLETED":
      return { label: "Completed", variant: "default", icon: "check" };
    case "FAILED":
      return { label: "Failed", variant: "destructive", icon: "alert" };
    case "PROCESSING":
      return { label: "Processing", variant: "secondary", icon: "clock" };
    default:
      return { label: "Queued", variant: "secondary", icon: "clock" };
  }
}

function downloadExport(path: string) {
  window.open(`${API_BASE}${path}`, "_blank", "noopener,noreferrer");
}

export default function OcrPage({ setNotice }: Props) {
  const [tab, setTab] = useState<"upload" | "vault" | "chat">("upload");

  // Upload & Scan
  const [blueprints, setBlueprints] = useState<string[]>(["Universal OCR (Any Text)"]);
  const [selectedBlueprint, setSelectedBlueprint] = useState("Universal OCR (Any Text)");
  const [file, setFile] = useState<File | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<OcrJob | null>(null);
  const [jobResult, setJobResult] = useState<OcrJobResult | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);

  // My Documents (vault)
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [vaultDetail, setVaultDetail] = useState<VaultDocDetail | null>(null);
  const [vaultDetailOpen, setVaultDetailOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Ask AI (chat)
  const [chatLoaded, setChatLoaded] = useState(false);
  const [kbDocs, setKbDocs] = useState<KbDoc[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ blueprints: string[] }>("/api/ocr-portal/blueprints")
      .then((data) => {
        if (data.blueprints?.length) {
          setBlueprints(data.blueprints);
          setSelectedBlueprint(data.blueprints[0]);
        }
      })
      .catch(() => {
        // Fall back to the default option already in state -- non-fatal.
      });
  }, []);

  // ---- Upload & Scan ----------------------------------------------------

  const handleFileSelect = (selectedFile?: File) => {
    setFile(selectedFile);
    setActiveJobId(null);
    setJobStatus(null);
    setJobResult(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setNotice({ type: "warning", message: "Choose a file to scan first." });
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("blueprint", selectedBlueprint);
      const response = await fetch(`${API_BASE}/api/ocr-portal/upload`, {
        method: "POST",
        headers: withAuthHeaders({}, "POST"),
        body,
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(data.error || "Upload failed."), { status: response.status });
      }
      setJobResult(null);
      setJobStatus({ job_id: data.job_id, status: "PENDING", progress: 0 });
      setActiveJobId(data.job_id);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!activeJobId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await apiFetch<OcrJob>(`/api/ocr-portal/jobs/${activeJobId}`);
        if (cancelled) return;
        setJobStatus(data);

        if (data.status === "COMPLETED") {
          const result = await apiFetch<OcrJobResult>(`/api/ocr-portal/jobs/${activeJobId}/result`);
          if (!cancelled) setJobResult(result);
          return;
        }
        if (data.status === "FAILED") {
          reportError(setNotice, { message: data.error_message || "OCR processing failed." }, "OCR processing failed.");
          return;
        }
        pollTimeoutRef.current = window.setTimeout(poll, 2000);
      } catch (error) {
        if (!cancelled) {
          reportError(setNotice, error as { message?: string; status?: number }, "Lost connection while checking job status.");
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current);
    };
  }, [activeJobId, setNotice]);

  const handleClear = () => {
    setFile(undefined);
    setActiveJobId(null);
    setJobStatus(null);
    setJobResult(null);
  };

  // ---- My Documents (vault) ----------------------------------------------

  const loadVault = async () => {
    try {
      const data = await apiFetch<VaultDoc[]>("/api/ocr-portal/vault");
      setVaultDocs(data);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load your documents.");
    }
  };

  const openVaultTab = () => {
    setTab("vault");
    if (!vaultLoaded) {
      setVaultLoaded(true);
      void loadVault();
    }
  };

  const openVaultDetail = async (doc: VaultDoc) => {
    try {
      const data = await apiFetch<VaultDocDetail>(`/api/ocr-portal/vault/${doc.id}`);
      setVaultDetail(data);
      setVaultDetailOpen(true);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load document.");
    }
  };

  const handleDeleteConfirmed = async () => {
    if (deleteTargetId == null) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/ocr-portal/vault/${deleteTargetId}`, { method: "DELETE" });
      setVaultDocs((prev) => prev.filter((doc) => doc.id !== deleteTargetId));
      setNotice({ type: "success", message: "Document deleted." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete document.");
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  };

  const handleAddToKnowledgeBase = async (doc: VaultDoc) => {
    try {
      await apiFetch("/api/ocr-portal/assistant/ingest", {
        method: "POST",
        body: JSON.stringify({ doc_ids: [doc.id] }),
      });
      setNotice({ type: "success", message: `${doc.filename} is being added to the knowledge base.` });
      if (chatLoaded) void loadKb();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to add document to knowledge base.");
    }
  };

  // ---- Ask AI (chat) -------------------------------------------------------

  const loadKb = async () => {
    try {
      const data = await apiFetch<KbDoc[]>("/api/ocr-portal/assistant/kb");
      setKbDocs(data);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load knowledge base.");
    }
  };

  const loadChatHistory = async () => {
    try {
      const data = await apiFetch<{ role: "user" | "assistant"; content: string }[]>(
        "/api/ocr-portal/assistant/history"
      );
      setChatMessages(data);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load chat history.");
    }
  };

  const openChatTab = () => {
    setTab("chat");
    if (!chatLoaded) {
      setChatLoaded(true);
      void loadKb();
      void loadChatHistory();
    }
  };

  const handleRemoveFromKb = async (doc: KbDoc) => {
    try {
      await apiFetch(`/api/ocr-portal/assistant/kb/${doc.doc_id}`, { method: "DELETE" });
      setKbDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to remove document.");
    }
  };

  const handleChatSend = async () => {
    const message = chatInput.trim();
    if (!message) return;
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const data = await apiFetch<{ role: "assistant"; content: string; citations: ChatCitation[] }>(
        "/api/ocr-portal/assistant/chat",
        { method: "POST", body: JSON.stringify({ message, session_id: "default" }) }
      );
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.content, citations: data.citations }]);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to reach the knowledge base.");
      setChatMessages((prev) => prev.slice(0, -1));
      setChatInput(message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleClearChat = async () => {
    try {
      await apiFetch("/api/ocr-portal/assistant/history", { method: "DELETE" });
      setChatMessages([]);
      setNotice({ type: "success", message: "Chat history cleared." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to clear chat history.");
    }
  };

  const statusMeta = jobStatus ? jobStatusMeta(jobStatus.status) : null;

  return (
    <section className="page-section ocr-scanner-page">
      <Tabs>
        <TabsTrigger active={tab === "upload"} onClick={() => setTab("upload")}>
          <span className="ocr-tab-label"><Icon name="upload" size={15} /> Upload &amp; Scan</span>
        </TabsTrigger>
        <TabsTrigger active={tab === "vault"} onClick={openVaultTab}>
          <span className="ocr-tab-label"><Icon name="folder" size={15} /> My Documents{vaultDocs.length > 0 ? ` (${vaultDocs.length})` : ""}</span>
        </TabsTrigger>
        <TabsTrigger active={tab === "chat"} onClick={openChatTab}>
          <span className="ocr-tab-label"><Icon name="chat" size={15} /> Ask AI</span>
        </TabsTrigger>
      </Tabs>

      {tab === "upload" && (
        <TabsContent>
          <div className="ocr-workspace-grid">
            <Card>
              <CardHeader>
                <CardTitle>Upload a Document</CardTitle>
                <CardDescription>Choose a document type, then upload an image or PDF for AI text extraction.</CardDescription>
              </CardHeader>
              <CardContent className="ocr-upload-form">
                <label className="ocr-field-label">
                  Document Type
                  <Select value={selectedBlueprint} onChange={(e) => setSelectedBlueprint(e.target.value)}>
                    {blueprints.map((bp) => (
                      <option key={bp} value={bp}>
                        {bp}
                      </option>
                    ))}
                  </Select>
                </label>

                <DocumentUploadDropzone
                  accept={SUPPORTED_DOCUMENT_ACCEPT}
                  file={file}
                  helperText={`Supported formats: ${SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", ")}`}
                  disabled={uploading}
                  onFileSelect={handleFileSelect}
                />

                <div className="ocr-form-actions">
                  <Button variant="primary" type="button" onClick={() => void handleUpload()} disabled={!file || uploading}>
                    {uploading ? "Uploading..." : "Start OCR Scanning"}
                  </Button>
                  <Button variant="secondary" type="button" onClick={handleClear} disabled={!file && !jobStatus}>
                    Clear / Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="ocr-status-card">
              <CardHeader>
                <CardTitle>Extraction Status</CardTitle>
                <CardDescription>Live progress for your current scan.</CardDescription>
              </CardHeader>
              <CardContent>
                {!jobStatus && (
                  <div className="ocr-empty-panel">
                    <Icon name="clock" size={28} />
                    <p className="muted">Upload a document to see extraction progress here.</p>
                  </div>
                )}

                {jobStatus && statusMeta && (
                  <div className="ocr-status-panel">
                    <div className="ocr-status-row">
                      <Badge variant={statusMeta.variant}>
                        <span className="ocr-badge-icon"><Icon name={statusMeta.icon} size={13} /></span>
                        {statusMeta.label}
                      </Badge>
                      {jobResult?.confidence_score != null && (
                        <Badge variant={confidenceVariant(jobResult.confidence_score)}>
                          {Math.round(jobResult.confidence_score)}% confidence
                        </Badge>
                      )}
                    </div>

                    {jobStatus.status !== "COMPLETED" && jobStatus.status !== "FAILED" && (
                      <div className="ocr-progress-bar">
                        <div
                          className="ocr-progress-bar-fill"
                          style={{ width: `${Math.min(100, Math.max(4, jobStatus.progress || 0))}%` }}
                        />
                      </div>
                    )}

                    {jobStatus.status === "FAILED" && (
                      <p className="ocr-error-text">{jobStatus.error_message || "Unknown error."}</p>
                    )}

                    {jobResult && (
                      <div className="ocr-export-row">
                        {EXPORT_FORMATS.map((fmt) => (
                          <Button
                            key={fmt.value}
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={() => downloadExport(`/api/ocr-portal/jobs/${activeJobId}/export?format=${fmt.value}`)}
                          >
                            {fmt.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {jobResult && (
            <Card className="ocr-result-card">
              <CardHeader>
                <CardTitle>{jobResult.filename}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="ocr-result-markdown">
                  <MarkdownReport text={jobResult.combined_markdown} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      )}

      {tab === "vault" && (
        <TabsContent>
          <Card>
            <CardHeader>
              <CardTitle>My Documents</CardTitle>
              <CardDescription>Everything you've previously scanned. Click a row to view the full text.</CardDescription>
            </CardHeader>
            <CardContent>
              {vaultDocs.length === 0 && (
                <div className="ocr-empty-panel">
                  <Icon name="folder" size={28} />
                  <p className="muted">No documents yet. Scan one from the Upload &amp; Scan tab.</p>
                </div>
              )}
              {vaultDocs.length > 0 && (
                <Table className="ocr-vault-table">
                  <TableHead>
                    <TableCell>Filename</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Confidence</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableHead>
                  {vaultDocs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <button type="button" className="ocr-doc-link" onClick={() => void openVaultDetail(doc)}>
                          <Icon name="file" size={15} /> {doc.filename}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{doc.doc_category || "Uncategorized"}</Badge>
                      </TableCell>
                      <TableCell>
                        {doc.confidence_score != null ? (
                          <Badge variant={confidenceVariant(doc.confidence_score)}>{Math.round(doc.confidence_score)}%</Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>{formatDateTime(doc.extraction_date)}</TableCell>
                      <TableCell>
                        <div className="ocr-row-actions">
                          <Button variant="ghost" size="sm" type="button" onClick={() => void handleAddToKnowledgeBase(doc)}>
                            Add to KB
                          </Button>
                          <Button variant="ghost" size="sm" type="button" onClick={() => downloadExport(`/api/ocr-portal/vault/${doc.id}/export/pdf`)}>
                            PDF
                          </Button>
                          <Button variant="destructive" size="sm" type="button" onClick={() => setDeleteTargetId(doc.id)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      )}

      {tab === "chat" && (
        <TabsContent>
          <div className="ocr-chat-grid">
            <Card>
              <CardHeader>
                <CardTitle>Knowledge Base</CardTitle>
                <CardDescription>Documents currently available to Ask AI.</CardDescription>
              </CardHeader>
              <CardContent>
                {kbDocs.length === 0 && (
                  <div className="ocr-empty-panel ocr-empty-panel-compact">
                    <p className="muted">Add a document from My Documents to start chatting.</p>
                  </div>
                )}
                <div className="ocr-kb-list">
                  {kbDocs.map((doc) => (
                    <div key={doc.doc_id} className="ocr-kb-item">
                      <span className="ocr-kb-item-name"><Icon name="file" size={14} /> {doc.filename}</span>
                      <Button variant="ghost" size="sm" type="button" onClick={() => void handleRemoveFromKb(doc)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="ocr-chat-card">
              <CardHeader className="ocr-chat-header">
                <div>
                  <CardTitle>Ask AI</CardTitle>
                  <CardDescription>Ask questions grounded in your knowledge base documents.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" type="button" onClick={() => void handleClearChat()} disabled={!chatMessages.length}>
                  Clear Chat
                </Button>
              </CardHeader>
              <CardContent className="ocr-chat-content">
                <div className="ocr-chat-history">
                  {chatMessages.length === 0 && (
                    <div className="ocr-empty-panel ocr-empty-panel-compact">
                      <Icon name="chat" size={24} />
                      <p className="muted">Ask a question about your documents.</p>
                    </div>
                  )}
                  {chatMessages.map((message, index) => (
                    <div key={index} className={`ocr-chat-message ocr-chat-${message.role}`}>
                      <span className="ocr-chat-role">{message.role === "user" ? "You" : "Assistant"}</span>
                      <MarkdownReport text={message.content} />
                      {!!message.citations?.length && (
                        <div className="ocr-chat-citations">
                          {message.citations.map((c, i) => (
                            <Badge key={i} variant="outline">{c.filename}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {chatLoading && <p className="muted ocr-chat-thinking">Thinking...</p>}
                </div>
                <div className="ocr-form-row">
                  <Input
                    value={chatInput}
                    placeholder="Ask a question about your documents..."
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !chatLoading) {
                        event.preventDefault();
                        void handleChatSend();
                      }
                    }}
                    disabled={chatLoading}
                  />
                  <Button onClick={() => void handleChatSend()} disabled={chatLoading || !chatInput.trim()}>
                    Send
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      )}

      <Modal open={vaultDetailOpen} onClose={() => setVaultDetailOpen(false)} title="Document">
        {vaultDetail && <MarkdownReport text={vaultDetail.markdown} />}
      </Modal>

      <ConfirmDialog
        open={deleteTargetId != null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDeleteConfirmed}
        title="Delete document?"
        description="This removes it from your vault permanently."
        confirmLabel="Delete"
        loading={deleting}
      />
    </section>
  );
}
