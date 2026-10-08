# Sleep Sync Operations

Sleep sync is controlled independently from activity sync. The shared Sleep & Health queue supports
Garmin, Suunto, and COROS Sleep for every connected user. COROS daily responses also feed the unified
Health writer. Suunto 24/7 Health uses the same queue and worker but has a separate scheduler, kill switch,
and production-wide account cursor. Garmin Health API 1.2.4 Ping/Pull uses the shared Firestore queue;
live callback pulls use the ordinary Sleep worker, while user-requested historical Health uses a dedicated
single-concurrency Cloud Tasks worker. Garmin Health is production-wide behind an independent operational
switch, and enabling either Health adapter does not change provider Sleep behavior.

COROS runs `scheduleCOROSSleepSync` every 24 hours. It queues a rolling seven-day daily-data
poll for each connected COROS account. The documented COROS endpoint provides sleep start/end
times, average sleep heart rate, resting heart rate, overnight HRV, steps, a provider-native
calorie value, and optional detailed HRV/interval-heart-rate samples.
The live endpoint may represent a successful range with no daily records as an exact empty
`data` object. The worker accepts that provider-confirmed no-data response, completes both sync
states without creating Sleep or Health records, and continues to reject any non-empty unknown
response shape.
It does not provide sleep-stage intervals, so COROS sessions retain their duration as an
unknown stage rather than inferred Light, Deep, REM, or Awake stages.

## Unified Health Compatibility Boundary

The unified health foundation does not replace this pipeline. `users/{uid}/sleepSessions` remains
the canonical normalized Sleep store, and existing dashboard, Training, and MCP Sleep reads continue
to use it. The COROS worker now writes aggregate sleep first, then one source-aware daily Health record.

COROS Health records create typed references to the existing Sleep duration, resting/sleep heart rate,
and overnight HRV aggregates. They do not copy Sleep sessions or stages. Detailed COROS `hrvList` points
from new responses live only in `healthSampleChunks`; existing legacy Sleep copies remain untouched until
the guarded migration has safely written Health and can remove them.
The reference validator requires the stable health metric ID to match the referenced Sleep field. See
[Unified health data foundation](unified-health-data.md).

Provider disconnect retains both normalized Sleep sessions and imported unified health history.
Account deletion recursively removes both because they remain below `users/{uid}`.

Sports Lib 20.3 is the canonical scalar JSON boundary for normalized Health values and Sleep aggregates. After the
guarded migration and zero-candidate production dry run, new server writes persist its versioned `toJSON()` envelope
without a second legacy canonical scalar copy. Dashboard, Health, Training, derived-metric, and MCP readers strictly
rehydrate it through the matching `fromJSON()` class and continue to accept legacy-only documents. Session structure,
timestamps, stages, samples, provenance, provider-native values, non-scalar score metadata, and provider fields remain
in their existing models. This storage transition changes no provider polling, OAuth, callback, or disconnect behavior.

Suunto Activity, daily-statistics, and Recovery values are separate Health source records. They do not
modify `sleepSessions`, workout events, FIT activity metrics, readiness, Training, or MCP output. Signed
Suunto Activity/Recovery notifications resolve every active server-owned account binding before compact per-UID ingress persistence and
enqueue bounded refetches asynchronously; the raw notification samples are not persisted. Signed permanent
rejects are acknowledged without retained ingress, and later non-retryable ingress is deleted with its original version guard.
See [Suunto 24/7 Health integration](suunto-integration.md).

