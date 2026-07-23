# HospAI Feature Gap Analysis and Required Scope

Last updated: 2026-03-01

## Purpose

This document compares the current HospAI application in this repository against the requested target scope for an advanced hospital management system.

Scope rules used for this review:

- AI-only features are intentionally excluded from the gap assessment.
- The review is based on code currently present in the repository, not on planned functionality.
- Features are classified as:
  - Implemented: materially available in the current app.
  - Partial: some underlying support exists, but the workflow is incomplete, shallow, or not fully surfaced in the UI.
  - Missing: no meaningful implementation found in the current application.

## Current Application Snapshot

The current application already includes a usable baseline HMS foundation:

- Authentication and module-level RBAC with `admin` and `normal` users.
- Patient registration and patient search.
- Re-admission workflow.
- Document upload, OCR processing, and PDF/Word export for OCR text.
- Billing invoice and payment workflows.
- Pharmacy inventory and sales workflows.
- Lab vendor and diagnostics workflows.
- HRMS basics: departments, attendance, payroll, leave.
- Employee management for admins.
- Multi-tenant hospital onboarding and platform admin controls.
- Backend audit logging.

The current application is strongest in:

- Core CRUD workflows.
- Permission-gated backend APIs.
- Foundational operational modules.

The current application is weakest in:

- Dedicated hospital operations workflows (registration desk, OP, IP, OT).
- Advanced dashboard operational telemetry.
- Reports and finance depth.
- Certificate/document generation workflows beyond OCR export.
- Admin monitoring and audit visibility in the frontend.
- Capacity management, scheduling, and integrated clinical operations.

## Evidence Base in the Codebase

Primary evidence reviewed:

- Frontend navigation and page surface:
  - `frontend/src/App.tsx`
  - `frontend/src/pages/DashboardPage.tsx`
  - `frontend/src/pages/AddPatientPage.tsx`
  - `frontend/src/pages/PatientsPage.tsx`
  - `frontend/src/pages/ReadmitPage.tsx`
  - `frontend/src/pages/BillingPage.tsx`
  - `frontend/src/pages/PharmacyPage.tsx`
  - `frontend/src/pages/LabPage.tsx`
  - `frontend/src/pages/HrmsPage.tsx`
  - `frontend/src/pages/EmployeesPage.tsx`
  - `frontend/src/pages/AdminPage.tsx`
  - `frontend/src/pages/PlatformAdminPage.tsx`
  - `frontend/src/pages/SettingsPage.tsx`

- Backend API and service coverage:
  - `backend/app.py`
  - `backend/utils/database.py`
  - `backend/utils/auth.py`

- Existing internal project status docs and tests:
  - `FEATURES.md`
  - `docs/DELIVERY_STATUS.md`
  - `docs/MANUAL_QA_CHECKLIST.md`
  - `backend/tests/test_hms_modules.py`
  - `backend/tests/test_multi_tenant_onboarding.py`

## Executive Summary

### Broad Status

Implemented or substantially present:

- Patient registration and record management
- Re-admission
- Document management
- Billing basic operations
- Pharmacy basic operations
- Diagnostics basic operations
- HRMS basic operations
- User management and RBAC

Partially present:

- Dashboard
- Registration desk
- Inpatient workflows
- Outpatient workflows
- Admin dashboard
- Reports and analytics

Missing as dedicated modules:

- OT (Operation Theatre)
- Certificates module
- Accounts module

### Most Important Missing Product Areas

The biggest functional gaps relative to your target HMS are:

- No dedicated front-desk operations layer (tokening, appointments, insurance verification, consent).
- No proper IP/OP workflow modules with structured care-cycle management.
- No OT scheduling and theatre operations.
- No comprehensive reporting module.
- No accounting/ledger/finance operations beyond billing.
- No certificate generation workflow.
- No admin monitoring UI for audit/security operations.
- No hospital capacity model (beds, wards, ICU capacity, occupancy rates).

## Module-by-Module Gap Analysis

## 1. Main Dashboard (AI Command Center)

### Requested Non-AI Scope

- Real-time OP/IP counts
- Bed occupancy rate
- ICU utilization
- Daily revenue tracking
- High-risk patients count (ignored for AI risk logic, but still would require a dashboard card if implemented)
- Doctor availability tracking
- Lab turnaround time monitoring
- Pharmacy stock alerts

### Current State

Status: Partial

Currently implemented:

- General dashboard stat cards:
  - Total Patients
  - New Today
  - Active Admissions
  - Readmitted Patients
  - Documents
