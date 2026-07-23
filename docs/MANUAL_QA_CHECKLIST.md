# HospAI Manual QA Checklist

## Environment Setup
1. Start backend (`:5001`) and frontend (`:5173`).
2. Open frontend and login with owner account:
   - Username: `employee`
   - Password: `employee123`
3. Confirm `/api/health` returns `{"status":"ok"}`.

## Authentication & RBAC
1. Login succeeds for owner.
2. Logout clears session and returns to login screen.
3. Create clinician, receptionist, HR manager users.
4. Verify restricted navigation is disabled per role.
5. Verify protected API calls return `403` when role lacks permission.

## Patient Management
1. Add patient and verify auto-generated `patient_id`.
2. Confirm duplicate detection on same demographics/phone.
3. Edit patient and verify fields are persisted.
4. Search by name, phone, and patient ID.
5. Delete patient and verify it no longer appears.

## Admission + Documents + OCR
1. Re-admit existing patient with notes.
2. Upload document in re-admission flow.
3. Verify document appears in patient detail.
4. Run OCR on uploaded document.
5. Export OCR result as PDF and Word.
6. Export patient list as CSV.

## Extended Patient Workflows
1. Create encounter (`OP`, `IP`) with insurance + referral + accident flag.
2. Allocate bed (ward/room/bed).
3. Add medication schedule and list pending medications.
4. Add doctor observation/treatment note.
5. Add patient movement (department transfer).
6. Verify all created entries appear in corresponding lists.

## Dashboard & Analytics
1. Confirm core stat cards load.
2. Verify trends/distributions endpoint data renders.
3. Verify hospital summary endpoint:
   - daily/monthly IP/OP
   - accident counts
   - revenue + due
   - payment mode breakdown
   - pharmacy + diagnostics summary
   - referrals

## Billing & Payments
1. Create invoice (`OP/IP/LAB/PHARMACY` module).
2. Add payment and verify due amount updates.
3. Add payment mode conversion fields and verify save.
4. Use `Pay via Razorpay` and verify checkout success records payment with `gateway_ref`.
5. Validate revenue summary totals.

## Appointment & Tokening
1. Create appointment with `Schedule & Assign Token`.
2. Create appointment with `Pay via Razorpay & Schedule` from OP Desk.
3. Create appointment with `Pay via Razorpay & Schedule` from Registration Desk.
4. Verify token generation, queue status, and OP billing invoice/payment linkage.

## Pharmacy
1. Add inventory item.
2. Create pharmacy sale and verify stock deduction.
3. Validate low-stock/out-of-stock/damaged counts.
4. Validate pharmacy sales totals.

## Lab & Diagnostics
1. Add lab vendor.
2. Create diagnostics record with partial paid amount.
3. Validate diagnostics paid/due summary.
4. Validate doctor-wise diagnostics filtering.

## HRMS
1. Create department mapping.
2. Add attendance entry.
3. Create payroll and verify net salary calculation.
4. Create leave request.
5. Approve/reject leave and verify status transition.

## Audit Logs
1. Perform actions in each module.
2. Verify audit logs contain entries with actor/action/module.
3. Verify only owner can fetch audit logs.

## Frontend Unit Test Sanity
1. Run `npm run test:run`.
2. Ensure all unit tests pass.

## Frontend E2E + Artifacts
1. Run `npm run test:e2e:artifacts`.
2. Verify screenshots appear under `frontend/tests/e2e/artifacts/latest`.
3. Run `npm run test:e2e:video`.
4. Verify generated video at `frontend/tests/e2e/artifacts/latest/e2e-run.mp4`.
