# History import on connection

Eligible Pro users can leave **Import history from this service** selected when connecting or reconnecting Garmin, Suunto, COROS, or Wahoo. The adjacent range selector defaults to **30 days** and also offers provider-valid longer ranges:

| Provider | Connection-history choices | Maximum choice |
| --- | --- | --- |
| Garmin | 30 days, 90 days, 1 year, 2 years, maximum | Latest rolling 5 years |
| Suunto | 30 days, 90 days, 1 year, 2 years, maximum | All history the provider makes available |
| COROS | 30 days, 60 days, maximum | Latest rolling 3 months |
| Wahoo | 30 days, 90 days, 1 year, 2 years, maximum | All eligible retained FIT-backed workouts |

The 30-day range contains the connection day and preceding 29 UTC calendar dates. Longer fixed-day ranges follow the same inclusive rule; calendar-year and provider-maximum choices preserve calendar boundaries. Every range ends at successful connection time with whole-second precision. The coordinator never continues earlier than the selected boundary, and there is no existing-user rollout. Saved-route libraries and outbound delivery settings remain separate.

The checkbox uses the shared capability inventory for its description. Dashboard, Routes, and Wahoo permission shortcuts navigate to Connections with the provider selected and reconnect controls visible. They do not begin OAuth. Omitted consent from an older client means false.

## Acceptance and ownership

OAuth start validates and persists both consent and the provider-valid range preset alongside the existing server-owned, expiring, single-use flow generation. State claiming and reconciliation scrub both values. Omission from an older client means no consent; a consented request that predates the range field retains the 30-day default. Denial, an expired/replayed state, ordinary refresh, and non-Pro disconnect recovery cannot accept history.

`service-connection-meta.ts` remains the compatibility facade; `service-connection-lifecycle.ts` owns the connected-state transaction and atomically stages the history run with its safe metadata. The connected-state transaction creates a run with a fresh opaque UUID in `connectionHistoryImports`, resolves the selected range from the successful connection time, and projects its safe initial status into the owner's service metadata. Successful OAuth includes a receipt only when automatic admission is enabled and the user requested history.

A retryable Firestore trigger dispatches the durable run; a once-per-minute recovery scan repairs missed dispatch, including a crash between commit and enqueue. Refreshing or closing the browser does not stop the run. Connection success remains independent of import failure.

Runs bind the exact provider account, token document, credential generation, and connection generation. They snapshot capability IDs/versions and Garmin's canonical Health-family inventory. Reconnecting supersedes previous work while preserving its imported records and applicable cooldowns. Disconnect/account cleanup recursively removes operational runs; it retains imported records on disconnect and removes account data through the existing account-deletion path.

Only server code reads runs, receipts, cursors, and leases. Client metadata contains opaque ID, selected range preset, resolved dates, bounded per-type outcomes, counts, safe explanations, and retry availability. The authenticated, App Check-protected `retryConnectionHistoryImport` callable is required because it resumes privileged provider/ingestion work. Browser writes to runs or progress are denied, including admin browsers.

## Shared operations

| Provider | Shared operations used by manual and connection imports | Completion |
| --- | --- | --- |
| Garmin | Activity backfill, Sleep requests, existing all-family Health cursor | Requested; delivery can take hours or days |
| Suunto | Activity history queue admission, Sleep windows, 24/7 Health windows | Processed by existing ingestion workers |
| COROS | Activity history queue admission, combined daily Sleep/Health requests | Processed by existing ingestion workers |
| Wahoo | Paginated eligible FIT-backed workout history | Processed by existing ingestion workers |

Manual callables retain their request/response contracts and historical range defaults. Their implementations are shared server functions; the coordinator does not invoke HTTP callables or duplicate parsing/persistence pipelines. Reservations, permission checks, provider cutoffs, queue identities and canonical workers apply to both entrypoints. A multi-window manual activity import holds one reservation across all its windows. A scope already in cooldown is skipped with its next availability, without delaying it until that date. Other scopes continue.

