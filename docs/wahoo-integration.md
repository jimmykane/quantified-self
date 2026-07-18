# Wahoo Integration

Wahoo is a Pro-only, import-only provider integration. Quantified Self receives completed workout summaries through Wahoo webhooks and can request a user-selected range of workout history. It does not upload workouts, plans, routes, or other data to Wahoo.

## Supported scope

- OAuth 2.0 authorization with `user_read`, `workouts_read`, and `offline_data` only.
- Connection identity from `GET /v1/user`, with a one-to-one Wahoo-to-Firebase account mapping.
- New and updated completed workouts from `workout_summary` webhooks.
- Manual history import from the descending, paginated `GET /v1/workouts` endpoint.
- FIT parsing through `@sports-alliance/sports-lib`, stable event IDs based on the Wahoo workout ID, and original FIT-file retention with the imported event.
- Disconnect through `DELETE /v1/permissions`, followed by recursive local token, queue, mapping, and pending-state cleanup.

Workouts without an available FIT file are skipped. Wahoo records identified as originating from a third-party fitness application are also skipped. Existing imported events and their retained original files are not deleted when the connection is removed or Pro access expires.

## Data flow

1. The Pro user starts OAuth from **Services**. Callable Functions enforce authentication, App Check, the Wahoo feature gate, and Pro access.
2. The backend exchanges the code, reads the stable Wahoo user ID, prevents duplicate ownership, and stores rotating credentials in the server-only `wahooAPIAccessTokens` collection.
3. Wahoo posts completed workout summaries to `wahooAPIWebhook`. The shared webhook token, direct user mapping, active connection, deletion guard, pending-disconnect state, and current Pro access are checked before queueing.
4. History imports use the same queue path. A per-user lease prevents overlapping history requests, pages stop once the selected start date is reached, and Wahoo rate-limit reset metadata is returned on HTTP 429.
5. Immediate Cloud Tasks and the scheduled dispatcher both process `wahooAPIWorkoutQueue`. The worker rechecks deletion and disconnect state, downloads only allowlisted HTTPS FIT URLs, validates size and FIT magic bytes, parses the event, rechecks deletion immediately before persistence, and retains the original FIT file.
6. Queue documents expire through the shared queue TTL policy. Disconnect and account deletion write cleanup tombstones before recursively removing matching operational documents.

Webhook delivery and history are idempotent. The deterministic queue and event IDs use the Wahoo user and workout IDs; a newer workout-summary revision reopens the same queue item instead of creating a duplicate event.

## Configuration

The integration is off unless `WAHOOAPI_ENABLED=true`. When enabled, Functions require:

- `WAHOOAPI_CLIENT_ID`
- `WAHOOAPI_CLIENT_SECRET`
- `WAHOOAPI_WEBHOOK_TOKEN`
- Optional `WAHOOAPI_ALLOWED_FILE_HOSTS`, a comma-separated exact-host allowlist that defaults to `cdn.wahooligan.com`

Configure the deployed webhook URL and the same high-entropy webhook token in the Wahoo developer portal. Confirm every production FIT-file hostname and add only exact provider-owned hosts; redirects are checked against the same allowlist.

## Security and lifecycle controls

- Browser clients can read only the safe connection state under `users/{uid}/meta/Wahoo API`; access and refresh tokens and direct user mappings are server-only in Firestore Rules.
- File downloads reject non-HTTPS URLs, credentials in URLs, IP literals, local hostnames, unapproved redirect targets, payloads over 20 MB, and non-FIT content.
- Wahoo access tokens are refreshed only immediately before a Wahoo API request. The next API request activates the rotated token, matching Wahoo's token-lifecycle guidance.
- Webhook retries and duplicate deliveries are safe because queue writes are revision-aware and deterministic.
- Pro access is required to connect, receive new imports, and run history. Disconnect remains available after Pro access ends.
- User deletion guards run before queue insertion, worker processing, and event persistence. Local cleanup remains authoritative if provider deauthorization is temporarily unavailable.

## Release checklist

1. Publish `@sports-alliance/sports-lib` 17.2.0 and verify both application lockfiles resolve the published artifact and integrity before running `npm ci` in release automation.
2. Complete Wahoo's production-app review and approve the final Wahoo brand asset and consumer-facing copy.
3. Register every production OAuth redirect URI and configure the production webhook URL/token in the Wahoo developer portal.
4. Set the production credentials and exact FIT-file host allowlist, leaving `WAHOOAPI_ENABLED=false` until all prerequisites are verified.
5. Deploy the Firestore indexes, Rules, queue TTL configuration, Functions, and Hosting artifacts through the normal release workflow.
6. Exercise sandbox OAuth, webhook, edited-workout deduplication, history pagination/rate limiting, disconnect, expired-Pro enforcement, and account deletion with test accounts.
7. Monitor callable/webhook error rates, queue age/retries, skipped reasons, FIT download failures, Wahoo 429 responses, and cleanup failures before enabling broadly.

Rollback is the feature gate: set `WAHOOAPI_ENABLED=false` to stop new connections, webhooks, and history imports while retaining already imported events. Queue workers remain able to drain already accepted items; disconnect stays available.
