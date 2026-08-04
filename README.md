---
title: HospAI
emoji: 🏥
colorFrom: blue
colorTo: red
sdk: docker
pinned: false
license: mit
---

# HospAI

AI-driven healthcare management application with patient tracking, OCR-assisted document intake, and admissions.

## Features
- 🏥 Patient Management
- 🔬 Medical Imaging OCR (X-Ray/MRI)
- 💊 Prescription OCR
- 📊 Healthcare Analytics

## Project Structure
- `backend/`: Flask API, OCR/export utilities, database access
- `frontend/`: React UI with HospAI branding

## Run Locally
1. Backend:
   - `cd backend`
   - `python -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
   - `python app.py`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Testing
### Backend (unit + integration)
- `cd backend`
- `pip install -r requirements-dev.txt`
- `pytest`

### Payment Regression Suite (backend + frontend)
- From repo root: `./scripts/test_payment_regression.sh`
- Frontend-only payment tests: `cd frontend && npm run test:payments`

### Frontend (E2E with Jest + Puppeteer)
1. Start backend and frontend:
   - `cd backend && python app.py`
   - `cd frontend && npm install && npm run dev -- --port 5173`
2. Run E2E tests:
   - `cd frontend`
   - `npm run test:e2e`

Notes:
- Set `E2E_BASE_URL` if your frontend runs on a different port or host.
- Use `npm run test:e2e:headed` to run with a visible browser.

## Production Deployment (Coolify)
- Production compose file: `docker-compose.yml`
- Services are internal-only via `expose` (no host port publishing), which is recommended for Coolify reverse-proxy routing.
- Healthchecks are enabled for backend, symptom backend, and frontend.
- Persistent volumes are configured for SQLite data and uploads:
  - `backend_data` -> `/data`
  - `backend_uploads` -> `/app/backend/uploads`

### Required environment variables in Coolify
- `VITE_API_BASE` (example: `https://api.hospai.ai`)
- `VITE_API_URL` (example: `https://api.hospai.ai`)
- `VITE_SYMPTOM_API_BASE` (example: `https://symptom.hospai.ai`)
- Backend runtime variables in Coolify (session/admin-route secrets, storage keys, OCR keys, Razorpay keys, etc.)
- The compose file enforces these `VITE_*` variables as required build args, so deployment will fail fast if missing.

### Coolify routing recommendation
- Route `frontend` service to your app domain (for example `app.hospai.ai`).
- Keep `backend` and `symptom-backend` private unless you explicitly need direct public access.