Activity admission is bounded to 100 items per step. Suunto/COROS oversized responses subdivide the requested range; irreducible oversized or invalid responses fail visibly instead of truncating. Wahoo advances one provider page at a time. Sleep/Health reuse their existing bounded windows, paging and cursor policies. Garmin Health retains its independent request pacing and family-specific cutoffs. Selecting a long or all-available range changes only the snapshotted boundary: the coordinator still executes one bounded page/window or queue-admission unit per dispatch through these same shared operations.

An unavailable early Garmin Activity or Sleep window does not cancel later windows in a longer selected range. The coordinator continues at the provider's minimum available start when supplied, or at the next bounded window. It never widens the selected range; if no eligible window remains, that scope is skipped with its availability explanation.

## Coordination, persistence, and retries

`processConnectionHistoryTask` has one concurrent dispatch, one dispatch per second, a 300-second timeout, and revision-bound task identity. A transactional lease outlives the worker. Before new admissions, both Firestore backlog and Cloud Tasks depth must be below half the existing 1,000-item capacity threshold. Capacity waits last a minute and spend no retry attempts. Provider failures use the shared retry/backoff policy and honor longer available provider retry hints.

Each operation retains its original range/cursor and a durable bounded completion receipt. An operation receipt survives a crash before the run advances. Queue admission remains idempotent if a failure occurs before a receipt can be persisted. Provider requests are at-least-once across an ambiguous network/commit failure; Garmin's existing duplicate-request handling is reused. Submission never proves delivery.

Automatic Sleep/Health operations preserve credential-read and queue-admission errors for the coordinator's retry/authorization classification. Failed automatic admission keeps its claimed reservation and cooldown; manual callable error mapping and cooldown recovery retain their existing behavior.

Invocation-local history context travels through the reused HTTP clients and canonical event, Sleep and Health writers. It verifies Pro entitlement, deletion state, exact credentials/connection and, for coordination, lease ownership before requests and transactional persistence. Original files use the canonical staging path. Context is constructed exclusively on the server from the private run, never from a callable payload. Legacy/manual ingestion without history context keeps its existing lifecycle protections.

Frontend retries capture the initiating Firebase user object and the displayed run. Account/view changes cancel delayed dispatch through the existing callable guard and suppress late feedback after a response. Pending controls and retry errors are scoped to that run and provider, so a replacement run can be retried independently. Closing the view does not undo work already accepted by the server.

Queued children from a superseded connection finish through the existing revision-guarded skip transition. Retry and dead-letter paths recheck history ownership before processing and inside their transaction, including when a provider handler has converted the original error to a safe error. Transient guard-read failures remain retryable. An early Sleep skip cannot use lease fields fetched from another worker as proof of ownership, and stale children cannot complete replacement revisions.

Suunto activity history uses the same Firebase-owner-scoped queue identity as webhooks. Existing canonical queue revisions are preserved by automatic admission. A new connection replaces only its owner’s unfinished work from a superseded history run, with a new queue revision; completed records remain intact. Child rows must have explicit terminal outcomes; missing rows never count as success. Failed child items can be restored only from the same run's matching DLQ entry, without overwriting a replacement row. Retry resumes failed steps and preserves completed steps and dates, renewing restored queue rows’ retention. Automatic cooldown timestamps remain anchored to the original connection, including across pages and retries; retry checks reservations again before restoring failed queue work. Lost authorization is explained separately and leads to reconnect options.

## Adding capabilities

1. Register supported history resources and the provider's valid range choices/maximum policy in `shared/connection-history.ts`, or declare an empty capability list for a service that cannot supply history. Both registries are exhaustive over `ServiceNames`.
2. Implement/reuse the server operation and register each version with its executable handler and downstream queue in `HISTORY_ADAPTERS`. Declare resource scope, shared cooldown group, completion semantics and bounded/resumable execution. Keep incompatible behavior behind a new version; do not reinterpret old snapshots.
3. Reuse canonical provider-family registries. Garmin's existing Health cursor reads the run snapshot through the history context so newly registered families enter future runs only.
4. Cover permission/cutoff behavior, provider response bounds, canonical queue identity, retries, disconnect/deletion and secret bindings. Contract tests require every advertised capability/version to have an adapter. A fixture registration test proves future runs discover additions without changing OAuth or frontend orchestration.
5. Update the provider integration guide and user Help. Never silently add work to already-created runs or already-connected users.

