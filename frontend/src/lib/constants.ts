import type {
  ModuleOption,
  ModuleId,
  NavItem,
  PatientForm,
  SignupForm,
  SubModuleOption,
  UserTypeOption,
} from "../types";

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

export const USER_TYPE_LABELS = USER_TYPE_OPTIONS.reduce<
  Record<string, string>
>((acc, role) => {
  acc[role.value] = role.label;
  return acc;
}, {});

export const MODULE_OPTIONS: ModuleOption[] = [
  {
    value: "dashboard",
    label: "Dashboard",
    description: "Hospital dashboard and analytics widgets.",
  },
  {
    value: "patients",
    label: "Patient Management",
    description: "Patient registration and treatment workflows.",
  },
  {
    value: "op",
    label: "Doctor Scheduling",
    description: "Doctor schedules and the doctor directory.",
  },
  {
    value: "beds",
    label: "Bed Management",
    description: "Room/bed layout, admitting and discharging patients.",
  },
  {
    value: "billing",
    label: "Billing",
    description: "Invoices, collections, and payment workflows.",
  },
  {
    value: "pharmacy",
    label: "Pharmacy",
    description: "Inventory and pharmacy sales operations.",
  },
  {
    value: "hrms",
    label: "HRMS",
    description: "Attendance, payroll, and leave operations.",
  },
  {
    value: "accounts",
    label: "Accounts",
    description: "Ledger, vendor payments, and doctor payouts.",
  },
  {
    value: "reports",
    label: "Reports",
    description: "Cross-module operational and financial reporting.",
  },
  {
    value: "symptom_ai",
    label: "SymptoMap AI",
    description: "AI symptom and OCR tools.",
  },
  {
    value: "employees",
    label: "Employee Management",
    description: "View and manage staff accounts and their access.",
  },
  {
    value: "patient_experience",
    label: "Patient Experience",
    description: "View and respond to patient feedback.",
  },
];

// Mirrors backend/core/auth.py's SUB_MODULES. Selecting a module alone grants
// full access to everything under it (all its sub-items); unchecking a
// specific sub-item narrows that down without removing the module entirely.
// A module with no entry here (dashboard, reports) has no finer-grained
// sub-items -- checking it is all-or-nothing, matching how it always worked.
export const SUB_MODULES: Partial<Record<ModuleId, SubModuleOption[]>> = {
  patients: [
    { value: "directory", label: "Patient Directory (edit/delete)" },
    { value: "registration", label: "Patient Registration" },
    { value: "consent_desk", label: "Consent Desk" },
    { value: "insurance_desk", label: "Insurance Desk" },
    { value: "appointments", label: "Appointments" },
    { value: "documents", label: "Documents & OCR" },
    {
      value: "clinical_records",
      label: "Clinical Records (encounters/notes/certificates)",
    },
    { value: "bulk_ai", label: "Bulk Patient AI" },
  ],
  op: [
    { value: "schedules", label: "Doctor Schedules" },
    { value: "doctors", label: "Doctor Directory" },
  ],
  beds: [
    {
      value: "manage",
      label: "Add/Edit Beds & Admit/Discharge Patients",
    },
  ],
  billing: [
    { value: "invoices", label: "Invoices & Payments" },
    { value: "claims", label: "Insurance Claims" },
  ],
  pharmacy: [
    { value: "inventory", label: "Inventory" },
    { value: "sales", label: "Sales" },
    { value: "suppliers", label: "Suppliers" },
    { value: "purchases", label: "Purchases" },
    { value: "prescriptions", label: "Prescriptions" },
  ],
  hrms: [
    { value: "departments", label: "Departments" },
    { value: "attendance", label: "Attendance" },
    { value: "payroll", label: "Payroll" },
    { value: "leaves", label: "Leave Requests" },
  ],
  accounts: [
    { value: "ledger", label: "Ledger" },
    { value: "vendor_payments", label: "Vendor Payments" },
    { value: "doctor_payouts", label: "Doctor Payouts" },
  ],
  symptom_ai: [{ value: "documents", label: "Knowledge Vault Documents" }],
  employees: [
    { value: "profile", label: "Edit Profile Fields" },
    { value: "access", label: "Manage Roles & Module Access" },
  ],
  patient_experience: [{ value: "feedback", label: "Respond to Feedback" }],
};

