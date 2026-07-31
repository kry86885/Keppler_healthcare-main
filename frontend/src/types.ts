export type UserType = "admin" | "normal";
export type ModuleId = "dashboard" | "patients" | "billing" | "pharmacy" | "lab" | "hrms" | "ot" | "accounts" | "reports" | "symptom_ai";

export interface UserTypeOption {
  value: UserType;
  label: string;
  description: string;
}

export interface ModuleOption {
  value: ModuleId;
  label: string;
  description: string;
}

export interface Notice {
  type: "success" | "error" | "warning";
  message: string;
}

export interface User {
  username: string;
  full_name?: string;
  role?: string;
  access_role?: string;
  user_type?: UserType;
  module_access?: ModuleId[];
  permissions?: string[];
  employee_id?: string;
  status?: string;
  hospital_id?: number;
  hospital_code?: string;
}

export interface Stats {
  total: number;
  today: number;
  active_admissions: number;
  documents: number;
  readmitted_patients: number;
}

export interface DistributionItem {
  label: string;
  count: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface EmployeeAnalytics {
  total: number;
  status_distribution: DistributionItem[];
  department_distribution: DistributionItem[];
  access_role_distribution: DistributionItem[];
}

export interface DashboardAnalytics {
  window_days: number;
  patients_trend: TrendPoint[];
  documents_trend: TrendPoint[];
  gender_distribution: DistributionItem[];
  doc_type_distribution: DistributionItem[];
  admission_status_distribution: DistributionItem[];
  employee?: EmployeeAnalytics;
}

export interface HospitalSummary {
  ip_op_counts: {
    daily_ip: number;
    daily_op: number;
    monthly_ip: number;
    monthly_op: number;
  };
  accidents: {
    daily: number;
    monthly: number;
  };
  revenue: {
    total: number;
    due: number;
    payment_mode_breakdown: DistributionItem[];
  };
  pharmacy_summary: {
    monthly_sales: number;
  };
  diagnostics_summary: {
    monthly_income: number;
  };
  referrals: DistributionItem[];
}

export interface Patient {
  id?: number;
  patient_id: string;
  admission_id?: string;
  name: string;
  middle_name?: string;
  last_name?: string;
  dob?: string;
  age?: number | string | null;
  weight?: number | string | null;
  height?: number | string | null;
  gender?: string;
  pregnant?: boolean | number;
  allergies?: string;
  symptoms?: string;
  phone?: string;
  address?: string;
  blood_group?: string;
  emergency_contact?: string;
  aadhar_number?: string;
  created_at?: string;
}

export interface Admission {
  id: number;
  admission_date: string;
  discharge_date?: string | null;
  notes?: string;
}

export interface PatientMovement {
  id: number;
  patient_id: string;
  admission_id?: number | null;
  from_department?: string | null;
  to_department: string;
  moved_at: string;
  moved_by?: string | null;
}

export interface JourneyEvent {
  stage: "registration" | "queue" | "consultation" | "billing" | "lab";
  label: string;
  timestamp?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface JourneySummary {
  consultation_billed: number;
  consultation_paid: number;
  lab_billed: number;
  lab_paid: number;
  pharmacy_billed: number;
  pharmacy_paid: number;
  total_billed: number;
  total_paid: number;
  total_due: number;
}

export interface PatientJourney {
  patient: Patient;
  events: JourneyEvent[];
  summary: JourneySummary;
}

export interface Encounter {
  id: number;
  patient_id: string;
  encounter_type: string;
  insurance_provider?: string | null;
  insurance_policy_no?: string | null;
  is_accident?: boolean | number;
  referral_source?: string | null;
  referral_name?: string | null;
  status?: string | null;
  created_by?: string | null;
  arrival_at?: string;
}

export interface BedAllocation {
  id: number;
  admission_id: number;
  patient_id: string;
  ward: string;
  room_no: string;
  bed_no: string;
  status?: string | null;
  allocated_at?: string;
}

export interface MedicationSchedule {
  id: number;
  patient_id: string;
  medicine_name: string;
  dosage?: string | null;
  schedule_time?: string;
  administered?: boolean | number;
  alert_enabled?: boolean | number;
  notes?: string | null;
  created_at?: string;
}

export interface ObservationNote {
  id: number;
  patient_id: string;
  admission_id?: number | null;
  doctor_name?: string | null;
  note: string;
  treatment_plan?: string | null;
  created_at?: string;
}

export interface PharmacySale {
  id: number;
  invoice_id?: string | number | null;
  patient_id?: string | null;
  prescription_ref?: string | null;
  medicine_name: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
  sold_at?: string;
}

export interface AuditLog {
  id: number;
  actor_username?: string | null;
  action?: string | null;
  module_name?: string | null;
  entity_key?: string | null;
  payload?: string | null;
  created_at?: string;
}

export interface Appointment {
  id: number;
  patient_id?: string | null;
  patient_name: string;
  patient_phone?: string | null;
  visit_type: string;
  department?: string | null;
  doctor_name?: string | null;
  appointment_date: string;
  token_no: number;
  status: string;
  appointment_kind?: string;
  follow_up_for?: number | null;
  reminder_sent_at?: string | null;
  no_show_marked?: boolean | number;
  notes?: string | null;
  created_at?: string;
}

export interface DoctorSchedule {
  id: number;
  doctor_name: string;
  department?: string | null;
  schedule_date: string;
  start_time: string;
  end_time: string;
  slot_capacity?: number | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface OpSummary {
  date: string;
  total_appointments: number;
  follow_ups: number;
  active_queue: number;
  no_shows: number;
  reminders_sent: number;
  available_doctors: number;
}

export interface Certificate {
  id: number;
  patient_id: string;
  admission_id?: number | null;
  certificate_type: string;
  title: string;
  body: string;
  issued_by?: string | null;
  created_at?: string;
}

export interface ReportsOverview {
  hospital_summary: {
    ip_op_counts: {
      daily_ip: number;
      daily_op: number;
      monthly_ip: number;
      monthly_op: number;
    };
    accidents: {
      daily: number;
      monthly: number;
    };
    revenue: {
      total: number;
      due: number;
      payment_mode_breakdown: DistributionItem[];
    };
    pharmacy_summary: {
      monthly_sales: number;
    };
    diagnostics_summary: {
      monthly_income: number;
    };
    referrals: DistributionItem[];
  };
  billing_summary: {
    total_billed: number;
    total_collected: number;
    total_due: number;
    total_advance: number;
    total_refunded: number;
    payment_mode_breakdown: DistributionItem[];
    collections_by_module: DistributionItem[];
  };
  pharmacy_summary: {
    low_stock_count: number;
    out_of_stock_count: number;
    damaged_stock_count: number;
    sales_total: number;
  };
  lab_summary: {
    total_amount: number;
    total_paid: number;
    total_due: number;
  };
  employee_summary: {
    total: number;
    active: number;
    inactive: number;
  };
  accounts_summary: {
    ledger_income: number;
    ledger_expense: number;
    net_position: number;
    vendor_paid_total: number;
    doctor_paid_total: number;
    doctor_due_total: number;
  };
  doctor_income: DistributionItem[];
  clinic_income: DistributionItem[];
  discount_by_module: DistributionItem[];
  payment_status_breakdown: DistributionItem[];
  alos_summary: {
    average_los_days: number;
    admission_count: number;
  };
  patient_financials: Array<{
    label: string;
    total_billed: number;
    total_due: number;
  }>;
  diagnostics_by_doctor: DistributionItem[];
}

export interface OtSummary {
  theatre_count: number;
  available_theatres: number;
  scheduled_surgeries: number;
  completed_surgeries: number;
  scheduled_hours: number;
  completed_hours: number;
  theatre_utilization: DistributionItem[];
}

export interface DocumentItem {
  id: number;
  doc_type: string;
  created_at: string;
  file_path?: string;
  file_name?: string;
  mime_type?: string;
  has_file_data?: number;
  ocr_text?: string;
  ocr_language?: string;
}

export interface SignupForm {
  username: string;
  password: string;
  full_name: string;
  email: string;
  phone: string;
  user_type: UserType;
  module_access: ModuleId[];
  job_role: string;
  department: string;
  address: string;
  emergency_contact: string;
}

export interface PatientForm {
  name: string;
  middle_name: string;
  last_name: string;
  dob: string;
  age: string;
  weight: string;
  height: string;
  gender: string;
  pregnant: boolean;
  allergy1: string;
  allergy2: string;
  allergy3: string;
  symptoms: string;
  phone: string;
  address: string;
  blood_group: string;
  emergency_contact: string;
  aadhar_number: string;
}

export interface NavItem {
  id: string;
  label: string;
  permission?: string;
  deniedHint?: string;
  group?: "overview" | "ai" | "registration" | "operations" | "finance" | "admin";
}

export interface Employee {
  username: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  department?: string;
  address?: string;
  emergency_contact?: string;
  status?: string;
  job_role?: string;
  access_role?: string;
  user_type?: UserType;
  module_access?: ModuleId[];
  date_joined?: string;
}
