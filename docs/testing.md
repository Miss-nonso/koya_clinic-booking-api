# Verification matrix

Run tests only against a disposable PostgreSQL database: fixtures TRUNCATE all clinic tables before each test. The suite fails rather than silently skipping if TEST_DATABASE_URL is absent.

| Area | Automated assertions | Status in this environment |
| --- | --- | --- |
| Authentication | Missing and wrong key on six assessment endpoints and health | Written; not executed |
| Reset | Past/empty slots, duplicate ids, invalid intervals, replacement and atomic rejection, clearing old state | Written; not executed |
| Core flow | List, availability, booking fields, read, restart/new-app persistence | Written; not executed |
| Validation | Missing/empty/nonstring fields, invalid email, bad JSON/body shape, missing/past slots | Written; not executed |
| Concurrent creation | 12 parallel distinct patients for one slot; one 201, eleven 409; database row count | Written; not executed |
| DB constraint | Direct insertion of another confirmed booking rejected by PostgreSQL | Written; not executed |
| Cancellation | Preserved history, freed slot/rebooking, repeated and simultaneous cancellation | Written; not executed |
| Idempotency | Same response/id/status, reordered JSON, conflicting bodies, cached 404, replay after cancellation | Written; not executed |
| Concurrent idempotency | Five parallel identical requests yield one id; parallel conflicting requests yield 201/422 | Written; not executed |
| Pagination | Stable timestamp ties, oldest-first traversal, no duplicates, cancelled history, email scope, final null | Written; not executed |
| Pagination errors | Missing email, malformed cursor, invalid/default limits | Written; not executed |
| Rate limiting | Five failures admitted, sixth 429, integer Retry-After, normalized email, other email unaffected | Written; not executed |
| Shared rate state | Independent app instances, ten simultaneous attempts, window expiry | Written; not executed |
| Migrations | Alembic upgrade head and alembic check | CI configured; not executed |
| Python syntax | compileall on backend and scripts | Passed locally |
| Frontend | Build, strict TypeScript check, dependency audit | CI configured; blocked locally |
| Browser | Responsive UI, booking, confirmation, lookup, cancel, history, retry | Pending runnable backend/frontend |
| Deployment | Supabase migration, Render HTTPS API and Vercel web proxy smoke checks | Pending |

## Manual end-to-end checklist after CI passes

1. Deploy a test revision; configure backend and frontend server secrets.
2. Seed synthetic future slots explicitly with scripts/seed_slots.py --replace-all.
3. Check unauthorized requests return 401 with {error}; verify authenticated /slots.
4. Book from the page, record the id, refresh/reopen the page and look it up. Confirm it survives a backend restart.
5. Cancel the booking, observe cancelled state, then book the released slot with another test email.
6. Query email history and page through it. Verify no duplicate ids and last cursor null.
7. Replay POST with the same Idempotency-Key, then change the body and expect 422. Use a fresh email when separately testing rate limits.
8. Send six attempts for one email; sixth must have 429 and a whole-second Retry-After. Other emails must remain usable.
9. Inspect browser network requests and built client bundles: no API key or database URL.
10. Test narrow/mobile and desktop viewports, keyboard navigation, visible errors and disabled submission while busy.
11. Run tests on PostgreSQL, record the passing output and exact revision, then capture the three submission values.

## Environmental blockers observed

- pip and npm cannot resolve their package registries (DNS/network restrictions).
- PostgreSQL binaries are installed, but the sandbox rejects both TCP sockets and Unix-domain sockets with Operation not permitted.
- Docker daemon access is denied.
- The workspace dependency runtime lookup failed.
- The project directory is not an initialized Git repository; its .git placeholder cannot be used for commits.

No automated runtime test, security audit, frontend build or deployed URL should be reported as passing on the basis of syntax compilation.

## Patient journey regression checks

The frontend follows the reference journey at https://koya-clinic.firefalltechnologies.ng/:

1. Open `/`: future slots are grouped by local calendar day; booked slots are visible but cannot be booked.
2. Filter by provider, day, time of day and availability; verify combinations, clearing filters, empty results and all sort options.
3. Choose **Book**: a modal shows the selected provider and time before asking for name and email. Check keyboard focus, Escape, close and Cancel.
4. Confirm with synthetic details: the dialog closes and the confirmation receives focus, showing the booking reference. Refresh the list and verify the slot is booked.
5. Open `/bookings`: search by email, verify empty results, booking details and pagination. Changing the email must start a fresh search.
6. Cancel an appointment: dismissing the confirmation preserves it; accepting marks it cancelled in history and releases its slot. Booking it again must create a fresh attempt key.
7. Verify lookup by reference, server errors, unavailable backend, duplicate-slot conflict and rate-limit feedback. A failed slot fetch must show a retry prompt rather than imply there are no appointments.
8. Repeat at a mobile width and with keyboard navigation. Dialog focus must stay inside the open modal and return to its trigger when dismissed.

These UI changes still require runtime verification once frontend dependencies and a test backend are available.
