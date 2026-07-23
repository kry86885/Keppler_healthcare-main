#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[payment-regression] Running backend payment integration tests..."
if [[ -x "${REPO_ROOT}/.venv-backend/bin/pytest" ]]; then
  "${REPO_ROOT}/.venv-backend/bin/pytest" -q \
    "${REPO_ROOT}/backend/tests/test_razorpay_integration.py" \
    "${REPO_ROOT}/backend/tests/test_hms_modules.py::test_billing_pharmacy_lab_summary_and_dashboard" \
    "${REPO_ROOT}/backend/tests/test_hms_modules.py::test_extended_patient_management_flow"
else
  python3 -m pytest -q \
    "${REPO_ROOT}/backend/tests/test_razorpay_integration.py" \
    "${REPO_ROOT}/backend/tests/test_hms_modules.py::test_billing_pharmacy_lab_summary_and_dashboard" \
    "${REPO_ROOT}/backend/tests/test_hms_modules.py::test_extended_patient_management_flow"
fi

echo "[payment-regression] Running frontend payment/unit tests..."
(
  cd "${REPO_ROOT}/frontend"
  npm run -s test:payments
)

echo "[payment-regression] Building frontend..."
(
  cd "${REPO_ROOT}/frontend"
  npm run -s build
)

echo "[payment-regression] Done."