export const DEFAULT_MODULE_ACCESS: ModuleId[] = [
  "dashboard",
  "patients",
  "symptom_ai",
];
export const ALL_ASSIGNABLE_MODULES: ModuleId[] = MODULE_OPTIONS.map(
  (module) => module.value,
);

export const ADMIN_PERMISSIONS: string[] = [
  "patients.read",
  "patients.write",
  "patients.delete",
  "patients.registration.write",
  "patients.consent.write",
  "patients.insurance.write",
  "patients.appointments.write",
  "patients.documents.write",
  "patients.clinical.write",
  "patients.bulk_ai.write",
  "op.read",
  "op.schedules.write",
  "op.doctors.write",
  "beds.read",
  "beds.write",
  "symptom_ai.use",
  "symptom_ai.documents.write",
  "employees.read",
  "employees.profile.write",
  "employees.access.write",
  "billing.read",
  "billing.invoices.write",
  "billing.claims.write",
  "pharmacy.read",
  "pharmacy.inventory.write",
  "pharmacy.sales.write",
  "pharmacy.suppliers.write",
  "pharmacy.purchases.write",
  "pharmacy.prescriptions.write",
  "hr.read",
  "hr.departments.write",
  "hr.attendance.write",
  "hr.payroll.write",
  "hr.leaves.write",
  "accounts.read",
  "accounts.ledger.write",
  "accounts.vendors.write",
  "accounts.doctors.write",
  "reports.read",
  "patient_experience.read",
  "patient_experience.write",
  "audit.read",
  "admin.use",
];

// Base ("select whole module") permission set -- matches backend
// MODULE_PERMISSION_MAP: the module's read permission plus every sub-item's
// write permission, i.e. full access to that module.
export const MODULE_PERMISSIONS: Record<ModuleId, string[]> = {
  dashboard: ["patients.read"],
  patients: [
    "patients.read",
    "patients.write",
    "patients.delete",
    "patients.registration.write",
    "patients.consent.write",
    "patients.insurance.write",
    "patients.appointments.write",
    "patients.documents.write",
    "patients.clinical.write",
    "patients.bulk_ai.write",
  ],
  op: ["op.read", "op.schedules.write", "op.doctors.write"],
  beds: ["beds.read", "beds.write"],
  billing: ["billing.read", "billing.invoices.write", "billing.claims.write"],
  pharmacy: [
    "pharmacy.read",
    "pharmacy.inventory.write",
    "pharmacy.sales.write",
    "pharmacy.suppliers.write",
    "pharmacy.purchases.write",
    "pharmacy.prescriptions.write",
  ],
  hrms: [
    "hr.read",
    "hr.departments.write",
    "hr.attendance.write",
    "hr.payroll.write",
    "hr.leaves.write",
  ],
  accounts: [
    "accounts.read",
    "accounts.ledger.write",
    "accounts.vendors.write",
    "accounts.doctors.write",
  ],
  reports: ["reports.read"],
  symptom_ai: ["symptom_ai.use", "symptom_ai.documents.write"],
  employees: [
    "employees.read",
    "employees.profile.write",
    "employees.access.write",
  ],
  patient_experience: ["patient_experience.read", "patient_experience.write"],
};

// Maps a module + sub-item key to the specific permission(s) that sub-item
// grants, for expanding a single "module.subitem" module_access entry.
export const SUB_MODULE_PERMISSIONS: Partial<
  Record<ModuleId, Record<string, string[]>>
