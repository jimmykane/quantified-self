# Provider Integration Implementation Guide

This document is the durable implementation guide for adding or materially changing a connected provider such as Garmin, Suunto, COROS, or Wahoo. It describes the repository-wide contract rather than any one partner API.

Keep it current in the same change whenever a provider is added, removed, renamed, gains a capability, changes a lifecycle rule, or changes operational support. The root `AGENTS.md` makes that update mandatory.

Use the provider-specific architecture document for exact API behavior and release decisions. For example, [Wahoo integration](wahoo-integration.md) records the Wahoo scope, endpoint assumptions, and launch checklist.

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
| Garmin   | Activity and sleep import, route delivery, and activity sync to Suunto/Wahoo | Garmin Connect is the destination label; its permissions and asynchronous history delivery need dedicated handling. |
| Suunto   | Activity, sleep, and route import; route/activity destination workflows | Supports both import and destination workflows, including activity delivery to Wahoo.                               |
| COROS    | Activity and sleep import, activity upload, and activity sync to Suunto/Wahoo | History range and partner API constraints differ from Garmin and Suunto.                                            |
| Wahoo    | Pro-only activity import through webhook/history and FIT activity delivery | Wahoo imports only FIT-backed Wahoo-recorded workouts; it accepts direct FIT and selected source-event delivery.     |

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

## 4. OAuth and provider identity

OAuth is a server-owned integration. The browser starts and completes the user experience, but it must never receive client secrets, access tokens, refresh tokens, or raw provider account mappings.

### Required flow

1. The frontend asks the authenticated callable for an authorization redirect URI.
2. The backend creates signed state that binds the request to the Firebase user and redirect URI.
3. The provider redirects back with either a code or an explicit authorization error. Handle both; do not report a successful connection when access was denied or state/code is incomplete.
4. The backend exchanges the code, fetches the stable provider user identity, verifies entitlement and feature state, and stores credentials only in a server-owned token tree.
5. The browser reads a safe connection-state projection only. It should display connected, reconnect-required, or disconnect-pending status without exposing credentials.

### Identity rules

- Prefer a stable provider user ID over a display name, email, or mutable device identifier.
- If one provider account may belong to only one Quantified Self account, enforce the mapping atomically in a Firestore transaction.
- Store the mapping separately from credentials when webhook resolution needs it. Verify current ownership before deleting a mapping; another connection may have claimed it while cleanup was in flight.
- Use the shared `getServiceAdapter()` factory and `ServiceAuthAdapter` lifecycle. Do not create a provider-specific token refresh path that bypasses shared deauthorization, cleanup, or safe metadata behavior.
- Refresh access tokens only when a provider request needs one, persist rotation safely, and never log token values or signed authorization URLs.

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
| Provider-to-Firebase mapping     | Server-owned top-level mapping collection   | Never readable or writable                                         |
| Safe connection status           | `users/{uid}/meta/<Provider>`               | Owner may read the limited projection; client does not write it    |
| Queue and failed jobs            | Server-owned queue and DLQ collections      | No client writes; admin read only where the Rules model permits it |
| Imported event and original file | Existing event/file model                   | Follow the established event and Storage access model              |

For every new persistent write path:

- Use the shared Firestore write sanitizer for event/activity documents. Never persist `streams` or top-level `activities` in an event document.
- Validate external payloads defensively. Treat every field as optional or untrusted until normalized.
- Keep provider credentials and signed download URLs out of safe metadata, events, error text, analytics, logs, and admin responses.
- Add Firestore Rules tests proving browser denial for token roots, mappings, queues, and backend-owned connection fields, plus owner read access for the safe projection.
- Add indexes deliberately for scheduled scans, queue status, pending disconnect retries, and history leases. Check the emulator and deployed index requirements before launch.

## 6. Ingestion: webhooks, history, and idempotent queues

### Webhooks