## Release and operations

Prepare and verify these changes locally; merging and production deployment require separate approval.

1. Release the Firestore rules/indexes and compatible backend first, including the four OAuth-start and completion handlers, `onConnectionHistoryImportWritten`, `processConnectionHistoryTask`, `recoverConnectionHistoryImports`, and `retryConnectionHistoryImport`. Release changed canonical workers and cleanup functions with the coordinator.
2. Verify the dedicated queue limits, task invoker permissions, scheduled recovery, and all secret bindings. The coordinator receives Garmin, Suunto API, COROS and Wahoo API credentials; dispatch/recovery/retry endpoints receive none. Existing ingestion workers retain their bindings.
3. Release the frontend after the backend can atomically accept jobs. Old clients remain opt-out by omission.
4. `CONNECTION_HISTORY_IMPORT_ENABLED=false` in the OAuth completion functions' runtime environment stops new automatic admission. This is not a credential; do not create a Functions `.env` file. Existing accepted runs, manual imports and imported data remain intact. Restore the environment setting through the separately approved infrastructure workflow.
5. Monitor the versioned `[ConnectionHistory]` observations below. Admin queue monitoring still includes coordination task depth, pending/failed runs and oldest pending age; its lifetime age and retained failed totals are diagnostics, not the new actionable alert predicates. Investigate private operational records without exporting identities or provider details into alerts.

Monitoring coverage: downstream recorded-activity and Health/Sleep ingestion remain **covered** by #829/#830. Coordinator implementation is **prepared locally**, with deployment, activation and live evidence still pending in [#847](https://github.com/jimmykane/quantified-self/issues/847), Project 2. Those existing bundles omit this coordinator; Admin Queue Monitor and passing offline tests do not establish active alert coverage.

## Coordinator monitoring (#847)

`tools/connection-history-monitoring/` reuses the shared `tools/monitoring/` provisioner without changing its behavior. Its independent owner is `qs-connection-history-monitoring-v1`, with one **QS Connection history** dashboard, 14 `qs_connection_history_*_v1` log metrics and six policies. The dashboard also consumes native Cloud Tasks depth, attempts and dispatch-delay metrics for exactly `processConnectionHistoryTask`, plus native Cloud Run request counts/latency for all four coordinator endpoints in `europe-west2`. All four are already Gen 2 with isolated owner-module loading; no new Function, scheduler, secret, index, Rules or product gate is introduced. Existing memory, timeout, retry, rate and concurrency settings remain unchanged. Native HTTP/transport series are diagnostic: an accepted enqueue, worker ACK, submitted Garmin request and committed activity/Health/Sleep ingestion are different outcomes. Native Cloud Run metric/resource contracts are documented by [Google](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z).

### Fixed signals and privacy

Only `[ConnectionHistory]` with `telemetryVersion=1` enters the new metrics. Labels are fixed `provider=garmin|suunto|coros|wahoo|unknown` and allowlisted outcome. Whole-worker failures before context is available retain `unknown`, rather than trusting task payload labels. No owner/run/account IDs, credential generations, titles, provider payloads, URLs or raw errors enter these signals or email text. Older diagnostic logs and server-only records remain separate.

