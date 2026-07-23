# Wahoo Integration

Wahoo is a Pro-only activity integration. Quantified Self receives completed workout summaries through Wahoo webhooks, can request a user-selected range of workout history, can send retained Wahoo FIT activities to Suunto, can deliver FIT activities plus user-selected GPX or FIT courses/routes to Wahoo, and can opt in to send saved Suunto routes to Wahoo. GPX and saved Suunto routes are converted in memory to the FIT course Wahoo accepts. It does not send plans, sleep, or other non-activity data between providers.

This is the Wahoo-specific architecture and release record. For the reusable implementation process, lifecycle requirements, operational checklist, and provider-wide pitfalls, see the [provider integration implementation guide](provider-integration-guide.md).

## Supported scope

- OAuth 2.0 authorization with `user_read`, `workouts_read`, `workouts_write`, `routes_read`, `routes_write`, and `offline_data`.
- Connection identity from `GET /v1/user`, with a one-to-one Wahoo-to-Firebase account mapping.
- New and updated completed workouts from `workout_summary` webhooks.
- Manual history import from the descending, paginated `GET /v1/workouts` endpoint.
- FIT parsing through `@sports-alliance/sports-lib`, stable event IDs based on the Wahoo workout ID, and original FIT-file retention with the imported event.
- FIT activity delivery from Wahoo imported events to Suunto through the shared activity-sync queue, with automatic delivery for new imports and date-range backfill for retained FIT files.
- FIT activity delivery to Wahoo from Garmin, COROS, and Suunto imported events through the shared activity-sync queue.
- Direct, user-selected FIT-file delivery from Wahoo Services. This sends the file only to Wahoo; it does not create or retain a Quantified Self event.
- Direct, user-selected GPX or FIT course/route delivery from Wahoo Services. The callable parses the source route to provide Wahoo's required metadata, converts a GPX route to FIT in memory, looks up Quantified Self's deterministic external ID based on the selected source file, then creates or updates the Wahoo route. It does not create or retain a Quantified Self route.
- Opt-in automatic and backfill delivery of Suunto routes already saved in Quantified Self. This uses the shared saved-route delivery queue and the same Wahoo uploader. The opaque external ID is derived from the Quantified Self saved-route ID, so a newer Suunto revision updates the corresponding Wahoo route instead of creating a duplicate.
- Disconnect through `DELETE /v1/permissions`, followed by recursive local token, queue, mapping, and pending-state cleanup.

Workouts without an available FIT file are skipped. Wahoo records identified as originating from a third-party fitness application are also skipped. Existing imported events and their retained original files are not deleted when the connection is removed or Pro access expires.

## Data flow

