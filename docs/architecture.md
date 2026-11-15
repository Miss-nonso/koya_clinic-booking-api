# Architecture and trade-offs

The backend uses FastAPI routes, Pydantic request/output schemas, SQLAlchemy models and transactional service functions. Alembic owns schema creation. Production code requires PostgreSQL; SQLite would give misleading concurrency results.

## Integrity and coordination

Booking creation locks the target slot with SELECT FOR UPDATE, then checks its start and occupancy. A partial unique index on slot_id WHERE status='confirmed' is the final database invariant. Cancellation locks the booking and changes its status rather than deleting it. A concurrent cancellation/creation can legitimately observe an occupied slot until the cancellation commits; a later retry can book it.

A shared PostgreSQL transaction advisory lock protects state operations; reset takes the exclusive version. Reset is atomic and cannot delete rows halfway through an active state operation. Rate counting and booking creation are separate transactions so a failed booking does not erase its attempt. A reset between those transactions is a new assessment state boundary.

Idempotency uses a key-specific transaction advisory lock, then looks up or creates the stored response in the same transaction as the booking. Concurrent processes cannot commit a booking without its response record. Slot creation's partial unique index remains effective even if application locking is accidentally bypassed.

The rate bucket is created with INSERT ON CONFLICT and locked FOR UPDATE. PostgreSQL's clock is read after the row lock is acquired. Each bucket holds at most five accepted timestamps, making concurrent admission deterministic. Expired timestamps are removed on that email's next attempt. Dormant email bucket rows remain until reset; a long-lived service should add scheduled retention cleanup. Idempotency records intentionally remain until reset because the supplied contract gives no retention interval.

All application tables have row-level security enabled with no public policies, blocking Supabase anonymous/authenticated Data API access. The backend connects as the database owner (or an explicitly authorized server role); do not use browser-role credentials.

Use Supabase's **session pooler** or direct PostgreSQL connection with TLS (`sslmode=require`). Avoid transaction pooler prepared-statement differences unless explicitly configured and tested. Bound SQLAlchemy pools per backend process; use one Render worker initially.

## Frontend

Next.js route handlers attach the API key server-side. The browser never receives the key or database credentials. A narrow route allowlist excludes reset/health; mutating proxy requests check the Origin header. No cookies or local storage hold patient details. Upstream responses and browser fetches use no-store. The UI preserves its current idempotency key across uncertain network failures in the same page session.

The public proxy intentionally exposes the patient operations required by the demo. It is not patient authentication: anyone knowing an email can list that email's bookings, and anyone knowing a booking id can retrieve/cancel it. A shared assessment API key cannot establish patient ownership. This assessment should use synthetic data only. Real clinical use requires patient login/ownership checks, audit trails, a suitable privacy/retention policy and removal or isolation of reset. Do not silently introduce a patient auth requirement that breaks assessment checks.

## Operational choices

- No startup seeding or automatic reset; restarts preserve all state.
- Migrations run before the single backend worker starts; migration failure prevents serving incompatible code.
- No CORS wildcard: the UI uses its same-origin server proxy.
- API docs are disabled on the backend to keep every exposed application operation authenticated.
- Framework HTTP and validation failures use the required JSON envelope. Unexpected server failures return a generic 500 without database/credential details.
- Idempotency stores a copy of the response including patient details; protect database access and backups accordingly.
- Dependency ranges must be resolved, audited and committed as lockfiles in a network-enabled environment before submission. No lockfile or successful dependency audit is claimed here.
