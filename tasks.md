# HospAI Autonomous Delivery Tasks

Last updated: 2026-07-23

## Phase A - Security and Access (M1)
- [x] Enforce default-deny for normal users when `module_access` is missing/invalid
- [x] Keep admin module access behavior intact
- [x] Add RBAC tests for missing/unknown/malformed `module_access`

## Phase B - Core Module Surfaces (M2/M3)
- [x] Wire frontend pages for Billing, Pharmacy, Lab, and HRMS
- [x] Ensure permission-gated navigation to each module
- [x] Add medicine create workflow in Pharmacy inventory page
- [x] Add pharmacy sale recording workflow from Pharmacy page
- [x] Add Billing create/payment workflows (invoice lifecycle)
- [x] Add Lab vendor/test creation workflows
- [x] Add HRMS attendance/payroll/leave write workflows
- [x] Add module filters/search across Billing, Lab, HRMS, Pharmacy
- [x] Add backend update/delete API support for Billing, Lab, and HRMS records
- [x] Add richer edit/delete UX for Pharmacy inventory with confirm dialogs

## Phase C - Mobile and UX Completion (M4)
- [x] Add mobile card fallback for module list views
- [x] Keep no-overflow responsive behavior on core module pages
- [ ] Run and record viewport QA at 320/375/768/1024/1440 for all core flows

## Phase D - Quality and Release (M5)
- [x] Stabilize targeted unit tests for auth and permission behavior
- [x] Add unit test for pharmacy inventory add flow
- [x] Run full backend suite
- [ ] Run full frontend suite (e2e pending)
- [ ] Update release/runbook docs with final verified gates

## Current Next Execution Queue
1. [x] Add frontend edit/delete controls for remaining module entities using new backend CRUD endpoints.
   - Audited all PUT/PATCH/DELETE routes in backend/app.py against frontend page coverage; Billing, Pharmacy, Lab, HRMS, Employees, Patients, OT, and Accounts were already fully wired.
   - Closed the one remaining gap: Consent and Insurance Verification records in RegistrationDeskPage.tsx were create-only with no edit UI despite existing backend PUT endpoints. Added edit-in-place support for both.
   - No delete endpoints exist for consents/insurance verifications on the backend, so no delete UI was added for those two entities.
2. Run E2E suite and complete responsive checklist at 320/375/768/1024/1440.
3. Update release/runbook docs with final verified gates.