- Patient and document trend charts
- Document type distribution
- Admission status distribution
- Gender distribution
- Quick actions for patient flows
- Backend hospital summary endpoint includes:
  - Daily/monthly IP and OP counts
  - Daily/monthly accident counts
  - Revenue total and due
  - Payment mode breakdown
  - Pharmacy monthly sales
  - Diagnostics monthly income
  - Referral summary

Important limitation:

- The richer hospital summary data exists in backend (`/api/dashboard/hospital-summary`) but is not surfaced in a dedicated frontend dashboard view.

### Missing or Incomplete

- Bed occupancy rate as a percentage
- ICU utilization
- Doctor availability
- Lab turnaround time
- Explicit pharmacy alert widgets on the dashboard
- Capacity thresholds and escalation views
- Real-time/live refresh behavior
- Operational command-center style drilldowns

### Required Work to Reach Target

- Add a dedicated dashboard data model for:
  - hospital bed capacity
  - ICU bed capacity
  - doctor roster/availability
  - lab order timestamps and turnaround
  - pharmacy low-stock alerts
- Expand the frontend dashboard to render hospital summary, alert tiles, and operational drilldowns.
- Add configurable master data for bed capacity, ICU capacity, and clinician availability.

## 2. Registration Desk

### Requested Non-AI Scope

- UHID generation
- Aadhaar/ID OCR scanning
- Insurance API verification
- Token system
- Appointment scheduling
- Digital consent forms

### Current State

Status: Partial

Currently implemented:

- Auto-generated patient ID / UHID-like identifier (`/api/patients/next-id`)
- Patient registration form with demographic and clinical basics
- Duplicate patient detection warning
- Document upload during registration
- OCR processing for uploaded documents
- OCR-assisted extraction for some demographics (DOB/age parsing helpers)

### Missing or Incomplete

- Aadhaar-specific or ID-card-specific extraction workflow
- Structured government ID fields and identity verification
- Insurance verification integration
- Insurance policy validation flow at registration
- Token/queue management for front desk
- Appointment calendar or appointment booking
- Walk-in versus scheduled visit handling
- Digital consent capture
- Signature capture / consent artifact storage
- Front-desk registration dashboard with waitlist and token status

### Required Work to Reach Target

- Add a dedicated Registration Desk module instead of folding all intake into Add Patient.
- Add new data entities:
  - appointments
  - visit tokens
  - insurance verification records
  - patient identity documents
  - consent forms and signatures
- Add registration workflow states:
  - walk-in
  - scheduled
  - checked-in
  - waiting
  - in consultation
  - completed

## 3. Inpatient (IP) Module

### Requested Non-AI Scope

- Ward-wise occupancy tracking
- Doctor assignment
- Nursing notes
- Vital monitoring integration
- IP billing automation

### Current State

Status: Partial

Currently implemented in backend:

- Admissions
- Encounters with `IP` type
- Bed allocations
- Observation notes
- Medication schedules
- Patient movement records

Currently surfaced in frontend:

- Admissions history is visible in patient detail
- Department movements are visible and can be added in patient detail
- Re-admit flow exists

### Important Gap Between Backend and Frontend

The backend contains core inpatient primitives, but there is no dedicated IP module page. The frontend does not currently expose:

- encounter management
- bed assignment workflow
- medication schedule management
- observation notes management

This means IP support is only partially productized.

### Missing or Incomplete

- Ward-wise occupancy board
- Room/bed status map
- Doctor assignment workflow
- Structured nursing notes UI
- Vital signs capture or monitor integration
- Admission lifecycle management (admit, transfer, discharge)
- Discharge planning workflow
- IP bill auto-aggregation from bed/services/medication
- Clinical task timeline

### Required Work to Reach Target

- Create a dedicated Inpatient module page and navigation entry.
- Expose backend endpoints for:
  - encounters
  - beds
  - medications
  - notes
  - movements
  in structured UI tabs.
- Add master data for wards, rooms, bed inventory, and doctor assignment.
- Add discharge workflow and discharge status controls.
- Link IP billing automatically to inpatient services and bed stay.

## 4. Outpatient (OP) Module

### Requested Non-AI Scope

- Appointment calendar
- Doctor schedule management
- OP consultation tracking
- Follow-up scheduling

### Current State

Status: Partial

Currently implemented:

- Encounters support `OP` type in backend
- Billing supports `OP` invoices
- Patient registration and search can support basic OP intake operationally

### Missing or Incomplete

