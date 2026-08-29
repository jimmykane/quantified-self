# Sleep Sync Operations

Sleep sync is controlled independently from activity sync. The shared Sleep & Health queue supports
Garmin, Suunto, and COROS Sleep for every connected user. COROS daily responses also feed the unified
Health writer. Suunto 24/7 Health uses the same queue and worker but has a separate scheduler, kill switch,
and production-wide account cursor. Garmin Health API 1.2.4 Ping/Pull uses the shared Firestore queue;
live callback pulls use the ordinary Sleep worker, while user-requested historical Health uses a dedicated
single-concurrency Cloud Tasks worker. Garmin keeps its own deny-all-when-empty rollout, and enabling either
Health adapter does not change provider Sleep behavior.

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

Suunto Activity, daily-statistics, and Recovery values are separate Health source records. They do not
modify `sleepSessions`, workout events, FIT activity metrics, readiness, Training, or MCP output. Signed
Suunto Activity/Recovery notifications resolve every active server-owned account binding before compact per-UID ingress persistence and
enqueue bounded refetches asynchronously; the raw notification samples are not persisted. Signed permanent
rejects are acknowledged without retained ingress, and later non-retryable ingress is deleted with its original version guard.
See [Suunto 24/7 Health integration](suunto-integration.md).

Garmin Daily, Stress Details, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration,
Blood Pressure, Skin Temperature, and Health Snapshot summaries are likewise separate Health records.
They enter through the canonical `receiveGarminAPIHealthData` Ping endpoint; the old
`receiveGarminAPISleepData` endpoint is a temporary Sleep-compatible alias. The handler deduplicates
validated descriptors, resolves unique accounts with bounded lookups, and durably queues compact
UID-scoped callback batches before acknowledging. The existing dispatcher expands each batch, then the
worker pulls and writes with OAuth and connection lifecycle guards. Large callback responses are written
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
and COROS is unchanged. It also does not disable Suunto 24/7 Health or staged Garmin Health.

Suunto Health has an independent source-controlled switch in
`functions/src/suunto/health-flags.ts`. When false, scheduled and webhook ingress stop creating
Health work, and queued `suunto_health_poll` rows are acknowledged as provider-disabled without
calling Suunto. Existing Sleep work continues.

Garmin Health has an independent source-controlled switch and deny-all rollout in
`functions/src/garmin/health-rollout.ts`. Disabled Health families are acknowledged without queue work;
Garmin Sleep remains controlled by the normal Sleep flags.

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

Garmin Health uses the same deny-all rollout rule in `functions/src/garmin/health-rollout.ts`. The
Garmin handler can continue accepting Sleep for normal Sleep users while acknowledging staged Health
families only for an explicitly allowed connected UID. The `getGarminHealthSyncAvailability` callable is
the client-safe source of that decision; clients do not infer rollout membership locally.

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
5. For Garmin, configure Sleep plus each staged Health family as Ping/Pull notifications to
   `receiveGarminAPIHealthData`. Direct Push summaries are acknowledged but discarded because the
   provider request is not locally authenticated; the worker persists data only after pulling from
   the exact Garmin callback host with the connected user's OAuth token. Confirm the live queue URL
   is removed after completion and `healthSyncState/GarminAPI` advances for Health families.
6. For Suunto Health, verify `scheduleSuuntoHealthSync` creates `suunto_health_poll`
   rows for the rolling seven-day range, and verify signed Activity/Recovery notifications create
   immediate local-day refetches. Confirm `healthSyncState/SuuntoApp` advances without changing
   `sleepSyncState/SuuntoApp` and that Activity, daily-statistics, and Recovery remain separate
   source-record types.

The Garmin history control calls `backfillGarminAPIHealth`. The legacy `backfillGarminAPISleep` callable is a
temporary alias for cached clients, with removal tracked by #625. The canonical callable requests Sleep for every eligible connected
Pro user and, for a UID in the staged Health rollout, adds one durable cursor for all ten Health families.
The UI waits for `getGarminHealthSyncAvailability` before enabling the control, then labels the action and
completion from the server response. Sleep-only users retain the prior behavior.

