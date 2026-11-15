# Koya Clinic Booking

FastAPI + PostgreSQL API and a Next.js/TypeScript/Tailwind patient page for all five Koya assessment levels.

**Status:** implementation and tests written; runtime verification and deployment are blocked in the current sandbox. No level is marked complete. Python syntax compilation passes. See docs/testing.md for exact verification status.

## Project map

- backend/app: routes, configuration, schemas, models, transactional booking services.
- backend/migrations: versioned Alembic schema, including the partial unique booking index.
- backend/tests: PostgreSQL integration, concurrency, idempotency, security and rate-limit tests.
- frontend/app: patient UI and server-only API proxy.
- docs/contract.md: supplied contract, level mapping, ambiguities and choices.
- docs/architecture.md: data relationships, transaction design and operational trade-offs.
- docs/testing.md: verification matrix and remaining checks.
- render.yaml: free Render backend blueprint.

## Local development

Requires Python 3.12+, Node 20.9+ (24 recommended), and PostgreSQL 16+. Run from the project root in a network-enabled terminal.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
docker compose up -d db
cp backend/.env.example backend/.env
```

Generate two different random secrets and put them in backend/.env (do not commit them):

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48)); print(secrets.token_urlsafe(48))'
```

Use the generated values for API_KEY and CURSOR_SECRET respectively. In your backend terminal:

```bash
set -a
. backend/.env
set +a
cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn app.main:create_app --factory --reload
```

The app does not automatically load .env; the shell commands above explicitly export it. In a second terminal:

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local: CLINIC_API_KEY must equal backend API_KEY.
npm install
npm run dev
```

Open http://localhost:3000. It will show an empty state until you explicitly seed future slots. From a root-directory terminal with API_KEY exported:

```bash
export CLINIC_API_URL=http://127.0.0.1:8000
python3 scripts/seed_slots.py --replace-all
```

That command calls the assessment's destructive reset endpoint. Do not use after submission or on data you want to keep.

## Tests

Create a **separate disposable** database named clinic_test. Tests erase all rows in it. Example with the local Compose database:

```bash
docker compose exec db createdb -U clinic clinic_test
export API_KEY=local-test-api-key-at-least-32-characters
export CURSOR_SECRET=local-test-cursor-secret-at-least-32-characters
export DATABASE_URL=postgresql+psycopg://clinic:clinic@localhost:5432/clinic_test
export TEST_DATABASE_URL="$DATABASE_URL"
cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/alembic check
../.venv/bin/pytest -q
```

The test database URL must use the postgresql+psycopg scheme. Normal production database URLs are normalized automatically by Settings.from_env.

In frontend run `npm run build`, `npm run typecheck` and `npm audit --omit=dev --audit-level=high`. Once installation succeeds, commit package-lock.json and freeze Python dependencies in a lockfile; re-run CI with those resolved versions before submission. No installed dependency versions or vulnerability scan are claimed yet.

## Deployment

1. Push this source to a Git repository you control. This workspace currently has no usable Git metadata.
2. **Supabase:** create a free PostgreSQL project. Use its session-pooler PostgreSQL URL with `sslmode=require`, including the actual database password. Keep it server-side. Do not use a browser anon key as a database password. Do not expose the application tables through a browser database client.
3. **Render:** create a Blueprint from render.yaml, or a free Python web service with root backend. Install `pip install -r requirements.txt`. Start with `alembic upgrade head && uvicorn app.main:create_app --factory --host 0.0.0.0 --port $PORT`. Set DATABASE_URL, API_KEY and CURSOR_SECRET as secret environment variables. Use independent random secrets (at least 32 characters). Do not configure an unauthenticated health-check path: /health is protected.
4. Verify the deployed backend using its root HTTPS URL and X-API-Key. Endpoints are at `/slots`, `/bookings`, etc.; there is no `/api` prefix.
5. **Vercel:** import the same repository, choose frontend as root directory and Next.js as framework. Set server environment variables CLINIC_API_URL to Render's HTTPS base URL and CLINIC_API_KEY to the same backend key. Never use NEXT_PUBLIC_ for either secret. Deploy after the backend passes verification.
6. Explicitly seed synthetic future slots; run the end-to-end checks in docs/testing.md, including the deployed proxy.
7. Record the exact deployed revision and submission values below. After submission, keep the deployment and database running and do not change code/configuration/data until Koya contacts you. Be aware that the assessment's /reset endpoint necessarily remains callable with the API key.

Free hosting can sleep or pause; confirm account/provider availability and assessment timing before submission. Use only synthetic patient information; the assessment contract does not provide patient authentication.

## Submission handover

| Field | Value |
| --- | --- |
| API base URL | Pending verified Render deployment |
| API key | Pending secure production configuration; share privately with the assessor |
| Web page URL | Pending verified Vercel deployment |
| Frozen revision | Pending repository push and passing checks |

Do not submit localhost URLs, placeholders, or a frontend preview without a working persistent backend.