- No dedicated OP page/module
- No appointment calendar
- No doctor calendar / schedule grid
- No consultation workflow state
- No visit queue
- No follow-up booking
- No consultation notes page specific to OP
- No OP-specific front-desk check-in/check-out flow

### Required Work to Reach Target

- Add an Outpatient module with:
  - appointments
  - queue management
  - doctor session slots
  - consultation records
  - follow-up scheduling
- Tie OP consultations into billing and patient history.

## 5. OT (Operation Theatre) Module

### Requested Non-AI Scope

- Surgery scheduling
- Surgeon allocation
- Equipment tracking
- OT utilization analytics

### Current State

Status: Missing

No dedicated OT backend entities, routes, or frontend module were found.

### Missing

- OT rooms / theatre master data
- Surgery booking
- Procedure catalog
- Surgical team assignment
- Pre-op / intra-op / post-op workflow
- OT equipment readiness tracking
- OT block scheduling
- OT utilization reports

### Required Work to Reach Target

- Introduce a new OT domain model:
  - theatres
  - procedures
  - surgery schedules
  - surgeon assignments
  - OT equipment logs
- Add an OT module page and operational calendar view.

## 6. Billing & Revenue Intelligence

### Requested Non-AI Scope

- OP & IP invoice generation
- GST compliance
- Insurance claim integration
- Refund management
- Advance payments

### Current State

Status: Partial

Currently implemented:

- Invoice creation, edit, delete
- Invoice listing/filtering
- Payment recording
- Due calculation
- Payment mode breakdown
- Revenue summary (billed, collected, due)
- Billing module UI
- Supports invoice modules such as `OP`, `IP`, `LAB`, `PHARMACY`

### Missing or Incomplete

- GST fields and tax rules
- Tax invoice formatting and compliance outputs
- Insurance claims workflow
- Payer-wise billing and reconciliation
- Refund workflow
- Credit note / cancellation flow
- Advance deposit ledger
- Settlement against advance
- Package billing / bundled services
- Service-item-level invoice composition
- Billing approval / exception handling

### Required Work to Reach Target

- Expand invoice schema to include:
  - tax/GST fields
  - claim status
  - payer type
  - refund references
  - advance balances
- Add sub-ledgers for advances, refunds, claim submissions, and settlements.
- Add invoice line items and service source linkage.

## 7. Diagnostics (Lab & Radiology)

### Requested Non-AI Scope

- Test ordering
- Barcode sample tracking
- Vendor integration
- Radiology DICOM viewer
- Report upload

### Current State

Status: Partial

Currently implemented:

- Lab vendor CRUD
- Diagnostic record CRUD
- Diagnostic amount/paid/due tracking
- Filtering by patient and doctor
- Summary totals

### Missing or Incomplete

- Test order management workflow from clinician to lab
- Sample collection lifecycle
- Barcode generation and tracking
- Status progression (ordered, collected, processing, reported)
- Radiology image storage/viewer
- DICOM viewer
- Structured lab result/report upload tied to diagnostic record
- Separate radiology versus pathology workflows
- Turnaround time analytics

### Required Work to Reach Target

- Split diagnostics into operational stages:
  - order
  - sample
  - processing
  - report
  - delivery
- Add specimen/barcode entities.
- Add file attachments for reports and imaging.
- Add radiology viewer integration or at least image/report attachment support.

## 8. Pharmacy Module

### Requested Non-AI Scope

- Prescription tracking
- Stock & expiry management
- Batch tracking
- Drug interaction alerts (ignore AI logic, but not the operational need to flag unsafe combinations)

### Current State

Status: Partial

Currently implemented:

- Inventory add/update/delete
- Quantity tracking
- Reorder level
- Low-stock, out-of-stock, damaged-stock counts
- Unit pricing
- Batch number field
- Expiry date field
- Sales recording with stock deduction
- Pharmacy summary metrics

### Missing or Incomplete

- Prescription-to-dispensation workflow
- Patient-linked medication dispensing records
- Prescriber tracking
- Drug master catalog
- Drug interaction rules engine
- Expiry alert dashboard and proactive notifications
- Purchase order / supplier replenishment workflow
- Goods receipt and stock inward logs
- Return-to-stock / damaged stock processing workflow

### Required Work to Reach Target

- Add prescription and dispensing entities tied to patients and clinicians.
- Add supplier/procurement flows for restocking.
- Add rule-based drug interaction checks and expiry alert views.
- Add a pharmacy transaction ledger beyond simple sale entries.

