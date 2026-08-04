import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label, Tabs, TabsTrigger } from "../components/ui";

type Props = {
  initialHospitalCode: string;
  onCreateHospital: (event: FormEvent<HTMLFormElement>) => void;
  onSetupHospitalAdmin: (event: FormEvent<HTMLFormElement>) => void;
  onResetHospitalAdminPassword: (event: FormEvent<HTMLFormElement>) => void;
  onToggleHospitalAccess: (event: FormEvent<HTMLFormElement>) => void;
};

type AdminAction = "create-hospital" | "onboard-admin" | "reset-password" | "toggle-access";

const ACTIONS: { id: AdminAction; label: string }[] = [
  { id: "create-hospital", label: "Add Hospital" },
  { id: "onboard-admin", label: "Onboard Admin" },
  { id: "reset-password", label: "Reset Password" },
  { id: "toggle-access", label: "Enable / Disable" },
];

export default function PlatformAdminPage({
  initialHospitalCode,
  onCreateHospital,
  onSetupHospitalAdmin,
  onResetHospitalAdminPassword,
  onToggleHospitalAccess,
}: Props) {
  const [activeAction, setActiveAction] = useState<AdminAction>("create-hospital");

  return (
    <div className="auth-page">
      <div className="auth-card platform-admin-card">
        <div className="brand brand-logo-full">
          <img src="/logo.png" alt="HospAI - AI Driven Healthcare Optimization" />
        </div>
        <div className="auth-heading">
          <h1>Platform Admin Console</h1>
          <p className="muted">Use platform onboarding credentials from backend `.env`.</p>
        </div>

        <Tabs role="tablist" aria-label="Platform admin actions">
          {ACTIONS.map((action) => (
            <TabsTrigger
              key={action.id}
              type="button"
              active={activeAction === action.id}
              onClick={() => setActiveAction(action.id)}
            >
              {action.label}
            </TabsTrigger>
          ))}
        </Tabs>

        {activeAction === "create-hospital" && (
          <form className="auth-form" onSubmit={onCreateHospital}>
            <Label>
              Platform Admin Username
              <Input name="platform_admin_username" placeholder="platform-admin" required />
            </Label>
            <Label>
              Platform Admin Password
              <Input name="platform_admin_password" type="password" placeholder="••••••••" required />
            </Label>
            <Label>
              Hospital Code
              <Input name="hospital_code" defaultValue={initialHospitalCode} required />
            </Label>
            <Label>
              Hospital Name
              <Input name="hospital_name" placeholder="City Hospital" />
            </Label>
            <Button type="submit" variant="primary">
              Add Hospital
            </Button>
          </form>
        )}

        {activeAction === "onboard-admin" && (
          <form className="auth-form" onSubmit={onSetupHospitalAdmin}>
            <Label>
              Platform Admin Username
              <Input name="platform_admin_username" placeholder="platform-admin" required />
            </Label>
            <Label>
              Platform Admin Password
              <Input name="platform_admin_password" type="password" placeholder="••••••••" required />
            </Label>
            <Label>
              Hospital Code
              <Input name="hospital_code" required />
            </Label>
            <Label>
              Admin Username
              <Input name="admin_username" required />
            </Label>
            <Label>
              Admin Password
              <Input name="admin_password" type="password" required />
            </Label>
            <Label>
              Admin Full Name
              <Input name="admin_full_name" />
            </Label>
            <Label>
              Admin Email
              <Input name="admin_email" type="email" />
            </Label>
            <Label>
              Admin Phone
              <Input name="admin_phone" />
            </Label>
            <Button type="submit" variant="primary">
              Onboard Hospital Admin
            </Button>
          </form>
        )}

        {activeAction === "reset-password" && (
          <form className="auth-form" onSubmit={onResetHospitalAdminPassword}>
            <Label>
              Platform Admin Username
              <Input name="platform_admin_username" placeholder="platform-admin" required />
            </Label>
            <Label>
              Platform Admin Password
              <Input name="platform_admin_password" type="password" placeholder="••••••••" required />
            </Label>
            <Label>
              Hospital Code
              <Input name="hospital_code" required />
            </Label>
            <Label>
              Admin Username
              <Input name="admin_username" required />
            </Label>
            <Label>
              New Password
              <Input name="new_password" type="password" required />
            </Label>
            <Button type="submit" variant="primary">
              Reset Admin Password
            </Button>
          </form>
        )}

        {activeAction === "toggle-access" && (
          <form className="auth-form" onSubmit={onToggleHospitalAccess}>
            <Label>
              Platform Admin Username
              <Input name="platform_admin_username" placeholder="platform-admin" required />
            </Label>
            <Label>
              Platform Admin Password
              <Input name="platform_admin_password" type="password" placeholder="••••••••" required />
            </Label>
            <Label>
              Hospital Code
              <Input name="hospital_code" required />
            </Label>
            <Label>
              Action (disable or enable)
              <Input name="action" placeholder="disable" required />
            </Label>
            <Label>
              Reason (for disable)
              <Input name="reason" placeholder="Policy violation" />
            </Label>
            <Button type="submit" variant="primary">
              Update Hospital Access
            </Button>
          </form>
        )}

        <p className="hint" style={{ textAlign: "center" }}>
          Hospital login stays on <a href="/">/</a>.
        </p>
      </div>
    </div>
  );
}
