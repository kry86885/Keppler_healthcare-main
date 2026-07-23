# E2E Testing Best Practices (HospAI)

## Design Choices Applied
- Split E2E tests by feature domain instead of one large file:
  - `frontend/tests/e2e/dashboard-auth.test.cjs`
  - `frontend/tests/e2e/patients-flow.test.cjs`
  - `frontend/tests/e2e/readmit-docs.test.cjs`
  - `frontend/tests/e2e/modules-api.test.cjs`
  - `frontend/tests/e2e/employees-settings.test.cjs`
- Shared test utility layer (`frontend/tests/e2e/helpers/e2e-helpers.cjs`) for reusable user actions and API calls.
- Centralized setup hooks (`frontend/tests/e2e/setup.cjs`) for screenshot artifacts and stable viewport/default timeouts.
- Artifacts-first debugging:
  - Automatic screenshot capture
  - ffmpeg video generation from artifacts

## Why This Pattern
- Improves maintainability and ownership (each module has a focused suite).
- Reduces duplication and drift by reusing helper functions.
- Enables stable diagnostics with persistent visual evidence.

## Recommended Ongoing Patterns
- Keep test names behavior-focused ("what the user can do"), not implementation-focused.
- Keep helpers at "intent level" (e.g., `registerPatient`) rather than low-level selectors in every test.
- Avoid cross-test state dependency; each test should create its own data.
- Keep setup hooks lightweight and idempotent.

## Primary References
- Jest setup/teardown hooks: [jestjs.io/docs/setup-teardown](https://jestjs.io/docs/setup-teardown)
- Jest configuration: [jestjs.io/docs/configuration](https://jestjs.io/docs/configuration)
- Puppeteer screenshot API: [pptr.dev/api/puppeteer.page.screenshot](https://pptr.dev/api/puppeteer.page.screenshot)
- Puppeteer waiting APIs: [pptr.dev/api/puppeteer.page.waitforselector](https://pptr.dev/api/puppeteer.page.waitforselector)
- Page Object design pattern (UI test maintainability): [selenium.dev/documentation/test_practices/encouraged/page_object_models](https://www.selenium.dev/documentation/test_practices/encouraged/page_object_models/)
