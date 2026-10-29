# CampusVerify — production-focused full-stack starter

CampusVerify helps students prepare scholarship paperwork before visiting a college counter. It is **not** a scholarship approval or government payment system. Automated checks are advisory; college staff make the final decision and confirm physical hardcopy receipt.

## Included
- React + Vite frontend with student, staff, and admin views
- FastAPI backend, JWT access tokens, password hashing, role checks
- PostgreSQL data model for users, student profiles, checklist rules, documents, queue tokens, audit events
- Private local document storage (never served as public static files)
- File extension/content-type/size checks; upload endpoint
- College-scoped API access
- Token queue lifecycle, skip/reschedule endpoints, queue status endpoint
- WebSocket authentication/heartbeat endpoint scaffold; queue UI refreshes from REST. Broadcast push updates must be implemented and tested before claiming fully real-time delivery.
- Configurable checklist rules and starter UP Scholarship document list
- Docker Compose for local development, backend tests, setup instructions

## Important limitations before a real college launch
This is a secure-minded starter, **not a certified production deployment**. Before real student data:
1. Have the college approve current scholarship rules and all document instructions.
2. Replace local file storage with private object storage (S3-compatible or equivalent) and malware scanning.
3. Put the app behind HTTPS/TLS, configure trusted origins, strong secrets, rate limiting, monitoring, encrypted backups and restore drills.
4. Add account provisioning/password reset, email/SMS notifications, retention/deletion workflows, and operational support.
5. Review applicable Indian privacy/data-protection requirements with the institution.
6. Conduct security review and load/concurrency tests. Token numbering currently uses a max-number query and is not safe against all concurrent booking races. Before production, add a per-college/per-date transactional sequence or PostgreSQL advisory lock, then test simultaneous bookings.
7. Change default development credentials/secrets. Do not use demo credentials with real data.

## Requirements
- Docker Desktop / Docker Engine with Compose, or Python 3.12 + Node.js 20+
- Git (recommended)

## Fastest local start (Docker)
1. Copy `.env.example` to `.env`.
2. Change `JWT_SECRET` before sharing/deploying.
3. Run:
   ```bash
   docker compose up --build
   ```
4. Open frontend: http://localhost:5173
5. API docs: http://localhost:8000/docs
6. Health check: http://localhost:8000/health

Development seed accounts (only if `SEED_DEMO=true`):
- Admin: `admin@campusverify.local` / `ChangeMe-Admin-123!`
- Staff: `staff@campusverify.local` / `ChangeMe-Staff-123!`
- Student: `student@campusverify.local` / `ChangeMe-Student-123!`

These are local-only demo accounts. Disable seeding and replace credentials for any shared environment.

## Manual setup
### Backend
```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# Set DATABASE_URL, JWT_SECRET, CORS_ORIGINS and SEED_DEMO in environment.
uvicorn app.main:app --reload
```
For PostgreSQL, create the database first and set `DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/campusverify`.
The starter creates tables on startup for convenience. For production, use Alembic migrations and a reviewed migration workflow.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Vite proxies `/api` and `/ws` to `http://localhost:8000` by default. Docker Compose sets `VITE_PROXY_TARGET=http://backend:8000`.

## Main API routes
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/student/dashboard`
- `GET /api/checklist`
- `POST /api/documents`
- `GET /api/documents`
- `GET /api/queue`
- `POST /api/queue/tokens`
- `POST /api/queue/tokens/{token_id}/call`
- `POST /api/queue/tokens/{token_id}/start`
- `POST /api/queue/tokens/{token_id}/complete`
- `POST /api/queue/tokens/{token_id}/skip`
- `POST /api/queue/tokens/{token_id}/reschedule`
- `GET /api/staff/students`
- `POST /api/staff/students/{student_id}/status`
- `GET /api/admin/rules`
- `PUT /api/admin/rules`
- `WS /ws/queue?token=JWT`

## Test
```bash
cd backend
pytest
```
Tests use an isolated SQLite database by overriding the app dependency. PostgreSQL is recommended for production concurrency testing.

## Project layout
```text
CampusVerify/
  backend/app/          FastAPI routes, models, security and queue logic
  backend/tests/        API tests
  frontend/src/         React application
  docker-compose.yml
  .env.example
```
