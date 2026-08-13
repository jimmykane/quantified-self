# COROS Integration

COROS is a Pro-only activity, sleep-summary, activity-delivery, and route-delivery integration. Quantified Self imports COROS activity/history data, polls supported sleep summaries, sends retained FIT activities in explicitly configured provider directions, uploads selected FIT activities, and sends direct or saved GPX/FIT routes to COROS.

This is the COROS-specific architecture and release record. For shared provider requirements, see the [provider integration implementation guide](provider-integration-guide.md).

## Supported scope

- OAuth 2.0 connection and refresh using the COROS `openId` as the stable provider identity.
- One active COROS account per Quantified Self user. New OAuth connects pin the account in safe service metadata. Legacy multi-token roots select the most recently refreshed token deterministically and pin it on first server use; a missing pinned token fails closed and requires reconnect.
- Recent COROS activity-history import within the provider's rolling three-month limit.
- Daily sleep-summary polling plus a user-requested three-month sleep backfill in 30-day windows, subject to the existing cooldown. COROS does not supply sleep stages through this integration.
- Direct FIT activity delivery with asynchronous provider status polling.
- Automatic and date-range FIT activity delivery from Garmin, Suunto, or Wahoo to COROS through the shared activity-sync queue.
- Existing COROS-to-Suunto and COROS-to-Wahoo automatic/date-range activity routes.
- Direct GPX/FIT route delivery from COROS Services without creating a saved Quantified Self route.
- Saved-route delivery from the Routes row action, selected-row bulk toolbar, and route detail.
- Opt-in automatic and backfill delivery of Suunto routes already saved in Quantified Self to COROS through the shared route-delivery queue.

Every automatic activity and saved-route direction is off by default. Empty rollout allowlists make the routes available to all eligible Pro users; a user must still connect both services and explicitly enable each direction. A date-range or saved-route backfill does not turn on future delivery.

## Account identity

All COROS imports and deliveries resolve the same active token through `functions/src/coros/account.ts`.

1. If `users/{uid}/meta/COROS API.providerUserId` exists, only that exact `openId` token is accepted.
2. If legacy metadata is not pinned, tokens are ordered by `dateRefreshed`, then `dateCreated`, then document ID, all descending.
3. The selected `openId` is persisted through the deletion-safe service-metadata writer before it is used.
4. Once pinned, a missing or mismatched token never falls back to another COROS account.

COROS route multipart requests require a partner-platform `openUserId`. Quantified Self derives a stable 128-bit, provider-scoped digest from the Firebase UID rather than sending the UID itself. The value is stable for a Quantified Self account but cannot be used as a browser credential.

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

## Echo suppression

Provider-to-provider activity delivery can otherwise return through a destination's import feed and start a loop. The shared outbound fingerprint mechanism runs for every activity destination, not only COROS:

1. Before provider delivery, compute an exact SHA-256 file fingerprint.
2. When the FIT can be parsed, also compute a semantic fingerprint from bounded event/activity start, end, type, duration, and distance fields. This tolerates provider re-encoding that changes file bytes without changing the activity.
3. Persist both receipts under `users/{uid}/activitySyncOutboundFingerprints`, namespaced by destination so the same FIT can be sent to multiple providers without one receipt overwriting another.
4. Abort provider delivery if the deletion-guarded receipt transaction fails.
5. During COROS or Suunto queue processing, check the downloaded original before event persistence. A matching, unexpired receipt for that source provider marks the inbound queue item processed without writing an event or starting another fan-out.

Receipts contain hashes, destination identity, timestamps, and TTL metadata—not the activity file. Browser access is denied. They expire after 120 days through Firestore TTL and are also removed by recursive account deletion. Wahoo independently omits third-party-app workouts from its import API, while the shared receipt still protects outbound deliveries consistently.

## Route delivery

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

- Access/refresh tokens remain in the server-only `COROSAPIAccessTokens` tree. The browser receives only safe connection metadata and token projections already permitted by the existing connection UI.
- Callables require authentication, App Check, and Pro access. Disconnect remains available after entitlement ends.
- Activity and route providers are called only after account-deletion and disconnect-pending checks; the checks repeat immediately before the provider request.
- Token refresh retries once after a terminal COROS authentication signal. A changed or missing active account fails closed.
- Multipart values remove CR/LF characters, names are bounded, source/generated files and provider payloads are never logged, and provider errors are reduced to allowlisted messages and typed dispositions.
- Activity fingerprints, queue state, service metadata, and provider tokens live under existing recursive account-deletion ownership. Browser Rules explicitly deny fingerprint access.

## Firestore and deployment dependencies

The implementation adds no new COROS credential secret. It reuses `COROSAPI_CLIENT_ID` and `COROSAPI_CLIENT_SECRET`.

`activitySyncOutboundFingerprints.expireAt` requires the Firestore TTL field override in `firestore.indexes.json`; the collection's hash/routing fields have automatic indexes disabled. Deploy indexes and Rules before Functions and Hosting so receipt writes and browser denial are active before users can start delivery.

The new callable exports are:

- `importActivityToCOROSAPI` (updated asynchronous contract);
- `getCOROSAPIWorkoutFileUploadStatus`;
- `importRouteToCOROSAPI`.

The existing shared activity-sync and route-delivery backfill, dispatch, worker, token-delete trigger, route-send, and inbound COROS queue functions also contain changed behavior and must be included in the normal Functions deployment rather than deploying only the three callable names.

## Release checklist

1. Confirm the production COROS partner application has activity-file upload and route-push entitlement. A controlled non-destructive activity probe on 2026-08-13 reached COROS application-level validation (`5096`, unsupported file) rather than permission denial (`30009`), confirming activity-upload access at that time. Route entitlement has not yet been validated and remains a pre-deployment launch gate.
2. With a dedicated test account, send one valid FIT activity and poll the same upload ID to terminal success; repeat it and verify duplicate-as-success without a second event.
3. Send one small valid GPX route to production only after confirming the route test is authorized. Stop the release if COROS returns HTTP 403 or result `30009`; do not broadly expose route controls until the partner enables that permission.
4. Deploy Firestore indexes/TTL and Rules, then Functions, then Hosting through the normal release workflow. Do not use implementation work as deployment approval.
5. Exercise direct FIT activity upload/status, each source-to-COROS automatic route, all date-range backfills, COROS-to-Suunto/Wahoo routes, direct GPX/FIT route upload, saved-route row/bulk/detail sends, Suunto route automatic/backfill delivery, duplicate handling, reconnect, disconnect-pending, expired-Pro, and deletion races.
6. Send the same test FIT to both COROS and Suunto, then import provider-returned copies and verify both destination-namespaced echo receipts remain effective and no duplicate event or fan-out is created.
7. Monitor provider permission/auth errors, upload pending age, unknown/mismatched statuses, queue retries/DLQ, route rejection and duplicate codes, echo-suppression counts, fingerprint-write failures, disconnect-pending age, and account-cleanup failures.

## Rollback

Automatic routes remain user-opt-in. If provider errors rise after release, disable new route settings in the shared rollout configuration and deploy that narrow rollback while preserving disconnect and status reconciliation for already accepted uploads. A route-entitlement failure should roll back the COROS route UI/callable and Suunto-to-COROS route availability without disabling COROS activity import, sleep, or confirmed activity delivery. Never delete accepted upload IDs or live queue state as a rollback mechanism.
