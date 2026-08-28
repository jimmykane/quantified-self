# Provider Integration Implementation Guide

This document is the durable implementation guide for adding or materially changing a connected provider such as Garmin, Suunto, COROS, or Wahoo. It describes the repository-wide contract rather than any one partner API.

Keep it current in the same change whenever a provider is added, removed, renamed, gains a capability, changes a lifecycle rule, or changes operational support. The root `AGENTS.md` makes that update mandatory.

Use the provider-specific architecture document for exact API behavior and release decisions. [Wahoo integration](wahoo-integration.md) records its scope and launch checklist; [COROS integration](coros-integration.md) records its daily Health mapping, asynchronous upload, route, single-account, echo-suppression, and entitlement decisions; [Suunto 24/7 Health integration](suunto-integration.md) records its metric mapping, bounded pulls, webhooks, lifecycle fencing, production-wide polling, and rollback switch; [Garmin Health integration](garmin-integration.md) records its Health API 1.2.4 family mapping, Ping/Pull trust boundary, callback credential handling, lifecycle fencing, staged rollout, and Summary Resender procedure.

## 1. Define the product contract before writing code

Start with a concise support matrix agreed with product and the provider. Do not infer capability from an OAuth scope alone.

| Question             | Decision to record                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direction            | Import from provider, send to provider, or both. A provider can support different directions for activities, routes, sleep, and plans.                                                    |
| Data types           | Activities, original files, routes, sleep, wellness, device identity, summaries, plans, or another distinct record type.                                                                  |
| Trigger              | Webhook, scheduled polling, user-requested history import, user upload, or a combination.                                                                                                 |
| Plan and entitlement | Free, Pro, admin-only, invite-only, feature-gated, or a combination. Decide separately whether disconnect remains available after entitlement ends.                                       |
| Data retention       | What disconnect removes, what stays in the account, and what account deletion removes.                                                                                                    |
| Partner constraints  | OAuth grant and scopes, redirect URIs, webhook verification, rate limits, pagination order, history range, file availability, retention, file hosts, branding, and production-app review. |
| Failure behavior     | Skip criteria, retryable errors, terminal errors, backoff, user-facing copy, and operational alerts.                                                                                      |

The current providers are intentionally not identical:

| Provider | Current primary role                                                    | Important distinction                                                                                               |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Garmin   | Activity/sleep import, staged Health import, route delivery, and activity delivery to Suunto/Wahoo/COROS | Garmin Health uses one canonical Ping/Pull ingress for Sleep plus ten staged summary families; callback URLs are short-lived credentials and historical Health replay uses Summary Resender. Garmin Connect route delivery requires Course Import permission. |
| Suunto   | Activity/sleep/route import, production 24/7 Health, plus activity and saved-route source/destination workflows | Health independently reconciles Activity, daily statistics, and Recovery for active connected accounts in windows of at most 28 days using signed webhook refetches, bounded polling, and history work. Suunto receives GPX routes; activities can flow to Wahoo/COROS, while saved routes can flow to Garmin/Wahoo/COROS through shared queues. |
| COROS    | Activity plus daily Health/Sleep import; asynchronous activity upload; activity delivery to/from supported providers; direct/saved GPX route delivery | Exactly one active COROS account is used. Daily Health reuses the Sleep poll/history queue, preserves aggregate Sleep through references, and stores bounded detailed HRV in Health. Activity upload is initialized then polled by 64-bit ID. Route push accepts bike/running GPX metadata and is available to eligible connected Pro users through one shared production-wide rollout gate. |
| Wahoo    | Pro activity import, FIT activity delivery, direct GPX/FIT course/route delivery, and opt-in Suunto saved-route delivery | Wahoo imports only FIT-backed Wahoo-recorded workouts; retained Wahoo FITs can sync to Suunto or COROS, while Wahoo accepts activity delivery from Garmin/COROS/Suunto. |

Treat this table as a high-level orientation, not a partner API specification. The public Help content and each `/integrations/<provider>` page define the user-facing supported scope.

## 2. Choose the right architecture

Most activity providers should use the shared asynchronous ingestion pattern:

```text
Provider OAuth / webhook / history request
        -> authenticated Functions ingress
        -> idempotent Firestore queue item
        -> immediate Cloud Task dispatch
        -> scheduled dispatcher safety net
        -> guarded worker and event/original-file persistence
        -> dashboard, exports, and analysis
```

This is preferred over processing partner payloads directly in a webhook or callable because provider requests can be retried, payloads may be incomplete, original files may need another download, and processing can exceed partner timeouts.

Provider health/wellness data uses the separate [unified health foundation](unified-health-data.md):

```text
Provider webhook / polling / history work
        -> provider-specific mapper
        -> shared runtime validation
        -> deletion-guarded revision replacement
        -> bounded source records and sample chunks
        -> shared direct/callable query projection
```

Do not put wellness records into activity events or create a second provider-specific health schema. Keep the existing normalized Sleep model canonical and use the foundation's allowlisted Sleep references when a relationship is needed. COROS is the reference implementation for sharing one provider response between Sleep aggregates and Health daily/sample records without duplicating detailed samples. Suunto is the reference for keeping separately fetched 24/7 Activity/Recovery data distinct from workout FIT and Sleep while reusing a guarded queue worker. Garmin is the reference for accepting an unauthenticated availability ping, resolving unique provider accounts in bounded lookups, durably queueing compact UID-scoped batches of validated provider-hosted callbacks, and performing the authenticated bounded pulls after acknowledgement. When a documented timestamp-keyed feed returns complementary or corrected rows at the same timestamp without a provider revision, merge per metric in provider response order: a later non-null observation may replace an earlier value, but omission or a documented missing sentinel must not erase an available measurement.

Add a provider-specific architecture document under `docs/` when the integration has meaningful protocol, data-flow, rollout, or operational detail. Link it from the Architecture Documentation section of `README.md`; Wahoo is the reference example.

Use the existing provider structure before inventing a parallel abstraction:

- `functions/src/<provider>/constants.ts` owns collection names, service name, endpoint-safe constants, and limits.
- `functions/src/<provider>/auth/` owns the adapter, API wrapper, OAuth callable wrappers, and token handling.
- `functions/src/<provider>/` owns webhook/history ingress, queue storage, processor, file download validation, and provider payload mapping when relevant.
- `functions/src/queue.ts`, `functions/src/tasks/`, and `functions/src/shared/queue-config.ts` provide shared dispatch and worker infrastructure.
- `shared/functions-manifest.ts` owns callable names and regions used by browser and Functions code.
- `shared/provider-presentation.ts` owns display labels, branding variants, and icon keys.

