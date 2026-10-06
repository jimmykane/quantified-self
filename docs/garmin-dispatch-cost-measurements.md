# Temporary Garmin dispatch cost measurements

Investigation: [#759](https://github.com/jimmykane/quantified-self/issues/759).
Removal: [#825](https://github.com/jimmykane/quantified-self/issues/825), a #759 subissue in cost epic #764.

These diagnostics explain the shared queue-write trigger's invocation volume while checking scheduled recovery.
They add no Firestore reads/writes, task requests, provider requests or persistent counters. They use the snapshots,
queue scans and dispatch results already available. Built-in Monitoring and billing data remain the source for
container starts, startup latency, memory, errors, billable instance time and actual costs.

This operational change has no app help, provider request/consent, Training or MCP contract impact. It preserves
queue admission, task identity, markers, deletion guards, leases, acknowledgement and retry behavior. No new
Function, secret, metric resource or configuration is introduced. Log failures do not retry successful work or
acknowledge failed work.

## Deployment scope

The instrumentation is prepared locally. After explicit approval, deploy both owners from the verified commit:

```sh
firebase deploy --project quantified-self-io \
  --only functions:dispatchGarminPingBatchOnWrite,functions:dispatchSleepSyncQueue
```

The Garmin dispatcher stays Gen 2 and the scheduled dispatcher stays Gen 1. Record the deployment time and source
commit in #759; begin daily comparisons with the next complete UTC day after both updates succeed. Deploying only
the first function leaves the recovery breakdown unavailable.

## Garmin Firestore dispatcher

Message: `[GarminPingBatchDispatcher] Invocation summary`, `telemetryVersion=1`, `dispatchSource=firestore`.
The service is `dispatchgarminpingbatchonwrite`. Each recorded invocation contains only allowlisted `provider` and
`queueType`, `writeKind`, `outcome`, `enqueueConfirmed`, `sampleRate`, `sampleWeight`, `durationMs` and `queueAgeMs`, plus the version/source.
Unrecognized provider/type values become `unknown`. No user/document/event IDs, revisions, callback URLs, payloads,
health values or error messages are included in these new summaries.

| Outcome | Meaning | Sample rate |
| --- | --- | --- |
| `deleted_write` | Before snapshot exists and after snapshot is absent | 5% |
| `missing_data` | Missing event or document data | 5% |
| `other_provider_or_type` | Write does not describe a Garmin Ping batch | 5% |
| `already_processed` | Batch is already processed | 5% |
| `already_dispatched` | Batch already has a dispatch marker | 5% |
| `same_revision` | Update did not introduce a new durable revision | 5% |
| `invalid_revision` | Update cannot establish a valid replacement identity | 5% |
| `dispatched` | Task existence confirmed and current batch marker committed | 100% |
| `stale` | Queue state/revision changed or marker no longer belongs to this delivery | 100% |
| `leased` | An active processing lease prevented dispatch | 100% |
| `deleted` | Revision-guarded account-deletion cleanup completed | 100% |
| `deferred` | Malformed batch left for scheduled reconciliation | 100% |
| `error` | Handler threw; original event retry behavior is retained | 100% |

Routine ignored calls are independently sampled. `sampleWeight=20` for 5% samples and `1` for full coverage.
`enqueueConfirmed` counts confirmed new or already-live tasks in this invocation, including a confirmation followed by
a stale or failed marker transition. It is not a unique newly created task count. Confirmed calls are logged in full.
An unsampled delete does not decode its before snapshot. Sampled deletes use before fields for workload attribution.
`queueAgeMs` is relative to `dateCreated`; invalid/future timestamps produce `null`. `durationMs` measures handler
wall time in fractional milliseconds. The clock stops before sampling, diagnostic snapshot decoding and log payload
construction, so sample-specific work is not extrapolated to unsampled calls. It excludes module import/framework
startup and is not billed CPU or billable instance time.

For each UTC day and outcome/workload, estimate invocations with `sum(sampleWeight)`. Estimate total handler duration
with `sum(sampleWeight * durationMs)` and the mean with that sum divided by `sum(sampleWeight)`. Ignored-call counts
and durations are estimates; report the observed sample count, rate and uncertainty. An empty sample does not prove
that a category never occurred. Do not infer a precise avoidable percentage from worker-to-dispatcher ratios.

## Scheduled recovery

The existing `[SleepSyncDispatcher] Reconciliation completed` log keeps `inspected`, `dispatched` and `skippedRecent`.
One aggregate per successful reconciliation adds `telemetryVersion=1`, `dispatchSource=scheduled`, `durationMs` and
`workloads` and `scannedTaskClasses`. Each workload uses the same bounded provider/type categories; there are no
per-document diagnostic logs. `scannedTaskClasses.sleepSync` and `.garminHealthBackfill` indicate which classes the
existing scans examined. A false flag means that class was skipped because it had no available task slots; its empty
workload/counts are not evidence of an empty queue. A true flag still describes the existing bounded scan, not the
entire queue. Summaries are emitted only after all selected scans complete; scan failures retain the existing errors.

| Per-workload field | Meaning |
| --- | --- |
| `inspected` | Candidates produced by the existing scans, including those not reached when capacity ends |
| `considered` | Candidates reached by the existing dispatch loop |
| `enqueueConfirmed` | New or already-live task confirmed; does **not** count only newly created tasks |
| `markedDispatched` | Current queue revision's dispatch marker committed |
| `markedUndispatched` | Marked from a previously unmarked revision |
| `markedStaleRecovery` | Marked after the existing stale-dispatch threshold |
| `markedLeaseRecovery` | Marked after retained processing lease expired; takes precedence over other reasons |
| `skippedRecent` | Existing dispatch marker was too recent |
| `skippedCapacity` | This task class had no remaining slots |
| `skippedInvalidDate` | Existing cleanup path handled invalid creation time |
| `skippedGuard` | Identity/deletion-guard admission returned false, including its handled lookup failures |
| `unconfirmed` | Task enqueue returned false |
| `notMarked` | Task was confirmed but identity/marker guard prevented marking |
| `errors` | Dispatch loop caught an exception; whole-run failures still use existing error logs/Monitoring |
| `oldestQueueAgeMs` | Oldest valid age among this run's scanned candidates, not the entire queue |

For each workload, `markedUndispatched + markedStaleRecovery + markedLeaseRecovery = markedDispatched`.
Across workloads, marker counts match the existing `dispatched` total. A confirmation followed by an error need not
produce a marker. These are observations/attempts, not unique jobs; the same pending revision can appear in several runs.

## Collection and interpretation

Use Cloud Logging with explicit UTC start/end bounds and these filters:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="dispatchgarminpingbatchonwrite"
jsonPayload.message="[GarminPingBatchDispatcher] Invocation summary"
jsonPayload.telemetryVersion=1
```

```text
resource.type="cloud_function"
resource.labels.function_name="dispatchSleepSyncQueue"
jsonPayload.message="[SleepSyncDispatcher] Reconciliation completed"
jsonPayload.telemetryVersion=1
```

Select only timestamp, revision labels and the documented summary fields. Check query limits/pagination and logging
latency; do not treat truncated or partially delivered results as a complete day. Keep query exports outside the
repository and record aggregate conclusions in #759. No additional logging/Monitoring resources are needed.

After 2–3 complete days, compare sampled ignored-write categories against admitted outcomes and existing worker and
webhook summaries. Review Garmin batch scheduled recovery, worker errors/retries/dead-letter outcomes and scanned
queue age before proposing changes. Waiting alone cannot recover the prior period's missing ignored-call classification.

For savings, use at least a week of comparable complete days, accounting for request volume, container starts and
billing-export availability. Extend the window when starts are sparse. Service billable time is not the sum of handler
durations, and worker executions are not unique dispatched revisions. Confirm data processing/recovery remains complete.
A create-only trigger would miss replacement revisions written onto existing documents.

## Removal

Once #759 records an adequately sampled cause, a comparable cost conclusion and the recovery guardrails, execute
#825. Remove the temporary invocation summaries, sampling, extra reconciliation fields and temporary-only helpers/tests.
Keep baseline reconciliation totals, worker/webhook summaries, Monitoring and regression tests for durable delivery.
Update this runbook and #759 with the cleanup commit and separately approved deployment, then verify temporary logs
stop appearing before closing #825. The investigation's acceptance criteria determine when #759 can close.
