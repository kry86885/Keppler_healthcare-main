import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { FiSettings, FiMenu } from "react-icons/fi";
import AuthView from "./components/AuthView";
import SettingsModal from "./components/SettingsModal";
import Toast from "./components/ui/Toast";
import ConfirmDialog from "./components/ui/ConfirmDialog";
import { Button, Container } from "./components/ui";
// Page components are code-split via lazy() -- previously all 36 pages were
// eagerly imported here, so every module's JS (billing, HR, OT, ICU, EMR,
// pharmacy, etc.) shipped in the initial bundle no matter which page the
// user actually opened first. Each now loads only when its `page === "..."`
// branch below is reached.
const AddPatientPage = lazy(() => import("./pages/AddPatientPage"));
const OcrPage = lazy(() => import("./pages/OcrPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const DoctorSchedulingPage = lazy(() => import("./pages/DoctorSchedulingPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const PatientExperiencePage = lazy(
  () => import("./pages/PatientExperiencePage"),
);
const PaymentCollectionPage = lazy(
  () => import("./pages/PaymentCollectionPage"),
);
const RevenueReportsPage = lazy(() => import("./pages/RevenueReportsPage"));
const DailyMonthlyReportsPage = lazy(
  () => import("./pages/DailyMonthlyReportsPage"),
);
const PharmacyPage = lazy(() => import("./pages/PharmacyPage"));
const HrmsPage = lazy(() => import("./pages/HrmsPage"));
const PatientsPage = lazy(() => import("./pages/PatientsPage"));
const ReadmitPage = lazy(() => import("./pages/ReadmitPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SymptomAiPage = lazy(() => import("./pages/SymptomAiPage"));
const PlatformAdminPage = lazy(() => import("./pages/PlatformAdminPage"));
const QueuePage = lazy(() => import("./pages/QueuePage"));
const DoctorPrescriptionPage = lazy(
  () => import("./pages/DoctorPrescriptionPage"),
);
const EmrPage = lazy(() => import("./pages/EmrPage"));
const RegistrationDeskPage = lazy(() => import("./pages/RegistrationDeskPage"));
const BulkPatientAiPage = lazy(() => import("./pages/BulkPatientAiPage"));
import {
  API_BASE,
  EMPTY_STATS,
  NAV_ITEMS,
  EMPTY_PATIENT_FORM,
} from "./lib/constants";
import {
  apiFetch,
  getHospitalCode,
  reportError,
  setHospitalCode,
} from "./lib/api";
import { resolvePermissions } from "./lib/format";
import type {
  DashboardAnalytics,
  HospitalSummary,
  Notice,
  Patient,
  Stats,
  User,
} from "./types";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

type SidebarIconName =
  | "dashboard"
  | "add"
  | "patients"
  | "readmit"
  | "billing"
  | "pharmacy"
  | "hrms"
  | "symptom"
  | "employees"
  | "settings"
  | "logout"
  | "profile"
  | "appointment";

const NAV_ICON_MAP: Record<string, SidebarIconName> = {
  dashboard: "dashboard",
  add: "add",
  ocr: "add",
  "op-desk": "patients",
  "appointment-in": "appointment",
  "appointment-out": "appointment",
  queue: "appointment",
  "patient-journey": "patients",
  "consent-desk": "add",
  "insurance-desk": "billing",
  patients: "patients",
  readmit: "readmit",
  billing: "billing",
  "billing-aging": "billing",
  "billing-reconciliation": "billing",
  "billing-create-invoice": "billing",
  "billing-record-payment": "billing",
  "billing-insurance-claims": "billing",
  "billing-invoices": "billing",
  "billing-mode-breakdown": "billing",
  "billing-module-collections": "billing",
  "billing-payment-collection": "billing",
  "billing-revenue-reports": "billing",
  "billing-daily-monthly-reports": "billing",
  pharmacy: "pharmacy",
  hrms: "hrms",
  accounts: "billing",
  "accounts-overview": "billing",
  "accounts-ledger": "billing",
  "accounts-vendor-payments": "billing",
  "accounts-doctor-payouts": "billing",
  reports: "dashboard",
  "symptom-ai": "symptom",
  "bulk-ai": "symptom",
  employees: "employees",
  settings: "settings",
};

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<SidebarIconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.2" {...stroke} />
        <rect x="14" y="3" width="7" height="11" rx="1.2" {...stroke} />
        <rect x="3" y="14" width="7" height="7" rx="1.2" {...stroke} />
        <rect x="14" y="18" width="7" height="3" rx="1.2" {...stroke} />
      </>
    ),
    add: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
        <path d="M12 8v8" {...stroke} />
        <path d="M8 12h8" {...stroke} />
      </>
    ),
    appointment: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.6" {...stroke} />
        <path d="M8 3v4M16 3v4M4 10h16M9 14h6M9 17h4" {...stroke} />
      </>
    ),
    patients: (
      <>
        <circle cx="9" cy="9" r="3" {...stroke} />
        <path d="M3.5 19c.8-2.7 2.9-4 5.5-4s4.7 1.3 5.5 4" {...stroke} />
        <circle cx="17.5" cy="10" r="2.5" {...stroke} />
        <path d="M14.8 18.8c.5-1.7 1.8-2.8 3.7-3.2" {...stroke} />
      </>
    ),
    readmit: (
      <>
        <path d="M20 12a8 8 0 1 1-2.3-5.7" {...stroke} />
        <path d="M20 4v6h-6" {...stroke} />
      </>
    ),
    billing: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...stroke} />
        <path d="M7 9h10M7 13h6M7 17h4" {...stroke} />
      </>
    ),
    pharmacy: (
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.5 20.5l-6-6a4.243 4.243 0 0 1 6-6l6 6a4.243 4.243 0 0 1-6 6z" />
        <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
      </svg>
    ),
    hrms: (
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    symptom: (
      <>
        <path
          d="M12 3C9 6 7 8.7 7 12a5 5 0 0 0 10 0c0-3.3-2-6-5-9Z"
          {...stroke}
        />
        <path
          d="M9.5 12.8c1.2-.1 2.1-.8 2.5-2.1.5 1.3 1.4 2 2.5 2.1"
          {...stroke}
        />
      </>
    ),
    employees: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...stroke} />
        <path d="M3 9.5h18" {...stroke} />
        <path d="M8 7v-2M16 7v-2" {...stroke} />
        <path d="M8.5 14.5h7M8.5 17.5h5" {...stroke} />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3.2" {...stroke} />
        <path
          d="M12 3v2.1M12 18.9V21M3 12h2.1M18.9 12H21M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M18.3 5.7l-1.5 1.5M7.2 16.8l-1.5 1.5"
          {...stroke}
        />
      </>
    ),
    logout: (
      <>
        <path
          d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10"
          {...stroke}
        />
        <path d="M14 8l4 4-4 4" {...stroke} />
        <path d="M18 12H9" {...stroke} />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8.2" r="3.1" {...stroke} />
        <path d="M5.5 19c.9-3 3.2-4.7 6.5-4.7s5.6 1.7 6.5 4.7" {...stroke} />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

type SidebarTabProps = {
  label: string;
  icon: SidebarIconName;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
};

function SidebarTab({
  label,
  icon,
  active,
  disabled = false,
  hint,
  onClick,
}: SidebarTabProps) {
  return (
    <button
      type="button"
      className={active ? "sidebar-tab active" : "sidebar-tab"}
      disabled={disabled}
      title={hint || ""}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="sidebar-tab-icon">
        <SidebarIcon name={icon} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function App() {
  const isAdminRoutePath =
    typeof window !== "undefined" && window.location.pathname === "/admin";
  const isPlatformAdminRoute =
    typeof window !== "undefined" &&
    window.location.pathname === "/platform-admin";
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState(isAdminRoutePath ? "admin" : "dashboard");
  const [patientsPageKey, setPatientsPageKey] = useState(0);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [dashboardAnalytics, setDashboardAnalytics] =
    useState<DashboardAnalytics | null>(null);
  const [hospitalSummary, setHospitalSummary] =
    useState<HospitalSummary | null>(null);
  const [dashboardAnalyticsLoading, setDashboardAnalyticsLoading] =
    useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientDetailRefreshToken, setPatientDetailRefreshToken] = useState(0);
  const [languages, setLanguages] = useState<Record<string, string>>({
    en: "English",
  });
  const [ocrLanguage, setOcrLanguage] = useState("en");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileActionsOpen, setProfileActionsOpen] = useState(false);
  const profileActionsRef = useRef<HTMLDivElement | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [hospitalCode, setHospitalCodeState] = useState(getHospitalCode());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [appointmentPrefill, setAppointmentPrefill] = useState<{
    doctorName?: string;
    department?: string;
  } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!profileActionsOpen) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (!profileActionsRef.current?.contains(event.target as Node)) {
        setProfileActionsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileActionsOpen(false);
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileActionsOpen]);

  const permissions = useMemo(() => resolvePermissions(user), [user]);
  const hasPermission = (permission?: string) =>
    !permission || permissions.includes(permission);
  const isAdmin = hasPermission("admin.use");
  const isClinicianUser =
    user?.access_role === "clinician" ||
    (user?.job_role || "").toLowerCase() === "doctor";
  // Identity-only flag (personalized greeting + default landing page in
  // getDefaultPage below) -- deliberately does NOT narrow nav visibility the
  // way isClinicianUser does, since a pharmacist's module_access already
  // governs what they can see and there's no equivalent need to hide other
  // granted modules from them.
  const isPharmacistUser =
    user?.access_role === "pharmacist" ||
    (user?.job_role || "").toLowerCase() === "pharmacist";
  const canAccessNavItem = (
    item: (typeof NAV_ITEMS)[0],
    permission?: string,
  ) => {
    if (item.id === "employees") return isAdmin;

    // Clinicians should only see a restricted set of pages WITHIN the patients and symptom_ai modules.
    // If the admin gives them access to other modules (like pharmacy or lab), they will see those pages.
    if (isClinicianUser) {
      if (
        item.module === "patients" ||
        item.module === "dashboard" ||
        item.module === "symptom_ai"
      ) {
        const allowedForClinician = [
          "queue",
          "emr",
          "dashboard",
          "patients",
          "symptom-ai",
          "doctor-prescription",
        ];
        if (!allowedForClinician.includes(item.id)) return false;
      }
    }

    // "Doctor Prescription" is the doctor's own consultation workspace (queue
    // call-in, clinical notes, prescription capture) -- it shares its module
    // (patients) and permission (patients.read) with pages every default
    // staff account also needs (Queue Management, Registration Desk), so it
    // can't be gated by permission alone. Restrict it to clinicians/doctors
    // and admins; everyone else with "patients" module access still correctly
    // sees the other patients-module pages.
    if (item.id === "doctor-prescription" && !isClinicianUser && !isAdmin) {
      return false;
    }

    // Normal users must explicitly have the module in their module_access array (if the nav item belongs to a module).
    if (user?.user_type !== "admin") {
      if (item.module && !(user?.module_access || []).includes(item.module)) {
        return false;
      }
    }

    return hasPermission(permission);
  };
  const sidebarNavItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          item.id !== "settings" && canAccessNavItem(item, item.permission),
      ),
    [permissions],
  );
  const sidebarGroups = useMemo(() => {
    // Ordered by how often day-to-day hospital work touches each area: the core patient
    // journey (Overview -> OP Management -> Operations) comes before supporting AI tools,
    // which comes before back-office Finance/Administration.
    const groups: Array<{
      key: string;
      label: string;
      items: typeof sidebarNavItems;
    }> = [
      { key: "overview", label: "Overview", items: [] },
      { key: "registration", label: "OP Management", items: [] },
      { key: "operations", label: "Operations", items: [] },
      { key: "ai", label: "AI", items: [] },
      { key: "finance", label: "Finance", items: [] },
      { key: "admin", label: "Administration", items: [] },
    ];
    sidebarNavItems.forEach((item) => {
      const target = groups.find(
        (group) => group.key === (item.group || "overview"),
      );
      target?.items.push(item);
    });

    // Custom sort for doctors: Doctor Prescription before Queue Management
    if (user?.access_role === "clinician") {
      const opGroup = groups.find((g) => g.key === "registration");
      if (opGroup) {
        const order = [
          "doctor-prescription",
          "queue",
          "emr",
          "appointment-out",
          "appointment-in",
        ];
        opGroup.items.sort((a, b) => {
          const indexA = order.indexOf(a.id);
          const indexB = order.indexOf(b.id);
          // If both are in the order array, sort by order array
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          // If only A is in the array, A comes first
          if (indexA !== -1) return -1;
          // If only B is in the array, B comes first
          if (indexB !== -1) return 1;
          // Otherwise maintain original order (mostly)
          return 0;
        });
      }
    }

    return groups.filter((group) => group.items.length > 0);
  }, [sidebarNavItems]);
  const groupKeyForPage = (pageId: string) =>
    NAV_ITEMS.find((item) => item.id === pageId)?.group || "overview";
  // Accordion behaviour: only the section containing the active page is expanded, so a
  // 13-item "Finance" group and an 8-item "OP Management" group are never both open (and
  // forcing a long scroll) at once -- this is the "sidebar should be systematic" fix.
  const [openSidebarGroup, setOpenSidebarGroup] = useState<string>(
    groupKeyForPage(page),
  );
  useEffect(() => {
    setOpenSidebarGroup(groupKeyForPage(page));
  }, [page]);

  const getDefaultPage = (currentUser: User | null) => {
    if (
      currentUser?.access_role === "clinician" ||
      (currentUser?.job_role || "").toLowerCase() === "doctor"
    ) {
      return "queue";
    }
    if (
      currentUser?.access_role === "pharmacist" ||
      (currentUser?.job_role || "").toLowerCase() === "pharmacist"
    ) {
      return "pharmacy";
    }
    const candidatePages = [
      "dashboard",
      "add",
      "appointment-in",
      "appointment-out",
      "queue",
      "patient-journey",
      "consent-desk",
      "insurance-desk",
      "op-desk",
      "billing-aging",
      "billing-reconciliation",
      "billing-create-invoice",
      "billing-record-payment",
      "billing-insurance-claims",
      "billing-invoices",
      "billing-mode-breakdown",
      "billing-module-collections",
      "billing-payment-collection",
      "billing-revenue-reports",
      "billing-daily-monthly-reports",
      "pharmacy",
      "hrms",
      "accounts",
      "reports",
      "accounts-ledger",
      "accounts-vendor-payments",
      "accounts-doctor-payouts",
      "reports",
      "symptom-ai",
      "employees",
      "settings",
    ];
    for (const candidate of candidatePages) {
      const navItem = NAV_ITEMS.find((item) => item.id === candidate);
      if (!navItem) continue;

      // We must mock canAccessNavItem logic here because canAccessNavItem relies on state (user, permissions)
      // which might be stale during login, so we re-evaluate it with currentUser.

      let hasAccess = false;
      const isAdminCheck =
        resolvePermissions(currentUser).includes("admin.use");
      if (navItem.id === "employees") {
        hasAccess = isAdminCheck;
      } else if (
        currentUser?.user_type !== "admin" &&
        navItem.module &&
        !(currentUser?.module_access || []).includes(navItem.module)
      ) {
        hasAccess = false;
      } else {
        hasAccess =
          !navItem.permission ||
          resolvePermissions(currentUser).includes(navItem.permission);
      }

      if (hasAccess) {
        return candidate;
      }
    }
    return "settings";
  };

  const syncUrlForPage = (nextPage: string) => {
    if (typeof window === "undefined") return;
    const targetPath = nextPage === "admin" ? "/admin" : "/";
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, "", targetPath);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/languages`)
      .then((res) => res.json())
      .then((data) => setLanguages(data.languages || { en: "English" }))
      .catch(() => setLanguages({ en: "English" }));
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<{ user?: User }>("/api/auth/session")
      .then((data) => {
        if (!active) return;
        if (data.user) {
          setUser(data.user);
          if (!isAdminRoutePath) {
            setPage(getDefaultPage(data.user));
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setPage("dashboard");
      setSelectedPatient(null);
      setNotice(null);
    };
    window.addEventListener("app:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("app:unauthorized", handleUnauthorized);
    };
  }, []);

  // Global Polling (Doctor & Staff Notifications)
  const previousStatusesRef = useRef<Record<number, string>>({});

  useEffect(() => {
    // Only poll if user is logged in
    if (!user) return;

    let active = true;
    const pollQueue = async () => {
      if (!active) return;
      try {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const data = await apiFetch<{ appointments?: any[] }>(
          `/api/appointments?date=${today}`,
        );
        const appointments = data.appointments || [];

        const currentStatuses: Record<number, string> = {};
        appointments.forEach((a) => {
          currentStatuses[a.id] = a.status;
        });

        const isClinician = user.access_role === "clinician";
        const isStaff =
          user.access_role === "receptionist" || user.access_role === "admin";

        const playAlertSound = () => {
          try {
            const AudioContext =
              window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
            osc.frequency.setValueAtTime(1108.73, ctx.currentTime + 0.1); // C#6
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
          } catch (e) {
            // Audio context failed or blocked
          }
        };

        if (Object.keys(previousStatusesRef.current).length > 0) {
          if (isClinician) {
            // Find new appointments that are checked_in
            const newPatients = appointments.filter(
              (a) =>
                (a.status === "checked_in" || a.status === "scheduled") &&
                !previousStatusesRef.current[a.id],
            );

            if (newPatients.length > 0) {
              const newPatient = newPatients[0];
              // Play sound and show notice
              if (typeof window !== "undefined") {
                try {
                  const audioCtx = new (
                    window.AudioContext || (window as any).webkitAudioContext
                  )();
                  const oscillator = audioCtx.createOscillator();
                  const gainNode = audioCtx.createGain();
                  oscillator.type = "sine";
                  oscillator.frequency.setValueAtTime(
                    880,
                    audioCtx.currentTime,
                  ); // A5
                  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                  oscillator.connect(gainNode);
                  gainNode.connect(audioCtx.destination);
                  oscillator.start();
                  oscillator.stop(audioCtx.currentTime + 0.15); // short beep
                  setTimeout(() => {
                    const osc2 = audioCtx.createOscillator();
                    const gain2 = audioCtx.createGain();
                    osc2.type = "sine";
                    osc2.frequency.setValueAtTime(1046.5, audioCtx.currentTime); // C6
                    gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    osc2.connect(gain2);
                    gain2.connect(audioCtx.destination);
                    osc2.start();
                    osc2.stop(audioCtx.currentTime + 0.2);
                  }, 200);
                } catch (e) {
                  // fallback if AudioContext fails
                }
              }
              setNotice({
                type: "success",
                message: `New Patient Arrived: ${newPatient.patient_name} (Token #${newPatient.token_no})`,
              });
            }
          }

          if (isStaff) {
            // Find newly completed appointments
            const completedPatients = appointments.filter(
              (a) =>
                a.status === "completed" &&
                previousStatusesRef.current[a.id] &&
                previousStatusesRef.current[a.id] !== "completed",
            );

            if (completedPatients.length > 0) {
              const patient = completedPatients[0];
              playAlertSound();
              setNotice({
                type: "success",
                message: `Consultation Completed: ${patient.patient_name} with Dr. ${patient.doctor_name || "Unknown"}`,
              });
            }
          }
        }

        previousStatusesRef.current = currentStatuses;
      } catch (e) {
        // silently fail polling
      }
    };

    // Poll immediately, then every 15 seconds
    void pollQueue();
    const interval = setInterval(pollQueue, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user]);

  const loadStats = async () => {
    try {
      const data = await apiFetch<Stats>("/api/stats");
      setStats({ ...EMPTY_STATS, ...data });
      return true;
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to load dashboard stats.",
      );
      return false;
    }
  };

  const loadPatients = async () => {
    try {
      const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
      setPatients(data.patients || []);
      return true;
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to load patient list.",
      );
      return false;
    }
  };

  const loadDashboardAnalytics = async () => {
    setDashboardAnalyticsLoading(true);
    try {
      const data = await apiFetch<DashboardAnalytics>(
        "/api/dashboard/analytics?days=14",
      );
      setDashboardAnalytics(data);
      return true;
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to load dashboard analytics.",
      );
      setDashboardAnalytics(null);
      return false;
    } finally {
      setDashboardAnalyticsLoading(false);
    }
  };

  const loadHospitalSummary = async () => {
    try {
      const data = await apiFetch<HospitalSummary>(
        "/api/dashboard/hospital-summary",
      );
      setHospitalSummary(data);
      return true;
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to load operational hospital summary.",
      );
      setHospitalSummary(null);
      return false;
    }
  };

  useEffect(() => {
    if (!user) return;
    if (hasPermission("patients.read")) {
      void loadStats();
      void loadPatients();
      void loadDashboardAnalytics();
      void loadHospitalSummary();
    } else {
      setStats(EMPTY_STATS);
      setDashboardAnalytics(null);
      setHospitalSummary(null);
      setPatients([]);
      setSelectedPatient(null);
    }
  }, [user, permissions]);

  useEffect(() => {
    if (!user) return;
    const activeNav = NAV_ITEMS.find((item) => item.id === page);
    if (activeNav && !canAccessNavItem(activeNav, activeNav.permission)) {
      setPage(getDefaultPage(user));
      setNotice({
        type: "warning",
        message:
          activeNav.deniedHint || "You do not have access to this module.",
      });
      return;
    }
    if (!isAdminRoutePath && page === "admin" && !isAdmin) {
      setPage(getDefaultPage(user));
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/");
      }
      setNotice({
        type: "warning",
        message: "Only admins can access the /admin page.",
      });
      return;
    }
    if (page === "patients" && hasPermission("patients.read")) {
      setSelectedPatient(null);
      void loadPatients();
    }
    if (page === "dashboard" && hasPermission("patients.read")) {
      void loadStats();
      void loadPatients();
      void loadDashboardAnalytics();
      void loadHospitalSummary();
    }
  }, [page, user, permissions]);

  const recentPatients = useMemo(() => patients.slice(0, 5), [patients]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const inputHospitalCode = (
      (form.elements.namedItem("hospital_code") as HTMLInputElement).value ||
      "hosp-default"
    )
      .trim()
      .toLowerCase();
    const payload = {
      username: (form.elements.namedItem("username") as HTMLInputElement).value,
      password: (form.elements.namedItem("password") as HTMLInputElement).value,
    };
    try {
      setHospitalCode(inputHospitalCode);
      setHospitalCodeState(inputHospitalCode);
      const data = await apiFetch<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "X-Hospital-Code": inputHospitalCode },
      });
      setUser(data.user);
      setPage(getDefaultPage(data.user));
      setNotice(null);
      if (resolvePermissions(data.user).includes("patients.read")) {
        void loadStats();
        void loadPatients();
        void loadDashboardAnalytics();
        void loadHospitalSummary();
      }
    } catch (error) {
      // Login failures must always be shown -- reportError's blanket 401 suppression exists
      // for background auth checks (e.g. the session-check on page load, which 401s for every
      // logged-out visitor and shouldn't toast an error), but a wrong-password attempt on the
      // login form itself is exactly the case the user needs to see.
      const typedError = error as { message?: string; status?: number };
      setNotice({
        type: "error",
        message: typedError.message || "Unable to sign in. Please try again.",
      });
    }
  };

  const readPlatformAdminCreds = (form: HTMLFormElement) => ({
    username: (
      (form.elements.namedItem("platform_admin_username") as HTMLInputElement)
        ?.value || ""
    ).trim(),
    password:
      (form.elements.namedItem("platform_admin_password") as HTMLInputElement)
        ?.value || "",
  });

  const platformHeaders = (
    platformAdminUsername: string,
    platformAdminPassword: string,
    hospitalCodeValue: string,
  ) => ({
    "Content-Type": "application/json",
    "X-Hospital-Code": hospitalCodeValue.trim().toLowerCase(),
    "X-Platform-Admin-Username": platformAdminUsername,
    "X-Platform-Admin-Password": platformAdminPassword,
  });

  const handleCreateHospital = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = (
      (form.elements.namedItem("hospital_code") as HTMLInputElement)?.value ||
      ""
    )
      .trim()
      .toLowerCase();
    const hospitalNameValue = (
      (form.elements.namedItem("hospital_name") as HTMLInputElement)?.value ||
      ""
    ).trim();

    try {
      const response = await fetch(`${API_BASE}/api/platform/hospitals`, {
        method: "POST",
        headers: platformHeaders(
          creds.username,
          creds.password,
          hospitalCodeValue,
        ),
        body: JSON.stringify({
          hospital_code: hospitalCodeValue,
          name: hospitalNameValue || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error || payload.message || "Unable to create hospital.",
        );
      setNotice({
        type: "success",
        message: `Hospital ${hospitalCodeValue} is ready.`,
      });
      setHospitalCode(hospitalCodeValue);
      setHospitalCodeState(hospitalCodeValue);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to create hospital.",
      );
    }
  };

  const handleSetupHospitalAdmin = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = (
      (form.elements.namedItem("hospital_code") as HTMLInputElement)?.value ||
      ""
    )
      .trim()
      .toLowerCase();
    const adminUsername = (
      (form.elements.namedItem("admin_username") as HTMLInputElement)?.value ||
      ""
    ).trim();
    const adminPassword =
      (form.elements.namedItem("admin_password") as HTMLInputElement)?.value ||
      "";
    const adminFullName = (
      (form.elements.namedItem("admin_full_name") as HTMLInputElement)?.value ||
      ""
    ).trim();
    const adminEmail = (
      (form.elements.namedItem("admin_email") as HTMLInputElement)?.value || ""
    ).trim();
    const adminPhone = (
      (form.elements.namedItem("admin_phone") as HTMLInputElement)?.value || ""
    ).trim();

    try {
      const response = await fetch(`${API_BASE}/api/auth/setup-admin`, {
        method: "POST",
        headers: platformHeaders(
          creds.username,
          creds.password,
          hospitalCodeValue,
        ),
        body: JSON.stringify({
          username: adminUsername,
          password: adminPassword,
          full_name: adminFullName,
          email: adminEmail,
          phone: adminPhone,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error ||
            payload.message ||
            "Unable to onboard hospital admin.",
        );
      setNotice({
        type: "success",
        message: `Admin created for ${hospitalCodeValue}.`,
      });
      setHospitalCode(hospitalCodeValue);
      setHospitalCodeState(hospitalCodeValue);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to onboard hospital admin.",
      );
    }
  };

  const handleResetHospitalAdminPassword = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = (
      (form.elements.namedItem("hospital_code") as HTMLInputElement)?.value ||
      ""
    )
      .trim()
      .toLowerCase();
    const adminUsername = (
      (form.elements.namedItem("admin_username") as HTMLInputElement)?.value ||
      ""
    ).trim();
    const newPassword =
      (form.elements.namedItem("new_password") as HTMLInputElement)?.value ||
      "";

    try {
      const response = await fetch(
        `${API_BASE}/api/platform/hospitals/${encodeURIComponent(hospitalCodeValue)}/admin/reset-password`,
        {
          method: "POST",
          headers: platformHeaders(
            creds.username,
            creds.password,
            hospitalCodeValue,
          ),
          body: JSON.stringify({
            username: adminUsername,
            new_password: newPassword,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error || payload.message || "Unable to reset admin password.",
        );
      setNotice({
        type: "success",
        message: `Admin password reset for ${hospitalCodeValue}.`,
      });
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to reset admin password.",
      );
    }
  };

  const handleToggleHospitalAccess = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = (
      (form.elements.namedItem("hospital_code") as HTMLInputElement)?.value ||
      ""
    )
      .trim()
      .toLowerCase();
    const action = (
      (form.elements.namedItem("action") as HTMLInputElement)?.value || ""
    )
      .trim()
      .toLowerCase();
    const reason = (
      (form.elements.namedItem("reason") as HTMLInputElement)?.value || ""
    ).trim();
    const endpoint = action === "enable" ? "enable" : "disable";

    try {
      const response = await fetch(
        `${API_BASE}/api/platform/hospitals/${encodeURIComponent(hospitalCodeValue)}/${endpoint}`,
        {
          method: "POST",
          headers: platformHeaders(
            creds.username,
            creds.password,
            hospitalCodeValue,
          ),
          body: JSON.stringify(endpoint === "disable" ? { reason } : {}),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.error ||
            payload.message ||
            "Unable to update hospital status.",
        );
      setNotice({
        type: "success",
        message: `Hospital ${hospitalCodeValue} is now ${endpoint === "disable" ? "disabled" : "enabled"}.`,
      });
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to update hospital status.",
      );
    }
  };

  const handleLogout = () => {
    void apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (
      typeof window !== "undefined" &&
      window.location.pathname === "/admin"
    ) {
      window.history.replaceState({}, "", "/");
    }
    setUser(null);
    setPage("dashboard");
    setSelectedPatient(null);
  };

  const navigateToPage = (targetPage: string, extraData?: any) => {
    let nextPage = targetPage;
    if (nextPage === "registration") {
      nextPage = "appointment-in";
    }

    if (nextPage === "patients") {
      setPatientsPageKey((prev) => prev + 1);
    }
    if (nextPage === "appointment-in" && extraData?.prefillDoctor) {
      setAppointmentPrefill(extraData.prefillDoctor);
    } else if (nextPage === "appointment-in") {
      setAppointmentPrefill(null);
    }
    syncUrlForPage(nextPage);
    setPage(nextPage);
    setIsMobileMenuOpen(false);
  };

  const refreshPatients = async () => {
    const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
    setPatients(data.patients || []);
  };

  const handleCreatePatient = async (
    payload: Record<string, unknown>,
    setForm: Dispatch<SetStateAction<any>>,
    setDuplicateInfo?: Dispatch<SetStateAction<any>>,
    refreshPatientId?: () => Promise<void>,
  ): Promise<{ patient_id: string; admission_id?: string } | null> => {
    try {
      const data = await apiFetch<{
        patient_id: string;
        admission_id?: string;
      }>("/api/patients", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshPatients();
      await loadStats();
      await loadHospitalSummary();
      setSelectedPatient({
        patient_id: data.patient_id,
        admission_id: data.admission_id,
        name: String(payload.name || ""),
        last_name: String(payload.last_name || ""),
        middle_name: String(payload.middle_name || ""),
      });
      setDuplicateInfo?.(null);
      setNotice({
        type: "success",
        message: `Patient ${data.patient_id} registered.`,
      });
      setForm(EMPTY_PATIENT_FORM);
      await refreshPatientId?.();
      return data;
    } catch (error) {
      const typedError = error as {
        status?: number;
        payload?: any;
        message?: string;
      };
      if (typedError.status === 409) {
        setDuplicateInfo?.(typedError.payload?.duplicate || null);
        setNotice({
          type: "warning",
          message: typedError.message || "Possible duplicate",
        });
        return null;
      }
      reportError(setNotice, typedError);
      return null;
    }
  };

  const handleDeletePatient = async (patientId: string) => {
    try {
      await apiFetch(`/api/patients/${patientId}`, { method: "DELETE" });
      await refreshPatients();
      await loadStats();
      await loadHospitalSummary();
      if (selectedPatient?.patient_id === patientId) {
        setSelectedPatient(null);
      }
      setNotice({ type: "success", message: "Patient removed." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number });
    }
  };

  const handleExportPatientsCsv = async (query = "") => {
    try {
      const params = query.trim()
        ? `?q=${encodeURIComponent(query.trim())}`
        : "";
      const response = await fetch(
        `${API_BASE}/api/export/patients/csv${params}`,
        {
          method: "GET",
          credentials: "include",
          headers: { "X-Hospital-Code": getHospitalCode() },
        },
      );
      if (!response.ok) {
        throw new Error("Unable to export patients CSV.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `patients_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setNotice({ type: "success", message: "Patients CSV exported." });
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to export patients CSV.",
      );
    }
  };

  const handleSelectPatient = (patient: Patient | null) => {
    if (!patient) {
      setSelectedPatient(null);
      return;
    }
    setSelectedPatient({
      patient_id: patient.patient_id,
      name: patient.name,
      middle_name: patient.middle_name,
      last_name: patient.last_name,
    });
  };

  const refreshPatientData = async (patientId?: string) => {
    await Promise.allSettled([
      loadStats(),
      loadPatients(),
      loadHospitalSummary(),
    ]);
    if (patientId) {
      setSelectedPatient((prev) =>
        prev?.patient_id === patientId ? { ...prev } : prev,
      );
    }
    setPatientDetailRefreshToken((prev) => prev + 1);
  };

  if (isAdminRoutePath) {
    return (
      <div className="app-shell app-shell-single">
        <main className="admin-route-main">
          <Container size="full" className="admin-route-container">
            <header className="topbar admin-route-topbar">
              <div>
                <h2>Admin</h2>
                <p className="muted">Separate admin route authentication.</p>
              </div>
            </header>
            <AdminPage setNotice={setNotice} />
          </Container>
        </main>
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </div>
    );
  }

  if (!authChecked) {
    if (isPlatformAdminRoute) {
      return (
        <>
          <PlatformAdminPage
            initialHospitalCode={hospitalCode}
            onCreateHospital={handleCreateHospital}
            onSetupHospitalAdmin={handleSetupHospitalAdmin}
            onResetHospitalAdminPassword={handleResetHospitalAdminPassword}
            onToggleHospitalAccess={handleToggleHospitalAccess}
          />
          {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
        </>
      );
    }
    return <div className="auth-page">Checking session...</div>;
  }

  if (isPlatformAdminRoute) {
    return (
      <>
        <PlatformAdminPage
          initialHospitalCode={hospitalCode}
          onCreateHospital={handleCreateHospital}
          onSetupHospitalAdmin={handleSetupHospitalAdmin}
          onResetHospitalAdminPassword={handleResetHospitalAdminPassword}
          onToggleHospitalAccess={handleToggleHospitalAccess}
        />
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AuthView onLogin={handleLogin} initialHospitalCode={hospitalCode} />
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </>
    );
  }

  return (
    <div className="app-shell">
      <div
        className={`sidebar-overlay ${isMobileMenuOpen ? "open" : ""}`}
        onClick={() => setIsMobileMenuOpen(false)}
      ></div>
      <aside className={`sidebar ${isMobileMenuOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand brand-logo-full">
            <img
              src="/logo.png"
              alt="HospAI - AI Driven Healthcare Optimization"
            />
          </div>
        </div>
        <div className="sidebar-scroll-region">
          <nav>
            {sidebarGroups.map((group) => {
              const isOpen = openSidebarGroup === group.key;
              return (
                <section key={group.key} className="sidebar-nav-group">
                  <button
                    type="button"
                    className="sidebar-nav-toggle"
                    onClick={() =>
                      setOpenSidebarGroup((current) =>
                        current === group.key ? "" : group.key,
                      )
                    }
                    aria-expanded={isOpen}
                  >
                    <span className="sidebar-nav-heading">
                      <span className="sidebar-nav-title">{group.label}</span>
                      <span className="sidebar-nav-count">
                        {group.items.length}
                      </span>
                    </span>
                    <span
                      className={
                        isOpen
                          ? "sidebar-nav-chevron"
                          : "sidebar-nav-chevron collapsed"
                      }
                      aria-hidden="true"
                    >
                      <span className="sidebar-nav-chevron-chip">
                        <svg
                          viewBox="0 0 24 24"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="sidebar-nav-items">
                      {group.items.map((item) => {
                        const blocked =
                          !!item.permission && !hasPermission(item.permission);
                        const isActive = page === item.id;
                        return (
                          <SidebarTab
                            key={item.id}
                            label={item.label}
                            icon={NAV_ICON_MAP[item.id] || "dashboard"}
                            active={isActive}
                            disabled={blocked}
                            hint={blocked ? item.deniedHint : ""}
                            onClick={() => {
                              if (blocked) {
                                setNotice({
                                  type: "warning",
                                  message: item.deniedHint || "Access denied.",
                                });
                                return;
                              }
                              navigateToPage(item.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-profile-row" ref={profileActionsRef}>
            <div
              className="employee-static-info"
              aria-label="Employee information"
            >
              <span className="profile-trigger-icon" aria-hidden="true">
                <SidebarIcon name="profile" />
              </span>
              <span className="profile-trigger-text">
                <span className="profile-name">
                  {user.full_name || user.username}
                </span>
                <span className="profile-subtext">
                  {user.employee_id
                    ? `ID ${user.employee_id}`
                    : "No employee ID"}
                </span>
              </span>
            </div>
            <button
              type="button"
              className="profile-gear-btn"
              aria-label="Profile actions"
              aria-haspopup="menu"
              aria-expanded={profileActionsOpen}
              title="Open profile actions"
              onClick={() => setProfileActionsOpen((current) => !current)}
            >
              <FiSettings size={16} aria-hidden="true" />
            </button>
            {profileActionsOpen && (
              <div
                className="sidebar-profile-actions"
                role="menu"
                aria-label="Profile actions"
              >
                <Button
                  className="settings-footer-btn"
                  variant="ghost"
                  onClick={() => {
                    setProfileActionsOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  Settings
                </Button>
                <Button
                  type="button"
                  className="logout-footer-btn"
                  variant="ghost"
                  onClick={() => {
                    setProfileActionsOpen(false);
                    setLogoutConfirmOpen(true);
                  }}
                >
                  Log out
                </Button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main>
        <Container size="full">
          <header className="topbar">
            <div className="topbar-header-content">
              <button
                className="mobile-menu-btn"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Open menu"
              >
                <FiMenu size={24} />
              </button>
              <div>
                <h2>
                  {page === "admin"
                    ? "Admin"
                    : page === "pharmacy" && isPharmacistUser && user?.full_name
                      ? `${greetingForHour(new Date().getHours())}, ${user.full_name.split(" ")[0]}`
                      : NAV_ITEMS.find((item) => item.id === page)?.label ||
                        "Dashboard"}
                </h2>
                <p className="muted">
                  {NAV_ITEMS.find((item) => item.id === page)?.subtitle ||
                    "Stay ahead with real-time care intelligence."}
                </p>
              </div>
            </div>
          </header>

          <Suspense fallback={<p className="muted">Loading...</p>}>
            {page === "dashboard" && (
              <DashboardPage
                stats={stats}
                recentPatients={recentPatients}
                analytics={dashboardAnalytics}
                hospitalSummary={hospitalSummary}
                analyticsLoading={dashboardAnalyticsLoading}
                onNavigate={navigateToPage}
                permissions={permissions}
              />
            )}

            {page === "add" && (
              <AddPatientPage
                onCreate={handleCreatePatient}
                setNotice={setNotice}
                onNavigate={navigateToPage}
              />
            )}
            {page === "ocr" && hasPermission("patients.documents.write") && (
              <OcrPage setNotice={setNotice} />
            )}

            {page === "appointment-in" && hasPermission("patients.read") && (
              <RegistrationDeskPage
                mode="appointment-in"
                selectedPatient={selectedPatient}
                setNotice={setNotice}
                onNavigate={navigateToPage}
                prefillData={appointmentPrefill}
              />
            )}
            {page === "appointment-out" &&
              hasPermission("patients.appointments.write") && (
                <RegistrationDeskPage
                  mode="appointment-out"
                  selectedPatient={selectedPatient}
                  setNotice={setNotice}
                  onNavigate={navigateToPage}
                  prefillData={appointmentPrefill}
                />
              )}
            {page === "queue" && hasPermission("patients.read") && (
              <QueuePage
                setNotice={setNotice}
                onNavigate={navigateToPage}
                canManageConsultation={isClinicianUser || isAdmin}
              />
            )}
            {page === "doctor-prescription" &&
              hasPermission("patients.read") &&
              (isClinicianUser || isAdmin) && (
                <DoctorPrescriptionPage
                  setNotice={setNotice}
                  onNavigate={navigateToPage}
                  isAdmin={isAdmin}
                  user={user}
                />
              )}
            {page === "emr" && hasPermission("patients.read") && (
              <EmrPage setNotice={setNotice} />
            )}

            {page === "consent-desk" &&
              hasPermission("patients.consent.write") && (
                <RegistrationDeskPage
                  mode="consent"
                  selectedPatient={selectedPatient}
                  setNotice={setNotice}
                />
              )}

            {page === "insurance-desk" &&
              hasPermission("patients.insurance.write") && (
                <RegistrationDeskPage
                  mode="insurance"
                  selectedPatient={selectedPatient}
                  setNotice={setNotice}
                />
              )}

            {page === "op-desk" && hasPermission("op.read") && (
              <DoctorSchedulingPage
                setNotice={setNotice}
                canEdit={
                  hasPermission("op.schedules.write") ||
                  hasPermission("op.doctors.write")
                }
              />
            )}

            {page === "patients" && (
              <PatientsPage
                key={patientsPageKey}
                patients={patients}
                onSelect={handleSelectPatient}
                onDelete={handleDeletePatient}
                onPatientUpdated={refreshPatientData}
                onExportCsv={handleExportPatientsCsv}
                selectedPatient={selectedPatient}
                setNotice={setNotice}
                canEdit={hasPermission("patients.write")}
                canDelete={hasPermission("patients.delete")}
                canReadBilling={hasPermission("billing.read")}
                ocrLanguage={ocrLanguage}
                languages={languages}
                refreshToken={patientDetailRefreshToken}
              />
            )}

            {page === "readmit" && (
              <ReadmitPage
                onSelect={handleSelectPatient}
                setNotice={setNotice}
                onReadmitComplete={refreshPatientData}
                ocrLanguage={ocrLanguage}
              />
            )}

            {page === "symptom-ai" && (
              <SymptomAiPage
                setNotice={setNotice}
                onNavigate={navigateToPage}
              />
            )}
            {page === "bulk-ai" && hasPermission("patients.bulk_ai.write") && (
              <BulkPatientAiPage setNotice={setNotice} />
            )}

            {page === "billing-payment-collection" &&
              hasPermission("billing.read") && (
                <PaymentCollectionPage
                  setNotice={setNotice}
                  onNavigate={navigateToPage}
                />
              )}
            {page === "billing-revenue-reports" &&
              hasPermission("billing.read") && (
                <RevenueReportsPage
                  setNotice={setNotice}
                  onNavigate={navigateToPage}
                />
              )}
            {page === "billing-daily-monthly-reports" &&
              hasPermission("billing.read") && (
                <DailyMonthlyReportsPage
                  setNotice={setNotice}
                  onNavigate={navigateToPage}
                />
              )}

            {page === "pharmacy" && hasPermission("pharmacy.read") && (
              <PharmacyPage setNotice={setNotice} />
            )}

            {page === "hrms" && hasPermission("hr.read") && (
              <HrmsPage setNotice={setNotice} />
            )}

            {page === "employees" && hasPermission("employees.read") && (
              <EmployeesPage
                setNotice={setNotice}
                canEditProfile={hasPermission("employees.profile.write")}
                canManageAccess={hasPermission("employees.access.write")}
                canCreateOrDelete={isAdmin}
              />
            )}

            {page === "patient-experience" &&
              hasPermission("patient_experience.read") && (
                <PatientExperiencePage setNotice={setNotice} />
              )}

            {page === "admin" && isAdmin && <AdminPage setNotice={setNotice} />}

            {page === "settings" && (
              <SettingsPage
                stats={stats}
                user={user}
                canReadAudit={hasPermission("audit.read")}
              />
            )}
          </Suspense>
        </Container>
      </main>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        languages={languages}
        ocrLanguage={ocrLanguage}
        onOcrLanguageChange={setOcrLanguage}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          handleLogout();
        }}
        title="Log out?"
        description="You will be signed out of this account."
        confirmLabel="Log out"
      />
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

export default App;