## 3. Foundation and shared contracts

Complete these shared changes early. Exhaustive unions and switch statements are deliberate: they force every cross-cutting surface to acknowledge the provider.

1. Add the provider to `ServiceNames` and provider metadata in `@sports-alliance/sports-lib` when the provider is part of the shared contract.
2. Publish the required sports-lib version before making the application depend on it. Do not leave an application lockfile pointing at an unpublished package version.
3. Add provider labels, source/destination branding, and icon keys to `shared/provider-presentation.ts`. Use source attribution for imported data and destination branding for connection or sending surfaces.
4. Add Function names and the correct region to `shared/functions-manifest.ts`; export every deployed entry point from `functions/src/index.ts`.
5. Add the environment configuration in `functions/src/config.ts`. Match established providers by requiring credentials when the integration runs; add a feature gate only when an explicitly approved staged rollout or operational requirement needs one. Update the configuration table in `README.md` with names only—never values, secrets, or production URLs.
6. Add approved SVG assets and register them through the existing icon/presentation path. Confirm partner brand requirements before release.
7. Add or update Firestore indexes, Rules, Storage Rules, TTL policies, and Firebase configuration only when the provider data model needs them.
8. For health/wellness support, add provider metric mappings to the unified health writer rather than expanding the stable catalog with provider field names. Record native semantics, coverage, quality, and revision behavior explicitly.

## 4. OAuth and provider identity

OAuth is a server-owned integration. The browser starts and completes the user experience, but it must never receive client secrets, access tokens, refresh tokens, or raw provider account mappings.

### Required flow

1. The frontend asks the authenticated callable for an authorization redirect URI.
2. The backend creates signed state that binds the request to the Firebase user and redirect URI.
3. The provider redirects back with either a code or an explicit authorization error. Handle both; do not report a successful connection when access was denied or state/code is incomplete.
4. The backend exchanges the code, fetches the stable provider user identity, verifies entitlement and feature state, and stores credentials only in a server-owned token tree.
5. The browser reads a safe connection-state projection only. It should display connected, reconnect-required, or disconnect-pending status without exposing credentials. A stable provider account ID may be included for display, but tokens and refresh credentials must never be projected.

### Identity rules

- Prefer a stable provider user ID over a display name, email, or mutable device identifier.
- When the provider documents stable identity inside a token returned directly by its authenticated OAuth exchange, normalize the documented claim before persisting credentials. If a legacy top-level response field is also present, require both identities to agree, and require refresh identity to match the retained account before updating either the credential or any server-owned authority binding.
- If one provider account may belong to only one Quantified Self account, use the shared duplicate-token query and cleanup lifecycle unless the provider requires stronger atomic transfer semantics.
- If a provider account may intentionally be shared by multiple Quantified Self accounts, explicitly exempt that provider from cross-user duplicate cleanup and test both OAuth preservation and webhook fan-out for every notification type that uses that identity; Suunto Workout, Route, Sleep, and Health all follow this policy with UID-namespaced queue identities.
- If reconnect-required work is retained for one provider account, pin that provider identity in server-owned connection metadata. Reject an OAuth callback for a different account until the retained connection is explicitly disconnected, and require every inbound, history, and outbound consumer to resolve the same pinned credential rather than selecting an arbitrary token document.
- Assign a server-owned generation when an OAuth flow starts. Claim state and PKCE context once, then require that same flow generation when persisting the exchanged token. A newer authorization attempt and explicit disconnect must invalidate the generation before cleanup, ordering delayed callbacks so they cannot recreate a deleted connection.
- Prefer resolving webhook identity from indexed, server-only token documents when the stable provider ID is stored with the credential. Require exactly one structurally valid match and fail closed on ambiguity. Add a separate mapping only when token-index resolution is insufficient; if a mapping is transferable, verify current ownership before cleanup.
- Never mint server-owned webhook authority from a token or mapping document that the browser can create or mutate. Lock the complete credential root and child subtree before enabling the authority writer. Legacy candidates must prove their stable identity through the provider, and durable bindings must record recognized server authorization provenance; reject and remove provenance-less bindings instead of trusting local shape alone.
- Discover legacy authority candidates only through the canonical server-owned provider root. Use stable keyset pagination rather than numeric offsets, bound both roots and retained children per invocation, record sweep age, and keep failed-candidate backoff independent from the main cursor so one hostile or permanently invalid row cannot starve the migration.
- Recheck connection, pinned provider identity, connection generation, entitlement, deletion, and queue ownership immediately before event persistence. If a provider supports mutable revisions, keep the active processing lease while recording a newer revision so two workers cannot interleave non-atomic event/activity writes. Make the lease longer than the worker runtime, recheck it immediately before persistence, and let the newer revision become dispatchable when the current worker completes. Stage original files outside user-readable paths until all deletion-guarded Firestore writes succeed.
- Treat provider-derived retry, verification, and maintenance metadata as background writes too. After provider I/O, recheck the shared account-deletion guard inside the same transaction as every metadata update; a pre-request check cannot authorize a post-request write during recursive cleanup.
- Use the shared `getServiceAdapter()` factory and `ServiceAuthAdapter` lifecycle. Do not create a provider-specific token refresh path that bypasses shared deauthorization, cleanup, or safe metadata behavior.
- Refresh access tokens only when a provider request needs one, persist rotation safely, and never log token values or signed authorization URLs. The shared `getTokenData()` path takes a transaction-backed lease on the token document before calling a provider refresh endpoint; bound that HTTP request below the lease duration. The lease owner may persist only if the credential snapshot and server-issued credential generation still match and the account-deletion guard remains active; a contender re-reads a winning refresh or retries later, and an expired lease is reclaimable after a crash. OAuth reconnect, disconnect, duplicate-account cleanup, and account deletion must replace, remove, or reject that snapshot atomically so an older worker cannot restore stale credentials.
- Give every connected, reconnect-required, and disconnect-pending transition a new opaque connection-state generation. Terminal credential cleanup must prove the expected generation and absence of a replacement credential in the same transaction that writes reconnect-required state; any later route-disable write must require that same generation and state. This prevents a stale refresh failure from overwriting a successful OAuth callback or disabling routes after reconnection.
- Keep a queue task's OAuth credential generation and connection-state generation immutable from its first lifecycle capture. Ordinary token refresh may update credential timestamps only inside that generation; never rebase old work onto a replacement OAuth snapshot. When token children can outlive a deleted parent document, require the original server-owned token-root generation in every downstream write transaction and deny direct browser creation, update, and deletion of that root.
- When credential generations are introduced after connections already exist, document and test the rollout boundary explicitly. A compatibility path may treat an existing root and child that both omit the generation as one legacy credential, but it must still reject a missing root, a generation on only one side, and unequal generations. Do not perform a blind credential migration or require reconnect when the existing pair can be safely fenced by this exact matching-absence rule.
- When authoritative connection metadata is mirrored into a separate product status such as unified Health, commit a generation-keyed repair marker in the authoritative transition. Require the exact marker claim as part of the derived-write guard, retry it from a bounded scheduler, and clear only that claim after success. A disconnect must transactionally supersede any pending claim while proving the credential root remains absent so an in-flight or delayed connected projection cannot restore stale status; logging and swallowing a partial projection is not a recovery mechanism.
- Keep any provider-specific refresh-failure exception narrow, centralized, and temporary. The current Suunto `400 invalid_grant` exception preserves credentials and retries because Suunto confirmed a provider outage; remove that exception and restore terminal-auth cleanup once Suunto confirms the incident is fixed.