Historical Health requests use inclusive windows of at most 90 days from January 1, 2016 to the request
time. `processGarminHealthBackfillTask` is isolated from ordinary Sleep work at one concurrent dispatch and
at least 1.5 seconds between Garmin requests. It advances its Firestore cursor after each accepted or
already-requested window, clips a family when Garmin reports its minimum start, retries network/`429`/`5xx`
failures, and treats permanent authorization/permission/request errors as terminal. It re-reads and
expiry-refreshes the exact token before every provider request while retaining the original OAuth and
connection-generation fence, then rechecks queue revision, account deletion, rollout, provider identity,
and lifecycle transactionally before progress. Rollout removal atomically skips matching progress. Every
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
**Import Sleep History** flow after the updated worker is deployed; deploying or rescanning an
MCP client does not rewrite sleep documents.

## One-Off COROS Sleep and Health Backfill

COROS retains daily data for up to three months and permits a maximum 30-day range per request.
Connected Pro users can choose **Import Sleep & Health History** in COROS History Import. The
user-requested backfill queues their available three-month window in 30-day ranges and is available
once every seven days. It uses the same guarded worker and ordered Sleep/Health writes as routine polling.

The `backfill-coros-daily-health` Functions script queues the current eligible COROS accounts through
the normal sleep queue in 30-day windows. The compatibility alias `backfill-coros-sleep` runs the same
script. It neither logs tokens nor fetches raw provider data itself; the deployed worker performs the
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
kill switch is enabled, **Import Sleep & Health History** queues one Sleep item and one Health item for every
non-overlapping range of at most 28 days for every connected Suunto account. The response reports the shared range count plus separate
`sleepQueued` and `healthQueued` counts. A combined request accepts at most eight connected accounts. When the Health kill switch is disabled, the existing Sleep-only copy
and behavior remain available. A partial enqueue failure clears the cooldown claim so the user can retry immediately;
deterministic queue identities make already accepted ranges duplicate-safe.

## Legacy COROS Sleep Sample Migration

Before the daily Health adapter, COROS daily extras and detailed HRV were stored inside normalized
Sleep documents. Inspect the bounded migration plan first; dry-run is the default and performs no writes:

```bash
npm --prefix functions run migrate-coros-sleep-to-health -- --uid <Firebase UID>
```

Execute the reviewed single-user plan explicitly:

```bash
npm --prefix functions run migrate-coros-sleep-to-health -- --uid <Firebase UID> --execute
```

For a global execution, a prior dry-run is required operationally and the command requires the additional
`--confirm-all-users` guard. The projected query defaults to 100 Sleep documents and has a hard 250-document
page maximum. Use `--limit` and the reported `nextStartAfter` with `--start-after` to page:

```bash
npm --prefix functions run migrate-coros-sleep-to-health -- --execute --confirm-all-users --limit 250
```

The migration writes the Health replacement first. Only after the exact content is successfully written or is
already present unchanged does a deletion-guarded transaction remove legacy `hrvSamples` and the moved COROS
daily fields from that Sleep document. It also handles a narrowly bounded rollout race where a current daily
backfill has already written the same provider date and revision while scalar-only legacy fields remain on the
same referenced Sleep document. That cleanup requires the stored Health record to match the user, provider,
source type, receipt revision, day, interval, coverage, metric identities and definitions, and exact Sleep
references, with no incoming samples or stored sample chunks. The current Health scalar values may supersede
older retained Sleep-side summaries; `healthRecordsSuperseded` reports this case. The Health record and unchanged
legacy fingerprint are both rechecked inside the cleanup transaction.

A stale result or any conflict containing sample-series data does not prove that every legacy value is durable,
so the source fields remain for operator review. Aggregate Sleep vitals and timing remain. A concurrent Sleep or
Health change fails the cleanup closed, and rerunning is idempotent. Malformed, out-of-window, or inconsistent
legacy samples/vitals also remain untouched and are counted as invalid so an operator can review them without
data loss.

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