> = {
  patients: {
    directory: ["patients.write", "patients.delete"],
    registration: ["patients.registration.write"],
    consent_desk: ["patients.consent.write"],
    insurance_desk: ["patients.insurance.write"],
    appointments: ["patients.appointments.write"],
    documents: ["patients.documents.write"],
    clinical_records: ["patients.clinical.write"],
    bulk_ai: ["patients.bulk_ai.write"],
  },
  op: {
    schedules: ["op.schedules.write"],
    doctors: ["op.doctors.write"],
  },
  beds: {
    manage: ["beds.write"],
  },
  billing: {
    invoices: ["billing.invoices.write"],
    claims: ["billing.claims.write"],
  },
  pharmacy: {
    inventory: ["pharmacy.inventory.write"],
    sales: ["pharmacy.sales.write"],
    suppliers: ["pharmacy.suppliers.write"],
    purchases: ["pharmacy.purchases.write"],
    prescriptions: ["pharmacy.prescriptions.write"],
  },
  hrms: {
    departments: ["hr.departments.write"],
    attendance: ["hr.attendance.write"],
    payroll: ["hr.payroll.write"],
    leaves: ["hr.leaves.write"],
  },
  accounts: {
    ledger: ["accounts.ledger.write"],
    vendor_payments: ["accounts.vendors.write"],
    doctor_payouts: ["accounts.doctors.write"],
  },
  symptom_ai: {
    documents: ["symptom_ai.documents.write"],
  },
  employees: {
    profile: ["employees.profile.write"],
    access: ["employees.access.write"],
  },
  patient_experience: {
    feedback: ["patient_experience.write"],
  },
};