Garmin Daily, Stress Details, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration,
Blood Pressure, Skin Temperature, and Health Snapshot summaries are likewise separate Health records.
They enter through the canonical `receiveGarminAPIHealthData` Ping endpoint. The handler deduplicates
validated descriptors, resolves unique accounts with bounded lookups, and durably queues compact
UID-scoped callback batches before acknowledging. A retryable Firestore trigger dispatches each newly created
or replacement batch revision outside the HTTP acknowledgement path without redispatching same-revision retry-state
writes; its worker immediately dispatches the per-callback children, and the scheduled
dispatcher remains the recovery path. Scheduled recovery scans regular Sleep work and Garmin Health backfills
independently, so capacity pressure in one Cloud Tasks queue cannot starve the other. The callback worker pulls and writes
with OAuth and connection lifecycle guards. Large callback responses are written
in 32-record checkpointed batches; a six-minute budget hands remaining work to a fresh queue revision whose
digest-bound cursor resumes without retaining raw provider data. See [Garmin Health integration](garmin-integration.md).

## Provider Kill Switch

Sleep provider disablement is source controlled in:

```text
functions/src/sleep/provider-flags.ts
```

Current setting:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [];
```

This constant only affects sleep sync. Existing activity sync behavior for Garmin, Suunto,
and COROS is unchanged. It also does not disable Suunto 24/7 Health or Garmin Health.

Suunto Health has an independent source-controlled switch in
`functions/src/suunto/health-flags.ts`. When false, scheduled and webhook ingress stop creating
Health work, and queued `suunto_health_poll` rows are acknowledged as provider-disabled without
calling Suunto. Existing Sleep work continues.

Garmin Health has an independent source-controlled operational switch in
`functions/src/garmin/health-flags.ts`. It has no UID allowlist. When the switch is disabled, Health
families are acknowledged without queue work and live Health backfills are safely skipped; Garmin Sleep
remains controlled by the normal Sleep flags.

## User Rollout

Sleep user rollout is also source controlled in:

```text
functions/src/sleep/provider-flags.ts
```

Current setting:

```ts
export const SLEEP_SYNC_ALLOWED_USER_IDS: readonly string[] = [];
```

An empty allowlist means all users. To scope sleep sync again, add Firebase UIDs to this
constant and deploy/restart the Functions runtime.

Suunto Health has no UID allowlist. While its independent kill switch is enabled,
`scheduleSuuntoHealthSync` keyset-pages all canonical connected-account roots, signed Health webhooks
resolve the bounded server-owned binding index, and eligible Suunto history requests offer the combined
Sleep & Health control. Polling advances at most 25 roots per 30-minute invocation and pauses for 24 hours
after completing a production-wide sweep.

Garmin Health has no UID allowlist. While its independent operational switch is enabled, the Garmin
handler admits Health work for every uniquely resolved active connected account. The
`getGarminHealthSyncAvailability` callable reports that global switch to clients; account connection,
permission, lifecycle, and deletion checks remain server-owned.

## What Disabled Means

When a provider is disabled:

- Provider webhook handlers acknowledge sleep webhooks but do not enqueue sleep work.
- Provider polling jobs skip creating sleep queue items.
- Already queued sleep work for that provider is marked processed with
  `resultStatus: provider_disabled`, `providerDisabled: true`, and zero written sessions.
- The worker does not call the provider API for disabled sleep queue items.

Skipped queue items are intentionally not retried after re-enabling. After the provider is
enabled again, new webhooks and scheduled polling runs are expected to create fresh work.
COROS and Suunto polling use a rolling recent window, so recent data can be picked up on
the next poll. Garmin sleep data relies on Garmin Health API webhook delivery in v1.

## Queue Revision and Recovery Safety

Every newly written Sleep queue item has an opaque `queueRevision`. The Cloud Task name and
payload both bind to that exact revision; the date-only payload remains accepted solely for
legacy queue rows that do not have a revision. Dispatch marking, worker claim, retry, completion,
skip, DLQ movement, and cleanup tombstones all recheck the live revision transactionally. A stale
task may acknowledge its own delivery, but it cannot update or delete a newer replacement.

If a newer revision arrives while the prior worker owns an active processing lease, the queue
replacement preserves that lease and remains undispatched until the older worker releases it.
The release makes the replacement eligible for its own task. If a worker crashes and leaves an
expired lease behind, the scheduled dispatcher treats that retained lease as recovery work and
uses a revision-bound recovery task name. A reserved task name is considered dispatched only
while the corresponding Cloud Task still exists, so a deleted or expired task cannot leave the
queue row permanently stuck.

## Routine Verification

1. For COROS, wait for the next `scheduleCOROSSleepSync` run or trigger the scheduled
   function manually in the Firebase console.
2. Verify new COROS queue items complete successfully, `users/{uid}/sleepSyncState/COROSAPI`
   shows a recent `lastPollAtMs` and `lastSyncedAtMs`, and `users/{uid}/healthSyncState/COROSAPI`
   shows `ready` with matching poll/sync timestamps.
3. Check `users/{uid}/sleepSessions` for sessions with the COROS source. The current endpoint
   does not provide sleep stages, scores, naps, or in-bed duration.
4. Check `users/{uid}/healthSourceRecords` for a `coros_daily` daily summary and its bounded
   `healthSampleChunks`. Persisted source/account/revision identities must be opaque hashes.
5. For Garmin, configure Sleep plus each enabled Health family as Ping/Pull notifications to
   `receiveGarminAPIHealthData`. Direct Push summaries are acknowledged but discarded because the
   provider request is not locally authenticated; the worker persists data only after pulling from
   the exact Garmin callback host with the connected user's OAuth token. Confirm the live queue URL
   is removed after completion and `healthSyncState/GarminAPI` advances for Health families.
6. For Suunto Health, verify `scheduleSuuntoHealthSync` creates `suunto_health_poll`
   rows for the rolling seven-day range, and verify signed Activity/Recovery notifications create
   immediate local-day refetches. Confirm `healthSyncState/SuuntoApp` advances without changing
   `sleepSyncState/SuuntoApp` and that Activity, daily-statistics, and Recovery remain separate
   source-record types.

The Garmin history control calls `backfillGarminAPIHealth`. The callable requests Sleep for every eligible connected
Pro user and, while Garmin Health is enabled, adds one durable cursor for all ten Health families.
The UI waits for `getGarminHealthSyncAvailability` before enabling the control, then labels the action and
completion from the server response. If the operational switch is disabled, the same control retains Sleep-only behavior.

Historical Garmin Sleep and Health imports request up to the latest rolling five calendar years,
with stricter provider minimums still applied. Health requests use inclusive windows of at most 90 days.
`processGarminHealthBackfillTask` is isolated from ordinary Sleep work at one concurrent dispatch and
at least 1.5 seconds between Garmin requests. It advances its Firestore cursor after each accepted or
already-requested window, clips a family when Garmin reports its minimum start, retries network/`429`/`5xx`
failures, and treats permanent authorization/permission/request errors as terminal. It re-reads and
expiry-refreshes the exact token before every provider request while retaining the original OAuth and
connection-generation fence, then rechecks queue revision, account deletion, Garmin Health availability,
provider identity, and lifecycle transactionally before progress. Disabling the operational switch atomically skips matching progress. Every
terminal DLQ path, including retry exhaustion, authorization failure, and invalid ranges or requests,
atomically marks the matching progress failed while moving the exact queue revision to the DLQ. Invalid
callback responses first mark Garmin Health state failed through the captured lifecycle guard; a stale guard
skips the callback instead. Sleep and Health
share the 30-day user cooldown, while each Health family can independently establish its provider minimum.
Garmin Summary Resender is retained for bounded operational recovery rather than the normal user backfill.

Garmin sleep ingestion stores average respiration from positive samples and derives the
normalized maximum SpO₂ aggregate from valid recorded samples. MCP and other aggregate
consumers can use those values without reading the raw sample series. Existing Garmin sessions
gain the SpO₂ aggregate only when Garmin redelivers the session or the user runs the normal
**Import Sleep history** flow after the updated worker is deployed; deploying or rescanning an
MCP client does not rewrite sleep documents.

## COROS Sleep and Health Backfill

COROS retains daily data for up to three months and permits a maximum 30-day range per request.
Connected Pro users can choose **Import Sleep & daily Health history** in COROS History Import. The
user-requested backfill queues their available three-month window in 30-day ranges and is available
once every seven days. It uses the same guarded worker and ordered Sleep/Health writes as routine polling.
Its response reports matching `sleepQueued` and `healthQueued` date-range counts because each COROS
daily queue item imports both domains from one provider response.

The `backfill-coros-daily-health` Functions script queues the current eligible COROS accounts through
the normal sleep queue in 30-day windows. It neither logs tokens nor fetches raw provider data itself; the deployed worker performs the
guarded token use and Sleep/Health writes.

Deploy the enabled scheduler and sleep worker before queueing a backfill:

```bash
npm --prefix functions run build && firebase deploy --only functions:scheduleCOROSSleepSync,functions:processSleepSyncTask
```

Inspect the account and queue-item count first:

```bash
npm --prefix functions run backfill-coros-daily-health
```

Then explicitly queue the backfill for all eligible connected COROS accounts:

```bash
npm --prefix functions run backfill-coros-daily-health -- --execute --confirm-all-users
```

Use `--uid <Firebase UID>` to limit the run to one user, or `--start YYYY-MM-DD` and
`--end YYYY-MM-DD` to narrow the window. The script clamps any earlier start date to COROS's
three-month retention boundary and exits nonzero if queueing a window fails. Existing COROS
connections whose token root and selected token both predate credential-generation metadata
remain eligible when both fields are absent; no credential migration or reconnect is required
solely for that legacy pair. A missing root, one-sided generation, or generation mismatch still
fails closed.

## Suunto Sleep and Health Backfill

The existing Suunto history callable, cooldown, and public Function name remain stable. While the Health
kill switch is enabled, **Import Sleep & 24/7 Health history** queues one Sleep item and one Health item for every
non-overlapping range of at most 28 days for every connected Suunto account. The response reports the shared range count plus separate
`sleepQueued` and `healthQueued` counts. A combined request accepts at most eight connected accounts. When the Health kill switch is disabled, the existing Sleep-only copy
and behavior remain available. A partial enqueue failure clears the cooldown claim so the user can retry immediately;
deterministic queue identities make already accepted ranges duplicate-safe.

## Health and Sleep Sports Lib JSON Migration

After the Sports Lib 20.3 dual-reader/new-writer release is deployed, migrate one user and one collection at a time. The
command is dry-run by default, accepts at most 250 documents, and returns an opaque `nextStartAfter` document ID only
when another page exists:

```bash
npm --prefix functions run migrate-health-sleep-sports-lib-data -- --uid <uid> --kind health --limit 100
npm --prefix functions run migrate-health-sleep-sports-lib-data -- --uid <uid> --kind sleep --limit 100

