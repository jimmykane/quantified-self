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

OAuth start validates and persists both consent and the provider-valid range preset alongside the existing server-owned, expiring, single-use flow generation. State claiming and reconciliation scrub both values. Omission from an older client means no consent; a consented request that predates the range field retains the 30-day default. Denial, an expired/replayed state, ordinary refresh, and non-Pro disconnect recovery cannot accept history. The connected-state transaction creates a deterministic opaque run in `connectionHistoryImports`, resolves the selected range from the successful connection time, and projects its safe initial status into the owner's service metadata. Successful OAuth includes a receipt only when automatic admission is enabled and the user requested history.

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

## Coordination, persistence, and retries

`processConnectionHistoryTask` has one concurrent dispatch, one dispatch per second, a 300-second timeout, and revision-bound task identity. A transactional lease outlives the worker. Before new admissions, both Firestore backlog and Cloud Tasks depth must be below half the existing 1,000-item capacity threshold. Capacity waits last a minute and spend no retry attempts. Provider failures use the shared retry/backoff policy and honor longer available provider retry hints.

Each operation retains its original range/cursor and a durable bounded completion receipt. An operation receipt survives a crash before the run advances. Queue admission remains idempotent if a failure occurs before a receipt can be persisted. Provider requests are at-least-once across an ambiguous network/commit failure; Garmin's existing duplicate-request handling is reused. Submission never proves delivery.

Invocation-local history context travels through the reused HTTP clients and canonical event, Sleep and Health writers. It verifies Pro entitlement, deletion state, exact credentials/connection and, for coordination, lease ownership before requests and transactional persistence. Original files use the canonical staging path. Context is constructed exclusively on the server from the private run, never from a callable payload. Legacy/manual ingestion without history context keeps its existing lifecycle protections.

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
5. Monitor `[ConnectionHistory]` structured events: `startup_failure`, `capacity_wait`, `checkpoint`, `finished`, and `monitoring_unavailable`. Outcomes distinguish retrying, skipped and failed work; `ageMs` measures run age. Admin queue monitoring includes coordination task depth, pending/failed runs and oldest pending age. Investigate sustained startup failure, queue age, throttling, skipped permissions and failed runs using server-only operational records. Do not log credentials or raw provider payloads.

This implements #681 with an explicit selected boundary. Thirty days remains the preselected default; users can choose a longer provider-valid range, including the provider maximum where supported. The run never expands its snapshot or automatically continues earlier than the chosen range.
