# HospAI Implementation Progress

Last updated: 2026-07-24

## Purpose

This document tracks implemented work completed in the repository during the current execution stream, the major remaining scope gaps, and the next recommended delivery slices.

## Implemented So Far

### Phase D: AI/OCR Service Layer (2026-07-24)

New `backend/ai/` package: business routes now depend only on this package's interfaces, never
on `google-genai` or `utils/ocr.py` directly, closing the "don't call Gemini directly inside
APIs" gap.

- **`ai/providers.py`**: `OCRProvider`/`LLMProvider` protocol interfaces -- a future self-hosted
  vLLM/PaddleOCR provider is a new class here, not a change to any caller.
- **`ai/gemini_provider.py`**: `GeminiOCRProvider`/`GeminiLLMProvider`, wrapping the existing
  `utils/ocr.py` logic (kept there since its mime-detection/PDF-extraction/markdown-cleanup
  helpers are already exercised by the pre-existing test suite) rather than duplicating it.
- **`ai/preprocessing.py`**: real, working CPU-only image preprocessing -- deskew (`minAreaRect`
  skew-angle correction), denoise (`fastNlMeansDenoisingColored`), and contrast normalization
  (CLAHE) via OpenCV (`opencv-python-headless`, newly added to `requirements.txt`). This is the
  realistically-implementable slice of the original CRAFT/PaddleOCR/TrOCR preprocessing stage in
  a GPU-less environment. Verified against a synthetic rotated test image; any decode/processing
  failure falls back to the original bytes unchanged so a bad image can never break upload.
- **`ai/service.py`**: the public API. `extract_text_from_image()` (preprocess → OCR provider,
  same name/signature `app.py` already imported so the existing `monkeypatch.setattr(app_module,
  "extract_text_from_image", ...)` test pattern kept working unmodified), `classify_and_extract_entities()`
  (second-pass Gemini call producing structured JSON -- document category, medications, diagnoses,
  dates, key values -- stored in a new `documents.structured_data` column), and
  `patient_history_search()` (simple RAG: `search_similar_documents` from Phase C + an LLM call
  synthesizing an answer from the retrieved excerpts).
- New endpoint `POST /api/ai/patient-history-search` (`patients.read` permission), returns
  `{"answer": ..., "sources": [...]}`; `answer` is `None` when no LLM provider is configured or no
  matches were found, but `sources` is still populated so the raw matches remain usable.
- Classification wiring lives in the `app.py` OCR route (not inside `utils/database.py`) to avoid
  a circular import -- `ai/service.py` depends on `utils/database.py` for `search_similar_documents`,
  so `database.py` cannot depend back on `ai/service.py`.

Full backend suite: 98 passed (12 new), 1 skipped, 0 failed.

### Phase C: Vector Store for Clinical Documents (2026-07-24)

New `backend/utils/embeddings.py` + `clinical_document_embeddings` table, giving the app real
semantic search over clinical documents/certificates.

- **Embedding provider**: implementation deviates from the original plan text (`sentence-transformers`
  / local BGE model) in favor of the Gemini embedding API (`client.models.embed_content`, model
  configurable via `GEMINI_EMBEDDING_MODEL`, default `text-embedding-004`). Rationale: `sentence-transformers`
  pulls in PyTorch (a multi-GB dependency) into what's otherwise a lightweight Flask+gunicorn deployment,
  and this stays consistent with the already-established "Gemini-backed AI provider" decision instead of
  introducing a second, heavier AI stack. `get_genai_model()` (the existing OCR provider client) is reused.
- **Storage**: vectors are stored as JSON-encoded float arrays in a `TEXT` column, compared via cosine
  similarity in Python, on both SQLite and Postgres. This also deviates from the original plan (native
  Postgres `vector` column via the pgvector extension) -- reason: there's no live Postgres instance in
  this environment to validate a pgvector-specific code path against, and a working, portable
  brute-force-cosine implementation that's actually been tested beats an unverified extension-dependent
  one. Upgrading a given deployment to native pgvector indexing later is a storage-layer optimization
  that doesn't change `store_document_embedding()`/`search_similar_documents()`'s contract.
- **Soft-failure by design**: both functions return `None`/`[]` (not an exception) when no
  `GEMINI_API_KEY` is configured, so document upload, OCR processing, and certificate creation keep
  working exactly as before in any environment without embeddings configured.