export const NAV_ITEMS: NavItem[] = [
  // Overview: landing page, then the two most common patient lookups.
  {
    id: "dashboard",
    label: "Dashboard",
    group: "overview",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "dashboard",
  },
  {
    id: "patients",
    label: "Patients",
    subtitle: "Search, review, and manage patient records.",
    group: "overview",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "patients",
  },
  {
    id: "readmit",
    label: "Re-admit",
    subtitle: "Find a previous patient and start a new visit.",
    group: "overview",
    permission: "patients.clinical.write",
    deniedHint: "Requires patient clinical-records access.",
    module: "patients",
  },

  // OP Management: ordered to match the actual front-desk-to-discharge patient journey.
  {
    id: "add",
    label: "Patient Registration",
    subtitle: "Register a new patient and capture their intake details.",
    group: "registration",
    permission: "patients.registration.write",
    deniedHint: "Requires patient registration access.",
    module: "patients",
  },
  {
    id: "consent-desk",
    label: "Consent Desk",
    subtitle: "Collect and verify patient consent forms.",
    group: "registration",
    permission: "patients.consent.write",
    deniedHint: "Requires consent desk access.",
    module: "patients",
  },
  {
    id: "insurance-desk",
    label: "Insurance Desk",
    subtitle: "Verify coverage and manage insurance claims eligibility.",
    group: "registration",
    permission: "patients.insurance.write",
    deniedHint: "Requires insurance desk access.",
    module: "patients",
  },
  {
    id: "appointment-in",
    label: "Appointment In",
    subtitle: "Check patients in and manage incoming appointments.",
    group: "registration",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "patients",
  },
  {
    id: "doctor-prescription",
    label: "Doctor Prescription",
    subtitle: "Consult, prescribe, and manage today's patient queue.",
    group: "registration",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "patients",
  },
  {
    id: "queue",
    label: "Queue Management",
    subtitle: "Track waiting patients and consultation status live.",
    group: "registration",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "patients",
  },
  {
    id: "emr",
    label: "EMR",
    subtitle: "Look up a patient's electronic medical record.",
    group: "registration",
    permission: "patients.read",
    deniedHint: "Requires patient access.",
    module: "patients",
  },
  {
    id: "appointment-out",
    label: "Appointment Out",
    subtitle: "Schedule and manage outgoing follow-up appointments.",
    group: "registration",
    permission: "patients.appointments.write",
    deniedHint: "Requires appointments access.",
    module: "patients",
  },

  // Operations: scheduling first, then the departments doctors refer patients to.
  {
    id: "op-desk",
    label: "Doctor Scheduling",
    subtitle: "Manage doctors and outpatient schedules.",
    group: "operations",
    permission: "op.read",
    deniedHint: "Requires doctor scheduling access.",
    module: "op",
  },
  {
    id: "beds",
    label: "Bed Management",
    subtitle: "See every room and bed at a glance, and admit or discharge patients.",
    group: "operations",
    permission: "beds.read",
    deniedHint: "Requires bed management access.",
    module: "beds",
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    subtitle: "Manage inventory, prescriptions, and sales intelligently.",
    group: "operations",
    permission: "pharmacy.read",
    deniedHint: "Requires pharmacy access.",
    module: "pharmacy",
  },

  // AI: the flagship assistant first, then supporting document/bulk tools.
  {
    id: "symptom-ai",
    label: "SymptoMap AI",
    subtitle: "AI-assisted symptom triage and wellness insights.",
    group: "ai",
    permission: "symptom_ai.use",
    deniedHint: "Requires SymptoMap AI access.",
    module: "symptom_ai",
  },
  {
    id: "ocr",
    label: "OCR Scanner",
    subtitle:
      "Upload scanned medical records, prescriptions, and reports for AI-powered text extraction, then browse or chat with what you've scanned.",
    group: "ai",
    permission: "patients.documents.write",
    deniedHint: "Requires documents access.",
    module: "patients",
  },
  {
    id: "bulk-ai",
    label: "AI Mode",
    subtitle:
      "Bulk-import patient lists and search them with plain-English prompts.",
    group: "ai",
    permission: "patients.bulk_ai.write",
    deniedHint: "Requires bulk patient AI access.",
    module: "patients",
  },

  // Finance: Simplified to 3 modules as per request.
  {
    id: "billing-payment-collection",
    label: "Payment Collection",
    subtitle: "Record and track all patient payments in real-time.",
    group: "finance",
    permission: "billing.read",
    deniedHint: "Requires billing access.",
    module: "billing",
  },
  {
    id: "billing-revenue-reports",
    label: "Revenue Reports",
    subtitle: "Monitor module-wise collections, dues, and doctor payouts.",
    group: "finance",
    permission: "billing.read",
    deniedHint: "Requires billing access.",
    module: "billing",
  },
  {
    id: "billing-daily-monthly-reports",
    label: "Daily / Monthly Reports",
    subtitle: "Track day-wise and month-wise collections across all modules.",
    group: "finance",
    permission: "billing.read",
    deniedHint: "Requires billing access.",
    module: "billing",
  },

  // Administration: manage employees before managing their HR operations (attendance/payroll/leave).
  {
    id: "employees",
    label: "Employee Management",
    subtitle: "Manage staff accounts, roles, and module access.",
    group: "admin",
    permission: "employees.read",
    deniedHint: "Requires employee management access.",
    module: "employees",
  },
  {
    id: "patient-experience",
    label: "Patient Experience",
    subtitle: "Track patient feedback and satisfaction trends.",
    group: "admin",
    permission: "patient_experience.read",
    deniedHint: "Requires patient experience access.",
    module: "patient_experience",
  },
  {
    id: "hrms",
    label: "HRMS",
    subtitle: "Attendance, payroll, leave, and department management.",
    group: "admin",
    permission: "hr.read",
    deniedHint: "Requires HRMS access.",
    module: "hrms",
  },

  {
    id: "settings",
    label: "Settings",
    subtitle:
      "Audit trail, WhatsApp Business API key, and message templates.",
    group: "admin",
  },
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

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");

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

export const EMPTY_STATS = {
  total: 0,
  today: 0,
  active_admissions: 0,
  documents: 0,
  readmitted_patients: 0,
};