### Security checklist

- Callable Functions require authenticated users, App Check where the shared callable pattern applies, feature gating, and the correct plan check.
- Admin callables use `onAdminCall`; do not make queue or credential controls client-writable.
- Validate redirect URIs from server-generated state, not arbitrary browser input.
- Store OAuth errors in user-safe form and redact tokens, signatures, query strings, and authorization headers from logs and queue error fields.

## 5. Firestore model, Rules, and ownership

Separate state by trust boundary.

| State                            | Typical location                            | Browser access                                                     |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| OAuth access/refresh tokens      | Provider token root and token subcollection | Never readable or writable                                         |
| Optional provider-to-Firebase mapping | Server-owned top-level collection when token-index lookup is insufficient | Never readable or writable                              |
| Safe connection status           | `users/{uid}/meta/<Provider>`               | Owner may read the limited projection; client does not write it    |
| Queue and failed jobs            | Server-owned queue and DLQ collections      | No client writes; admin read only where the Rules model permits it |
| Imported event and original file | Existing event/file model                   | Follow the established event and Storage access model              |
| Imported health source record    | `users/{uid}/healthSourceRecords`            | Owner bounded read; server writes only                              |
| High-resolution health samples  | `users/{uid}/healthSampleChunks`             | Owner bounded read; server writes only                              |
| Safe health sync status         | `users/{uid}/healthSyncState`                | Owner bounded read; server writes only                              |

For every new persistent write path:

- Use the shared Firestore write sanitizer for event/activity documents. Never persist `streams` or top-level `activities` in an event document.
- Validate external payloads defensively. Treat every field as optional or untrusted until normalized.
- Keep provider credentials and signed download URLs out of safe metadata, events, error text, analytics, logs, and admin responses.
- Move user-scoped queue items to a DLQ only in a transaction that rechecks account deletion and the exact live queue revision; otherwise account cleanup or a newer queue payload can be resurrected by an in-flight worker.
- Add Firestore Rules tests proving browser denial for token roots, optional mappings, queues, and backend-owned connection fields, plus owner read access for the safe projection.
- Add indexes deliberately for scheduled scans, queue status, pending disconnect retries, and history leases. Check the emulator and deployed index requirements before launch.
- Use the shared health writer's deterministic opaque provider-account ID, source-record ID, account-scoped source-key hash, and hashed revision token. Never persist the raw provider account ID, raw provider record key or revision token, free-form provider error, or raw provider payload in the unified health collections.
- Let the shared Health writer maintain `maxObservedRevisionOrder` separately from the content revision copied to sample chunks. An identical higher-order delivery advances only that source-record watermark; delayed distinct content below it remains stale, while source/chunk revision identity stays aligned.
- Keep health sample documents and reads strictly bounded. Time-based retention is intentionally uncapped until product/privacy policy explicitly changes it; do not add ad hoc TTL in a provider adapter.

## 6. Ingestion: webhooks, history, and idempotent queues

### Webhooks

- Verify the provider's documented authentication or shared secret before accepting work. Reject malformed and unrelated payloads before queueing. Reject unknown, disconnected, deletion-pending, and non-entitled identities before direct queueing. When a strict acknowledgement deadline requires durable asynchronous fan-out, first bind the request through a bounded indexed server-owned identity lookup and recheck lifecycle state in the ingress transaction; do not retain ingress for unknown or ineligible identities. Unless the integration enforces provider-account uniqueness, retain every eligible match as independent durable work rather than selecting the first owner. Recheck each binding and lifecycle again in the retryable worker before fan-out.
- Resolve provider identity through server-owned credentials or a server-owned direct mapping, never browser-visible metadata. A direct mapping should use a one-way provider-identity key, be updated atomically with credential ownership, and be removed on disconnect and deletion. Do not use a globally limited credential query as webhook authority: unrelated client-writable token documents can consume the limit before structural filtering.
- Treat access/refresh-token rotation within the same credential generation separately from authority replacement. A worker may rebase a failed write guard only after atomically recapturing the live credential and proving that the provider binding, credential generation, root lifecycle, connection generation, and deletion state are unchanged; bound the rebase attempts and leave repeated rotation retryable.
- Revalidate the server-owned identity binding in any worker that maps an embedded webhook payload. This prevents already queued work from retaining authority after a binding is revoked, replaced, or rejected during a provenance migration.
- Treat webhook delivery as at-least-once. Duplicate, delayed, and out-of-order deliveries must not create duplicate events.
- Match the provider's acknowledgement contract exactly. For providers that retry every non-`2xx`, acknowledge authenticated malformed, oversized, unknown, disconnected, deleting, or otherwise permanently skipped deliveries with `2xx`; retry cannot repair them and repeated failures may trip a provider-wide circuit breaker. Authentication failures still fail closed. Reserve retryable `5xx` for a failed identity lookup or durable ingress/dispatch preparation so the provider retries. Keep health-check behavior separate from authenticated delivery handling.
- For strict acknowledgement deadlines, keep the synchronous path to a bounded direct identity lookup plus one idempotent ingress transaction, acknowledge only after the durable create or a deliberate no-write permanent skip, and move queue or Cloud Tasks fan-out to a retryable datastore trigger. Any mapping used as identity authority must already be server-write-only. Deploy Rules, mapping writers/backfill, and the consumer before the producer. Never rely on non-awaited work after returning the response.
- A stable ingress ID deduplicates provider retries but does not identify a Firestore document incarnation across disconnect/reconnect. Bind every asynchronous completion and discard to the original create/update version so a stale trigger cannot mutate a same-ID ingress recreated under a newer lifecycle.
- If provider revisions exist, persist a revision timestamp or version. A newer revision should safely supersede an older queued one; an older delivery must not reopen or overwrite newer work.
- Return quickly. Queue a compact, validated work reference rather than doing file download, parsing, or event persistence in the webhook handler.
- Protect integer-shaped provider IDs before JSON parsing when the API can emit 64-bit numbers. Normalize them to bounded decimal strings and test values above JavaScript's safe-integer limit.