- **Wired into**: `create_certificate()` (embeds the certificate body at creation) and
  `update_document_ocr()` (embeds the OCR text once it's extracted, not the empty upload placeholder).
  Both calls are wrapped so an embedding failure can never break the underlying write.
- **Tenant + patient isolation verified**: `search_similar_documents(query, hospital_id, patient_id=None, k=5)`
  always scopes by `hospital_id`, with an optional `patient_id` filter; covered by
  `backend/tests/test_vector_store.py` including a cross-hospital-leak regression test.

Full backend suite: 86 passed (4 new), 1 skipped, 0 failed.

### Phase B: Database Hardening (2026-07-24)

Additive schema hardening across every operational/domain table (`patients`, `admissions`, `documents`,
`encounters`, `bed_allocations`, `medication_schedules`, `observation_notes`, `patient_movements`,
`invoices`, `invoice_payments`, `insurance_claims`, `pharmacy_inventory`, `pharmacy_sales`,
`pharmacy_suppliers`, `pharmacy_purchases`, `lab_vendors`, `diagnostics`, `department_master`,
`attendance`, `payroll`, `leave_requests`, `appointments`, `doctor_schedules`, `patient_consents`,
`insurance_verifications`, `certificates`, `ot_theatres`, `ot_surgeries`, `accounts_ledger`,
`vendor_payments`, `doctor_payouts` — 30 tables). System/security tables (`hospitals`, `users`,
`sessions`, `audit_logs`) were intentionally excluded; they have their own identity/audit semantics.

- **UUID columns**: every operational table now has a `uuid` column, populated automatically for new
  rows via a database-level mechanism (a `gen_random_uuid()` column default on Postgres 13+, an
  `AFTER INSERT` trigger on SQLite) rather than editing dozens of scattered `INSERT` call sites.
  Existing rows were backfilled during migration. Existing integer primary keys are untouched — this
  is purely additive, so no API response shape, foreign key, or frontend type changed.
- **Audit columns**: `created_by`, `updated_by`, `deleted_by` (text — an actor identifier, matching the
  existing free-text `created_by` convention already used on `encounters`/`invoices`) and `deleted_at`
  were added to all 30 tables via the project's existing incremental `ALTER TABLE ... ADD COLUMN`
  migration pattern in `init_database()`.
- **Soft deletes**: every hard `DELETE` in `backend/utils/database.py` across all 30 operational tables
  was converted to a soft delete (`deleted_at`/`deleted_by` set instead of removing the row), via a new
  shared `soft_delete_row()` helper. All corresponding `list_*`/`get_*`/search functions now filter
  `deleted_at IS NULL`, so deleted records disappear from every read path exactly as before — the only
  behavior change is that the row is retained instead of destroyed. Every affected `app.py` delete route
  now passes the authenticated user's username as the `actor` for `deleted_by`. `users` (employee hard
  delete) was intentionally left as-is; it already has a separate deactivate/status workflow and wasn't
  in scope for this pass.
- **Composite indexes**: added tenant-scoped composite indexes (`hospital_id` + date/status) on the
  tables most exercised by dashboard/report queries (patients, invoices, diagnostics, pharmacy_sales,
  appointments, attendance, admissions), guarded to only create when the underlying columns exist.
- **Table partitioning** was explicitly not implemented — SQLite doesn't support it and current data
  volumes don't warrant it on Postgres yet; documented here as a deferred recommendation.
- `created_by`/`updated_by` on the *create/update* path (as opposed to `deleted_by` on delete, which is
  fully wired) are present in the schema but not yet populated on every write — threading actor context
  into every create/update function across the whole app is a much larger effort better done alongside
  the Phase A route/service restructuring, where each route already needs touching.

Full backend suite: 82 passed, 1 skipped, 0 failed. No frontend changes required (soft delete is
transparent at the API layer — same response shapes, same status codes).

### Pre-Refactor Baseline Hardening (2026-07-23)

Before starting the backend modularization phase of the enterprise architecture plan, the full backend
test suite was run cleanly for the first time in this environment (with `BUCKET_URL`/session/admin-route
secrets configured as process env vars, not a committed `.env`). Establishing a genuinely green baseline
surfaced several real, pre-existing bugs — fixed here since they directly affect multi-tenant correctness
and data availability, and touch the exact code about to be restructured:

- **Multi-tenant employee creation bug (data isolation break):** `signup_employee()` resolved the target
  hospital via a bare `resolve_hospital_id()` call with no arguments, which always resolved to the default
  hospital rather than the current request's or authenticated admin's actual hospital. Any employee created
  via `/api/employees` (or the platform admin-route account endpoints) was silently created under the wrong
  hospital regardless of which hospital's admin created them. Fixed by threading an explicit `hospital_id`
  (the authenticated admin's `current_hospital_id()`, or `request_hospital_id()` for the separate admin-route
  endpoints) into `signup_employee()`.