## 9. Reports & Analytics

### Requested Non-AI Scope

- Income by User
- Income by Clinic
- Income by Doctor
- Diagnosis Monthly Income
- Lab Vendor Reports
- Discount Reports
- Patient Transaction History
- ALOS (Average Length of Stay)

### Current State

Status: Partial

Currently implemented:

- Billing revenue summary
- Payment mode breakdown
- Diagnostics summary
- Pharmacy summary
- Hospital summary endpoint with:
  - IP/OP counts
  - accidents
  - revenue
  - referrals
- Patient CSV export
- Some dashboard trend/distribution visuals

### Missing or Incomplete

- No dedicated Reports module
- No date-range report center
- No doctor-wise income reports
- No clinic-wise income reports
- No user-wise income reports
- No diagnosis-wise monthly income report
- No vendor performance or vendor payable reports
- No discount reporting
- No patient financial transaction history report
- No ALOS calculation/report
- No export framework for these operational reports

### Required Work to Reach Target

- Add a dedicated Reports & Analytics module.
- Build a unified reporting backend with filters:
  - date range
  - doctor
  - clinic
  - module
  - patient
  - vendor
- Add export options (CSV/XLSX/PDF) for each report.

## 10. Admin Dashboard

### Requested Non-AI Scope

- Role-Based Access Control (RBAC)
- Audit trail
- Lock history report
- User management
- System configuration

### Current State

Status: Partial

Currently implemented:

- RBAC with module-level permissions
- Admin-only employee management
- Admin route user creation and promotion
- Platform admin hospital onboarding and hospital enable/disable
- Backend audit log collection
- Basic settings page showing user and stats snapshots

### Missing or Incomplete

- No frontend audit trail page
- No lock history report
- No failed login/security event reporting
- No admin dashboard summarizing user activity or anomalies
- No robust system configuration console
- No permission matrix editor with auditability
- No role templates beyond module assignments
- No password policy, session policy, or security settings UI

### Required Work to Reach Target

- Add an Admin Dashboard module distinct from employee maintenance.
- Surface audit logs in the frontend with filters.
- Add security event tracking:
  - failed logins
  - account locks
  - password resets
  - user activation/deactivation history
- Expand settings into actual configurable administration screens.

## 11. Certificates Module

### Requested Non-AI Scope

- Discharge summaries
- Medical certificates
- Insurance documents
- Fit-to-work certificates

### Current State

Status: Missing

There is no dedicated certificate-generation workflow. The current export capability only covers OCR text exported to PDF/Word and is not a clinical certificate system.

### Missing

- Certificate templates
- Structured data merge into templates
- Document approval / signature workflow
- Certificate issuance log
- Patient-linked generated certificate archive
- Discharge summary workflow

### Required Work to Reach Target

- Add a Certificates module with configurable templates and patient-linked generated outputs.
- Add approval, issuer, and document version tracking.

## 12. Accounts Module

### Requested Non-AI Scope

- General ledger
- Vendor payments
- Doctor payouts
- Referral marketing tracking
- Lab vendor reports

### Current State

Status: Missing

Only limited financial functionality exists today:

- billing invoices and collections
- pharmacy sales totals
- diagnostics amounts
- referral source tagging in encounters/billing

This is not an accounting module.

### Missing

- Chart of accounts
- General ledger
- Journal entries
- Accounts payable
- Vendor payment workflow
- Doctor payout calculation and settlement
- Referral commission accounting
- Expense tracking
- Reconciliation
- Financial closing workflow

### Required Work to Reach Target

- Introduce a full Accounts domain model and reporting layer.
- Link billing, diagnostics, pharmacy, vendor expenses, and payouts into ledger entries.

## Cross-Cutting Gaps Outside Individual Modules

## 1. Master Data and Operational Configuration

The app lacks several required master-data systems:

- doctor master
- clinic master
- ward/room/bed master
- OT master
- service catalog
- procedure catalog
- insurer/payer master
- pharmacy supplier master

Without these, many requested modules cannot be built cleanly.

## 2. Scheduling Infrastructure

The requested product needs schedule-aware modules, but the current application has no central scheduling engine for:

- appointments
- doctor rosters
- surgery bookings
- follow-ups
- token queues

## 3. Clinical Workflow Depth

Current patient workflows are largely demographic and document-oriented. Missing clinical workflow layers include:

- structured consultation records
- vitals charts
- care plans
- discharge workflows
- order management
- prescription lifecycle

## 4. Reporting Architecture

