import type { ModuleOption, ModuleId, NavItem, PatientForm, SignupForm, UserTypeOption } from "../types";

// With Vite's dev server proxy, API requests use relative paths (/api/...).
// The proxy transparently forwards them to the Flask backend on port 5001.
// This eliminates all cross-origin cookie issues.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const SYMPTOM_API_BASE = import.meta.env.VITE_SYMPTOM_API_BASE ?? "";


export const USER_TYPE_OPTIONS: UserTypeOption[] = [
  {
    value: "normal",
    label: "Normal User",
    description: "Access only to assigned modules.",
  },
  {
    value: "admin",
    label: "Admin User",
    description: "Employee management and full module control.",
  },
];

export const USER_TYPE_LABELS = USER_TYPE_OPTIONS.reduce<Record<string, string>>((acc, role) => {
  acc[role.value] = role.label;
  return acc;
}, {});

export const MODULE_OPTIONS: ModuleOption[] = [
  { value: "dashboard", label: "Dashboard", description: "Hospital dashboard and analytics widgets." },
  { value: "patients", label: "Patient Management", description: "Patient registration and treatment workflows." },
  { value: "billing", label: "Billing", description: "Invoices, collections, and payment workflows." },
  { value: "pharmacy", label: "Pharmacy", description: "Inventory and pharmacy sales operations." },
  { value: "lab", label: "Lab & Diagnostics", description: "Diagnostic vendors and test records." },
  { value: "hrms", label: "HRMS", description: "Attendance, payroll, and leave operations." },
  { value: "ot", label: "OT", description: "Operation theatre scheduling and utilisation." },
  { value: "accounts", label: "Accounts", description: "Ledger, vendor payments, and doctor payouts." },
  { value: "reports", label: "Reports", description: "Cross-module operational and financial reporting." },
  { value: "symptom_ai", label: "SymptoMap AI", description: "AI symptom and OCR tools." },
];

export const DEFAULT_MODULE_ACCESS: ModuleId[] = ["dashboard", "patients", "symptom_ai"];
export const ALL_ASSIGNABLE_MODULES: ModuleId[] = MODULE_OPTIONS.map((module) => module.value);

export const ADMIN_PERMISSIONS: string[] = [
    "patients.read",
    "patients.write",
    "patients.delete",
    "symptom_ai.use",
    "employees.read",
    "employees.write",
    "billing.read",
    "billing.write",
    "pharmacy.read",
    "pharmacy.write",
    "lab.read",
    "lab.write",
    "hr.read",
    "hr.write",
    "ot.read",
    "ot.write",
    "accounts.read",
    "accounts.write",
    "reports.read",
    "audit.read",
    "admin.use",
];

export const MODULE_PERMISSIONS: Record<ModuleId, string[]> = {
  dashboard: ["patients.read"],
  patients: ["patients.read", "patients.write"],
  billing: ["billing.read", "billing.write"],
  pharmacy: ["pharmacy.read", "pharmacy.write"],
  lab: ["lab.read", "lab.write"],
  hrms: ["hr.read", "hr.write"],
  ot: ["ot.read", "ot.write"],
  accounts: ["accounts.read", "accounts.write"],
  reports: ["reports.read"],
  symptom_ai: ["symptom_ai.use"],
};