- **Global employee ID collisions across hospitals:** `generate_employee_id()` computed the next sequential
  ID scoped per-hospital (e.g. every hospital's first employee got `EMP-00001`), but `users.employee_id` has
  a database-wide `UNIQUE` constraint, not a per-hospital one — so onboarding a second hospital's first admin
  always failed with a `UNIQUE constraint failed` error. Fixed by computing the next ID across all hospitals.
- **Hospital admin bootstrap wasn't actually admin:** `signup_hospital_admin()` never set `user_type` on the
  new account, so it defaulted to `"normal"` and the freshly onboarded hospital admin had zero permissions
  despite `access_role="owner"`. Fixed by explicitly setting `user_type="admin"`.
- **Disabling a hospital didn't block login:** `authenticate()` never checked hospital status (only session
  validation on *subsequent* requests did), so a disabled hospital's admin could still log in and obtain a
  fresh session. Fixed by joining hospital status into the login query and rejecting inactive hospitals with
  the same 403 pattern already used for inactive user accounts.
- **Object storage local-fallback was broken in both directions:** `ObjectStorage.__init__` referenced
  `self.local_base` in its S3-failure fallback path without ever assigning it (`AttributeError` waiting to
  happen), and `ObjectStorage.read()`/`delete()` only ever handled `s3://`-prefixed paths, silently returning
  `None`/no-op for any document that had fallen back to local disk storage — meaning OCR, document viewing,
  and exports could never retrieve a document once it fell back to local storage. Both are fixed now.
- **Vestigial public self-signup endpoint removed:** `/api/auth/signup` still existed and worked despite the
  system's admin-only account-creation model (`/api/employees`) and an existing test (`test_auth.py::test_signup_endpoint_removed`)
  already expecting it to be gone. Removed the route; the `signup_employee` helper function remains in use by
  the legitimate admin-gated creation paths.
- **Stale env var name in multi-tenant onboarding tests:** tests referenced `ONBOARDING_ADMIN_USERNAME/PASSWORD`,
  which the application never reads (it reads `PLATFORM_ADMIN_USERNAME/PASSWORD`); tests renamed to match.
- **`PLATFORM_ADMIN_USERNAME/PASSWORD` were frozen at import time**, making them impossible to reconfigure
  within a single test session (or a running process) — fixed to read fresh via `os.getenv()` per call.
- **`IS_POSTGRES` detection required both `DB_ENGINE=postgres` and a `postgres://` `DATABASE_URL`** even though
  `.env.example` documents `DATABASE_URL` alone as sufficient; simplified to depend only on the URL scheme
  (plus the existing `DB_PATH` override guard), matching documented usage.
- One test (`test_employee_account_creation_is_admin_only_per_hospital`) asserted that an `hr_manager`-role
  employee should be denied `admin.use` — but `hr_manager` is intentionally admin-equivalent in
  `normalize_user_type` (used in two places), so the test's non-admin example was swapped to `receptionist`,
  which is unambiguously non-admin in the current role model. The underlying admin/normal binary permission
  model (no intermediate "elevated but not full admin" tier) is a known limitation, not something invented
  here — a candidate for the Phase E auth/permission hardening work.

Full backend suite: 82 passed, 1 skipped, 0 failed. Frontend build and full unit suite unaffected (untouched
this slice). A local git repository was also initialized for the project (previously untracked) so this and
the following architecture phases have a real rollback safety net.

### Dashboard

- Added operational hospital summary widgets to the main dashboard.
- Surfaced OP/IP counts, revenue, due amount, accident counts, payment mix, referral sources, diagnostics income, and pharmacy sales.

### Patient Module

- Patient registration remains in place.
- Added registration desk scheduling and token queue support.
- Added a dedicated OP desk workflow with:
  - doctor schedule setup
  - OP day summary
  - appointment queue filtering
  - follow-up scheduling
- Added OP appointment operations for:
  - reminder sent tracking
  - no-show marking
- Added registration-side operations for:
  - digital consent capture
  - structured insurance verification logging
- Added clinical operations in patient detail:
  - encounters
  - bed assignments
  - medication schedules
  - observation notes
- Added patient visit timeline.
- Added patient transaction history (billing and diagnostics when permissions allow).
- Added patient-linked certificate workflows:
  - discharge summary
  - medical certificate
  - insurance document
  - fit-to-work

### Billing

- Added support for invoice advances and refunds.
- Expanded revenue summary with:
  - total advance
  - total refunded
  - collections by module
- Updated billing UI to capture and show these values.
- Added insurance claim tracking linked to invoices:
  - claim amount
  - approved amount
  - claim status
  - external claim reference
- Added billing analytics depth for:
  - receivable aging buckets
  - payment reconciliation summary
  - converted payment tracking
- Exposed payment conversion fields in the billing payment workflow so reconciliation metrics are driven from user-entered payment conversions.

### Pharmacy

- Added pharmacy sales listing API.
- Added pharmacy sales reporting in the frontend.
- Added pharmacy workflow depth for:
  - prescription-linked dispensing
  - supplier master records
  - procurement / purchase orders

### Lab / Diagnostics

