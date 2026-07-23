# HospAI Implementation Handoff

Last updated: 2026-03-04

## Purpose

This document is the consolidated implementation record for the HospAI expansion work completed in this repository. It captures the delivered modules, the concrete backend and frontend surfaces now present, the validation added, and the remaining non-trivial gaps.

It is intended to be the authoritative handoff note for engineering, QA, and release planning.

## Delivery Summary

The project now includes working end-to-end foundations for the major HMS modules requested in the original scope:

- dashboard operations and financial summaries
- patient management with OP/IP-adjacent workflows
- registration desk scheduling, consent, and insurance verification
- billing with collections, advances, refunds, claims, and reconciliation analytics
- diagnostics lifecycle tracking
- pharmacy inventory, sales, suppliers, and procurement
- reports center with export endpoints
- OT scheduling and utilisation tracking
- accounts ledger, vendor payments, and doctor payouts
- server-enforced RBAC with module-level access
- audit log visibility in settings
- responsive mobile-first layout improvements for the shared shell and module workspaces

The implementation was delivered incrementally in low-risk slices, preserving backward compatibility for existing database rows and keeping backend authorization server-enforced.

## Implemented Modules

### 1. Dashboard

Delivered:

- hospital summary cards now surface operational and financial metrics
- dashboard reads the hospital summary payload in the app shell and refresh path
- surfaced metrics include:
  - OP/IP counts
  - revenue and dues
  - diagnostics income
  - pharmacy sales
  - accidents
  - payment-mode mix
  - referral sources

Primary files:

- [frontend/src/App.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/App.tsx)
- [frontend/src/pages/DashboardPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/DashboardPage.tsx)

### 2. Registration Desk

Delivered:

- appointment scheduling and token generation
- appointment queue status updates
- digital consent record capture
- insurance verification log capture
- intake-side operational panels embedded into the add-patient flow

Backend surfaces:

- `GET /api/appointments`
- `POST /api/appointments`
- `PUT /api/appointments/<id>`
- `POST /api/appointments/razorpay/order`
- `POST /api/appointments/razorpay/verify`
- `GET /api/registration/consents`
- `POST /api/registration/consents`
- `PUT /api/registration/consents/<id>`
- `GET /api/registration/insurance`
- `POST /api/registration/insurance`
- `PUT /api/registration/insurance/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/AddPatientPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/AddPatientPage.tsx)

### 3. Patient Management / IP Foundations

Delivered:

- patient encounters
- bed allocations
- medication schedules
- observation notes
- movement tracking
- patient visit timeline
- patient transaction history for billing and diagnostics
- patient-linked certificates

Certificate types implemented:

- discharge summary
- medical certificate
- insurance document
- fit-to-work

Backend surfaces:

- patient encounter, bed, medication, notes, movement, and certificate CRUD endpoints under `/api/patients/...`
- `DELETE /api/certificates/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/PatientsPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/PatientsPage.tsx)

### 4. OP Desk

Delivered:

- dedicated OP Desk page
- doctor schedule management
- OP day summary cards
- queue filtering by date and doctor
- appointment create and update
- follow-up scheduling
- reminder-sent tracking
- no-show marking

Backend surfaces:

- `GET /api/op/summary`
- `GET /api/op/doctor-schedules`
- `POST /api/op/doctor-schedules`
- `PUT /api/op/doctor-schedules/<id>`
- `DELETE /api/op/doctor-schedules/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/OpPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/OpPage.tsx)

### 5. Billing

Delivered:

- invoice creation and update
- payment recording with gateway and conversion metadata
- advances and refunds
- insurance claims linked to invoices
- collection reporting and billing analytics

Billing analytics now include:

- collections by module
- receivable aging buckets
- gateway-collected totals
- converted-payment totals
- payment conversion breakdown

Backend surfaces:

- `GET /api/billing/invoices`
- `POST /api/billing/invoices`
- `PUT /api/billing/invoices/<id>`
- `POST /api/billing/invoices/<id>/payments`
- `POST /api/billing/razorpay/order`
- `POST /api/billing/razorpay/verify`
- `GET /api/billing/revenue-summary`
- `GET /api/billing/claims`
- `POST /api/billing/claims`
- `PUT /api/billing/claims/<id>`
- `DELETE /api/billing/claims/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/BillingPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/BillingPage.tsx)

### 6. Diagnostics / Lab

Delivered:

- vendor management
- diagnostic entry management
- doctor-wise and invoice-wise reporting visibility
- sample and result lifecycle tracking

Diagnostic lifecycle fields added:

- `sample_barcode`
- `order_status`
- `collected_at`
- `reported_at`

Primary files:

- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/LabPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/LabPage.tsx)

