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
For deployment on a remote server, ensure the following are properly set in `.env`:
- `POSTGRES_PASSWORD`: A secure password for PostgreSQL.
- `SESSION_PEPPER`: A random cryptographic string for securing sessions.
- `GEMINI_API_KEY`: Your LLM API key.
- `VITE_API_BASE` / `VITE_APP_URL`: Must reflect the domain names where your frontend and API are hosted if placed behind a reverse proxy (like Nginx or Traefik).

## Maintenance & Development
- All code is strictly formatted (Black for Python, Prettier for TypeScript).
- PostgreSQL database backups should target the bound `volumes/pg_data` directory.