### History imports

- Use the same queue format and processor as webhooks. Separate processing paths drift and create inconsistent duplicate or cleanup behavior.
- Require the appropriate entitlement and connection state at request time, then re-check in the worker.
- Use a per-user lease so duplicate browser clicks, tabs, or retried callables cannot run overlapping history scans.
- Record enough cursor/range state to make failures observable without exposing provider data.
- Confirm the partner pagination order. For descending history, include both selected date boundaries and stop only once records are older than the start boundary. Do not assume API ordering without tests.
- Confirm whether a provider range is made of calendar dates or instants and whether both ends are inclusive. Use one canonical representation end to end, split by the provider's maximum number of included dates, and make adjacent windows non-overlapping. Test timezone boundaries plus one-day, exact-limit, and limit-plus-one ranges.
- Classify provider 429 responses separately and surface reset metadata where available. Do not convert rate limits into rapid retries.

### Queue item design

Queue IDs and imported event IDs must be stable across retries. Prefer provider identity plus stable provider activity/workout ID, with a secondary provider-user identity where collisions are possible.

Queue items generally need:

- Firebase UID and stable provider owner ID;
- provider activity/workout ID and revision/version;
- minimal processing data such as source URL or payload fields needed after the webhook ends;
- stable provider mode/submode, device, timezone, plan/workout, and multipart-component metadata needed for faithful attribution or later detail recovery;
- `processed`, `retryCount`, `dateCreated`, dispatch marker, result/error fields, and TTL expiry;
- lease owner, lease expiry, and revision claim fields where the provider can update the same activity.

Use a transaction for an upsert that can race with another webhook or history page. Claim a revision before processing it. When stable queue IDs allow history to replace an item, give every replacement a new opaque revision and include that revision in both the task identity and payload. Dispatch recovery, the post-enqueue marker, retry/DLQ transitions, deferral, and completion must atomically prove the stored revision still matches. Event persistence needs the same protection: claim a revision-bound lease transactionally, make replacement transactions preserve an active lease, keep competing workers retryable, and release the replacement as undispatched only after the older event/original-file/fan-out sequence ends. Set the lease beyond the worker timeout and verify an expired lease has a durable task retry/reclaim path. A stale task may acknowledge its own delivery, but it must leave the replacement pending for its own task. Reuse the shared workout-dispatch recovery and guarded queue-transition helpers rather than adding unguarded provider-specific writes. Cloud Tasks remains at-least-once, so event persistence and downstream fan-out must remain idempotent even with these lifecycle guards.

Keep stable identity separate from transport data. A short-lived signed file URL must not be part of a new queue or event ID. When a provider offers a detail endpoint, retain the bounded stable request fields needed to recover a missing or expired URL, validate that the returned record/component matches the queue item, and persist only the refreshed queue URL under deletion and revision guards.

### Outbound activity delivery

When a provider accepts activities, use the shared `activity-sync` route model rather than adding a provider-specific fan-out path. Define an explicit `source -> destination` route in `shared/activity-sync-routes.ts`, enable it only from Services, and route historical delivery through the existing date-range backfill callable.

