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
        
        <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
          <button 
            className={`flex-1 py-2 text-sm font-medium rounded-md flex justify-center items-center gap-2 ${loginType === "staff" ? "bg-white shadow text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setLoginType("staff")}
            type="button"
          >
            <User size={16} /> Staff Login
          </button>
          <button 
            className={`flex-1 py-2 text-sm font-medium rounded-md flex justify-center items-center gap-2 ${loginType === "doctor" ? "bg-white shadow text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setLoginType("doctor")}
            type="button"
          >
            <Activity size={16} /> Doctor Login
          </button>
        </div>

        <h1 className="text-xl mb-2">{loginType === "doctor" ? "Doctor Portal" : "Welcome back"}</h1>
        <p className="muted mb-6">{loginType === "doctor" ? "Sign in to manage your consultations and queue." : "Sign in to manage patients, OCR documents, and admissions."}</p>

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
          <Button type="submit" variant="primary" className="w-full mt-4">
            Login
          </Button>
        </form>
        <div className="hint mt-4 text-center">Only hospital admins can access Employee Management.</div>
      </div>
    </div>
  );
}