### 7. Pharmacy

Delivered:

- inventory management
- pharmacy sales
- pharmacy sales reporting
- prescription-linked dispensing (`patient_id`, `prescription_ref`)
- supplier master
- procurement / purchase orders
- automatic inventory increase when received purchases are posted

Backend surfaces:

- `GET /api/pharmacy/inventory`
- `POST /api/pharmacy/inventory`
- `GET /api/pharmacy/sales`
- `POST /api/pharmacy/sales`
- `GET /api/pharmacy/summary`
- `GET /api/pharmacy/suppliers`
- `POST /api/pharmacy/suppliers`
- `PUT /api/pharmacy/suppliers/<id>`
- `DELETE /api/pharmacy/suppliers/<id>`
- `GET /api/pharmacy/purchases`
- `POST /api/pharmacy/purchases`
- `PUT /api/pharmacy/purchases/<id>`
- `DELETE /api/pharmacy/purchases/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/PharmacyPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/PharmacyPage.tsx)

### 8. Reports

Delivered:

- dedicated `reports` module with backend permission enforcement
- cross-module reports overview endpoint
- Reports Center UI
- report exports

Reports currently include:

- billing summary
- hospital operational summary
- pharmacy summary
- lab summary
- employee summary
- accounts summary
- doctor-wise income
- diagnostics by doctor
- patient financials
- clinic-wise income
- discount by module
- payment-status breakdown
- ALOS summary

Export endpoints:

- `GET /api/reports/export/csv`
- `GET /api/reports/export/pdf`
- `GET /api/reports/export/word`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/ReportsPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/ReportsPage.tsx)

### 9. OT (Operation Theatre)

Delivered:

- OT theatre master records
- surgery scheduling
- surgery update/delete workflow
- OT summary and utilisation analytics

OT analytics currently include:

- theatre count
- available theatres
- scheduled surgeries
- completed surgeries
- scheduled hours
- completed hours
- theatre-wise utilisation

Backend surfaces:

- `GET /api/ot/theatres`
- `POST /api/ot/theatres`
- `PUT /api/ot/theatres/<id>`
- `DELETE /api/ot/theatres/<id>`
- `GET /api/ot/surgeries`
- `POST /api/ot/surgeries`
- `PUT /api/ot/surgeries/<id>`
- `DELETE /api/ot/surgeries/<id>`
- `GET /api/ot/summary`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/OtPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/OtPage.tsx)

### 10. Accounts

Delivered:

- general ledger entries
- vendor payments
- doctor payouts
- accounts summary

Accounts summary currently includes:

- ledger income
- ledger expense
- net position
- vendor paid total
- doctor paid total
- doctor due total

Backend surfaces:

- `GET /api/accounts/summary`
- `GET /api/accounts/ledger`
- `POST /api/accounts/ledger`
- `PUT /api/accounts/ledger/<id>`
- `DELETE /api/accounts/ledger/<id>`
- `GET /api/accounts/vendors`
- `POST /api/accounts/vendors`
- `PUT /api/accounts/vendors/<id>`
- `DELETE /api/accounts/vendors/<id>`
- `GET /api/accounts/doctors`
- `POST /api/accounts/doctors`
- `PUT /api/accounts/doctors/<id>`
- `DELETE /api/accounts/doctors/<id>`

Primary files:

- [backend/app.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/app.py)
- [backend/utils/database.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/database.py)
- [frontend/src/pages/AccountsPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/AccountsPage.tsx)

### 11. Security / Platform

Delivered:

- module-level backend permission enforcement for new modules
- mirrored frontend navigation and module visibility
- audit log viewer in settings
- backward-compatible schema extension approach

Primary files:

- [backend/utils/auth.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/utils/auth.py)
- [frontend/src/lib/constants.ts](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/lib/constants.ts)
- [frontend/src/pages/SettingsPage.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/SettingsPage.tsx)

### 12. Responsive UI / Mobile Compatibility

Delivered:

- shared layout now supports smaller viewports more intentionally instead of relying on desktop collapse behavior
- sidebar becomes a sticky top rail on tablet and mobile widths
- navigation becomes horizontally scrollable on smaller screens
- sidebar footer and profile controls reflow for narrow screens
- top bars and module panel headers stack cleanly on phones
- inline action groups and forms collapse into single-column layouts at mobile breakpoints
- buttons become full-width where necessary on very small screens
- global overflow is constrained to prevent accidental horizontal scrolling

Primary files:

- [frontend/src/styles.css](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/styles.css)
- [frontend/src/App.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/App.tsx)

## Documentation Maintenance

The documentation trail for this project should continue to be updated in these files as implementation changes land:

- [docs/IMPLEMENTATION_HANDOFF.md](/Users/subigyalamichhane/kalpra/Keppler_healthcare/docs/IMPLEMENTATION_HANDOFF.md) for cumulative scope, API, UI, and validation state
- [docs/IMPLEMENTATION_PROGRESS.md](/Users/subigyalamichhane/kalpra/Keppler_healthcare/docs/IMPLEMENTATION_PROGRESS.md) for rolling execution progress and next slices

The intent is to keep these two documents aligned with the real application state after each meaningful feature, test, or UI change.

## Testing Added

### Existing Regression Coverage Extended

- backend HMS integration suite for multi-module workflows:
  - [backend/tests/test_hms_modules.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/tests/test_hms_modules.py)

### New Backend Regression Tests

- [backend/tests/test_hospai_regression.py](/Users/subigyalamichhane/kalpra/Keppler_healthcare/backend/tests/test_hospai_regression.py)

Covers:

- reports overview and export endpoints
- billing claims in reporting context
- pharmacy procurement stock application
- OP reminder and no-show summary updates
- OT summary/utilisation after surgery creation
- accounts summary after vendor and doctor payouts
- registration consents and insurance verification records
- diagnostics lifecycle creation and status updates

### Frontend Unit Tests Added

- [frontend/src/pages/ReportsPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/ReportsPage.test.tsx)
- [frontend/src/pages/OpPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/OpPage.test.tsx)
- [frontend/src/pages/OtPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/OtPage.test.tsx)
- [frontend/src/pages/AccountsPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/AccountsPage.test.tsx)
- [frontend/src/pages/AddPatientPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/AddPatientPage.test.tsx)
- [frontend/src/pages/PharmacyPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/PharmacyPage.test.tsx)
- [frontend/src/pages/LabPage.test.tsx](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/src/pages/LabPage.test.tsx)

Covers:

- render smoke coverage for the new major module pages
- presence of key forms, sections, and summary widgets
- compatibility with the current API payload shapes

### E2E Tests Added

- [frontend/tests/e2e/advanced-ops.test.cjs](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/tests/e2e/advanced-ops.test.cjs)
- [frontend/tests/e2e/registration-pharmacy-lab-advanced.test.cjs](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/tests/e2e/registration-pharmacy-lab-advanced.test.cjs)
- [frontend/tests/e2e/module-workspace-ui.test.cjs](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/tests/e2e/module-workspace-ui.test.cjs)
- [frontend/tests/e2e/finance-ops-ui.test.cjs](/Users/subigyalamichhane/kalpra/Keppler_healthcare/frontend/tests/e2e/finance-ops-ui.test.cjs)

Covers:

- navigation into Reports, OT, and Accounts workspaces
- OP API workflow for schedules, appointments, and reminders
- OT creation flow via API
- Accounts and Reports API availability through the authenticated browser session
- registration consent and insurance verification API flows
- diagnostics lifecycle API flow
- pharmacy supplier and procurement API flow
- browser-level workspace visibility for Add Patient, Pharmacy, and Lab modules
- browser-level workspace visibility for Billing, OT, and Accounts modules

## Validation Commands

The intended validation set for this delivery is:

- `./.venv/bin/python -m pytest backend/tests/test_hms_modules.py backend/tests/test_hospai_regression.py -q`
- `npm run test:run -- src/pages/ReportsPage.test.tsx src/pages/OpPage.test.tsx src/pages/OtPage.test.tsx src/pages/AccountsPage.test.tsx`
- `npm run build`
- `E2E_BASE_URL=http://localhost:5173 E2E_API_BASE=http://localhost:5001 npm run test:e2e:artifacts -- --runInBand tests/e2e/advanced-ops.test.cjs`

## Remaining Gaps

The implementation is substantially closer to the original product scope, but these areas are still not fully complete:

- OCR-driven Aadhaar or ID auto-fill remains roadmap-level, not production-complete
- AI features from the original product brief remain intentionally deferred
- richer appointment calendar visualisation and automated reminder delivery are still limited
- advanced billing settlement, insurer remittance reconciliation, and deeper claim lifecycle states can still be expanded
- diagnostics barcode workflow exists, but vendor integrations and richer report publishing workflows can still be extended
- pharmacy auto-reorder and expiry automation are still operationally basic
- export polish is functional but not yet a fully branded reporting suite
- mobile responsiveness has been improved at the shared layout level, but page-by-page fine tuning for denser data-entry screens can still be expanded

## Recommended Next Release Slice

1. Add page-specific mobile refinements for the heaviest data-entry screens such as Billing, Patients, and Add Patient.
2. Deepen OP scheduling into a stronger calendar and follow-up workflow.
3. Expand financial reconciliation and insurer settlement reporting.