- Make directions explicit. A provider can be a destination without being a source; do not create reverse routes merely because both APIs exist. Wahoo has deliberate Wahoo -> Suunto and Wahoo -> COROS routes because its import path retains native Wahoo FIT files, while Wahoo does not disclose workout summaries that it identifies as third-party-app activity. Document the partner behavior that prevents a reciprocal Wahoo import loop instead of assuming every provider has that protection.
- When a destination can return delivered activities through its import feed, write a deletion-guarded outbound receipt before the provider call. Use destination-namespaced exact-file hashes plus a bounded semantic FIT fingerprint when provider re-encoding is possible. Check receipts before inbound event persistence and fan-out, deny browser access, expire them through TTL, and ensure one file sent to multiple destinations cannot overwrite another destination's receipt. Give each pre-request write an operation ID: roll it back only when a final guard proves no provider request started, and retain it after any request-start boundary because delivery may be ambiguous. Wahoo's third-party import exclusion remains a provider defense, not a substitute for the shared receipt mechanism.
- Deliver the retained original only when its format is accepted by the destination. Do not silently transcode or use a derived event unless the product contract explicitly covers it.
- Recheck source and destination connection, entitlement, disconnect-pending, reconnect-required, deletion, and feature-gate state in the worker. A route setting is not an authorization grant.
- When a provider has a narrowly scoped refresh anomaly, make the first bounded failures durable per-account backoff rather than repeatedly charging shared provider capacity. Reset consecutive-failure state atomically with a successful winning refresh so isolated failures separated by valid rotations cannot accumulate into a false reconnect requirement. If failures become reconnect-required, park unaccepted activity and saved-route deliveries under a guarded queue state; a successful OAuth reconnect clears only that provider's recovery state, restores only route settings that were enabled before parking, and re-dispatches the parked items. Bind the post-token OAuth lifecycle transition to the server-issued credential generation so a stale callback cannot clear or overwrite a newer authorization. Persist route restoration itself as a provider-neutral, connection-generation-bound repair marker. Restore settings first, transactionally close a generation- and credential-bound parking barrier, reconcile every row parked before that barrier against the restored settings, and clear the marker only as the final phase. Workers must treat an open barrier as parkable and a closed barrier as authoritative, so no row can appear behind the release scan. This keeps failures durably retryable and finalizes intentionally disabled routes instead of reopening them. If a separate multi-collection re-dispatch can partially succeed, persist a server-only repair marker and retry it from an existing or dedicated scheduler; never require another OAuth callback to complete the release. Do not silently turn preserved route settings off unless the product contract calls for it.
- Persist a provider-issued asynchronous upload/job identifier as soon as it is issued. When initialization returns an ID before the provider accepts the blob, durably retain the exact server-side continuation required to repeat the same idempotent blob request, and make that guarded state write succeed before sending any blob bytes. A state-write failure must abort the PUT. Subsequent queue workers repeat that same request when delivery is uncertain and then poll the same identifier; they must never initialize a replacement job. Keep signed URLs and headers only on the live admin-only queue row, clear them on completion, and exclude them from logs and DLQ copies. Direct callable upload flows must return opaque resume identifiers in retryable errors and check the same job first. A direct flow without a persisted signed continuation must keep polling that job when the provider reports `NEW`, because `NEW` can also describe an accepted blob that is still processing; starting a fresh direct upload must be an explicit user action rather than an automatic retry.
- Normalize terminal states into the shared result contract: success, duplicate-as-success, retryable pending/rate-limit/outage, skipped auth/scope problem, or a sanitized terminal failure. Do not log raw provider payloads or source files; for operator diagnosis, log only the HTTP status and a length-bounded, allowlisted provider error message. Some providers, including Wahoo, report an exact duplicate as an asynchronous terminal status; handle that as success rather than a failed retry.
- A documented accepted-but-pending job status is not a Cloud Task failure. Persist the job ID, consume a bounded polling budget, durably record the next poll due time, acknowledge the current task, and enqueue a status-only poll with the configured retry/backoff cadence. The reconciliation scheduler must honor that due time rather than starting an immediate duplicate, page past future scheduled polls so they cannot starve newer work, and ensure a retry before that time reuses the same scheduled task rather than performs an early provider poll. Emit an info-level structured poll-scheduled log. Scheduler or transport failures, exhausted polling, and terminal provider rejection must remain warning/error paths.
- Classify destination failures at the provider boundary with `ProviderOperationError`. The adapter owns provider-specific HTTP, job-status, and message interpretation; shared queue workers consume only its disposition (`retryable`, `permanent`, `auth_required`, or `permission_required`) and retry mode (`resume`, `restart`, or `none`). Do not add provider message matching to a shared worker except as an explicitly temporary compatibility rule for already-deployed behavior.
- Preserve the provider phase boundary. A typed retry decision applies only while the provider request is in progress. Once the provider confirms success, a later metadata or queue write failure must not be reclassified as a provider failure. Prefer a durable acceptance receipt, DLQ record, or terminal manual-reconciliation marker before acknowledging accepted work. When a direct provider call needs an outbound-echo receipt, write it as an operation-scoped provisional claim, promote it only after the final account/lifecycle guard and immediately before provider I/O, and roll back only that claim if no request starts. Echo detection must require the promoted marker; concurrent rollback must never delete another operation's accepted receipt. Keep the terminal live marker without a TTL when work is copied to DLQ, and reject both automatic and manual re-enqueue until an operator has reconciled and explicitly cleared that marker. The DLQ audit copy may retain its normal TTL. If every Firestore persistence path is unavailable, leave the durable provider-operation claim untouched and fail the Cloud Task. A later delivery must reconcile or DLQ that stale claim without repeating the provider request. Retry exhaustion must retain the provider-specific DLQ context for diagnosis. Side effects derived from provider success, such as per-service upload counters, must use the durable queue item or provider operation ID as an idempotency record so completion retries cannot count the same upload twice. Treat a supposedly completed asynchronous response without its required provider operation ID as a terminal provider-contract failure rather than retrying the original non-idempotent request.
- If authentication is lost while polling an already accepted asynchronous upload, retain the provider operation ID and fail closed into manual reconciliation. Do not downgrade accepted work to an ordinary reconnect skip that can later be manually replayed.
- A direct browser file upload is a separate product path. State whether it creates an event or route. Wahoo direct activity delivery intentionally accepts FIT only and retains only the short-lived browser row/upload token needed to show status. Wahoo direct course/route delivery accepts FIT and GPX sources, converts GPX to FIT in memory because Wahoo receives FIT courses, makes a server-side idempotent route-library request using the source-file fingerprint, and does not create or retain a Quantified Self route. Saved-route delivery is distinct: Suunto routes already saved in Quantified Self flow through the shared route-delivery queue and use the saved-route ID as a stable opaque Wahoo external key, so revisions update rather than duplicate the provider route. Bound both source and converted output, and define conversion limits such as one route with valid coordinates.
- Suunto FIT activity delivery currently uses a temporary provider-protection circuit breaker: the shared upload adapter checks an issued upload at most five times and spaces repeated status checks by ten seconds, while the direct callable accepts one request at a time on one instance. Keep this conservative bound until direct delivery moves to a dedicated rate-limited queue with asynchronous pending responses; do not raise it without a measured provider allowance.

Apply the same typed failure contract to queued saved-route delivery. Provider adapters should map 408, 429, and safely repeatable update failures to retryable outcomes; explicit content or validation rejection to permanent outcomes; and auth/scope failures to skipped outcomes. Keep any provider job or external route identifier needed for idempotent resume/update behavior. Persist each provider acceptance before continuing a multi-account direct delivery batch, but mark it partial until every account has been attempted. A stale partial receipt must fail closed for reconciliation rather than being finalized as complete or replayed. When a provider lacks a stable create key or duplicate-reconciliation endpoint, an ambiguous create timeout or transport failure must fail closed for operator reconciliation rather than automatically creating a possible duplicate; do not add a second adapter-level retry loop.

### Direct manual route delivery formats

The shared Services uploader accepts **GPX and FIT** source routes for every current route destination. The browser sends the selected source unchanged; Functions parses it and produces the destination representation in memory. Never put provider conversion logic in the browser, and never infer the output format from the source extension alone.

| Destination | Accepted source | Destination representation | Retention and retry behavior |
| ----------- | --------------- | -------------------------- | ---------------------------- |
| Wahoo | GPX, FIT | FIT course; GPX is exported to FIT | Does not create a Quantified Self route. Source-file fingerprint is the external ID, so a retry updates the same Wahoo route. |
| Suunto | GPX, FIT | Fresh GPX route generated from the parsed source | Does not create a Quantified Self route. Keep compatibility for older browser clients that gzip GPX before calling Functions. |
| Garmin Connect | GPX, FIT | Garmin Course Import JSON built from parsed route geometry | Does not create a Quantified Self route or delivery metadata. A repeat direct upload creates another Garmin course; saved-route sends use delivery metadata and update the existing course. |
| COROS | GPX, FIT | Fresh GPX plus COROS bike/running metadata | Available to eligible connected Pro users. Does not create a Quantified Self route. Direct, saved, and Suunto route delivery share the same empty production allowlist so an operational rollback remains possible. A deterministic partner user ID avoids exposing the Firebase UID; deterministic revision IDs make exact repeats duplicate-safe. Cycling-family routes map to bike and all other/missing types to running. |

