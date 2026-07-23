# HospAI Backend Architecture (Enterprise Baseline)

## Design Pattern
- API layer: `backend/app.py` handles routing, authn/authz, request validation, and response shaping.
- Service/data layer: `backend/utils/database.py` encapsulates SQL and domain operations per module.
- Security layer: `backend/utils/auth.py` centralizes identity, session lifecycle, access role mapping, and permissions.
- Cross-cutting concerns:
  - RBAC via `require_permissions`.
  - Audit logging via `log_audit_event` + `audit_logs` table.
  - Input validation via `validate_required_fields`.

## Module Coverage
- Patient Management:
  - Registration, admissions, documents, encounters (OP/IP), bed allocation, medication schedules, clinical notes, patient movement.
- Dashboard:
  - Legacy analytics + FRD summary endpoint (`/api/dashboard/hospital-summary`).
- Billing:
  - Invoice creation/listing, payment recording, revenue + due summaries, payment-mode breakdown.
- Pharmacy:
  - Inventory upsert/list, stock deduction on sale, stock/sales summary.
- Lab & Diagnostics:
  - Vendor management, diagnostics records, paid/due summaries.
- HRMS:
  - Departments, attendance, payroll, leave request lifecycle.
- Compliance:
  - Audit logs endpoint (`/api/audit/logs`) with owner-only permission.

## Reusability and Maintainability Rules
- Keep SQL only in `backend/utils/database.py`.
- Keep route handlers thin: validate input, call data function, audit action, return JSON.
- Enforce required fields with `validate_required_fields` for all new POST/PUT endpoints.
- Add permissions in both:
  - `backend/app.py` (`ACCESS_ROLE_PERMISSION_MAP`)
  - `backend/utils/auth.py` (`ROLE_PERMISSIONS`)

## Test Strategy
- Existing test suites remain for auth, RBAC, patients, employees, exports, and full flows.
- New module tests added:
  - `backend/tests/test_hms_modules.py` for patient extensions, billing/pharmacy/lab, HR, and audit access.

## Next Refactor Step (Recommended)
- Move each module into Flask Blueprints (`routes/patients.py`, `routes/billing.py`, etc.) and keep `app.py` as app factory + blueprint registration only.