npm --prefix functions run migrate-health-sleep-sports-lib-data -- --execute --uid <uid> --kind health --limit 100 --concurrency 5
npm --prefix functions run migrate-health-sleep-sports-lib-data -- --execute --uid <uid> --kind sleep --limit 100 --concurrency 5

npm --prefix functions run migrate-health-sleep-sports-lib-data -- --execute --uid <uid> --kind health --limit 100 --concurrency 5 --start-after <opaque-document-id>
```

In additive mode, execution rechecks account deletion for each candidate and re-reads the exact document in the update
transaction. It updates only the derived canonical field and never changes provider revisions, receipt timestamps,
source metadata, stage/session structure, or raw provider fields. A concurrent delete becomes `skipped_missing`; a
deletion race becomes
`skipped_deleted_user`; malformed or conflicting Sports Lib JSON becomes `skippedInvalid` and is left untouched. Any
of those blocking outcomes or a retryable failure stops new transaction batches, exits nonzero, and returns the cursor
immediately before the earliest document that was not safely handled. Already-started transactions in that bounded
batch may finish, and rerunning from the returned cursor safely rechecks them. `--concurrency` defaults to 5 and is
capped at 10; start at 5 and increase only after a clean pilot while keeping users and Health/Sleep collections
sequential. Re-running the same page is safe. Finish by repeating both dry runs and require `candidates: 0`,
`skippedInvalid: 0`, `skippedDeletedUser: 0`, `skippedMissing: 0`, and `failed: 0`.

The migration does not require provider reconnects or history refetches. Ordinary disconnect intentionally retains
imported history, so disconnecting during the migration does not remove a valid historical candidate. Account deletion
still removes the complete user subtree and prevents the migration from recreating descendants. Sleep-document updates
use the existing per-user coalesced derived-metric ingress, so keep the documented user-scoped batches and allow that
queue to settle during rollout rather than running overlapping pages for the same user.

After clean single-user pilots, use the global cohort runner instead of copying Firebase UIDs into repeated commands.
It scans only top-level user document names, checks for Health or Sleep subcollections, and keeps users plus their Health
and Sleep passes sequential. It never prints a raw UID. `nextStartAfter` is a domain-separated SHA-256 checkpoint bound
to either dry-run or execution mode; on resume, the runner resolves it by scanning field-masked user document names
server-side. A dry-run checkpoint is deliberately rejected by `--execute`, so it cannot skip users that were inspected
but not migrated:

```bash
# Read-only five-user cohort.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --max-users 5

