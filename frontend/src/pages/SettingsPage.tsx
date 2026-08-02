import { useEffect, useState } from "react";
import { Button, Input, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { AuditLog, Stats, User } from "../types";

type Props = {
  stats: Stats;
  user: User;
  canReadAudit: boolean;
};

export default function SettingsPage({ stats, user, canReadAudit }: Props) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [auditModule, setAuditModule] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [templates, setTemplates] = useState<{template_key: string, content: string}[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<{template_key: string, content: string} | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");

  const loadAuditLogs = async (moduleName = auditModule) => {
    if (!canReadAudit) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (moduleName.trim()) params.set("module", moduleName.trim());
      const data = await apiFetch<{ logs?: AuditLog[] }>(`/api/audit/logs?${params.toString()}`);
      setLogs(data.logs || []);
    } catch (loadError) {
      const typedError = loadError as { message?: string; status?: number };
      setError(typedError.message || "Unable to load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canReadAudit) {
      void loadAuditLogs("");
      void loadTemplates();
    }
  }, [canReadAudit]);

  const loadTemplates = async () => {
    try {
      const data = await apiFetch<{templates: any[]}>("/api/whatsapp/templates");
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Failed to load templates", err);
    }
  };

  const saveTemplate = async () => {
    if (!editingTemplate) return;
    setTemplateLoading(true);
    setTemplateNotice("");
    try {
      await apiFetch("/api/whatsapp/templates", {
        method: "PUT",
        body: JSON.stringify(editingTemplate)
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

  return (
    <section className="module-page">
      <div className="settings-grid">
        <div className="panel">
          <h3>Database Snapshot</h3>
          <pre>{JSON.stringify(stats, null, 2)}</pre>
        </div>
        <div className="panel">
          <h3>Current User</h3>
          <pre>{JSON.stringify(user, null, 2)}</pre>
        </div>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <div>
            <h3>Audit Trail</h3>
            <p className="muted">Recent system actions, filtered by module when needed.</p>
          </div>
        </div>
        {!canReadAudit ? (
          <p className="muted">Audit log access is restricted to admins with audit permission.</p>
        ) : (
          <>
            <div className="patient-toolbar">
              <Input
                value={auditModule}
                onChange={(event) => setAuditModule(event.target.value)}
                placeholder="Filter by module name (e.g. billing_invoices)"
              />
              <Button type="button" onClick={() => void loadAuditLogs(auditModule)}>
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
              <span className="muted">{loading ? "Loading..." : `${logs.length} rows`}</span>
            </div>
            {error ? <p className="notice error">{error}</p> : null}
            {!loading && !error && logs.length === 0 ? <p className="muted">No audit log entries available.</p> : null}
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
                <div className="module-mobile-list" style={{ display: "grid" }} aria-label="Audit log cards">
                  {logs.map((log) => (
                    <article className="module-mobile-card" key={`audit-${log.id}`}>
                      <h4>{log.module_name || "Audit Event"}</h4>
                      <p><strong>When:</strong> {formatDateTime(log.created_at)}</p>
                      <p><strong>Actor:</strong> {log.actor_username || "-"}</p>
                      <p><strong>Action:</strong> {log.action || "-"}</p>
                      <p><strong>Record:</strong> {log.entity_key || "-"}</p>
                      <p><strong>Details:</strong> {log.payload || "-"}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {canReadAudit && (
        <div className="panel">
          <div className="module-panel-head">
            <div>
              <h3>WhatsApp Templates</h3>
              <p className="muted">Manage the automated feedback prompts sent via WhatsApp.</p>
            </div>
          </div>
          {templateNotice && <p className="notice">{templateNotice}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {templates.map(t => (
              <div key={t.template_key} style={{ border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '4px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', textTransform: 'capitalize' }}>{t.template_key.replace('_', ' ')}</h4>
                <p style={{ whiteSpace: 'pre-wrap', color: 'var(--muted-color)' }}>{t.content}</p>
                <Button variant="ghost" onClick={() => setEditingTemplate(t)} style={{ marginTop: '0.5rem' }}>Edit</Button>
              </div>
            ))}
            {templates.length === 0 && (
              <Button onClick={() => setEditingTemplate({template_key: 'comment_prompt', content: ''})}>Add New Template</Button>
            )}
          </div>
          
          {editingTemplate && (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--primary-color)', borderRadius: '4px' }}>
              <h4>Editing: {editingTemplate.template_key}</h4>
              <Input 
                value={editingTemplate.template_key} 
                onChange={e => setEditingTemplate({...editingTemplate, template_key: e.target.value})}
                placeholder="Template Key"
                style={{ marginBottom: '0.5rem' }}
                disabled={templates.some(t => t.template_key === editingTemplate.template_key)}
              />
              <textarea 
                value={editingTemplate.content} 
                onChange={e => setEditingTemplate({...editingTemplate, content: e.target.value})}
                style={{ width: '100%', minHeight: '100px', padding: '0.5rem', marginBottom: '0.5rem' }}
                placeholder="Template Content"
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button onClick={saveTemplate} disabled={templateLoading}>Save</Button>
                <Button variant="ghost" onClick={() => setEditingTemplate(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
