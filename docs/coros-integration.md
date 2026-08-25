# COROS Integration

COROS is a Pro-only activity, sleep-summary, activity-delivery, and route-delivery integration. Quantified Self imports COROS activity/history data, polls supported sleep summaries, sends retained FIT activities in explicitly configured provider directions, uploads selected FIT activities, and implements direct or saved GPX/FIT route delivery to COROS. Activity upload, activity-sync routes, and route delivery are available production-wide to eligible connected users.

This is the COROS-specific architecture and release record. For shared provider requirements, see the [provider integration implementation guide](provider-integration-guide.md).

## Supported scope

- OAuth 2.0 connection and refresh using the COROS `openId` as the stable provider identity.
- Server-side binding-state verification when a connected account is shown in the Services connection grid.
- One active COROS account per Quantified Self user. New OAuth connects pin the account in safe service metadata. Legacy multi-token roots select the most recently refreshed token deterministically and pin it on first server use; a missing pinned token fails closed and requires reconnect.
- Recent COROS activity-history import within the provider's rolling three-month limit.
- Daily sleep-summary polling plus a user-requested three-month sleep backfill in 30-day windows, subject to the existing cooldown. COROS does not supply sleep stages through this integration.
- Direct FIT activity delivery with asynchronous provider status polling.
- Automatic and date-range FIT activity delivery from Garmin, Suunto, or Wahoo to COROS through the shared activity-sync queue.
- Existing COROS-to-Suunto and COROS-to-Wahoo automatic/date-range activity routes.
- Direct GPX/FIT route delivery from COROS Services without creating a saved Quantified Self route.
- Saved-route delivery from the Routes row action, selected-row bulk toolbar, and route detail.
- Opt-in automatic and backfill delivery of Suunto routes already saved in Quantified Self to COROS through the shared route-delivery queue.

Every automatic activity and saved-route direction is off by default. Empty rollout allowlists make the corresponding routes available to all eligible Pro users; a user must still connect the required services and explicitly enable each direction. COROS direct/saved route upload and Suunto-to-COROS route delivery reuse the same empty production allowlist in `shared/coros-rollout.ts`; populating it provides a narrow emergency rollback. A date-range or saved-route backfill does not turn on future delivery.

## Account identity

All COROS imports and deliveries resolve the same active token through `functions/src/coros/account.ts`.

1. If `users/{uid}/meta/COROS API.providerUserId` exists, only that exact `openId` token is accepted.
2. If legacy metadata is not pinned, tokens are ordered by `dateRefreshed`, then `dateCreated`, then document ID, all descending.
3. The selected `openId` is persisted through the deletion-safe service-metadata writer before it is used.
4. Once pinned, a missing or mismatched token never falls back to another COROS account.

A multi-window activity-history request resolves that account once and passes the expected `openId` through every 30-day window; each provider request revalidates the pin, while persisted range and activity-count metadata remain cumulative across successful windows, including windows with no activities. Daily sleep polling deduplicates candidate users and resolves active accounts with bounded concurrency rather than fanning out an unbounded number of metadata/token reads.

When the connected COROS card is opened, the authenticated `getCOROSAPIBindingState` callable checks `GET /coros/bindState` with the active server-side token. A bound response records only the safe binding status and check timestamp. An unbound response atomically marks the connection reconnect-required and disables every COROS activity-sync and route-delivery setting so no automatic route remains active for a revoked provider account. The transaction proves the token, pinned `openId`, connection lifecycle, and account-deletion state are still current; a stale response is ignored. Before returning a stale result, the callable atomically replaces only its own lease with a per-account cooldown and gives the browser the retry time. Provider outages and malformed responses show a retry state and do not mark an account disconnected.

Binding checks are protected on the server rather than relying on one browser's request coalescing. A result is reused for five minutes, each account can hold only one 45-second provider-call lease, and a recent result can be served while that lease is active. Uncached calls also consume a transactionally enforced shared COROS budget of 60 checks per fixed minute. Exhausting either control returns a retryable callable error before contacting COROS, while structured budget-exhaustion logs provide aggregate monitoring. The decoded provider response is capped at 16 KiB before JSON parsing. A handled provider failure or stale result atomically replaces only that request's lease with a 15-second per-account cooldown; the cooldown is checked before the shared budget is read or debited. The callable returns `retryAt`, the Services grid coalesces state changes while waiting, and at most one delayed automatic retry is attempted for a stale result. The upstream attempt still consumes the shared budget, and many distinct accounts remain bounded by the global limit. Reconnect and disconnect cleanup remove obsolete lease and cooldown state.

COROS route multipart requests require a partner-platform `openUserId`. Quantified Self derives a stable 128-bit, provider-scoped digest from the Firebase UID rather than sending the UID itself. The value is stable for a Quantified Self account but cannot be used as a browser credential.

