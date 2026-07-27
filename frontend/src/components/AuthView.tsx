import type { FormEvent } from "react";
import { Button, Input, Label } from "./ui";

type Props = {
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  initialHospitalCode: string;
};

export default function AuthView({ onLogin, initialHospitalCode }: Props) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-logo-full">
          <img src="/logo.png" alt="HospAI - AI Driven Healthcare Optimization" />
        </div>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage patients, OCR documents, and admissions.</p>

        <form className="auth-form" onSubmit={onLogin}>
          <Label>
            Hospital Code
            <Input name="hospital_code" defaultValue={initialHospitalCode} placeholder="hosp-default" required />
          </Label>
          <Label>
            Username
            <Input name="username" placeholder="employee" required />
          </Label>
          <Label>
            Password
            <Input name="password" type="password" placeholder="••••••" required />
          </Label>
          <Button type="submit" variant="primary">
            Login
          </Button>
        </form>
        <div className="hint">Only hospital admins can access Employee Management.</div>
      </div>
    </div>
  );
}