# Execute the same bounded cohort with five guarded document transactions at a time.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --execute --max-users 5 --document-concurrency 5

# Resume after a clean execution cohort using only its execution checkpoint.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --execute --max-users 25 --document-concurrency 5 --start-after <opaque-checkpoint>
```

The runner defaults to scanning at most 100 user documents and processing at most five users that actually have Health
or Sleep data. `--scan-limit` can be raised to 5,000 when sparse accounts require it; `--max-users` is capped at 100,
`--document-limit` at 250, and `--document-concurrency` at 10. Each user receives complete Health and Sleep dry runs
before execution, guarded execution one collection at a time, and zero-candidate postchecks before the checkpoint can
advance. Inactive/deleting users are skipped. Any invalid record, missing/deleting document, read/write failure,
repeated document cursor, or nonzero postcheck stops the cohort and retains the checkpoint before that user. Rerun from
the returned checkpoint after resolving the cause. Checkpoint resolution completes before any migration writes; if the
checkpoint user root was deleted between cohorts, restart without `--start-after` and let the idempotent postchecks
advance through already-current users again. Start with 5 users, review logs and the derived-metrics queues, then increase
to 25 before processing the remainder.

After the additive migration, writer cleanup, and observation window are complete, the same runners can remove the
historical duplicate scalar fields. This is an explicit, destructive mode and remains a dry run unless `--execute` is
also present:

```bash
# Read-only pilot: report historical documents whose duplicate scalars are safe to remove.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --remove-legacy-scalars --max-users 5