## Inbound activity ingestion

### Webhook acknowledgement

The COROS webhook supports unauthenticated `GET` health checks and credential-verified `POST` deliveries. A POST receives result `0000` only after every valid workout component has been durably queued, or when the delivery is a known non-retryable skip such as an unknown local account. Authentication, malformed payload, and transient queue failures return distinct non-zero result codes; transient failures also use a retryable HTTP status so COROS can deliver the message again. The handler caps the raw body at 8 MiB, bounds the batch and string fields, queues items with concurrency limited to 10, preserves integer-shaped 64-bit identifiers as strings, and never logs the raw body or signed FIT URL.

Regular and multisport webhook records share the same queue and worker. Queue identity uses `openId`, `labelId`, and a stable component key rather than the ephemeral signed download URL. Each newly stored or history-replaced payload also receives an opaque queue revision. That revision is carried in the Cloud Task name and payload, and dispatch recovery, dispatch markers, FIT-detail updates, retries, deferrals, DLQ moves, and completion all require the stored revision to remain current. At queue-wrapper entry, the worker transactionally claims revisioned work before token lookup, provider access, download or FIT-detail recovery, parsing, echo detection, or any revision-sensitive retry, deferral, DLQ, or completion transition. The revision-bound lease lasts longer than the worker timeout and remains held through event identity resolution, original-file persistence, and activity-sync fan-out. A racing history transaction may install the newer payload only while preserving that active lease; its worker remains retryable until those older-revision writes finish. Completion then releases the replacement as unprocessed and undispatched, so the newer revision necessarily persists last. A crashed owner is reclaimable after the lease expires and the Cloud Task retry backoff has elapsed. Already-queued pre-revision COROS rows use their original creation time as a rollout-generation guard, so they cannot mark a new revision dispatched, retried, or complete. Duplicate webhook deliveries preserve the active revision and update the latest bounded workout metadata and URL without resetting lifecycle state. Event-ID migration first honors the current stable reservation, then positively matching primary-event metadata, and only then an exact or unambiguous legacy URL-derived reservation; ambiguous multisport collisions stay separate rather than guessing and overwriting an event.

### History ranges and FIT-detail recovery

COROS activity and sleep dates are provider calendar dates, inclusive at both boundaries. Server helpers validate real UTC dates, clamp history to the rolling three-month limit, reject end dates beyond a one-day UTC allowance for the user's local calendar, and split requests into non-overlapping windows of at most 30 calendar dates. The browser sends `YYYY-MM-DD` values for COROS so local timezone conversion cannot shift the selected date.

Webhook/history records may omit a FIT URL, and signed URLs may expire before a worker downloads them. The worker recovers a fresh URL from `GET /v2/coros/sport/detail/fit` using the stable `labelId`, parent `mode`/`subMode`, and multisport component identity. It validates the returned workout and component before a deletion-guarded queue update. A detail-auth response gets one forced OAuth refresh; a signed-URL 401/403/404/410 by itself does not incorrectly mark the account disconnected. Retryable detail failures stay retryable, while unusable detail responses enter the existing DLQ with a sanitized reason.

### Imported event metadata

Imported COROS events preserve bounded provider attribution when supplied: effective `mode` and `subMode`, device name, start/end timezone, `planWorkoutId`, and stable multisport component identity. New events do not retain the provider's expiring FIT URL; the owned original file remains the durable source for export, reprocessing, and downstream delivery.

## Activity delivery

### Direct upload protocol

`importActivityToCOROSAPI` accepts one bounded base64 FIT file from the authenticated browser. It enforces App Check, Pro access, account-deletion state, disconnect-pending state, the active COROS account, and the common activity upload byte limit before calling `POST /coros/file/upload` as multipart form data.

A successful initialization must return an integer-shaped upload ID. JavaScript parsing protects 64-bit `uploadId` and `labelId` values from numeric precision loss. The browser stores only the opaque upload ID and provider account ID in its temporary upload row.

`getCOROSAPIWorkoutFileUploadStatus` calls `GET /coros/file/upload/get` for that same account and upload ID:

- provider status `1` remains pending;
- provider status `2` is success;
- provider status `-1` is a terminal processing failure;
- duplicate result `5082` is completed duplicate-as-success;
- an unknown status or mismatched upload ID fails closed as a provider-contract error.

After COROS issues an upload ID, status retries resume that operation and do not post the FIT again. A completed upload increments the COROS upload counter through an idempotency record keyed by the provider operation or queue item.

### Shared automatic and backfill delivery

The following FIT-only routes use `shared/activity-sync-routes.ts`, the common date-range backfill callable, and the same COROS upload/status helpers:

| Source | Destination |
| --- | --- |
| Garmin | COROS |
| Suunto | COROS |
| Wahoo | COROS |
| COROS | Suunto |
| COROS | Wahoo |