Apply the same request controls to every destination: authenticated App Check callables, Pro entitlement, explicit FIT/GPX filename allowlist, strict base64 decoding, a 20 MB source limit (including legacy gzip expansion), parsed-route validation, converted-output limit where an output file is generated, deletion/disconnect guards, and sanitized provider errors. Make the route format and retention behavior visible in Services, Help, privacy policy, and the public integration page.

OAuth scope changes are migrations. Request the full supported scope for new connections, enforce the specific write scope immediately before outbound calls, and show existing users a clear reconnect action. Wahoo's direct and saved-route flows need both `routes_read` (idempotency lookup) and `routes_write` (create/update); its direct activity flow needs `workouts_write`. Do not mark a read-only connection as generally disconnected when inbound imports remain valid.

When product behavior specifies a single active provider account, centralize token selection in one server helper and use it for imports, polling, history, direct uploads, shared workers, and route delivery. Pin the stable provider ID in safe connection metadata, use one deterministic migration choice for legacy multi-token roots, and fail closed if the pinned token disappears. A browser-only selection rule is insufficient.

## 7. Worker, original files, and event persistence

The worker is the final safety boundary. It should be safe to execute repeatedly and must expect the connection or user to have changed since ingestion.

Before each irreversible action, use `functions/src/shared/user-deletion-guard.ts`:

1. before queue insertion;
2. before a worker makes provider requests or refreshes credentials;
3. immediately before event/original-file persistence;
4. inside transactions that write queue completion, history lease, or other follow-up state.

Also stop work when the provider is disconnected, reconnect-required, or disconnect-pending. A disconnect that starts mid-job must not result in a new import.

### Downloading provider files safely

Provider file URLs are external input even if they came from an authenticated partner API. The Wahoo and COROS implementations use the shared defensive pattern for a safe FIT download path; each keeps its own provider-host policy and provider-specific response handling. Prefer exact hosts. When a provider contract returns rotating CDN distribution names, a provider CDN suffix is acceptable only with a provider-specific path constraint and the controls below:

- require HTTPS;
- reject credentials in URLs, IP literals, localhost, private targets, and unapproved redirect targets;
- allowlist exact provider-owned hosts, or a narrowly scoped provider CDN suffix plus its expected path shape, through configuration;
- enforce a request deadline and, when the provider documents a safe maximum, a byte limit;
- validate response type and file magic bytes before parsing;
- never persist or log the full signed URL.

Treat a successful HTTP status as transport success, not proof that a provider file is ready. Normalize only recognized wrappers and validate the complete FIT envelope—including its declared length—before invoking Sports Lib. Apply a decoded-body limit when the provider contract documents a safe maximum; do not invent one that could reject valid activity files. A provider-specific incomplete or placeholder response should remain retryable with a distinct exhausted-retry DLQ context. Diagnostics may retain only structural facts such as byte length, an allowlisted content-type category, and validation reason; never retain or log the response body. If a structurally valid FIT parses without a session, retry only when provider evidence supports a narrowly bounded not-ready case (for Suunto, a suspiciously small response); keep ordinary full-sized sessionless files terminal so permanent corruption does not consume the retry budget.

Suunto FIT downloads in the queued sync worker use a 60-second provider deadline without a decoded-body cap because its contract does not establish a safe maximum. That worker has a 540-second runtime, leaving time for sanitized error handling after an abort.

Do not use a provider's short-lived file URL as durable application data. Download it in the worker, validate it, and store the original file through the existing event/file flow so reprocessing, export, and sync use the owned copy.

### Persisting events

- Resolve a deterministic event ID before writing. Put provider identity fields in safe event metadata for future deduplication and attribution.
- Preserve normalized provider metadata that has durable meaning—such as mode/submode, device, source timezone, plan/workout ID, and multipart component identity—without retaining ephemeral URLs or raw partner payloads.
- Call the shared event persistence path rather than hand-writing an alternate event document schema.
- Recheck deletion immediately before the write; a check only at the beginning of a long FIT parse is insufficient.
- Mark the exact claimed queue revision complete only after event persistence succeeds. On errors, sanitize the error, increment retries atomically, and move terminal work to the existing DLQ/TTL model.

## 8. Lifecycle: disconnect, entitlement, deletion, and cleanup

Every new provider needs a lifecycle plan before it is enabled.

### Disconnect

1. Start provider deauthorization when the partner supports it.
2. If the partner call fails transiently, record the shared disconnect-pending state and pause new work rather than pretending the connection is gone.
3. Keep disconnect available even when a formerly-Pro user no longer has entitlement.
4. Use the scheduled pending-disconnect retry workflow; add the provider token root to its collection configuration.
5. When cleanup runs, recursively remove provider token subtrees and feature-owned operational state, including every ingress/source queue, its DLQ copies, optional mappings, history leases, and pending disconnect state. Workers must also recheck the exact source connection before unchanged-item shortcuts, inside any persistence transaction that follows provider I/O, and immediately before downstream fan-out, because cleanup can race already-running work. Pass the originally captured lifecycle fence into persistence rather than recapturing after I/O, and remove any newly uploaded external object when the guarded transaction rejects while preserving the prior committed object. If external-object deletion can fail, transactionally persist a backend-only, deletion-safe reservation containing the exact object path before uploading anything; do not upload if that write fails. Treat a rejected external-object write as ambiguous: keep its original delayed reservation even if an immediate delete reports success, because the write can become visible afterward. Lease active reservations beyond the worker timeout, make cleanup idempotent, path-bounded, and aware of any object that later became committed, and provide a recurring bounded re-drive in addition to finite event retries. Put deletion-surviving cleanup state outside the recursively deleted user subtree, deny browser access, and make account cleanup invoke the same reconciler without deleting an active lease. Do not use TTL for unresolved reservations. Carry that lifecycle into downstream queue rows, recheck it in the queue-admission transaction, and recheck it when the downstream worker claims and performs the irreversible provider operation. If a rollout introduces strict lifecycle generations for legacy credentials, backfill them only after server-side provider verification or from an existing provider-authorized binding; update that binding atomically, preserve every existing nonempty generation, and never promote legacy token-tree contents as authority by themselves.
6. Assign each pending-disconnect episode an opaque generation and copy it to every parked queue row. Parking must transactionally recheck the authoritative token-root state. Release must transactionally prove that the token root has no live pending episode; once clear, it should reopen every older parked generation for that service. This lets a newer live episode block a stale clear without leaving rows from an earlier episode stranded after the authoritative state is eventually cleared.
7. Carry both the disconnect-episode generation and active OAuth credential generation through provider cleanup. Recheck them immediately before provider deauthorization, inside local credential deletion, and again before recording a retry failure so stale disconnect work cannot disable or delete a newly authorized connection.
8. Capture subscription-enforcement token queries and their token-root generation in one read transaction. Bind each local deletion to both that lifecycle generation and the captured token document version, falling back to an exact credential snapshot only when version metadata is unavailable. This includes same-document replacements.