The current system has point summaries, not a report platform. A scalable report layer still needs:

- a common query and filter model
- date-range slicing
- drilldownable aggregates
- exportable report templates

## 5. Frontend Productization Gaps

Several backend features exist but are not yet productized in the UI:

- encounter management
- bed management
- medication schedule management
- observation notes management
- audit log review
- hospital summary dashboard view

This means the backend is ahead of the frontend in several domains.

## Detailed Gap Matrix

| Module | Current Status | What Exists Today | Major Missing Areas |
| --- | --- | --- | --- |
| Main Dashboard | Partial | Generic stats, trends, backend hospital summary endpoint | Bed occupancy, ICU, doctor availability, TAT, alert widgets, full ops dashboard |
| Registration Desk | Partial | Patient ID generation, registration form, duplicate detection, OCR upload | Appointments, tokening, insurance verification, consent, front-desk workflow |
| Inpatient | Partial | Admissions, encounters, beds, meds, notes, movements in backend | Dedicated IP UI, doctor assignment, nursing, vitals, discharge, occupancy |
| Outpatient | Partial | OP encounter type and OP billing support | Appointments, calendar, doctor schedule, consultations, follow-ups |
| OT | Missing | None | Full OT operations |
| Billing | Partial | Invoices, payments, revenue summary | GST, claims, refunds, advances, itemized billing |
| Diagnostics | Partial | Vendors, diagnostics records, summaries | Order lifecycle, barcodes, reports, DICOM, TAT |
| Pharmacy | Partial | Inventory, batch, expiry, sales, stock summaries | Prescriptions, interaction checks, procurement, dispensing workflow |
| Reports | Partial | Summary endpoints, CSV export | Dedicated report suite, financial/clinical reports, ALOS |
| Admin Dashboard | Partial | RBAC, user management, backend audit logs, platform admin tools | Audit UI, lock history, config console, security monitoring |
| Certificates | Missing | OCR export only | Clinical/admin certificate system |
| Accounts | Missing | No true accounting domain | Ledger, payouts, payables, accounting reports |

## Prioritized Build Recommendation

## Phase 1: Convert Existing Foundations into Complete Operational Modules

Highest leverage because much of the backend groundwork already exists.

Build next:

- Registration Desk module
- Inpatient module
- Outpatient module
- Dashboard expansion
- Audit log frontend

Reason:

- These will unlock the most visible hospital workflows with the least architectural waste because they can reuse existing patient, billing, and admission primitives.

## Phase 2: Deepen Revenue and Diagnostics Operations

Build next:

- Billing enhancements (GST, advances, refunds, claims)
- Diagnostics workflow expansion (orders, samples, reports)
- Pharmacy prescription and dispensing linkage
- Reports module v1

Reason:

- These directly improve operational completeness and financial control.

## Phase 3: Add New Net-New Modules

Build next:

- OT module
- Certificates module
- Accounts module

Reason:

- These require new domain models and should be built after core patient-flow stability is in place.

## Phase 4: Admin and Enterprise Hardening

Build next:

- Admin dashboard expansion
- lock/security event reporting
- configuration console
- richer exports and operational reports

Reason:

- These improve governance, auditability, and deployment readiness.

## Recommended Backlog by Priority

1. Dashboard v2 with real operational metrics.
2. Registration Desk with appointment and token workflow.
3. Inpatient UI using the already existing backend primitives.
4. Outpatient scheduling and consultation flow.
5. Billing v2 with GST, claims, advances, and refunds.
6. Diagnostics order-to-report lifecycle.
7. Reports module with financial and operational exports.
8. Admin dashboard with audit and security visibility.
9. Pharmacy prescription/dispensing workflow.
10. OT module.
11. Certificates module.
12. Accounts module.

## Conclusion

The current application is a solid HMS foundation, but it is not yet a complete hospital operations platform at the level described in your target feature list.

What is already in place:

- core patient workflows
- billing baseline
- pharmacy baseline
- diagnostics baseline
- HRMS baseline
- RBAC and admin controls

What is still needed to meet your target scope:

- dedicated operational modules for registration, OP, IP, and OT
- much deeper finance, reports, and admin monitoring
- certificate generation
- a true accounts/ledger subsystem
- stronger scheduling, capacity, and workflow orchestration

In short:

- The repository is beyond prototype stage.
- It is not yet feature-complete against your desired HospAI product scope.
- The biggest next step is not adding isolated screens; it is productizing the missing operational workflows around the backend foundations that already exist.