1. The Pro user starts OAuth from **Services**. Callable Functions enforce authentication, App Check, and Pro access.
2. The backend exchanges the code, reads the stable Wahoo user ID, atomically assigns its one-to-one Firebase mapping, removes any previous local owner token, and stores rotating credentials in the server-only `wahooAPIAccessTokens` collection. A transfer is rejected for retry until active FIT-publication leases clear; it never changes the mapping while a worker is publishing an imported activity.
3. Wahoo posts completed workout summaries to `wahooAPIWebhook`. The shared webhook token, direct user mapping, active connection, deletion guard, pending-disconnect state, and current Pro access are checked before queueing.
4. History imports use the same queue path. A per-user lease prevents overlapping history requests, pages stop once the selected start date is reached, and Wahoo rate-limit reset metadata is returned on HTTP 429.
5. Immediate Cloud Tasks and the scheduled dispatcher both process `wahooAPIWorkoutQueue`. A revision-scoped processing lease serializes updates to the same workout. A newer revision atomically clears an older lease, and stale workers acknowledge only their own snapshot without completing or overwriting the newer revision. Before persistence, the worker adds its own short-lived publication lease to the Wahoo identity mapping; every event/activity write and final FIT publication verifies that lease. The OAuth transfer transaction refuses to replace an owner while any publication lease is active. The worker rechecks Pro access, deletion, and disconnect state, downloads only allowlisted HTTPS FIT URLs with a bounded request deadline, validates size and FIT magic bytes, parses the event, rechecks deletion immediately before persistence, and retains the original FIT file. A rejected ownership fence recursively removes only event, metadata, and activity document roots created by that worker attempt before the publication lease is released; it never deletes an existing deterministic Wahoo event from an earlier revision.
6. After a Wahoo FIT event is persisted, the common activity-sync handoff queues an enabled Wahoo-to-Suunto route from that retained original FIT. The same route supports manual date-range backfill. Wahoo excludes workout summaries created by third-party fitness applications, so activities that Quantified Self or Suunto previously sent to Wahoo are not imported back through this source flow.
7. For Garmin, COROS, and Suunto activity-sync routes whose destination is Wahoo, the shared worker downloads the already retained original FIT, creates the documented URL-encoded `POST /v1/workout_file_uploads` payload (`file`, optional `filename`, and optional `time_zone`), persists Wahoo's upload token before retrying, and polls `GET /v1/workout_file_uploads/:token` until it reaches `complete`, `duplicate`, or an error. The worker does not post the FIT again after an asynchronous upload has started.
8. Direct FIT activity delivery uses the same Wahoo upload helper and bounded status callable, but no event or source file is persisted by Quantified Self.
9. Direct GPX/FIT course/route delivery validates a 20 MB base64-bounded source request, parses the course/route server-side, and for GPX exports the parsed route as a FIT course in memory. GPX conversion requires exactly one route with valid coordinates; generated FIT is bounded to 20 MB. The flow derives Wahoo's required distance, ascent, start coordinate, activity-family, title, and deterministic external ID from the selected source file, then calls `GET /v1/routes?external_id=...` followed by `POST /v1/routes` or `PUT /v1/routes/:id`. It requires `routes_read` and `routes_write`; no browser token, source payload, generated FIT payload, or route document is persisted. Wahoo Cloud API routes sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App.
10. Suunto-to-Wahoo saved-route delivery is opt-in in Suunto Services. Imported Suunto routes first exist in Quantified Self, then the shared route-delivery queue reparses the saved original source, converts the canonical route to FIT, verifies the Wahoo route scopes, and uses the opaque saved-route external ID to create or update the Wahoo route. Manual backfill uses the same queue while automatic delivery is off. Missing Wahoo connection or route scope is recorded as a skipped delivery with a reconnect instruction instead of a retry.
11. Queue documents expire through the shared queue TTL policy. Disconnect and account deletion write cleanup tombstones before recursively removing matching operational documents.

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
- `workouts_write` is enforced immediately before activity uploads, while direct course/route delivery requires both `routes_read` and `routes_write` before its external-ID lookup and create/update request. Connections created before either delivery capability must be reauthorized to receive the new scope; read-only imports remain available until then.
- Outbound requests are URL-encoded, carry the FIT as Wahoo's documented base64 data value, and never log the source file, generated FIT, bearer token, or upload form body. Wahoo's asynchronous activity-upload token—not the FIT payload—is persisted on an activity-sync queue item. Direct GPX/FIT course/route delivery is synchronous and retains neither payload nor a Quantified Self route document.
- File downloads reject non-HTTPS URLs, credentials in URLs, IP literals, local hostnames, unapproved redirect targets, payloads over 20 MB, non-FIT content, and responses that exceed the bounded request deadline. Wahoo JSON API requests use a separate bounded deadline.
- Wahoo identity transfer and FIT publication are serialized through leases on the server-only identity mapping. The worker holds its lease from first event write through user-readable FIT promotion; a transfer is rejected while any lease remains active. If a guarded write detects an ownership change, recursive cleanup removes only document roots created by that attempt before retry/skip handling, preserving previously imported revisions that share the deterministic event ID.
- Wahoo access tokens are refreshed only immediately before a Wahoo API request. The next API request activates the rotated token, matching Wahoo's token-lifecycle guidance.
- Webhook retries and duplicate deliveries are safe because queue writes are revision-aware and deterministic.
- Pro access is required to connect, receive new imports, and run history. Disconnect remains available after Pro access ends.
- User deletion guards run before queue insertion, worker processing, and event persistence. Local cleanup remains authoritative if provider deauthorization is temporarily unavailable.

## Release checklist

1. Publish `@sports-alliance/sports-lib` 17.2.2 and verify both application lockfiles resolve the published artifact and integrity before running `npm ci` in release automation.
2. Complete Wahoo's production-app review and approve the final Wahoo brand asset and consumer-facing copy.
3. Register every production OAuth redirect URI and configure the production webhook URL/token in the Wahoo developer portal.
4. Set the production credentials and exact FIT-file host allowlist.
5. Deploy the Firestore indexes, Rules, queue TTL configuration, Functions, and Hosting artifacts through the normal release workflow.
6. Exercise sandbox OAuth with activity and route write scopes, webhook, edited-workout deduplication, history pagination/rate limiting, automatic and manual Wahoo-to-Suunto delivery, direct FIT activity delivery, direct FIT and GPX course/route create/update behavior, GPX conversion failures and output-size bounds, each source-to-Wahoo activity route, duplicate uploads, asynchronous activity-upload polling, disconnect, expired-Pro enforcement, and account deletion with test accounts.
7. Monitor callable/webhook error rates, queue age/retries, skipped reasons, FIT download failures, Wahoo upload status failures, Wahoo 429 responses, and cleanup failures before enabling broadly.