- `dispatch_attempt`: enqueue `accepted` (including deterministic task deduplication) or `failed`; this is not an ACK.
- `worker_attempt`: whole-task `acknowledged`, `failed` or `expected_contention`, plus bounded duration. ACK can be a stale revision, active lease or deletion no-op; it is not ingestion success.
- `checkpoint`: emitted only after a committed transaction, once even if its callback replays. `active`, `requested`, `processed`, `skipped`, `failed` and `expected_contention` describe coordination. `requested` wins when any scope remains request-only; `processed` can include skipped scopes and never claims complete provider coverage, watch receipt or workout completion.
- `operation_retry`: only a committed increase in real operation retry attempts. Capacity waits and window subdivision do not increment this signal. Recognized credential-refresh/provider-operation contention is excluded without changing existing retry behavior.
- `recovery_run`: the unchanged once-per-minute recovery's outcome; whole-run and candidate failure observations can overlap.
- `queue_sample` / `queue_sample_unavailable`: four fixed provider heartbeats on UTC quarter-hour scheduled ticks, including idle observations.

Logger failures cannot turn a committed checkpoint or ACK into another task retry. Observation errors cannot replace recovery's original result/error. No new signal is emitted for a rejected checkpoint write. New terminal failures count committed failure episodes, not retained failed documents or duplicate processed tasks; an explicit owner Retry can create another failure episode.

### Bounded read-only observations

The existing recovery scheduler samples every **15 minutes**, using its scheduled timestamp rather than delayed invocation time. Its dispatch loop still runs every minute, with unchanged limits. There is no additional scheduler or persistent monitoring state.

One masked, oldest-due-first query inspects at most **20 runs plus one truncation sentinel**, using the existing `(processed, nextAttemptAt)` index. Reads exclude token values, provider payloads and operation receipt results; only the receipt's `lastOperation.key` is selected. Each candidate's read-only transaction rechecks exact document update time, owner/tombstone, token/root presence and credential/connection generations. Permission/cooldown/unsupported-capability and Sleep/Health rollout checks match the local admission contract. Pro/grace checks are read-only and cached, at most 20 Auth lookups. Child observations share a **100-row total budget** and read only `processed`, `resultStatus` and `skippedReason`; pending children belong to the downstream bundles. Missing/failed children or an exhausted cursor can leave overdue coordinator finalization, not prove successful ingestion. Successful children with another page remaining still require downstream capacity; ambiguous child state is unknown.

A durable receipt matching the exact current step, capability version, cursor, window and page means the worker only resumes its committed result. That checkpoint recovery stays observable without new provider admission or capacity, permission or cooldown checks. It still requires a current connected account, Pro/grace access and no pending children. Stale receipt keys cannot bypass admission checks. The key never enters telemetry, and observing recovery never claims successful ingestion.

Capacity checks reuse the actual downstream queue/collection mapping, cache each mapping within the observation, and require both native depth and Firestore pending count below the existing half-capacity threshold. No provider API, refresh, queue write, account pinning, dispatch decision or retry change occurs. Capacity reads settle together on ordinary errors. A shared **five-second deadline** stops further reads and suppresses late healthy emissions; already-started requests may finish afterward.

Future retries, active leases, pending children, superseded/disconnected/deleting accounts and non-Pro access are excluded. Downstream saturation and expected permission/cooldown skips exclude new admissions, not receipt recovery or finalization. A retry that is already overdue remains eligible; its future backoff window is not mistaken for a stall. Age is the delay since the sampled revision's `nextAttemptAt`, not the lifetime of a years-long import. A same-revision edit racing the sample is unknown, not zero.

Positive count/age values are lower bounds. A global saturated or unknown prefix without a proven eligible count omits count/age, including for unseen providers; it cannot clear backlog as healthy zero. Query/read/capacity failure or timeout emits unavailable for all four groups. A complete idle observation emits real zero. Histogram chart means preserve zero observations without interpolating a false positive age; the backlog policy uses the exact emitted count/age predicate instead.

### Initial alert conditions

| Policy | Condition per fixed provider | Meaning |
| --- | --- | --- |
| Sustained eligible backlog | Three positive samples at least 15 minutes overdue in one hour | Eligible coordinator delay, not complete backlog or expected provider waits |
| Repeated dispatch/recovery failures | Three observations in 15 minutes | Immediate startup/enqueue or recovery failure; candidate/run observations may overlap |
| Repeated processing failures | Ten observations in 15 minutes | Unexpected failed attempts or committed real retries; ACK/contention/skips excluded |
| New failed import runs | Three newly committed terminal failure episodes in 30 minutes | Not retained failures, stale tasks or lifecycle skips |
| Observations unavailable | Two unknown/unavailable samples in one hour | Includes capped prefixes with no proven eligible count |
| Required heartbeat missing | No sample for one hour, independently for all four providers | Idle emits; no-new-imports is never an outage |