# Execute one bounded cleanup cohort.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --execute --remove-legacy-scalars --max-users 5 --document-concurrency 5

# Resume only with the checkpoint returned by the same cleanup/execution mode.
npm --prefix functions run migrate-health-sleep-sports-lib-data-global -- --execute --remove-legacy-scalars --max-users 25 --document-concurrency 5 --start-after <opaque-checkpoint>
```

Cleanup checkpoints use a separate domain from additive-migration checkpoints and remain separately bound to dry-run
or execution mode. The runner refuses to remove anything unless the existing Sports Lib envelope strictly decodes and
round-trips to the legacy values. Health cleanup removes only duplicate `canonical` value/goal maps while retaining
provider-native values and other goal metadata. Sleep cleanup removes only the duplicate duration, in-bed duration,
stage-duration, vital, and numeric score paths while retaining session structure, stages, samples, provenance, score
qualifiers/components, and provider fields. Unexpected legacy map fields, malformed/conflicting envelopes, deletion
races, and failures stop the cohort before its checkpoint advances. Repeat the cleanup dry run through the entire user
inventory and require zero candidates, invalid records, and failures. Because `--execute --remove-legacy-scalars`
deletes historical Firestore fields, running it in production requires separate approval for the exact cohort.

Keep dual readers in place through the rollback window. Removing legacy readers is not part of this migration and
requires another reviewed release.

## Temporarily Disable A Provider

To pause COROS sleep sync, add it to the disabled-provider list:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.COROSAPI,
];
```