Scheduled cross-user repair scans must use bounded ordered pages, durable cursors, and bounded concurrency. A partial repair marker is intentionally idempotent: advancing past a failed row may delay it until cursor wraparound, but must never make it unreachable.

If the provider exposes a binding/status endpoint, check it server-side when the browser opens the connection overview rather than trusting token-document presence. Project only a safe checked state and timestamp. An authoritative unbound response should atomically mark reconnect-required and disable every automatic route involving that provider after proving the credential and account are still current; a timeout, malformed response, or stale result must leave connection state unchanged and offer a retry. Browser request coalescing is not provider-quota protection: reuse recent results server-side, claim a short per-account in-flight lease before the upstream call, and enforce or monitor an aggregate provider budget. The response write must still own that lease and match the credential/account revision. Reject exhausted capacity before the provider call, emit structured saturation logs, and leave a short backoff lease after provider failures.

### Subscription enforcement

If a provider is Pro-only, add it to the scheduled entitlement scan and its token-root discovery. Decide whether an entitlement restoration clears a pending disconnect or requires a fresh user connection; document the result in the provider-specific guide and Help content.

### Account deletion

Account deletion is not merely token deletion. Add provider identity discovery and recursive cleanup for all feature-owned top-level state, including queue items, DLQ records, optional mappings, leases, and scheduler cursor/checkpoint documents when keyed by user. The deletion tombstone is the durable signal; missing user roots alone are not enough.

Existing imported events are product-policy decisions. State explicitly whether disconnect, entitlement expiry, and account deletion each retain or remove them. Wahoo retains imported events on disconnect but removes account-associated data on account deletion.

Unified health history is retained on provider disconnect and removed on account deletion. Its collections live below `users/{uid}`, so the configured recursive extension owns account cleanup; provider adapters must not delete historical health source records during ordinary deauthorization.

## 9. Frontend, help, public pages, and attribution

The frontend should reuse the Services and provider-presentation patterns rather than create a one-off integration page.

### Required product surfaces

- Add the provider to `ServicesComponent`, its navigation order, connection-state map, query-param selection, and focused tool-dialog switch.
- Create or adapt a provider service component using `ServicesAbstractComponentDirective`. Keep connection summary and advanced tools compatible with the dialog contract (`showConnectionSummary`, `showAdvancedTools`, `activeProviderTool`, and `showOnlyActiveProviderTool`).
- Show connection, reconnect, disconnect-pending, locked/Pro, loading, and history states accessibly. Upsell actions must be actual buttons, not a click handler on a non-interactive panel.
- Add the provider to `AppUserService`, source icons, dashboard prompts only when relevant, and shared provider presentation helpers.
- Add/update `/integrations/<provider>` when it has product/search value. Update route metadata, server prerender routes, sitemap/robots, internal links, the integrations hub, public Help, policies, and tests together.
- State supported and unsupported workflows plainly. Do not imply that a connected provider supports routes, sleep, uploads, or provider-to-provider sync when it does not.

Use `app-service-source-icon` and the shared presentation helpers. Imported activity surfaces use source attribution; connection and destination surfaces use destination branding. See [connected-provider attribution audit](connected-provider-attribution-audit.md).

## 10. Admin and operational coverage

Provider parity includes operational visibility, not only a user-facing connection.

### Required current admin parity

- Add the provider queue collection to `getQueueStats` so the Queue Monitor reports pending, succeeded, stuck, dead-letter, retry-bucket, throughput, and lag statistics.
- Include its queue collection in ingestion DLQ analysis and error clustering.
- Add the provider token root to admin user filtering and user enrichment so admins can filter connected users and see the connection date.
- Add the provider logo to Admin User Management and Queue Monitor.
- Keep all these functions under the existing admin callable authorization. Never expose raw token or queue data to normal users.

The current admin UI is aggregate observability. It does not provide provider-specific inspection, replay, or requeue actions for the normal activity-ingestion queues. Do not add a Wahoo-only manual retry control without defining an equivalent safe, audited queue-operation model for every provider it should cover.

### What to monitor after release

- OAuth starts, callback failures, provider denial/cancel rates, duplicate or ambiguous provider identities, and token-refresh failures;
- webhook authentication failures, accepted/skipped payloads, duplicate/superseded revisions, and history lease collisions;
- queue depth, age/lag, retries, stuck work, DLQ growth, and Cloud Task dispatch failures;
- provider 429s, pagination errors, signed-file download rejects, timeouts, parsing failures, and original-file retention failures;
- disconnect-pending age, deauthorization failures, entitlement enforcement, and cleanup/deletion failures.

Use structured logs with safe identifiers and error categories. Do not put token values, authorization codes, signed URLs, file query strings, or full raw partner payloads in logs, analytics, or admin responses.

## 11. Test plan

Add deterministic tests next to the code being changed. The minimum set for an activity-import provider is below; add cases for every provider-specific rule.