Threshold policies use a 60-second retest window, missing data inactive, and the explicitly selected existing email channel for OPENED/CLOSED notifications. Absence policies require each series to initialize after metric creation. These are initial tunable thresholds, not partner quotas or unique-user counts.

### Approval and operational completion

Offline preview needs no credentials or network:

```bash
node tools/connection-history-monitoring/cli.mjs --project=quantified-self-io
```

After separate approval, deploy only the three instrumented endpoints (`processConnectionHistoryTask`, `onConnectionHistoryImportWritten`, `recoverConnectionHistoryImports`). `retryConnectionHistoryImport` has native dashboard coverage but no handler changes. Verify active revisions and unchanged runtime/secret/queue/scheduler configuration. No Hosting, Rules or index release is required by this monitoring change.

Apply only after explicit approval for this bundle and selecting the existing Alerts email channel:

```bash
node tools/connection-history-monitoring/cli.mjs \
  --project=quantified-self-io \
  --notification-channel='projects/quantified-self-io/notificationChannels/EXISTING_ALERTS_CHANNEL_ID' \
  --confirm-project=quantified-self-io --apply
```

The provisioner validates the enabled email channel and paginated inventories before writes. Owner/name/policy-identity collisions, duplicates, malformed inventories and immutable metric schema drift fail closed. Serial reapply retains condition IDs and dashboard etag, without duplicate resources or DELETE. Other dashboards, metrics, policies and all notification channels remain unchanged. No new mail extension integration is needed; Cloud Monitoring uses its existing notification channel.

Before closing #847, record approval and pinned commit, deploy/apply results, exact API readback of the dashboard/14 metric schemas/six valid enabled policies, all **18 chart and nine condition queries**, native metrics for all four services and the queue, and positive **post-creation** metric points from a natural quarter-hour observation for each of the four heartbeat groups. Earlier logs cannot initialize new metric-absence series. Reuse existing same-channel notification evidence where valid; fault injection, manual scheduler invocation, test email, provider actions or deletion need their own approval. Do not claim operational coverage while activation/readback is pending.

Monitoring adds bounded Firestore/Auth/Cloud Tasks reads (at most 21 queried runs, 20 six-record lifecycle reads plus optional Sleep rows, 100 child rows and cached capacity observations per 15-minute tick), small fixed-category logs, log-metric series and alert evaluations. This is **not guaranteed free**. Idle probes read one bounded query and emit four logs; no provider calls or new scheduler are added. Review current [Observability pricing](https://cloud.google.com/products/observability/pricing) and actual volume before changing thresholds or sample limits.

Help's **Recent history when connecting** was reviewed and remains accurate; observability changes no user-facing behavior. **No MCP wire impact:** no tools, schemas, scopes, consent, exposed athlete data, Assistant actions or bundled skills change. Local verification includes privacy/lifecycle emulator cases, deterministic telemetry/deadline specs, actual log-filter fixtures, provisioning ownership/pagination/reapplication tests and the existing entrypoint/secret checks. The new emulator suite is registered in CI's `mcp-data` group; offline definitions run in the existing unit job.

```bash
npm run test:connection-history-monitoring
npm --prefix functions test -- src/connection-history
npm run test:functions-emulators -- mcp-data
npm run test:emulator-coverage
npm run test:delivery-shards
npm run test:workflows
npm --prefix functions run entrypoint:check
npm --prefix functions run deploy:safety:compiled
git diff --check
```

This implements #681 with an explicit selected boundary. Thirty days remains the preselected default; users can choose a longer provider-valid range, including the provider maximum where supported. The run never expands its snapshot or automatically continues earlier than the chosen range.