- Expanded lab diagnostics reporting in the frontend with:
  - vendor visibility
  - invoice number visibility
  - doctor-wise income
  - invoice-wise diagnostics breakdown
- Added diagnostic order lifecycle fields:
  - sample barcode
  - order status
  - sample collected timestamp
  - report issued timestamp

### Reports

- Added a dedicated `reports` module with explicit module-level access.
- Added backend reports overview endpoint.
- Added frontend Reports page with cross-module operational and financial summaries.
- Expanded reports with:
  - clinic-wise income
  - discount by module
  - payment status breakdown
  - ALOS summary
- Added report exports:
  - CSV
  - PDF
  - Word

### OT / Operation Theatre

- Added a dedicated `ot` module with explicit module-level access.
- Added backend OT domain support for:
  - theatre master records
  - surgery schedules
  - OT utilization summary
- Added frontend OT operations page for:
  - theatre setup
  - surgery scheduling
  - theatre status tracking
  - surgery status updates
- Expanded OT analytics with:
  - scheduled/completed hours
  - theatre-wise utilisation

### Accounts

- Added a dedicated `accounts` module with explicit module-level access.
- Added backend accounts foundations for:
  - general ledger entries
  - vendor payments
  - doctor payouts
  - accounts summary totals
- Added frontend Accounts page for ledger, vendor, and doctor payout operations.

### Admin / Settings

- Replaced the placeholder settings page with a usable audit log viewer.
- Fixed audit field mapping to match backend schema.

### Responsive UI

- Updated the shared frontend layout for improved mobile compatibility.
- Sidebar now reflows into a sticky top rail on tablet and mobile widths.
- Navigation is horizontally scrollable on smaller screens.
- Module headers, inline actions, forms, and buttons now collapse more cleanly for phone-sized layouts.
- Reduced accidental horizontal overflow in the shared shell.

### Registration Desk (Consent & Insurance) Edit Support

- Added edit affordances for existing Consent and Insurance Verification records in `RegistrationDeskPage.tsx`, closing the last known gap where backend `PUT /api/registration/consents/<id>` and `PUT /api/registration/insurance/<id>` endpoints had no corresponding frontend UI (records were previously create-only/read-only).
- Added an "Edit" action per list row that populates the form and switches the save action to call the existing PUT endpoint by ID, with a "Cancel Edit" control to return to create mode.
- No delete endpoints exist for these two entities on the backend, so no delete UI was added (would require a new backend endpoint first).

## Validation Completed

- Repeated frontend production builds with `npm run build` succeeded after each major slice.
- Repeated focused backend validation with:
  - `./.venv/bin/python -m pytest backend/tests/test_hms_modules.py -q`
  passed after each backend slice.
- Added a frontend unit test covering the Consent edit-and-PUT flow in `RegistrationDeskPage.test.tsx` (full frontend suite: 16 files / 45 tests passing, `npm run build` green).
- Added additional documentation and regression coverage for the expanded modules:
  - [docs/IMPLEMENTATION_HANDOFF.md](/Users/subigyalamichhane/kalpra/Keppler_healthcare/docs/IMPLEMENTATION_HANDOFF.md)
  - new backend regression tests for reports, OT, accounts, OP, and pharmacy procurement
  - new frontend unit tests for Reports, OP, OT, and Accounts
  - new e2e coverage for advanced operations workspaces
- Added follow-on regression coverage for:
  - registration consents and insurance verification
  - diagnostics lifecycle fields and status transitions
  - pharmacy supplier and procurement UI/API flows
- Added browser-driven workspace smoke coverage for:
  - Add Patient registration desk panels
  - Pharmacy workflow panels
  - Lab workflow panels
- Added browser-driven workspace smoke coverage for:
  - Billing workflow panels
  - OT workflow panels
  - Accounts workflow panels

## Remaining Major Gaps Against Original Scope

The original modules documentation is still not fully satisfied. Major remaining gaps:

- fuller OP module:
  - richer calendar views
  - deeper calendar / reminder automation
- registration depth:
  - deeper OCR / ID extraction
- billing depth:
  - fuller claim settlement lifecycle
- diagnostics depth:
  - richer workflow automation / alerts
- pharmacy depth:
  - deeper stock automation / reorder workflows
- responsive polish:
  - page-specific refinement for the most crowded module screens on smaller devices

## Current Delivery Strategy

Work is being completed in coherent, testable slices instead of a single high-risk rewrite. Each slice is expected to:

- reuse existing backend primitives when possible
- preserve permission enforcement
- remain backward-compatible with the current database
- include validation before moving on
- update the implementation documentation when the delivered scope changes materially

## Next Recommended Slices

1. Apply page-specific mobile refinements to dense workflows like Billing, Patients, and Add Patient.
2. Deepen OP with richer calendar views and reminder automation.
3. Expand insurer settlement and financial reconciliation depth.
