# Keppler Healthcare

AI-driven healthcare management application featuring intelligent patient tracking, OCR-assisted document intake, dynamic dashboards, and automated hospital workflows.

## System Architecture

The application is built with a robust, production-ready stack:
- **Frontend**: React (TypeScript, Vite) with dynamic UI routing and components.
- **Backend**: Python (Flask, Gunicorn) serving stateless REST APIs.
- **Database**: PostgreSQL for all core storage (using `psycopg2`).
- **Caching & Workers**: Redis + Celery for background tasks (bulk import, document processing).
- **AI Module**: Separate `symptom_backend` microservice for advanced LLM integrations.

## Production Deployment

The entire system is thoroughly containerized and ready for production environments via `docker-compose.yml`.

### Quick Start

1. **Configure Environment**
   Copy the example environment file and fill in your secure keys.
   ```bash
   cp .env.example .env
   ```

2. **Start the Stack**
   ```bash
   docker compose up -d --build
   ```

3. **Access the Application**
   - Frontend: http://localhost:5173
   - API: http://localhost:5011

### Essential Environment Variables
For deployment on a remote server, ensure the following are properly set in `.env` (see `.env.example` for the full list):
- `POSTGRES_PASSWORD`: A secure password for PostgreSQL.
- `SESSION_PEPPER`, `ADMIN_ROUTE_AUTH_SECRET`, `ADMIN_ROUTE_PASSWORD`: Random cryptographic secrets -- rotate the defaults before going live.
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`: Your LLM API key for the main backend's OCR and Symptom AI RAG-chat features.
- `SYMPTOM_AI_GEMINI_API_KEY`: A dedicated Gemini key for the separate `symptom_backend` service (falls back to `GEMINI_API_KEY` if unset).
- `VITE_API_BASE` / `VITE_SYMPTOM_API_BASE`: Must reflect the domain names where your API and Symptom AI service are hosted if placed behind a reverse proxy (like Nginx or Traefik); leave blank for same-origin relative API calls.

## Maintenance & Development
- PostgreSQL database backups should target the bound `volumes/pg_data` directory.
- Per-user Symptom AI document knowledge graphs live in `volumes/rag_workspaces` -- back this up alongside `pg_data` if that feature is in use.
- Uploaded files (prescriptions, bulk-import sources) live in `volumes/uploads`.
