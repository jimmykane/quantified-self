# Wahoo Integration

Wahoo is a Pro-only activity integration. Quantified Self receives completed workout summaries through Wahoo webhooks, can request a user-selected range of workout history, can send retained Wahoo FIT activities to Suunto, and can deliver FIT activities to Wahoo. It does not send plans, routes, sleep, or other non-activity data.

This is the Wahoo-specific architecture and release record. For the reusable implementation process, lifecycle requirements, operational checklist, and provider-wide pitfalls, see the [provider integration implementation guide](provider-integration-guide.md).

## Supported scope

- OAuth 2.0 authorization with `user_read`, `workouts_read`, `workouts_write`, and `offline_data`.
- Connection identity from `GET /v1/user`, with a one-to-one Wahoo-to-Firebase account mapping.
- New and updated completed workouts from `workout_summary` webhooks.
- Manual history import from the descending, paginated `GET /v1/workouts` endpoint.
- FIT parsing through `@sports-alliance/sports-lib`, stable event IDs based on the Wahoo workout ID, and original FIT-file retention with the imported event.
- FIT activity delivery from Wahoo imported events to Suunto through the shared activity-sync queue, with automatic delivery for new imports and date-range backfill for retained FIT files.
- FIT activity delivery to Wahoo from Garmin, COROS, and Suunto imported events through the shared activity-sync queue.
- Direct, user-selected FIT-file delivery from Wahoo Services. This sends the file only to Wahoo; it does not create or retain a Quantified Self event.
- Disconnect through `DELETE /v1/permissions`, followed by recursive local token, queue, mapping, and pending-state cleanup.

Workouts without an available FIT file are skipped. Wahoo records identified as originating from a third-party fitness application are also skipped. Existing imported events and their retained original files are not deleted when the connection is removed or Pro access expires.

## Data flow

1. The Pro user starts OAuth from **Services**. Callable Functions enforce authentication, App Check, and Pro access.
2. The backend exchanges the code, reads the stable Wahoo user ID, atomically assigns its one-to-one Firebase mapping, removes any previous local owner token, and stores rotating credentials in the server-only `wahooAPIAccessTokens` collection.
3. Wahoo posts completed workout summaries to `wahooAPIWebhook`. The shared webhook token, direct user mapping, active connection, deletion guard, pending-disconnect state, and current Pro access are checked before queueing.
4. History imports use the same queue path. A per-user lease prevents overlapping history requests, pages stop once the selected start date is reached, and Wahoo rate-limit reset metadata is returned on HTTP 429.
5. Immediate Cloud Tasks and the scheduled dispatcher both process `wahooAPIWorkoutQueue`. A revision-scoped processing lease serializes updates to the same workout. A newer revision atomically clears an older lease, and stale workers acknowledge only their own snapshot without completing or overwriting the newer revision. The worker rechecks Pro access, deletion, and disconnect state, downloads only allowlisted HTTPS FIT URLs with a bounded request deadline, validates size and FIT magic bytes, parses the event, rechecks deletion immediately before persistence, and retains the original FIT file.
6. After a Wahoo FIT event is persisted, the common activity-sync handoff queues an enabled Wahoo-to-Suunto route from that retained original FIT. The same route supports manual date-range backfill. Wahoo excludes workout summaries created by third-party fitness applications, so activities that Quantified Self or Suunto previously sent to Wahoo are not imported back through this source flow.
7. For Garmin, COROS, and Suunto activity-sync routes whose destination is Wahoo, the shared worker downloads the already retained original FIT, creates the documented URL-encoded `POST /v1/workout_file_uploads` payload (`file`, optional `filename`, and optional `time_zone`), persists Wahoo's upload token before retrying, and polls `GET /v1/workout_file_uploads/:token` until it reaches `complete`, `duplicate`, or an error. The worker does not post the FIT again after an asynchronous upload has started.
8. Direct FIT delivery uses the same Wahoo upload helper and bounded status callable, but no event or source file is persisted by Quantified Self.
9. Queue documents expire through the shared queue TTL policy. Disconnect and account deletion write cleanup tombstones before recursively removing matching operational documents.

Webhook delivery and history are idempotent. The deterministic queue and event IDs use the Wahoo user and workout IDs; a newer workout-summary revision reopens the same queue item instead of creating a duplicate event.

## Configuration

Functions require:

- `WAHOOAPI_CLIENT_ID`
- `WAHOOAPI_CLIENT_SECRET`
- `WAHOOAPI_WEBHOOK_TOKEN`
- Optional `WAHOOAPI_ALLOWED_FILE_HOSTS`, a comma-separated exact-host allowlist that defaults to `cdn.wahooligan.com`

Configure the deployed webhook URL and the same high-entropy webhook token in the Wahoo developer portal. Confirm every production FIT-file hostname and add only exact provider-owned hosts; redirects are checked against the same allowlist.

## Security and lifecycle controls

- Browser clients can read only the safe connection state and display-only Wahoo account ID under `users/{uid}/meta/Wahoo API`; access and refresh tokens and direct user mappings are server-only in Firestore Rules. Existing connections recover the ID through an authenticated, App Check-protected callable that returns that identifier only.
- `workouts_write` is enforced immediately before each outbound Wahoo request. Connections created before delivery support must be reauthorized to receive the new scope; read-only imports remain available until then.
- Outbound upload requests are URL-encoded, carry the FIT as Wahoo's documented base64 data value, and never log the source file, bearer token, or upload form body. Wahoo's asynchronous upload token—not the FIT payload—is persisted on a route queue item.
- File downloads reject non-HTTPS URLs, credentials in URLs, IP literals, local hostnames, unapproved redirect targets, payloads over 20 MB, non-FIT content, and responses that exceed the bounded request deadline. Wahoo JSON API requests use a separate bounded deadline.
- Wahoo access tokens are refreshed only immediately before a Wahoo API request. The next API request activates the rotated token, matching Wahoo's token-lifecycle guidance.
- Webhook retries and duplicate deliveries are safe because queue writes are revision-aware and deterministic.
- Pro access is required to connect, receive new imports, and run history. Disconnect remains available after Pro access ends.
- User deletion guards run before queue insertion, worker processing, and event persistence. Local cleanup remains authoritative if provider deauthorization is temporarily unavailable.

## Release checklist

1. Publish `@sports-alliance/sports-lib` 17.2.0 and verify both application lockfiles resolve the published artifact and integrity before running `npm ci` in release automation.
2. Complete Wahoo's production-app review and approve the final Wahoo brand asset and consumer-facing copy.
3. Register every production OAuth redirect URI and configure the production webhook URL/token in the Wahoo developer portal.
4. Set the production credentials and exact FIT-file host allowlist.
5. Deploy the Firestore indexes, Rules, queue TTL configuration, Functions, and Hosting artifacts through the normal release workflow.
6. Exercise sandbox OAuth with the write scope, webhook, edited-workout deduplication, history pagination/rate limiting, automatic and manual Wahoo-to-Suunto delivery, direct FIT delivery, each source-to-Wahoo route, duplicate uploads, asynchronous upload polling, disconnect, expired-Pro enforcement, and account deletion with test accounts.
7. Monitor callable/webhook error rates, queue age/retries, skipped reasons, FIT download failures, Wahoo upload status failures, Wahoo 429 responses, and cleanup failures before enabling broadly.
