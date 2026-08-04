import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Badge, Button, Checkbox, ConfirmDialog, Input, Label, Select, Table, TableCell, TableHead, TableRow, Tabs, TabsContent, TabsTrigger, Textarea } from "../components/ui";
import { EMPTY_SIGNUP_FORM, MODULE_OPTIONS, SUB_MODULES, USER_TYPE_LABELS, USER_TYPE_OPTIONS } from "../lib/constants";
import { apiFetch, reportError } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Employee, ModuleAccessEntry, Notice, SignupForm } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  // Edit name/email/phone/department/status/job_role, activate/deactivate.
  canEditProfile: boolean;
  // Edit user_type/access_role/module_access on an existing employee --
  // separately grantable, server-side clamped to never exceed what the
  // caller granting it holds themselves (see backend/core/auth.py's
  // authorize_employee_access_change).
  canManageAccess: boolean;
  // Creating brand-new accounts and deleting existing ones stay admin-only.
  canCreateOrDelete: boolean;
};

type EditForm = {
  full_name: string;
  email: string;
  phone: string;
  department: string;
  address: string;
  emergency_contact: string;
  status: string;
  job_role: string;
  user_type: SignupForm["user_type"];
  module_access: ModuleAccessEntry[];
};

// A module checkbox alone grants full access to everything under it; a
// sub-item checkbox grants just that one write permission. Both are stored
// in the same flat module_access array -- see SUB_MODULE_PERMISSIONS in
// lib/constants.ts and backend/core/auth.py's get_permissions() for how a
// dotted "module.subitem" entry is expanded into actual permissions.
const isModuleFullyGranted = (moduleAccess: ModuleAccessEntry[], moduleValue: string) =>
  moduleAccess.includes(moduleValue);

const isSubItemGranted = (moduleAccess: ModuleAccessEntry[], moduleValue: string, subKey: string) =>
  moduleAccess.includes(moduleValue) || moduleAccess.includes(`${moduleValue}.${subKey}`);

const toggleWholeModule = (moduleAccess: ModuleAccessEntry[], moduleValue: string): ModuleAccessEntry[] => {
  const withoutModule = moduleAccess.filter(
    (entry) => entry !== moduleValue && !entry.startsWith(`${moduleValue}.`)
  );
  // Already fully granted -> turn the whole module off. Otherwise (absent or
  // only partially granted via sub-items) -> grant it fully.
  return moduleAccess.includes(moduleValue) ? withoutModule : [...withoutModule, moduleValue];
};

const toggleSubItem = (
  moduleAccess: ModuleAccessEntry[],
  moduleValue: string,
  subKey: string,
  allSubKeys: string[]
): ModuleAccessEntry[] => {
  const dotted = `${moduleValue}.${subKey}`;
  if (moduleAccess.includes(moduleValue)) {
    // Was fully granted -- narrow to every other sub-item explicitly so the
    // rest of the module's access survives, dropping just this one.
    const withoutModule = moduleAccess.filter((entry) => entry !== moduleValue);
    const others = allSubKeys.filter((key) => key !== subKey).map((key) => `${moduleValue}.${key}`);
    return [...withoutModule, ...others];
  }
  if (moduleAccess.includes(dotted)) {
    return moduleAccess.filter((entry) => entry !== dotted);
  }
  return [...moduleAccess, dotted];
};

const describeModuleAccessEntry = (entry: ModuleAccessEntry): string => {
  const [moduleValue, subKey] = entry.split(".", 2);
  const moduleLabel = MODULE_OPTIONS.find((m) => m.value === moduleValue)?.label || moduleValue;
  if (!subKey) return moduleLabel;
  const subLabel = SUB_MODULES[moduleValue as keyof typeof SUB_MODULES]?.find((s) => s.value === subKey)?.label || subKey;
  return `${moduleLabel}: ${subLabel}`;
};

