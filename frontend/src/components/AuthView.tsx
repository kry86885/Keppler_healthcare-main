import React, { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label } from "./ui";
import { FiUser as User, FiActivity as Activity } from "react-icons/fi";

type Props = {
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  initialHospitalCode: string;
};

export default function AuthView({ onLogin, initialHospitalCode }: Props) {
  const [loginType, setLoginType] = useState<"staff" | "doctor">("staff");

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-logo-full">
          <img src="/logo.png" alt="HospAI - AI Driven Healthcare Optimization" />
        </div>

        <div className="auth-toggle" role="tablist" aria-label="Login type">
          <button
            type="button"
            role="tab"
            aria-selected={loginType === "staff"}
            className={loginType === "staff" ? "auth-toggle-tab active" : "auth-toggle-tab"}
            onClick={() => setLoginType("staff")}
          >
            <User size={15} /> Staff Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={loginType === "doctor"}
            className={loginType === "doctor" ? "auth-toggle-tab active" : "auth-toggle-tab"}
            onClick={() => setLoginType("doctor")}
          >
            <Activity size={15} /> Doctor Login
          </button>
        </div>

        <div className="auth-heading">
          <h1>{loginType === "doctor" ? "Doctor Portal" : "Welcome back"}</h1>
          <p className="muted">
            {loginType === "doctor"
              ? "Sign in to manage your consultations and queue."
              : "Sign in to manage patients, OCR documents, and admissions."}
          </p>
        </div>

        <form className="auth-form" onSubmit={onLogin}>
          <Label>
            Hospital Code
            <Input name="hospital_code" defaultValue={initialHospitalCode} placeholder="hosp-default" required />
          </Label>
          <Label>
            Username
            <Input name="username" placeholder={loginType === "doctor" ? "dr.smith" : "employee"} required />
          </Label>
          <Label>
            Password
            <Input name="password" type="password" placeholder="••••••" required />
          </Label>
          <Button type="submit" variant="primary" className="auth-submit">
            Login
          </Button>
        </form>
        <div className="hint auth-hint">Only hospital admins can access Employee Management.</div>
      </div>
    </div>
  );
}