- Verify the provider's documented authentication or shared secret before accepting work. Reject malformed, unrelated, unknown, disconnected, deletion-pending, and non-entitled payloads before queueing.
- Resolve the provider identity through the server-owned mapping, not browser-visible metadata.
- Treat webhook delivery as at-least-once. Duplicate, delayed, and out-of-order deliveries must not create duplicate events.
- If provider revisions exist, persist a revision timestamp or version. A newer revision should safely supersede an older queued one; an older delivery must not reopen or overwrite newer work.
- Return quickly. Queue a compact, validated work reference rather than doing file download, parsing, or event persistence in the webhook handler.

### History imports

- Use the same queue format and processor as webhooks. Separate processing paths drift and create inconsistent duplicate or cleanup behavior.
- Require the appropriate entitlement and connection state at request time, then re-check in the worker.
- Use a per-user lease so duplicate browser clicks, tabs, or retried callables cannot run overlapping history scans.
- Record enough cursor/range state to make failures observable without exposing provider data.
- Confirm the partner pagination order. For descending history, include both selected date boundaries and stop only once records are older than the start boundary. Do not assume API ordering without tests.
- Classify provider 429 responses separately and surface reset metadata where available. Do not convert rate limits into rapid retries.

### Queue item design

Queue IDs and imported event IDs must be stable across retries. Prefer provider identity plus stable provider activity/workout ID, with a secondary provider-user identity where collisions are possible.

Queue items generally need:

- Firebase UID and stable provider owner ID;
- provider activity/workout ID and revision/version;
- minimal processing data such as source URL or payload fields needed after the webhook ends;
- `processed`, `retryCount`, `dateCreated`, dispatch marker, result/error fields, and TTL expiry;
- lease owner, lease expiry, and revision claim fields where the provider can update the same activity.

Use a transaction for an upsert that can race with another webhook or history page. Claim a revision before processing it. A worker that discovers its queue snapshot was superseded must acknowledge only its own work and leave the newer revision intact.

### Outbound activity delivery

When a provider accepts activities, use the shared `activity-sync` route model rather than adding a provider-specific fan-out path. Define an explicit `source -> destination` route in `shared/activity-sync-routes.ts`, enable it only from Services, and route historical delivery through the existing date-range backfill callable.

- Make directions explicit. A provider can be a destination without being a source; do not create reverse routes merely because both APIs exist. Wahoo deliberately has Garmin/COROS/Suunto -> Wahoo routes but no Wahoo-origin route, which prevents import/delivery loops.
- Deliver the retained original only when its format is accepted by the destination. Do not silently transcode or use a derived event unless the product contract explicitly covers it.
- Recheck source and destination connection, entitlement, disconnect-pending, reconnect-required, deletion, and feature-gate state in the worker. A route setting is not an authorization grant.
- Persist a provider-issued asynchronous upload/job identifier before retrying. Subsequent retries must poll that identifier, not repost the original file, otherwise a timeout can create duplicate activities.
- Normalize terminal states into the shared result contract: success, duplicate-as-success, retryable pending/rate-limit/outage, skipped auth/scope problem, or a sanitized terminal failure. Keep provider error payloads and source files out of queue errors and logs.
- A direct browser FIT upload is a separate product path. State whether it creates an event. Wahoo direct delivery intentionally sends to the provider only and retains only the short-lived browser row/upload token needed to show status.

OAuth scope changes are migrations. Request the full supported scope for new connections, enforce the specific write scope immediately before outbound calls, and show existing users a clear reconnect action. Do not mark a read-only connection as generally disconnected when inbound imports remain valid.

## 7. Worker, original files, and event persistence

The worker is the final safety boundary. It should be safe to execute repeatedly and must expect the connection or user to have changed since ingestion.

Before each irreversible action, use `functions/src/shared/user-deletion-guard.ts`:

1. before queue insertion;
2. before a worker makes provider requests or refreshes credentials;
3. immediately before event/original-file persistence;
4. inside transactions that write queue completion, history lease, or other follow-up state.

Also stop work when the provider is disconnected, reconnect-required, or disconnect-pending. A disconnect that starts mid-job must not result in a new import.

### Downloading provider files safely

Provider file URLs are external input even if they came from an authenticated partner API. The Wahoo implementation is the reference for a safe FIT download path:

- require HTTPS;
- reject credentials in URLs, IP literals, localhost, private targets, and unapproved redirect targets;
- allowlist exact provider-owned hosts through configuration;
- enforce a request deadline and a byte limit;
- validate response type and file magic bytes before parsing;
- never persist or log the full signed URL.

Do not use a provider's short-lived file URL as durable application data. Download it in the worker, validate it, and store the original file through the existing event/file flow so reprocessing, export, and sync use the owned copy.

### Persisting events

- Resolve a deterministic event ID before writing. Put provider identity fields in safe event metadata for future deduplication and attribution.
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
5. When cleanup runs, recursively remove provider token subtrees and feature-owned operational state, including queues, mappings, history leases, and pending disconnect state.

### Subscription enforcement

If a provider is Pro-only, add it to the scheduled entitlement scan and its token-root discovery. Decide whether an entitlement restoration clears a pending disconnect or requires a fresh user connection; document the result in the provider-specific guide and Help content.

### Account deletion

Account deletion is not merely token deletion. Add provider identity discovery and recursive cleanup for all feature-owned top-level state, including queue items, DLQ records, mappings, leases, and scheduler cursor/checkpoint documents when keyed by user. The deletion tombstone is the durable signal; missing user roots alone are not enough.

Existing imported events are product-policy decisions. State explicitly whether disconnect, entitlement expiry, and account deletion each retain or remove them. Wahoo retains imported events on disconnect but removes account-associated data on account deletion.

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

- OAuth starts, callback failures, provider denial/cancel rates, identity-mapping conflicts, and token-refresh failures;
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
| OAuth            | State binding, approved redirect, explicit provider denial, incomplete callback, token refresh/rotation, stable identity, mapping conflict, and disconnect after entitlement expiry.            |
| API boundary     | Request timeout, input normalization, pagination, rate-limit mapping, secret redaction, and no unsafe retry behavior.                                                                           |
| Webhook/history  | Authentication, entitlement/connection/deletion rejection, deterministic IDs, duplicate delivery, out-of-order or newer revision, date boundaries, skip rules, and lease contention.            |
| File worker      | Allowed host/redirect checks, unsafe URL rejection, size/type/FIT validation, timeout, retry/DLQ behavior, and original-file persistence.                                                       |
| Lifecycle        | Disconnect pending/retry, entitlement enforcement, cleanup ownership races, recursive deletion, and account deletion guards before every write.                                                 |
| Rules            | Token/mapping/queue client denial and safe owner metadata read.                                                                                                                                 |
| Frontend         | Provider navigation, query selection, connection states, focused tool dialog, Pro and keyboard-accessible upsell behavior, help, policies, integration page, route metadata, sitemap, and logo. |
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
- **Making disconnect dependent on Pro.** Users must be able to revoke access after their plan changes. Separate connect/import authorization from disconnect authorization.
- **Giving the client access to useful-looking operational fields.** Token roots, mappings, queues, retry state, and disconnect controls are backend-owned even when the browser shows a connection badge.
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
- [ ] Services UI, accessibility, icons, source/destination labels, Help, Policies, public integration page, metadata, sitemap, and internal links are updated as applicable.
- [ ] Admin queue stats, DLQ analysis, user filtering/enrichment, and logos are updated.
- [ ] Unit, Rules, frontend, admin, shared-library, and build verification passed.
- [ ] Provider-specific architecture/release document and this guide were updated.
- [ ] Rollout, monitoring, and rollback plan are written before enabling production traffic.