Update the provider flag tests and deploy or restart the Functions runtime. Restore the empty
list to re-enable it. Queued items skipped while disabled are intentionally not retried; the
next daily COROS poll will request the rolling recent window again.

## Cloud Monitoring (#830)

Status: **activated in production on 7 October 2026**, after the separately approved
three-Function deployment and configuration apply. The existing Alerts email channel
is reused. All 11 metrics, dashboard queries and six enabled policies passed API readback;
dated activation and observation evidence is recorded in [#830](https://github.com/jimmykane/quantified-self/issues/830).
Positive post-creation heartbeat, sampled-count and sampled-age series for all four
provider/workload lanes were verified on 8 October 2026; raw pre-creation logs were not
used as retrospective metric samples. This completes #830's activation evidence.
The #829 Activity Import dashboard and #655 Training dashboard do not provide this area's coverage.

`tools/health-sleep-monitoring/definitions.mjs` owns **QS Health & Sleep**, 11 versioned
log-based metrics and six alert policies, tagged `qs-health-sleep-monitoring-v1`.
Provisioning reuses `tools/monitoring/`, checks ownership and inventories before writing,
preserves dashboard etags/policy condition IDs on reapplication, and never deletes or
adopts unrelated resources. The existing Alerts email channel is selected explicitly;
this does not use the mail extension or create another notification channel.

### Metrics and interpretation

- Fixed dimensions are `provider` (`GarminAPI`, `SuuntoApp`, `COROSAPI`, `unknown`) and
  `workload` (`sleep_sync`, `garmin_health_backfill`); terminal/attempt outcomes are closed
  categories. No UID, job/account ID, title, email, credential, callback URL, raw error
  or Health/Sleep payload is extracted or added to the new operational logs.
- `committed` and `new_dead_letters` are observations **after** guarded transactions
  commit, not within retriable callbacks. Repeated stale tasks, ACKs, retained
  `failed_jobs`, and failed persistence are not new successes or permanent failures.
  Skips remain separate. Ordinary `completed` means that its success transition committed;
  it is not a record/session count or an exactly-once audit ledger. A crash between a
  commit and its best-effort log can lose an observation.
- `worker_attempts` and `worker_latency` reuse `[SleepSyncTaskWorker] Invocation summary`
  and the independent `[GarminHealthBackfillTaskWorker] Invocation summary`. `processed`
  includes lifecycle skips; HTTP acknowledgement and DLQ handling are not ingestion
  success. Existing #759 dispatcher diagnostics remain intact and are not dependencies.
- `worker_failures` counts failed/error/missing attempts and committed retry transitions;
  the matching `retry_incremented` summary is not counted again. Expected refresh/lease
  contention, stale tasks, already-processed work, deferrals and skips are excluded.
  `dispatch_failures` covers failed/unconfirmed enqueue attempts and scheduler failures,
  not a refused stale marker after a confirmed enqueue.
- Garmin backfill `completed` means its terminal request cursor committed. Requests
  are intentionally serialized and paced; asynchronous Garmin callbacks are ingested
  later by the ordinary worker. Completion is **not** historical-data coverage.
- Native Cloud Tasks depth, HTTP attempts and dispatch-delay p95 are shown separately
  for `processSleepSyncTask` and `processGarminHealthBackfillTask`. Native transport
  failures cannot identify a provider or exclude expected contention, so they are
  diagnostic charts only, never independent paging conditions. Processing alerts use
  the classified worker outcomes instead.
  Their filters use the documented Monitoring `one_of` comparison for these two exact
  queue IDs, together with the project and region constraints. Logging-style value lists
  and mixed AND/OR resource-label restrictions are not valid here; see
  [Monitoring filter syntax](https://docs.cloud.google.com/monitoring/api/v3/filters#comparisons).
  Production query checks cover the effective filters and aggregations, not only fixture strings.

### Bounded observations and limits

The existing 30-minute `dispatchSleepSyncQueue` scheduler emits four observation
heartbeats even when idle. There is no new scheduler, queue write or provider request.
One field-masked query reads at most 21 shared `sleepSyncQueue` rows ordered by
`dateCreated`, handling the first 20. Each recognized candidate uses a read-only
transaction for its unchanged queue snapshot, owner, deletion tombstone, connection
metadata and token root, plus at most one identity-filtered token metadata lookup. Opaque
credential/connection generations are compared privately, never logged. Credential and
provider payload fields are not selected. The existing processed/dateCreated index is
reused; no new indexes or Rules are needed.

Future polls/backfills, `dispatchAfterMs` rate/coalescing waits, ordinary retries,
nonzero dispatch markers, active leases, deferred/reconciliation work, deleting or
missing owners, disabled providers, rollout exclusions, disconnect/reconnect state,
missing tokens, mismatched pinned provider accounts, superseded queue generation fences
and token/root generation mismatches are excluded. Absent legacy queue fences remain
unfenced; explicit null fences require absent current generations. Malformed generation
metadata is unknown, not healthy zero. Replaced snapshots
cannot borrow the old row's age. Garmin backfill is excluded while the dispatcher's
existing native depth observation has tasks waiting/running: intentional single-task
capacity is not a live-ingestion incident. Unknown depth marks sampled backfill unknown,
not eligible. Depth is the existing pre-dispatch snapshot, not an atomic joint view of
Firestore and Cloud Tasks; the next scheduled observation refreshes it.

`sampled_due` and `sampled_age` are **lower bounds**, not complete queue totals or true
oldest-work age. Age uses the last Firestore write, conservatively resetting after
recovery/replacement; charts show hourly sample means. Saturation is explicit and the
shared oldest prefix may hide later providers/work. Rows without `dateCreated` are not
returned by the ordered query. Admin Queue Monitor/native queue metrics are necessary
companions; this probe does not prove all malformed or later work is healthy.

Malformed owner/type/timestamps or failed reads are unknown. Unknown-only observations
omit numerical backlog/age, never publish false zeros; an unclassifiable provider marks
all four observed lanes unknown. `queue_samples` includes known and unavailable
heartbeats, while `probe_failures` captures unknown/unavailable observations. A five-second
deadline stops further lookups and suppresses late success; an in-flight read RPC cannot
be cancelled and may finish read-only. Telemetry failures cannot change task ACK/retry
or the dispatcher's original result/error.

### Initial alert thresholds

These are starting thresholds to tune from measured traffic, not an SLA. Each threshold
condition must hold for 60 seconds and treats missing samples as inactive; telemetry
absence is a separate condition. Normal lack of new provider measurements never alerts.

| Policy | Ordinary ingestion | Serialized Garmin backfill |
| --- | --- | --- |
| Sustained undispatched work | Two observations at least 1h old in 90m | Two observations at least 6h old in 4h, while native task depth is zero |
| Repeated dispatch failures | Three attempts in 90m | Three attempts in 6h |
| Repeated processing failures | Ten failures/retries in 15m | Three failures/retries in 6h |
| New permanent failures | Three new DLQ commits in 30m | One new DLQ commit in 6h |
| Observations unavailable | Two unknown/unavailable samples per provider/lane in 90m | Same |
| Required observation heartbeat missing | Heartbeat absent for 2h per provider/lane | Same |

Policies group provider/workload independently, open/close notifications on the selected
existing channel, and auto-close after two hours without evidence. Absence needs an
initial time series: do not treat absence of an incident as proof of first activation.
Inspect Dashboard → **QS Health & Sleep**, Logs Explorer and `/admin/queues` before
action. Check the affected lane's exclusions, sample saturation/unknowns, native queue
state and safe worker categories; investigate identifiers/errors only privately. Do not
purge, replay, change concurrency or call provider APIs merely to silence an alert.

### Cost, verification and activation

Worst-case probe document reads per invocation are 21 + (20 × 5) + 20 = **141**,
or **6,768/day** at the unchanged 30-minute cadence. Empty-query minimums and billing
depend on actual results; the bound excludes existing dispatch reads and any platform
index-read charges. No extra Cloud Tasks depth request is added. Four probe heartbeats
per invocation mean 192/day, plus bounded transition/attempt logs. Eleven log-based
metrics (including distributions) can incur Logging/Monitoring ingestion/storage costs;
measure billed volume/cardinality rather than assuming alerts are free. No new Function,
queue, scheduler, dependencies, Health/Sleep data storage or email-extension work is added.
Worker/dispatcher generation, memory, secrets, timeout, retry and single-task limits are
unchanged. All three affected handlers use direct owner-module target loading: the ordinary
worker, Garmin backfill worker and existing Gen 1 dispatcher. See the
[entrypoint contracts and local benchmark](functions-entrypoint-loading.md#healthsleep-backfill-and-dispatcher-isolation).
This loading-only change leaves the dispatcher at 256 MiB and backfill at 512 MiB; it does
not migrate the scheduler to Gen 2 or change the Monitoring resource filters.

Local checks:

```bash
npm run test:health-sleep-monitoring
npm run test:emulator-coverage
npm run test:functions-emulators -- mcp-data
npm --prefix functions run entrypoint:check
npm --prefix functions run deploy:safety:compiled
node tools/health-sleep-monitoring/cli.mjs --project=quantified-self-io
```

The last command is offline preview only: no credential access, network or cloud writes.
After **separate explicit approval**, deploy exactly the three affected Functions, then
apply the owned resources using the already approved existing email channel:

```bash
firebase deploy --project quantified-self-io --only functions:processSleepSyncTask,functions:processGarminHealthBackfillTask,functions:dispatchSleepSyncQueue
node tools/health-sleep-monitoring/cli.mjs --project=quantified-self-io --notification-channel=projects/quantified-self-io/notificationChannels/EXISTING_CHANNEL_ID --apply --confirm-project=quantified-self-io
```

Before marking #830 Done, record deployed options/generations, all 11 metric filters and
dimensions, one owned dashboard, six enabled policies and the exact existing channel
without its private labels. Reapply serially to prove no duplicates/unrelated changes;
read back each chart and alert query, including native queue scopes and distribution
aggregation. Wait for four natural heartbeats and distinguish raw logs from aligned
counter interpolation. Verify representative threshold/missing-data behavior against
safe aggregate samples and reuse #655's same-channel delivery proof only if that channel
is unchanged. No fault injection, test email, provider call or temporary resource deletion
is authorized by these instructions. Keep activation/readback evidence on #830.

Final read-only verification at 07:11 UTC on 8 October 2026 (10:11 Helsinki) confirmed
the eleven owned metrics, one dashboard and six valid enabled policies still match
their source definitions and use the existing enabled Alerts email channel. All
thirteen chart and fourteen condition queries, including aggregations, passed API
validation. In the preceding four-hour window, each of the four lanes had eight
positive heartbeat points and eight positive distribution-count observations in
both `sampled_due` and `sampled_age`. The latest interval was 07:00:00–07:01:00 UTC:
heartbeat count one and a distribution observation with mean zero for count/age
in every lane. These are real post-creation idle samples, not inferred from empty
queries or counter interpolation. An idle bounded sample is not global backlog
coverage. The earlier approved deployment/apply and same-channel email proof are
reused; this verification performed no cloud write, manual dispatch, provider call,
fault injection, test email or data deletion. #830's operational acceptance is complete.

Help was reviewed: this is admin operational visibility only, so product explanations
remain unchanged. MCP impact is **none**: no tools, metrics exposed to users, schemas,
scopes, consent, provider actions, Assistant permissions or bundled skills change.