The worker downloads the retained original FIT, verifies entitlement, both connection states, the active destination account, pending disconnect, and account deletion, then persists resume state before provider continuation. It never derives a replacement activity from event statistics.

For COROS-bound shared rows, provider status `1` is an expected asynchronous wait rather than a Cloud Task failure. The worker retains the upload ID, consumes the bounded polling budget, durably records the next poll's due time, acknowledges the current task, and schedules the next status-only poll using the configured Cloud Tasks backoff (15 minutes through four hours). The queue reconciler respects that due time instead of bypassing it with an immediate task, and an early retry re-enqueues the same planned task rather than polling COROS ahead of schedule. It emits an info-level structured poll-scheduled log; the next worker never posts the FIT again. Scheduler/transport failures, exhausted polling, and status `-1` remain warning/error paths.

## Echo suppression

Provider-to-provider activity delivery can otherwise return through a destination's import feed and start a loop. The shared outbound fingerprint mechanism runs for every activity destination, not only COROS:

1. Before provider delivery, compute an exact SHA-256 file fingerprint.
2. When the FIT can be parsed, also compute a semantic fingerprint from bounded event/activity start, end, type, duration, and distance fields. This tolerates provider re-encoding that changes file bytes without changing the activity.
3. Persist both receipts under `users/{uid}/activitySyncOutboundFingerprints`, namespaced by destination so the same FIT can be sent to multiple providers without one receipt overwriting another.
4. Abort provider delivery if the deletion-guarded receipt transaction fails.
5. During COROS, Suunto, or Wahoo queue processing, check the downloaded original before event persistence. A matching, unexpired receipt for that source provider marks the inbound queue item processed without writing an event or starting another fan-out.

Receipts contain hashes, destination identity, timestamps, and TTL metadata—not the activity file. Browser access is denied. They expire after 120 days through Firestore TTL and are also removed by recursive account deletion. Wahoo independently omits third-party-app workouts from its import API, while the shared receipt still protects outbound deliveries consistently.

Inbound COROS FIT URLs are treated as untrusted provider input. The worker accepts only HTTPS downloads and redirects on `oss.coros.com` or a `*.cloudfront.net` distribution, and requires COROS's bounded `/fit/<account>/<workout>.fit` path shape. COROS's API reference describes `fitUrl` as a provider-returned download URL and uses `oss.coros.com` in examples without defining a fixed-host contract; production also returns rotating CloudFront distribution hosts. The worker applies a 60-second deadline and the shared 30 MB activity limit, validates the FIT signature before parsing, and reduces transport failures to errors that do not expose signed URL query values.

## Route delivery

Route controls, the direct callable, saved-route sends, and Suunto route automatic/backfill delivery all enforce the same shared server-backed rollout gate. Its empty allowlist makes route delivery production-wide while preserving a narrow operational rollback; frontend visibility is not the authorization boundary. Authentication, App Check, Pro entitlement, active connection, account deletion, and pending-disconnect checks remain mandatory.

All COROS route entry points share `functions/src/coros/routes.ts` through the common route-send and route-delivery adapters:

- direct GPX/FIT upload in COROS Services;
- a saved-route row, bulk, or detail send;
- automatic or existing saved Suunto route delivery.

The server accepts at most 20 MB of source data, validates the filename and base64 encoding, parses GPX/FIT through the shared route parser, and exports fresh GPX in memory. The destination request uses `POST /coros/route/push` with the active COROS `openId`, opaque partner user ID, signed-positive 63-bit route ID, GPX file, route name, distance, creation time, language, and optional duration/ascent.

Route type inference is intentionally broad because COROS accepts only two types:

- cycling-family types—including bike, MTB, road cycling, gravel, cycling, velo, and spin—map to bike (`1`);
- every other or missing activity type maps to running (`2`).

The provider route ID is a deterministic digest of the Quantified Self user, active COROS account, stable source key, and exact generated GPX revision. Repeating the same revision uses the same ID; changed geometry produces a new revision ID. COROS duplicate result `13001` is success. Direct selected-file delivery creates no Quantified Self route, while saved delivery persists provider route/account metadata before a multi-route batch continues.

HTTP 408, 429, 5xx, and transient transport failures are retryable. Authentication failures require reconnect, and HTTP 403 or provider code `30009` is a permission-required failure. Invalid parameters, missing required distance, invalid provider responses, and rejected content are terminal and sanitized before reaching the browser or DLQ.

## Security and lifecycle controls