export const NAV_ITEMS: NavItem[] = [
  // Overview: landing page, then the two most common patient lookups.
  { id: "dashboard", label: "Dashboard", group: "overview", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "patients", label: "Patients", group: "overview", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "readmit", label: "Re-admit", group: "overview", permission: "patients.write", deniedHint: "Requires patient write access." },

  // OP Management: ordered to match the actual front-desk-to-discharge patient journey.
  { id: "add", label: "Patient Registration", group: "registration", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "consent-desk", label: "Consent Desk", group: "registration", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "insurance-desk", label: "Insurance Desk", group: "registration", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "appointment-in", label: "Appointment In", group: "registration", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "queue", label: "Queue Management", group: "registration", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "doctor-prescription", label: "Doctor Prescription", group: "registration", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "emr", label: "EMR", group: "registration", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "appointment-out", label: "Appointment Out", group: "registration", permission: "patients.read", deniedHint: "Requires patient access." },

  // Operations: scheduling first, then the departments doctors refer patients to.
  { id: "op-desk", label: "Doctor Scheduling", group: "operations", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "pharmacy", label: "Pharmacy", group: "operations", permission: "pharmacy.read", deniedHint: "Requires pharmacy access." },
  { id: "lab", label: "Lab & Diagnostics", group: "operations", permission: "lab.read", deniedHint: "Requires lab access." },
  { id: "ot", label: "OT", group: "operations", permission: "ot.read", deniedHint: "Requires OT access." },

  // AI: the flagship assistant first, then supporting document/bulk tools.
  { id: "symptom-ai", label: "SymptoMap AI", group: "ai", permission: "symptom_ai.use", deniedHint: "Requires SymptoMap AI access." },
  { id: "ocr", label: "OCR Scanner", group: "ai", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "bulk-ai", label: "AI Mode", group: "ai", permission: "patients.write", deniedHint: "Requires patient write access." },

  // Finance: overview first, then day-to-day billing actions, then reconciliation/analytics,
  // then accounts-payable (ledger/vendor/doctor payouts), then cross-module reports last.
  { id: "accounts-overview", label: "Accounts Overview", group: "finance", permission: "accounts.read", deniedHint: "Requires accounts access." },
  { id: "billing-create-invoice", label: "Create Invoice", group: "finance", permission: "billing.write", deniedHint: "Requires billing write access." },
  { id: "billing-invoices", label: "Invoices", group: "finance", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "billing-record-payment", label: "Record Payment", group: "finance", permission: "billing.write", deniedHint: "Requires billing write access." },
  { id: "billing-reconciliation", label: "Payment Reconciliation", group: "finance", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "billing-insurance-claims", label: "Insurance Claims", group: "finance", permission: "billing.write", deniedHint: "Requires billing write access." },
  { id: "billing-mode-breakdown", label: "Payment Mode Breakdown", group: "finance", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "billing-module-collections", label: "Collections by Module", group: "finance", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "billing-aging", label: "Receivable Aging", group: "finance", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "accounts-ledger", label: "Ledger Entries", group: "finance", permission: "accounts.read", deniedHint: "Requires accounts access." },
  { id: "accounts-vendor-payments", label: "Vendor Payments", group: "finance", permission: "accounts.read", deniedHint: "Requires accounts access." },
  { id: "accounts-doctor-payouts", label: "Doctor Payouts", group: "finance", permission: "accounts.read", deniedHint: "Requires accounts access." },
  { id: "reports", label: "Reports", group: "finance", permission: "reports.read", deniedHint: "Requires reports access." },

  // Administration: manage employees before managing their HR operations (attendance/payroll/leave).
  { id: "employees", label: "Employee Management", group: "admin", permission: "employees.read", deniedHint: "Requires admin access." },
  { id: "hrms", label: "HRMS", group: "admin", permission: "hr.read", deniedHint: "Requires HRMS access." },

  { id: "settings", label: "Settings" },
];

export const DOC_TYPES = [
  { value: "test_docs", label: "Test Documents" },
  { value: "xray_mri", label: "X-Ray / MRI" },
  { value: "prescriptions", label: "Prescription" },
];

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "tif",
  "tiff",
  "bmp",
  "gif",
  "heic",
  "heif",
];

const SUPPORTED_DOCUMENT_EXTENSION_SET = new Set(SUPPORTED_DOCUMENT_EXTENSIONS);

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const isSupportedDocumentFile = (file: File) => {
  const parts = file.name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return SUPPORTED_DOCUMENT_EXTENSION_SET.has(ext);
};

export const EMPTY_PATIENT_FORM: PatientForm = {
  name: "",
  middle_name: "",
  last_name: "",
  dob: "",
  age: "",
  weight: "",
  height: "",
  gender: "Female",
  pregnant: false,
  allergy1: "",
  allergy2: "",
  allergy3: "",
  symptoms: "",
  phone: "",
  address: "",
  blood_group: "",
  emergency_contact: "",
  aadhar_number: "",
};

export const EMPTY_SIGNUP_FORM: SignupForm = {
  username: "",
  password: "",
  full_name: "",
  email: "",
  phone: "",
  user_type: "normal",
  module_access: [...DEFAULT_MODULE_ACCESS],
  job_role: "",
  department: "",
  address: "",
  emergency_contact: "",
};

export const EMPTY_STATS = { total: 0, today: 0, active_admissions: 0, documents: 0, readmitted_patients: 0 };