export default function EmployeesPage({ setNotice, canEditProfile, canManageAccess, canCreateOrDelete }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<SignupForm>(EMPTY_SIGNUP_FORM);
  const [tab, setTab] = useState("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EditForm>>({});
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState(false);
  const [departments, setDepartments] = useState<{ department_name?: string }[]>([]);
  const [customDept, setCustomDept] = useState("");

  const loadEmployees = async (search?: string) => {
    const path = search ? `/api/employees/search?q=${encodeURIComponent(search)}` : "/api/employees";
    const data = await apiFetch<{ employees?: Employee[] }>(path);
    setEmployees(data.employees || []);
  };

  const loadStats = async () => {
    const data = await apiFetch<{ total: number; active: number; inactive: number }>("/api/employees/stats");
    setStats(data);
  };

  const loadDepartments = async () => {
    try {
      const data = await apiFetch<{ departments?: { department_name?: string }[] }>("/api/registration/departments");
      setDepartments(data.departments || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadEmployees();
    void loadStats();
    void loadDepartments();
  }, []);

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateOrDelete) {
      setNotice({ type: "warning", message: "You do not have permission to add employees." });
      return;
    }
    
    const finalDepartment = form.department === "Other" ? customDept : form.department;
    const payload = { ...form, department: finalDepartment };
    
    try {
      const res = await apiFetch<{ success: boolean; message: string }>("/api/employees", { method: "POST", body: JSON.stringify(payload) });
      if (res.success) {
        setNotice({ type: "success", message: res.message });
        setForm(EMPTY_SIGNUP_FORM);
        setCustomDept("");
        void loadEmployees();
        void loadStats();
        setTab("list");
      } else {
        setNotice({ type: "error", message: res.message });
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number });
    }
  };

  const toggleStatus = async (employee: Employee) => {
    if (!canEditProfile) {
      setNotice({ type: "warning", message: "You do not have permission to update employee status." });
      return;
    }
    const path = employee.status === "active" ? "deactivate" : "activate";
    await apiFetch(`/api/employees/${employee.employee_id}/${path}`, { method: "POST" });
    void loadEmployees(query);
    void loadStats();
  };

  const handleDelete = async (employee: Employee) => {
    if (!canCreateOrDelete) {
      setNotice({ type: "warning", message: "You do not have permission to delete employees." });
      return;
    }
    await apiFetch(`/api/employees/${employee.employee_id}`, { method: "DELETE" });
    void loadEmployees(query);
    void loadStats();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingEmployee(true);
    try {
      await handleDelete(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeletingEmployee(false);
    }
  };

  const startEdit = (employee: Employee) => {
    if (!canManageAccess) {
      setNotice({ type: "warning", message: "You do not have permission to manage employee access." });
      return;
    }
    setEditingId(employee.employee_id);
    setEditForm({
      full_name: employee.full_name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      department: employee.department || "",
      address: employee.address || "",
      emergency_contact: employee.emergency_contact || "",
      status: employee.status || "active",
      job_role: employee.job_role || "",
      user_type: employee.user_type || "normal",
      module_access: employee.module_access ?? [],
    });
  };

  const handleEditSave = async (employeeId: string) => {
    if (!canManageAccess) {
      setNotice({ type: "warning", message: "You do not have permission to manage employee access." });
      return;
    }
    try {
      await apiFetch(`/api/employees/${employeeId}`, { method: "PUT", body: JSON.stringify(editForm) });
      setNotice({ type: "success", message: "Employee updated successfully." });
      setEditingId(null);
      void loadEmployees(query);
      void loadStats();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number });
    }
  };

  const deptCounts = employees.reduce<Record<string, number>>((acc, emp) => {
    const key = emp.department || "Unassigned";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const statusCounts = employees.reduce<Record<string, number>>((acc, emp) => {
    const key = emp.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <section className="panel">
      <Tabs>
        <TabsTrigger active={tab === "list"} onClick={() => setTab("list")}>Directory</TabsTrigger>
        <TabsTrigger
          active={tab === "rbac"}
          onClick={() => setTab("rbac")}
          disabled={!canManageAccess}
          title={!canManageAccess ? "No permission to manage access control." : ""}
        >
          Access Control (RBAC)
        </TabsTrigger>
        <TabsTrigger active={tab === "stats"} onClick={() => setTab("stats")}>Statistics</TabsTrigger>
      </Tabs>

      <TabsContent>
        {tab === "list" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem", marginTop: "1.5rem" }}>
            {/* Left Column: Add Employee Form */}
            <div className="panel" style={{ padding: "1.5rem", background: "#FFFFFF", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem", color: "#0F172A", fontWeight: 600 }}>
                ➕ Add New Employee
              </h4>
              <p className="muted" style={{ margin: "0 0 1.25rem 0", fontSize: "0.875rem" }}>
                Basic details only. RBAC permissions can be configured later.
              </p>
              <form className="grid-form" onSubmit={handleAdd}>
                <Label>Username<Input value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} required disabled={!canCreateOrDelete} /></Label>
                <Label>Password<Input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required disabled={!canCreateOrDelete} /></Label>
                <Label>Full Name<Input value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} required disabled={!canCreateOrDelete} /></Label>
                <Label>Email<Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required disabled={!canCreateOrDelete} /></Label>
                <Label>Phone<Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} required disabled={!canCreateOrDelete} /></Label>
                <Label>
                  Job Title
                  <Select value={form.job_role} onChange={(e) => setForm((p) => ({ ...p, job_role: e.target.value }))} required disabled={!canCreateOrDelete}>
                    <option value="">Select a role</option>
                    <option value="Doctor">Doctor</option>
                    <option value="Nurse">Nurse</option>
                    <option value="Admin">Admin</option>
                    <option value="Receptionist">Receptionist</option>
                    <option value="Pharmacist">Pharmacist</option>
                    <option value="Lab Technician">Lab Technician</option>
                    <option value="Technician">Technician</option>
                    <option value="Other">Other</option>
                  </Select>
                </Label>
                <Label>
                  Department
                  <Select value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} required disabled={!canCreateOrDelete}>
                    <option value="">Select a department</option>
                    {departments.map(d => d.department_name ? <option key={d.department_name} value={d.department_name}>{d.department_name}</option> : null)}
                    <option value="Other">Other (Type custom)</option>
                  </Select>
                </Label>
                {form.department === "Other" && (
                  <Label>
                    Custom Department
                    <Input value={customDept} onChange={(e) => setCustomDept(e.target.value)} required disabled={!canCreateOrDelete} placeholder="Type department name..." />
                  </Label>
                )}
                <Label className="span-2">Address<Textarea rows={2} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} disabled={!canCreateOrDelete} /></Label>
                <Label className="span-2">Emergency Contact<Input value={form.emergency_contact} onChange={(e) => setForm((p) => ({ ...p, emergency_contact: e.target.value }))} disabled={!canCreateOrDelete} /></Label>
                <div className="form-actions span-2">
                  <Button variant="primary" type="submit" disabled={!canCreateOrDelete}>Add Employee</Button>
                  <Button variant="secondary" type="button" onClick={() => setForm(EMPTY_SIGNUP_FORM)}>Reset</Button>
                </div>
              </form>
            </div>

            {/* Right Column: Employees Directory Table */}
            <div className="panel" style={{ padding: "1.5rem", background: "#FFFFFF", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "1.15rem", color: "#0F172A", fontWeight: 600 }}>
                    👥 Employee Directory ({employees.length})
                  </h4>
                  <p className="muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
                    Basic staff information and contact details.
                  </p>
                </div>
                <div className="module-inline-actions">
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." style={{ width: '200px' }} />
                  <Button variant="secondary" size="sm" onClick={() => void loadEmployees(query)}>Search</Button>
                </div>
              </div>

              <Table>
                <TableHead style={{ gridTemplateColumns: "2fr 2fr 2fr 1.5fr 1.5fr" }}>
                  <TableCell>EMPLOYEE</TableCell>
                  <TableCell>CONTACT</TableCell>
                  <TableCell>ROLE / DEPT</TableCell>
                  <TableCell>STATUS</TableCell>
                  <TableCell style={{ textAlign: "right" }}>ACTIONS</TableCell>
                </TableHead>
                <div>
                  {employees.map((emp) => (
                    <TableRow key={emp.employee_id} style={{ gridTemplateColumns: "2fr 2fr 2fr 1.5fr 1.5fr" }}>
                      <TableCell>
                        <div style={{ fontWeight: 600, color: "#1E293B" }}>{emp.full_name || emp.username}</div>
                        <div className="muted" style={{ fontSize: "0.75rem" }}>ID: {emp.employee_id}</div>
                      </TableCell>
                      <TableCell>
                        <div style={{ fontSize: "0.85rem" }}>{emp.email || "-"}</div>
                        <div className="muted" style={{ fontSize: "0.85rem" }}>{emp.phone || "-"}</div>
                      </TableCell>
                      <TableCell>
                        <div style={{ fontWeight: 500 }}>{emp.job_role || "-"}</div>
                        <span style={{ padding: "0.2rem 0.4rem", background: "#F1F5F9", borderRadius: "4px", fontSize: "0.75rem", color: "#334155" }}>
                          {emp.department || "No Dept"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            borderRadius: "12px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            backgroundColor: emp.status === "active" ? "#DEF7EC" : "#FDE8E8",
                            color: emp.status === "active" ? "#03543F" : "#9B1C1C",
                          }}
                        >
                          {emp.status === "active" ? "● Active" : "○ Inactive"}
                        </span>
                      </TableCell>
                      <TableCell style={{ textAlign: "right" }}>
                        <div className="module-inline-actions" style={{ justifyContent: "flex-end" }}>
                          <Button variant="secondary" size="sm" onClick={() => void toggleStatus(emp)} disabled={!canEditProfile}>
                            {emp.status === "active" ? "Deactivate" : "Activate"}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(emp)} disabled={!canCreateOrDelete}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {employees.length === 0 && (
                    <TableRow style={{ gridTemplateColumns: "1fr" }}>
                      <TableCell className="muted" style={{ gridColumn: "1 / -1", padding: "2rem", textAlign: "center" }}>
                        No employees found.
                      </TableCell>
                    </TableRow>
                  )}
                </div>
              </Table>
            </div>
          </div>
        )}

        {tab === "rbac" && (
          <div className="panel" style={{ padding: "1.5rem", background: "#FFFFFF", borderRadius: "12px", border: "1px solid #E2E8F0", marginTop: "1.5rem" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem", color: "#0F172A", fontWeight: 600 }}>
              🛡️ Access Control (RBAC)
            </h4>
            <p className="muted" style={{ margin: "0 0 1.5rem 0", fontSize: "0.875rem" }}>
              Manage user roles and module permissions for existing employees.
            </p>
            <Table>
              <TableHead style={{ gridTemplateColumns: "2fr 1fr 3fr 1fr" }}>
                <TableCell>EMPLOYEE</TableCell>
                <TableCell>USER TYPE</TableCell>
                <TableCell>MODULE ACCESS</TableCell>
                <TableCell style={{ textAlign: "right" }}>ACTIONS</TableCell>
              </TableHead>
              <div>
                {employees.map((emp) => (
                  <TableRow key={`rbac-${emp.employee_id}`} style={{ gridTemplateColumns: "2fr 1fr 3fr 1fr" }}>
                    <TableCell>
                      <div style={{ fontWeight: 600, color: "#1E293B" }}>{emp.full_name || emp.username}</div>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>{emp.job_role || "-"}</div>
                    </TableCell>
                    {editingId === emp.employee_id ? (
                      <TableCell style={{ gridColumn: "1 / -1" }}>
                        <div className="panel" style={{ margin: "0.5rem 0", padding: "1rem", background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                          <h5 style={{ marginTop: 0, marginBottom: "1rem" }}>Edit Access for {emp.full_name || emp.username}</h5>
                          <Label>
                            User Type
                            <Select value={editForm.user_type || "normal"} onChange={(e) => setEditForm((p) => ({ ...p, user_type: e.target.value as SignupForm["user_type"] }))}>
                              {USER_TYPE_OPTIONS.map((role) => (
                                <option key={role.value} value={role.value}>{role.label}</option>
                              ))}
                            </Select>
                          </Label>
                          {(editForm.user_type || "normal") !== "admin" && (
                            <Label style={{ marginTop: "1rem" }}>
                              Module Access
                              <p className="muted" style={{ margin: "0.25rem 0 0.5rem 0", fontSize: "0.8rem" }}>
                                Check a module for full access to it, or expand it to grant only specific sub-items.
                              </p>
                              <div className="module-grid" style={{ marginTop: "0.5rem" }}>
                                {MODULE_OPTIONS.map((module) => {
                                  const moduleAccess = editForm.module_access || [];
                                  const fullyGranted = isModuleFullyGranted(moduleAccess, module.value);
                                  const subItems = SUB_MODULES[module.value];
                                  return (
                                    <div key={module.value} style={{ marginBottom: "0.5rem" }}>
                                      <label className="checkbox-line" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Checkbox
                                          checked={fullyGranted}
                                          onChange={() =>
                                            setEditForm((p) => ({
                                              ...p,
                                              module_access: toggleWholeModule(p.module_access || [], module.value),
                                            }))
                                          }
                                        />
                                        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{module.label}</span>
                                      </label>
                                      {subItems && (
                                        <div style={{ marginLeft: "1.75rem", marginTop: "0.25rem" }}>
                                          {subItems.map((sub) => (
                                            <label
                                              key={sub.value}
                                              className="checkbox-line"
                                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.15rem' }}
                                            >
                                              <Checkbox
                                                checked={isSubItemGranted(moduleAccess, module.value, sub.value)}
                                                onChange={() =>
                                                  setEditForm((p) => ({
                                                    ...p,
                                                    module_access: toggleSubItem(
                                                      p.module_access || [],
                                                      module.value,
                                                      sub.value,
                                                      subItems.map((s) => s.value)
                                                    ),
                                                  }))
                                                }
                                              />
                                              <span style={{ fontSize: "0.8rem", color: "#475569" }}>{sub.label}</span>
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </Label>
                          )}
                          <div className="form-actions" style={{ marginTop: "1.5rem" }}>
                            <Button variant="primary" type="button" onClick={() => void handleEditSave(emp.employee_id)} disabled={!canManageAccess}>
                              Save Access
                            </Button>
                            <Button variant="secondary" type="button" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        </div>
                      </TableCell>
                    ) : (
                      <>
                        <TableCell>
                          <Badge variant={emp.user_type === "admin" ? "default" : "secondary"}>
                            {USER_TYPE_LABELS[emp.user_type || ""] || USER_TYPE_LABELS.normal}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {emp.user_type === "admin" ? (
                              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>All Modules</span>
                            ) : (emp.module_access ?? []).length > 0 ? (
                              (emp.module_access ?? []).map(m => (
                                <span key={m} style={{ padding: "0.1rem 0.4rem", background: "#E2E8F0", borderRadius: "4px", fontSize: "0.7rem", color: "#475569" }}>
                                  {describeModuleAccessEntry(m)}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>No access</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell style={{ textAlign: "right" }}>
                          <Button variant="secondary" size="sm" onClick={() => startEdit(emp)} disabled={!canManageAccess}>
                            Edit Access
                          </Button>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
                {employees.length === 0 && (
                  <TableRow style={{ gridTemplateColumns: "1fr" }}>
                    <TableCell className="muted" style={{ gridColumn: "1 / -1", padding: "2rem", textAlign: "center" }}>
                      No employees found.
                    </TableCell>
                  </TableRow>
                )}
              </div>
            </Table>
          </div>
        )}

        {tab === "stats" && (
          <div>
            <div className="stat-grid">
              <StatCard label="Total Employees" value={stats.total} />
              <StatCard label="Active Employees" value={stats.active} />
              <StatCard label="Inactive Employees" value={stats.inactive} />
            </div>

            <div className="panel">
              <h4>Department Distribution</h4>
              <div className="bar-chart">
                {Object.entries(deptCounts).map(([dept, count]) => (
                  <div key={dept} className="bar-row">
                    <span>{dept}</span>
                    <div className="bar">
                      <div style={{ width: `${(count / Math.max(1, employees.length)) * 100}%` }} />
                    </div>
                    <span>{count}</span>
                  </div>
                ))}
              </div>

              <h4>Status Distribution</h4>
              <div className="bar-chart">
                {Object.entries(statusCounts).map(([status, count]) => (
                  <div key={status} className="bar-row">
                    <span>{status}</span>
                    <div className="bar">
                      <div style={{ width: `${(count / Math.max(1, employees.length)) * 100}%` }} />
                    </div>
                    <span>{count}</span>
                  </div>
                ))}
              </div>

              <h4>All Employees (Table View)</h4>
              <Table>
                <TableHead>
                  <TableCell>Employee ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>User Type</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Date Joined</TableCell>
                </TableHead>
                {employees.map((emp) => (
                  <TableRow key={`table-${emp.employee_id}`}>
                    <TableCell>{emp.employee_id}</TableCell>
                    <TableCell>{emp.full_name || emp.username}</TableCell>
                    <TableCell>{USER_TYPE_LABELS[emp.user_type || ""] || USER_TYPE_LABELS.normal}</TableCell>
                    <TableCell>{emp.department || "-"}</TableCell>
                    <TableCell>{emp.status || "-"}</TableCell>
                    <TableCell>{formatDate(emp.date_joined)}</TableCell>
                  </TableRow>
                ))}
              </Table>
            </div>
          </div>
        )}
      </TabsContent>
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deletingEmployee}
        title="Delete employee?"
        description={
          deleteTarget
            ? `This will permanently remove ${deleteTarget.full_name || deleteTarget.username} (${deleteTarget.employee_id}).`
            : "This action cannot be undone."
        }
        confirmLabel="Delete Employee"
      />
    </section>
  );
}
