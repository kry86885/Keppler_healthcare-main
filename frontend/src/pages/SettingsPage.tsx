import { useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiClock,
  FiMessageSquare,
  FiShield,
  FiUser,
} from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import StatCard from "../components/StatCard";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TabsTrigger,
  Textarea,
} from "../components/ui";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { AuditLog, Stats, User } from "../types";

type Props = {
  stats: Stats;
  user: User;
  canReadAudit: boolean;
  isAdmin: boolean;
};

type WhatsappSettings = {
  source: "database" | "environment" | "none";
  account_sid: string;
  auth_token_set: boolean;
  whatsapp_from: string;
  default_country_code: string;
  updated_by: string | null;
  updated_at: string | null;
  encryption_configured: boolean;
};

type SettingsTab = "overview" | "whatsapp" | "templates" | "audit";

function labelize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function SettingsPage({
  stats,
  user,
  canReadAudit,
  isAdmin,
}: Props) {
  const tabs = useMemo(() => {
    const list: { id: SettingsTab; label: string }[] = [
      { id: "overview", label: "Overview" },
    ];
    if (isAdmin) list.push({ id: "whatsapp", label: "WhatsApp Business" });
    if (canReadAudit) {
      list.push({ id: "templates", label: "Message Templates" });
      list.push({ id: "audit", label: "Audit Trail" });
    }
    return list;
  }, [isAdmin, canReadAudit]);
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [auditModule, setAuditModule] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [templates, setTemplates] = useState<
    { template_key: string; content: string }[]
  >([]);
  const [editingTemplate, setEditingTemplate] = useState<{
    template_key: string;
    content: string;
  } | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");

  const [waSettings, setWaSettings] = useState<WhatsappSettings | null>(null);
  const [waAccountSid, setWaAccountSid] = useState("");
  const [waAuthToken, setWaAuthToken] = useState("");
  const [waFrom, setWaFrom] = useState("");
  const [waCountryCode, setWaCountryCode] = useState("+91");
  const [waSaving, setWaSaving] = useState(false);
  const [waNotice, setWaNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadWhatsappSettings = async () => {
    try {
      const data = await apiFetch<WhatsappSettings>("/api/whatsapp/settings");
      setWaSettings(data);
      setWaAccountSid(data.account_sid || "");
      setWaFrom(data.whatsapp_from || "");
      setWaCountryCode(data.default_country_code || "+91");
      setWaAuthToken("");
    } catch (err) {
      console.error("Failed to load WhatsApp settings", err);
    }
  };

  const saveWhatsappSettings = async () => {
    setWaSaving(true);
    setWaNotice(null);
    try {
      await apiFetch("/api/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({
          account_sid: waAccountSid.trim(),
          auth_token: waAuthToken.trim(),
          whatsapp_from: waFrom.trim(),
          default_country_code: waCountryCode.trim() || "+91",
        }),
      });
      setWaNotice({
        type: "success",
        text: "WhatsApp Business API key saved.",
      });
      await loadWhatsappSettings();
    } catch (err) {
      const typedError = err as { message?: string };
      setWaNotice({
        type: "error",
        text: typedError.message || "Unable to save WhatsApp settings.",
      });
    } finally {
      setWaSaving(false);
    }
  };

  const loadAuditLogs = async (moduleName = auditModule) => {
    if (!canReadAudit) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (moduleName.trim()) params.set("module", moduleName.trim());
      const data = await apiFetch<{ logs?: AuditLog[] }>(
        `/api/audit/logs?${params.toString()}`,
      );
      setLogs(data.logs || []);
    } catch (loadError) {
      const typedError = loadError as { message?: string; status?: number };
      setError(typedError.message || "Unable to load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await apiFetch<{ templates: any[] }>(
        "/api/whatsapp/templates",
      );
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to load templates", err);
    }
  };

  useEffect(() => {
    if (canReadAudit) {
      void loadAuditLogs("");
      void loadTemplates();
    }
    if (isAdmin) {
      void loadWhatsappSettings();
    }
  }, [canReadAudit, isAdmin]);

  const saveTemplate = async () => {
    if (!editingTemplate) return;
    setTemplateLoading(true);
    setTemplateNotice("");
    try {
      await apiFetch("/api/whatsapp/templates", {
        method: "PUT",
        body: JSON.stringify(editingTemplate),
      });
      setTemplateNotice("Template saved.");
      setEditingTemplate(null);
      await loadTemplates();
    } catch (err) {
      setTemplateNotice("Failed to save template.");
    } finally {
      setTemplateLoading(false);
    }
  };

  const waStatusBadge = !waSettings ? null : waSettings.source ===
    "database" ? (
    <Badge variant="default">Configured</Badge>
  ) : waSettings.source === "environment" ? (
    <Badge variant="secondary">Using server defaults</Badge>
  ) : (
    <Badge variant="outline">Not configured</Badge>
  );

  return (
    <section className="module-page">
      <Tabs role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            type="button"
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </Tabs>

      {activeTab === "overview" && (
        <div className="settings-tab-panel">
          <div className="stat-grid">
            <StatCard label="Total Patients" value={stats.total} />
            <StatCard label="New Today" value={stats.today} />
            <StatCard
              label="Active Admissions"
              value={stats.active_admissions}
            />
            <StatCard
              label="Readmitted Patients"
              value={stats.readmitted_patients}
            />
            <StatCard label="Documents" value={stats.documents} />
          </div>

          <Card>
            <CardHeader>
              <div className="settings-card-title-row">
                <FiUser aria-hidden="true" />
                <CardTitle>Your Account</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="settings-account-grid">
                <div>
                  <span className="settings-account-label">Name</span>
                  <span>{user.full_name || user.username}</span>
                </div>
                <div>
                  <span className="settings-account-label">Username</span>
                  <span>{user.username}</span>
                </div>
                <div>
                  <span className="settings-account-label">Role</span>
                  <span>
                    {user.job_role || user.access_role || user.role || "-"}
                  </span>
                </div>
                <div>
                  <span className="settings-account-label">
                    Employee ID
                  </span>
                  <span>{user.employee_id || "-"}</span>
                </div>
                <div>
                  <span className="settings-account-label">Hospital</span>
                  <span>{user.hospital_code || "-"}</span>
                </div>
                <div>
                  <span className="settings-account-label">Status</span>
                  <span>
                    <Badge
                      variant={
                        (user.status || "active").toLowerCase() === "active"
                          ? "default"
                          : "outline"
                      }
                    >
                      {labelize(user.status || "Active")}
                    </Badge>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "whatsapp" && isAdmin && (
        <div className="settings-tab-panel">
          <Card>
            <CardHeader>
              <div className="settings-card-title-row">
                <FaWhatsapp aria-hidden="true" />
                <CardTitle>WhatsApp Business API</CardTitle>
                {waStatusBadge}
              </div>
              <p className="muted">
                Connect your Twilio WhatsApp Business number once here --
                it's used app-wide for appointment reminders, sending
                EMR/prescriptions, and every other WhatsApp message the app
                sends. Visible to owners/admins only.
              </p>
            </CardHeader>
            <CardContent>
              {waSettings && !waSettings.encryption_configured && (
                <p className="notice error">
                  This server doesn't have SETTINGS_ENCRYPTION_KEY configured
                  yet, so a key can't be saved securely here. Ask whoever
                  manages the deployment to set it, then reload this page.
                </p>
              )}
              {waSettings?.source === "database" && (
                <p className="notice">
                  <FiShield aria-hidden="true" /> Stored encrypted
                  {waSettings.updated_by ? ` -- last updated by ${waSettings.updated_by}` : ""}
                  {waSettings.updated_at
                    ? ` on ${formatDateTime(waSettings.updated_at)}`
                    : ""}
                  .
                </p>
              )}
              {waSettings?.source === "environment" && (
                <p className="notice">
                  Currently using TWILIO_* environment variables set on the
                  server. Saving here will switch to this key instead.
                </p>
              )}
              {waNotice && (
                <p
                  className={`notice ${waNotice.type === "error" ? "error" : ""}`}
                >
                  {waNotice.text}
                </p>
              )}

              <div className="module-form-grid" style={{ marginTop: "0.5rem" }}>
                <Label>
                  Account SID
                  <Input
                    value={waAccountSid}
                    onChange={(e) => setWaAccountSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                </Label>
                <Label>
                  Auth Token
                  <Input
                    type="password"
                    value={waAuthToken}
                    onChange={(e) => setWaAuthToken(e.target.value)}
                    placeholder={
                      waSettings?.auth_token_set
                        ? "Set -- leave blank to keep it"
                        : "Enter your Twilio auth token"
                    }
                  />
                </Label>
                <Label>
                  WhatsApp Number
                  <Input
                    value={waFrom}
                    onChange={(e) => setWaFrom(e.target.value)}
                    placeholder="+14155238886"
                  />
                </Label>
                <Label>
                  Default Country Code
                  <Input
                    value={waCountryCode}
                    onChange={(e) => setWaCountryCode(e.target.value)}
                    placeholder="+91"
                  />
                </Label>
              </div>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                The country code is applied to phone numbers that don't
                already have one (e.g. a 10-digit number saved as a patient's
                contact).
              </p>
              <Button
                onClick={saveWhatsappSettings}
                disabled={waSaving}
                style={{ marginTop: "0.75rem" }}
              >
                {waSaving ? "Saving..." : "Save"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "templates" && canReadAudit && (
        <div className="settings-tab-panel">
          <Card>
            <CardHeader>
              <div className="settings-card-title-row">
                <FiMessageSquare aria-hidden="true" />
                <CardTitle>WhatsApp Templates</CardTitle>
              </div>
              <p className="muted">
                Manage the automated feedback prompts sent via WhatsApp.
              </p>
            </CardHeader>
            <CardContent>
              {templateNotice && <p className="notice">{templateNotice}</p>}
              <div className="settings-template-list">
                {templates.map((t) => (
                  <div key={t.template_key} className="settings-template-card">
                    <h4>{labelize(t.template_key)}</h4>
                    <p>{t.content}</p>
                    <Button variant="ghost" onClick={() => setEditingTemplate(t)}>
                      Edit
                    </Button>
                  </div>
                ))}
                {templates.length === 0 && (
                  <Button
                    onClick={() =>
                      setEditingTemplate({
                        template_key: "comment_prompt",
                        content: "",
                      })
                    }
                  >
                    Add New Template
                  </Button>
                )}
              </div>

              {editingTemplate && (
                <div className="settings-template-editor">
                  <h4>Editing: {labelize(editingTemplate.template_key)}</h4>
                  <Label>
                    Template Key
                    <Input
                      value={editingTemplate.template_key}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          template_key: e.target.value,
                        })
                      }
                      placeholder="template_key"
                      disabled={templates.some(
                        (t) => t.template_key === editingTemplate.template_key,
                      )}
                    />
                  </Label>
                  <Label>
                    Content
                    <Textarea
                      value={editingTemplate.content}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          content: e.target.value,
                        })
                      }
                      rows={4}
                      placeholder="Template content"
                    />
                  </Label>
                  <div className="settings-template-editor-actions">
                    <Button onClick={saveTemplate} disabled={templateLoading}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setEditingTemplate(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "audit" && canReadAudit && (
        <div className="settings-tab-panel">
          <Card>
            <CardHeader>
              <div className="settings-card-title-row">
                <FiClock aria-hidden="true" />
                <CardTitle>Audit Trail</CardTitle>
              </div>
              <p className="muted">
                Recent system actions, filtered by module when needed.
              </p>
            </CardHeader>
            <CardContent>
              <div className="patient-toolbar">
                <Input
                  value={auditModule}
                  onChange={(event) => setAuditModule(event.target.value)}
                  placeholder="Filter by module name (e.g. billing_invoices)"
                />
                <Button
                  type="button"
                  onClick={() => void loadAuditLogs(auditModule)}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAuditModule("");
                    void loadAuditLogs("");
                  }}
                >
                  Clear
                </Button>
                <span className="muted">
                  {loading ? "Loading..." : `${logs.length} rows`}
                </span>
              </div>
              {error ? <p className="notice error">{error}</p> : null}
              {!loading && !error && logs.length === 0 ? (
                <p className="muted">No audit log entries available.</p>
              ) : null}
              {!loading && !error && logs.length > 0 ? (
                <>
                  <Table className="module-table" aria-label="Audit logs table">
                    <TableHead>
                      <TableCell>When</TableCell>
                      <TableCell>Actor</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Module</TableCell>
                      <TableCell>Record</TableCell>
                      <TableCell>Details</TableCell>
                    </TableHead>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{formatDateTime(log.created_at)}</TableCell>
                        <TableCell>{log.actor_username || "-"}</TableCell>
                        <TableCell>{log.action || "-"}</TableCell>
                        <TableCell>{log.module_name || "-"}</TableCell>
                        <TableCell>{log.entity_key || "-"}</TableCell>
                        <TableCell>{log.payload || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </Table>
                  <div
                    className="module-mobile-list"
                    style={{ display: "grid" }}
                    aria-label="Audit log cards"
                  >
                    {logs.map((log) => (
                      <article
                        className="module-mobile-card"
                        key={`audit-${log.id}`}
                      >
                        <h4>{log.module_name || "Audit Event"}</h4>
                        <p>
                          <strong>When:</strong> {formatDateTime(log.created_at)}
                        </p>
                        <p>
                          <strong>Actor:</strong> {log.actor_username || "-"}
                        </p>
                        <p>
                          <strong>Action:</strong> {log.action || "-"}
                        </p>
                        <p>
                          <strong>Record:</strong> {log.entity_key || "-"}
                        </p>
                        <p>
                          <strong>Details:</strong> {log.payload || "-"}
                        </p>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {!isAdmin && !canReadAudit && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          WhatsApp Business API, message templates, and the audit trail are
          restricted to admins.
        </p>
      )}
    </section>
  );
}
