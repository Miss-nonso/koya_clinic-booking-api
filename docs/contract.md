# Koya assessment contract and implementation decisions

Source: the Swagger page and expanded endpoint descriptions supplied by the user on 15 November 2026. The original OpenAPI JSON was not available. This document distinguishes supplied requirements from choices where the excerpt is silent.

All endpoint payloads are JSON. All six assessment endpoints require `X-API-Key`; missing or wrong keys return 401. Every error body contains only `{"error":"<message>"}`.

## Endpoint inventory

| Level | Method | Path | Headers / parameters | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| 1, 2 | POST | /reset | X-API-Key | `{slots: SlotInput[]}` | 200; body unspecified by source | 401; implementation returns 400 for invalid reset data |
| 1, 2 | GET | /slots | X-API-Key; no query parameters supplied | None | 200 `{slots: Slot[]}` | 401 |
| 1–5 | POST | /bookings | X-API-Key; optional Idempotency-Key | `{slot_id,name,email}` | 201 Booking | 400 invalid/missing data or started slot; 404 missing slot; 409 occupied; 422 conflicting key reuse; 429 rate limited with whole-second Retry-After; 401 |
| 4, 2 | GET | /bookings | X-API-Key; required email; optional limit (default 10, 1–50); optional cursor | None | 200 `{bookings: Booking[],next_cursor: string|null}` | 400 invalid limit; 401; implementation also returns 400 for missing email or malformed cursor |
| 1, 2 | GET | /bookings/{id} | X-API-Key; required string path id | None | 200 Booking | 404 missing booking; 401 |
| 3, 2 | DELETE | /bookings/{id} | X-API-Key; required string path id | None | 200 cancelled Booking | 404 missing booking; 409 already cancelled; 401 |

`SlotInput`: `id`, `provider`, `start`, `end`. Source example uses string ids, provider names and UTC ISO 8601 timestamps.

`Slot`: all SlotInput fields plus boolean `available`.

`Booking`: string `id`, `slot_id`, `name`, `email`, `status`, and ISO 8601 `created_at`. Status is `confirmed` or `cancelled`.

## Exact behavioural requirements

- Reset deletes all bookings, replaces all slots, and allows past slots.
- Booking requires nonempty slot_id/name/email and valid email. Trim name/email; lowercase stored email.
- Booking a slot whose start is at or before the current time returns 400.
- At most one confirmed booking per slot, including simultaneous requests.
- Cancellation preserves the booking, sets status to cancelled and frees the slot. Repeated cancellation returns 409.
- Same idempotency key and body replays the original status and response, including the original booking id. Changed body returns 422.
- Booking lists match email case-insensitively, oldest first. Cursor continuation ends with next_cursor null.
- At most five booking attempts per email per minute, failed attempts included; sixth returns 429 with integer Retry-After. Other email addresses remain unaffected.

## Ambiguities resolved for this implementation

1. **Error examples:** every error example repeats `slot not found`, including validation, rate limiting and missing booking examples. Treat this as a shared schema example, not a requirement to use that literal message for every failure. Errors use meaningful messages and the exact required envelope/status.
2. **Cancelled example:** DELETE's sample incorrectly shows confirmed. Follow its explicit behaviour and return cancelled.
3. **Reset response:** source specifies only 200; return `{"ok":true}`. Reset also clears idempotency records and rate buckets, avoiding stale responses or throttles across assessment resets. This is an assessment control, never exposed through the public web proxy.
4. **Slot listing:** no filtering/order query parameters were supplied. List all slots, ordered by start then id. Availability indicates absence of a confirmed booking; a past, unoccupied slot remains listed but cannot be booked. The UI hides past slots. Verify against the original GET /slots description if additional text exists.
5. **Rate policy:** rolling 60-second window, keyed by trimmed/lowercase email. Run after authentication and JSON parsing but before booking validation/idempotency. Malformed requests with a nonempty string email count, even if the email itself is invalid. Missing/nonstring emails cannot be attributed to an email bucket. Requests rejected at the rate gate do not extend its deadline. Retried requests count and can receive 429 after the fifth attempt.
6. **Idempotency comparison:** hash the complete parsed JSON body with sorted object keys; JSON whitespace and object key order do not matter. Values are compared before name/email normalization. Keys are global to the single configured API credential and booking operation; no expiry before reset. Cache business/validation error responses as well as successes, but not rate-limit, authentication or malformed-JSON errors. A replay after cancellation returns the historical creation response; GET returns current state.
7. **Pagination:** include confirmed and cancelled history; stable ascending (created_at,id) order; HMAC-signed, email-bound cursors. Invalid cursors and missing/empty email return 400. New bookings after the cursor can appear in subsequent pages; this is keyset pagination, not a snapshot.
8. **Reset validation:** require unique nonempty ids, nonempty providers, timezone-aware ISO timestamps, and end after start. Past timestamps are accepted.
9. **Additional endpoint:** `/health` is an authenticated database readiness probe. It does not change the six assessment endpoints.

## Data model and relationships

- Slot → many historical bookings via bookings.slot_id; a partial unique index permits only one confirmed booking for each slot.
- Booking stores patient name/email directly. No separate patient identity or login is specified.
- IdempotencyRecord maps a hashed key to body hash, HTTP status and immutable JSON response. It is committed with booking creation.
- RateBucket stores a SHA-256 email identifier and up to five recent accepted attempt timestamps. It is a shared PostgreSQL store, not worker-local memory.

## Implementation sequence and verification gates

1. Level 1: migrations, reset, list slots, create/read bookings; verify persistence in a separately created application instance.
2. Level 2: protect endpoints, normalize/validate fields, consistent errors; verify all missing/wrong keys and malformed requests.
3. Level 3: partial unique index, transactional locking and cancellation; verify parallel creation/cancellation and direct database constraint enforcement.
4. Level 4: atomic idempotency records and signed keyset pagination; verify concurrent retries/conflicting bodies, ties and cursor boundaries.
5. Level 5: independently committed rate attempts; verify failures, case normalization, other emails, expiry and multi-instance/concurrent enforcement.
6. Build/type-check the Next.js app; verify browser flows and inspect browser output for secret leakage.
7. Apply migrations to Supabase, deploy Render then Vercel, verify HTTPS end to end, and record submission details. Freeze the submitted revision afterward.

**Current gate:** source and tests are written; levels are not verified because runtime dependencies and a usable PostgreSQL server are unavailable in this sandbox. Do not submit until all gates pass.