- Access/refresh tokens remain in the existing `COROSAPIAccessTokens` tree and its pre-existing owner-readable connection model, but browser writes to the token subtree are denied. OAuth exchange, refresh, and disconnect mutations use the Admin SDK. The delivery callables and workers do not return credentials; their browser responses contain only bounded upload/status identifiers and messages.
- User-triggered import and delivery callables require authentication, App Check, and Pro access. Binding verification requires authentication and App Check but intentionally remains available after entitlement ends, as does disconnect.
- Activity and route providers are called only after account-deletion and disconnect-pending checks; the checks repeat immediately before the provider request.
- Token refresh extends the same COROS access token for 30 days from successful refresh completion and stores an expiry five minutes early as an operational buffer. The refresh token is retained because COROS documents it as non-expiring. A provider operation retries refresh once after a terminal COROS authentication signal; a changed or missing active account fails closed.
- Activity initialization/status and route-push requests have a 30-second provider deadline; timeout outcomes retain the operation's safe restart/resume policy.
- Multipart values remove CR/LF characters, names are bounded, source/generated files and provider payloads are never logged, and provider errors are reduced to allowlisted messages and typed dispositions.
- Activity fingerprints, queue state, service metadata, and provider tokens live under existing recursive account-deletion ownership. Browser Rules explicitly deny fingerprint access.

## Firestore and deployment dependencies

The implementation adds no new COROS credential secret. It reuses `COROSAPI_CLIENT_ID` and `COROSAPI_CLIENT_SECRET`.

`activitySyncOutboundFingerprints.expireAt` requires the Firestore TTL field override in `firestore.indexes.json`; the collection's hash/routing fields have automatic indexes disabled. Deploy indexes and Rules before Functions and Hosting so receipt writes and browser denial are active before users can start delivery.

The affected callable exports are:

- `getCOROSAPIBindingState`;
- `importActivityToCOROSAPI` (updated asynchronous contract);
- `getCOROSAPIWorkoutFileUploadStatus`;
- `importRouteToCOROSAPI`.

The inbound COROS webhook (`insertCOROSAPIWorkoutDataToQueue`), activity-history callable (`addCOROSAPIHistoryToQueue`), activity worker (`parseCOROSAPIWorkoutQueue`), COROS sleep polling/backfill paths, token refresh scheduler, and existing shared activity-sync/route-delivery functions also contain changed behavior. Include those affected exports in the normal Functions deployment rather than deploying only the callable names above.

## Release checklist

1. Confirm the production COROS partner application has activity-file upload and route-push entitlement. A controlled non-destructive activity probe on 2026-08-13 reached COROS application-level validation (`5096`, unsupported file) rather than permission denial (`30009`), confirming activity-upload access at that time. The shared route rollout is configured for general availability; stop the release if the route smoke test below returns HTTP 403 or result `30009`.
2. With a dedicated test account, send one valid FIT activity and poll the same upload ID to terminal success; repeat it and verify duplicate-as-success without a second event.
3. From a dedicated test account, send one small valid GPX route and verify it appears in COROS. Repeat the same saved-route revision and verify duplicate-safe success. Stop the release if COROS returns HTTP 403 or result `30009`.
4. Deploy Firestore indexes/TTL and Rules, then Functions, then Hosting through the normal release workflow. Do not use implementation work as deployment approval.
5. Exercise webhook GET health and POST acknowledgement, missing/expired FIT URL recovery, regular and multisport metadata, direct FIT activity upload/status, each source-to-COROS automatic route, inclusive 1/30/31-day history windows, all date-range backfills, COROS-to-Suunto/Wahoo routes, direct GPX/FIT route upload, saved-route row/bulk/detail sends, Suunto route automatic/backfill delivery, duplicate handling, reconnect, disconnect-pending, expired-Pro, deletion races, and a history replacement while its prior Cloud Task is live.
6. Revoke the dedicated COROS account at the provider, open the Services connection grid, and verify the card becomes reconnect-required while every COROS activity and saved-route automatic setting turns off. Repeat with a simulated provider outage and verify it shows Retry without changing connection state. Verify repeated grid requests reuse the five-minute server cache, overlapping uncached requests make only one provider call, and the shared request budget rejects excess calls before the COROS API.
7. Send the same test FIT to both COROS and Suunto, then import provider-returned copies and verify both destination-namespaced echo receipts remain effective and no duplicate event or fan-out is created.
8. Monitor provider permission/auth/binding errors, binding-check budget exhaustion, upload pending age, unknown/mismatched statuses, FIT-detail recovery, stale queue-revision skips, queue retries/DLQ, route rejection and duplicate codes, echo-suppression counts, fingerprint-write failures, disconnect-pending age, and account-cleanup failures.

## Rollback

Automatic routes remain user-opt-in. If provider errors rise after release, populate the shared COROS route allowlist with approved internal accounts and deploy that narrow rollback while preserving disconnect and status reconciliation for already accepted uploads. A route-entitlement failure should roll back the COROS route UI/callable and Suunto-to-COROS route availability without disabling COROS activity import, sleep, or confirmed activity delivery. Never delete accepted upload IDs or live queue state as a rollback mechanism.