| Area             | Required assertions                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts | Service enum/metadata, provider presentation, source icon, function manifest, and required configuration validation (plus any explicitly approved rollout gate).                                  |
| Health/wellness  | Native/canonical semantics, source attribution, coverage, missing-data behavior, ordered revision replacement, bounded chunks/queries, conflict preservation, Sleep references, disconnect retention, and deletion guards. |
| OAuth            | State binding, approved redirect, explicit provider denial, incomplete callback, token refresh/rotation, stable identity, duplicate handling, and disconnect after entitlement expiry.             |
| API boundary     | Request timeout, input normalization, pagination, rate-limit mapping, secret redaction, and no unsafe retry behavior.                                                                           |
| Webhook/history  | Health and delivery acknowledgement, authentication, entitlement/connection/deletion rejection, lossless 64-bit IDs, deterministic IDs, duplicate delivery, out-of-order or newer revision, inclusive/date-window boundaries, skip rules, and lease contention. |
| File worker      | Allowed host/redirect checks, unsafe URL rejection, size/type/FIT validation, missing/expired URL detail recovery, metadata preservation, timeout, retry/DLQ behavior, and original-file persistence. |
| Lifecycle        | Disconnect pending/retry, entitlement enforcement, cleanup ownership races, recursive deletion, and account deletion guards before every write.                                                 |
| Rules            | Token/queue client denial, optional-mapping denial, and safe owner metadata read.                                                                                                               |
| Frontend         | Provider navigation, query selection, server-verified connection states and retry behavior, focused tool dialog, Pro and keyboard-accessible upsell behavior, help, policies, integration page, route metadata, sitemap, and logo. |
| Admin            | Queue stats inclusion, user filter/enrichment, labels/logos, and existing admin authorization.                                                                                                  |

Run the narrowest tests after each edit round, then run the relevant builds before handoff:

```bash
# Frontend
npx vitest run <affected-frontend-specs> --reporter=verbose

# Functions
npm --prefix functions test -- <affected-functions-specs>
npm --prefix functions run build

# Firestore and Storage Rules
npm run test:rules

# Application build
npm run build

# sports-lib, when its shared provider contract changed
npm --prefix ../sports-lib test -- --runInBand <affected-sports-lib-specs>
npm --prefix ../sports-lib run build
```

Run commands from the appropriate checked-out worktree. Do not deploy, publish, or push as part of implementation verification.

## 12. Release and rollback checklist

1. Verify the provider agreement, production review, privacy terms, allowed scopes, redirect URIs, webhook registration, exact file hosts, and brand assets.
2. Publish required shared-library changes first, then update application lockfiles to the published version and verify a clean install resolves it.
3. Add production configuration through the approved secret/configuration process. If an explicitly approved staged rollout uses a feature gate, keep it disabled until all code, Rules, indexes, TTL policy, queues, and hosting artifacts are ready.
4. Deploy through the normal release workflow in dependency order. Exercise sandbox or test-account OAuth, webhook, history, revision deduplication, rate limiting, disconnect, expired entitlement, and account deletion.
5. Watch the operational signals above before broad enablement. Enable gradually only when the provider has an intentionally implemented staged rollout.
6. Define rollback before launch. If an approved feature gate exists, it should stop new connections, webhooks, and history requests without deleting existing user data or blocking disconnect. Decide whether accepted queue work drains and document that behavior.

## 13. Pitfalls to avoid

- **Treating OAuth as the integration.** OAuth only grants access; stable identity, safe storage, refresh, webhooks/history, worker behavior, cleanup, and product scope still need implementation.
- **Processing partner requests inline.** Webhooks and callables can be retried or time out. Queue durable work and process asynchronously.
- **Using timestamps or titles as identity.** Activity names and start times can change or collide. Use stable provider IDs and revision data.
- **Assuming pagination order or date semantics.** Test inclusivity, timezone, order, page termination, and rate-limit behavior with partner-shaped payloads.
- **Storing an ephemeral signed file URL.** Validate and download it promptly, then retain the owned original file; never log the signed URL.
- **Trusting a partner URL.** Defend against SSRF, redirects, private addresses, oversized responses, invalid content, and unbounded requests.
- **Checking account deletion only at ingress.** Deletion can begin during download or parsing. Guard before enqueue, processing, persistence, and transactional follow-up writes.
- **Deleting a root document non-recursively.** Token roots and feature state can have subcollections. Use `recursiveDelete` for subtree-capable cleanup.
- **Copying Sleep or flattening provider health into one preferred value.** Keep `sleepSessions` canonical, reference allowlisted aggregates, preserve every source observation, and make any future source-selection policy explicit.
- **Making disconnect dependent on Pro.** Users must be able to revoke access after their plan changes. Separate connect/import authorization from disconnect authorization.
- **Giving the client access to useful-looking operational fields.** Token roots, optional mappings, queues, retry state, and disconnect controls are backend-owned even when the browser shows a connection badge.
- **Adding only the service card.** A provider is incomplete without help, policies, integration page/SEO where appropriate, attribution, Rules, admin visibility, cleanup, and tests.
- **Adding an admin action without an operation model.** Aggregate monitoring is safe by default. Manual retry/replay must define authorization, idempotency, deletion checks, auditability, rate limits, and cross-provider parity.
- **Forgetting deployment order.** A released app must not depend on an unpublished sports-lib version, missing Cloud Task queue, missing index, missing Rules deployment, or unregistered webhook/redirect URI.
- **Letting the guide drift.** Update this guide and the provider-specific document whenever a capability, provider list, lifecycle rule, admin surface, or release requirement changes.

## Change checklist

Use this checklist in every provider integration PR or implementation handoff:

- [ ] Product scope and unsupported behavior documented.
- [ ] Partner/API, privacy, retention, and launch constraints recorded.
- [ ] Shared service/presentation/manifest/config contracts updated.
- [ ] OAuth, stable identity, server-only storage, and safe metadata implemented.
- [ ] Webhook/history ingress is authenticated, idempotent, revision-aware, and rate-limit aware.
- [ ] Worker validates external files, retains originals, uses deterministic event IDs, and sanitizes writes/errors.
- [ ] Queue dispatch, TTL, retry/DLQ, and scheduled safety net are wired.
- [ ] Disconnect, entitlement, pending retry, account deletion, and recursive cleanup cover every owned collection.
- [ ] Firestore/Storage Rules, indexes, TTL, configuration, and any approved feature gate are reviewed.
- [ ] Health/wellness mappings use the unified model, bounded writer/query contracts, source-aware conflicts, and Sleep references without duplicating Sleep data.
- [ ] Services UI, accessibility, icons, source/destination labels, Help, Policies, public integration page, metadata, sitemap, and internal links are updated as applicable.
- [ ] Admin queue stats, DLQ analysis, user filtering/enrichment, and logos are updated.
- [ ] Unit, Rules, frontend, admin, shared-library, and build verification passed.
- [ ] Provider-specific architecture/release document and this guide were updated.
- [ ] Rollout, monitoring, and rollback plan are written before enabling production traffic.
