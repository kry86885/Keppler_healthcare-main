import React, { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label } from "./ui";
import {
  FiUsers,
  FiFileText,
  FiBarChart2,
  FiShield,
  FiHome,
  FiUser,
  FiLock,
  FiEye,
  FiEyeOff,
  FiLoader,
  FiActivity,
  FiPlusSquare,
} from "react-icons/fi";

type Props = {
  onLogin: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  initialHospitalCode: string;
};

type LoginType = "staff" | "doctor" | "pharmacist" | "admin";

const FEATURES = [
  { icon: FiUsers, label: "Patient Management" },
  { icon: FiFileText, label: "OCR & Smart Documentation" },
  { icon: FiBarChart2, label: "Billing & Analytics" },
  { icon: FiShield, label: "Secure & Compliant" },
];

const LOGIN_TABS: { type: LoginType; label: string; icon: typeof FiUser }[] = [
  { type: "staff", label: "Staff", icon: FiUser },
  { type: "doctor", label: "Doctor", icon: FiActivity },
  { type: "pharmacist", label: "Pharmacy", icon: FiPlusSquare },
  { type: "admin", label: "Admin", icon: FiShield },
];

const LOGIN_COPY: Record<
  LoginType,
  { heading: string; subtext: string; placeholder: string; submitLabel: string }
> = {
  staff: {
    heading: "Welcome Back",
    subtext: "Sign in to continue to HospAI",
    placeholder: "Enter your username",
    submitLabel: "Login",
  },
  doctor: {
    heading: "Doctor Portal",
    subtext: "Sign in to manage your consultations and queue.",
    placeholder: "dr.smith",
    submitLabel: "Login as Doctor",
  },
  pharmacist: {
    heading: "Pharmacy Portal",
    subtext: "Sign in to manage inventory, prescriptions, and dispensing.",
    placeholder: "pharmacy.desk",
    submitLabel: "Login to Pharmacy",
  },
  admin: {
    heading: "Admin Portal",
    subtext:
      "Sign in to manage employees, hospital settings, and access controls.",
    placeholder: "hospital.admin",
    submitLabel: "Login as Administrator",
  },
};

export default function AuthView({ onLogin, initialHospitalCode }: Props) {
  const [loginType, setLoginType] = useState<LoginType>("staff");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const copy = LOGIN_COPY[loginType];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    setSubmitting(true);
    Promise.resolve(onLogin(event)).finally(() => setSubmitting(false));
  };

  return (
    <div className="auth-page auth-page-split">
      <span className="auth-bg-blob auth-bg-blob-a" aria-hidden="true" />
      <span className="auth-bg-blob auth-bg-blob-b" aria-hidden="true" />
      <span className="auth-bg-blob auth-bg-blob-c" aria-hidden="true" />
      <div className="auth-brand-panel">
        <div className="auth-brand-panel-content">
          <img
            className="auth-brand-logo"
            src="/logo.png"
            alt="HospAI - AI Driven Healthcare Optimization"
          />
          <h2 className="auth-brand-headline">
            <span className="auth-brand-headline-line">
              Smarter Healthcare.
            </span>
            <span className="auth-brand-headline-line auth-brand-headline-accent">
              Better Outcomes.
            </span>
          </h2>
          <p className="auth-brand-subtext">
            Manage patients, streamline OP/IP operations, and deliver
            AI-assisted care -- all from one platform.
          </p>
          <div className="auth-feature-row">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div className="auth-feature" key={label}>
                <span className="auth-feature-icon">
                  <Icon aria-hidden />
                </span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-card">
          <div
            className="auth-type-tabs"
            role="tablist"
            aria-label="Login type"
          >
            {LOGIN_TABS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={loginType === type}
                className={
                  loginType === type ? "auth-type-tab active" : "auth-type-tab"
                }
                onClick={() => setLoginType(type)}
                disabled={submitting}
              >
                <Icon aria-hidden /> {label}
              </button>
            ))}
          </div>

          <div className="auth-heading">
            <h1>{copy.heading}</h1>
            <p className="muted">{copy.subtext}</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <Label>
              Hospital Code
              <span className="auth-input-group">
                <FiHome className="auth-input-icon" aria-hidden />
                <Input
                  name="hospital_code"
                  defaultValue={initialHospitalCode}
                  placeholder="hosp-default"
                  disabled={submitting}
                  required
                />
              </span>
            </Label>
            <Label>
              Username
              <span className="auth-input-group">
                <FiUser className="auth-input-icon" aria-hidden />
                <Input
                  name="username"
                  placeholder={copy.placeholder}
                  disabled={submitting}
                  required
                />
              </span>
            </Label>
            <Label>
              Password
              <span className="auth-input-group">
                <FiLock className="auth-input-icon" aria-hidden />
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  disabled={submitting}
                  required
                />
                <button
                  type="button"
                  className="auth-input-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <FiEyeOff aria-hidden />
                  ) : (
                    <FiEye aria-hidden />
                  )}
                </button>
              </span>
            </Label>
            <Button
              type="submit"
              variant="primary"
              className="auth-submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <FiLoader className="auth-spinner" aria-hidden /> Signing
                  in...
                </>
              ) : (
                copy.submitLabel
              )}
            </Button>
          </form>

          <div className="hint auth-hint">
            Only hospital admins can access Employee Management.
          </div>
        </div>
      </div>
    </div>
  );
}
