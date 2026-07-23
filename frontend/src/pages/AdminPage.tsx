import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { ALL_ASSIGNABLE_MODULES, DEFAULT_MODULE_ACCESS, MODULE_OPTIONS } from "../lib/constants";
import { apiFetch, reportError } from "../lib/api";
import { Badge, Button, Checkbox, Input, Label, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import type { Employee, ModuleId, Notice, UserType } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type AdminForm = {
  username: string;
  password: string;
  full_name: string;
  email: string;
  phone: string;
  department: string;
  user_type: UserType;
  module_access: ModuleId[];
};

const EMPTY_FORM: AdminForm = {
  username: "",
  password: "",
  full_name: "",
  email: "",
  phone: "",
  department: "Administration",
  user_type: "normal",
  module_access: [...DEFAULT_MODULE_ACCESS],
};

export default function AdminPage({ setNotice }: Props) {
  const [form, setForm] = useState<AdminForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [users, setUsers] = useState<Employee[]>([]);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const toggleModule = (current: ModuleId[] | undefined, moduleName: ModuleId) => {
    const set = new Set(current || []);
    if (set.has(moduleName)) {
      set.delete(moduleName);
    } else {
      set.add(moduleName);
    }
    return ALL_ASSIGNABLE_MODULES.filter((module) => set.has(module));
  };

  const loadAdminAuthState = async () => {
    setAuthLoading(true);
    try {
      const state = await apiFetch<{ authorized: boolean; configured: boolean }>("/api/admin/auth/session");
      setAuthorized(!!state.authorized);
      setConfigured(!!state.configured);
    } catch {
      setAuthorized(false);
      setConfigured(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await apiFetch<{ users?: Employee[] }>("/api/admin/users");
      setUsers(data.users || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load users.");
    }
  };

  useEffect(() => {
    void loadAdminAuthState();
  }, []);

  useEffect(() => {
    if (!authorized) return;
    void loadUsers();
  }, [authorized]);

  const handleAdminAuthLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authSubmitting) return;
    setAuthSubmitting(true);
    try {
      await apiFetch("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: authPassword }),
      });
      setAuthorized(true);
      setAuthPassword("");
      setNotice({ type: "success", message: "Admin route unlocked." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Invalid admin route password.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAdminAuthLogout = async () => {
    try {
      await apiFetch("/api/admin/auth/logout", { method: "POST" });
      setAuthorized(false);
      setUsers([]);
      setNotice({ type: "success", message: "Admin route locked." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to lock admin route.");
    }
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const payload = {
        ...form,
        user_type: form.user_type,
        module_access: form.user_type === "admin" ? ALL_ASSIGNABLE_MODULES : form.module_access,
        job_role: form.user_type === "admin" ? "System Admin" : "Staff",
        address: "",
        emergency_contact: "",
      };
      const response = await apiFetch<{ success?: boolean; message?: string; employee_id?: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (response.success) {
        setNotice({
          type: "success",
          message: response.employee_id
            ? `User created (${response.employee_id}).`
            : response.message || "User created.",
        });
        setForm(EMPTY_FORM);
        await loadUsers();
      } else {
        setNotice({ type: "error", message: response.message || "Unable to create user." });
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create user.");
    } finally {
      setCreating(false);
    }
  };

  const handlePromoteToAdmin = async (employeeId: string) => {
    setPromotingId(employeeId);
    try {
      await apiFetch(`/api/admin/users/${employeeId}/promote`, { method: "POST" });
      setNotice({ type: "success", message: `${employeeId} promoted to admin.` });
      await loadUsers();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to promote user.");
    } finally {
      setPromotingId(null);
    }
  };

  if (authLoading) {
    return (
      <section className="panel admin-auth-panel">
        <h3>Admin Route</h3>
        <p className="muted">Checking admin access...</p>
      </section>
    );
  }

  if (!configured) {
    return (
      <section className="panel admin-auth-panel">
        <h3>Admin Route</h3>
        <p className="muted">Admin route password is not configured on the server.</p>
        <p className="muted">
          Set <code>ADMIN_ROUTE_PASSWORD</code> in your <code>.env</code> and restart the backend.
        </p>
      </section>
    );
  }

  if (!authorized) {
    return (
      <section className="panel admin-auth-panel">
        <h3>Admin Route Login</h3>
        <p className="muted">Enter the route password to access admin management.</p>
        <form className="grid-form" onSubmit={handleAdminAuthLogin}>
          <Label className="span-2">
            Admin Route Password
            <Input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} required />
          </Label>
          <div className="form-actions span-2">
            <Button variant="primary" type="submit" disabled={authSubmitting}>
              {authSubmitting ? "Unlocking..." : "Unlock /admin"}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="panel admin-page">
      <div className="admin-page-header">
        <div>
          <h3>Admin Management</h3>
          <p className="muted">Create users and promote existing users to admin.</p>
        </div>
        <div className="form-actions">
          <Button variant="secondary" type="button" onClick={handleAdminAuthLogout}>
            Lock /admin
          </Button>
        </div>
      </div>

      <div className="admin-page-grid">
        <div className="panel admin-page-section">
          <h4>Create New User</h4>
          <form className="grid-form" onSubmit={handleCreateUser}>
            <Label>
              Username
              <Input value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} required />
            </Label>
            <Label>
              Password
              <Input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} required />
            </Label>
            <Label>
              Full Name
              <Input value={form.full_name} onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))} required />
            </Label>
            <Label>
              Email
              <Input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} required />
            </Label>
            <Label>
              Phone
              <Input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} required />
            </Label>
            <Label>
              Department
              <Input value={form.department} onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))} required />
            </Label>
            <Label>
              User Type
              <Select value={form.user_type} onChange={(e) => setForm((prev) => ({ ...prev, user_type: e.target.value as UserType }))}>
                <option value="normal">Normal</option>
                <option value="admin">Admin</option>
              </Select>
            </Label>
            {form.user_type === "normal" && (
              <Label className="span-2">
                Module Access
                <div className="module-grid">
                  {MODULE_OPTIONS.map((module) => {
                    const selected = form.module_access.includes(module.value);
                    return (
                      <label key={module.value} className="checkbox-line">
                        <Checkbox
                          checked={selected}
                          onChange={() =>
                            setForm((prev) => ({
                              ...prev,
                              module_access: toggleModule(prev.module_access, module.value),
                            }))
                          }
                        />
                        <span>{module.label}</span>
                      </label>
                    );
                  })}
                </div>
              </Label>
            )}
            <div className="form-actions span-2">
              <Button variant="primary" type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create User"}
              </Button>
              <Button variant="secondary" type="button" onClick={() => setForm(EMPTY_FORM)} disabled={creating}>
                Reset
              </Button>
            </div>
          </form>
        </div>

        <div className="panel admin-page-section">
          <h4>Existing Users</h4>
          <div className="admin-users-table">
            <Table>
              <TableHead>
                <TableCell>Employee ID</TableCell>
                <TableCell>Username</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Action</TableCell>
              </TableHead>
              {users.map((user) => {
                const isAdmin = user.user_type === "admin";
                return (
                  <TableRow key={user.employee_id}>
                    <TableCell>{user.employee_id}</TableCell>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.full_name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={isAdmin ? "default" : "outline"}>{isAdmin ? "admin" : "normal"}</Badge>
                    </TableCell>
                    <TableCell>{user.status || "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="secondary"
                        onClick={() => void handlePromoteToAdmin(user.employee_id)}
                        disabled={isAdmin || promotingId === user.employee_id}
                      >
                        {promotingId === user.employee_id ? "Promoting..." : isAdmin ? "Already Admin" : "Make Admin"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
          </div>
        </div>
      </div>
    </section>
  );
}
