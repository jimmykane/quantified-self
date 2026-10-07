# Recorded activity import monitoring (#829)

This is inbound **completed-activity ingestion**, not Training planned-workout delivery,
outbound activity/route delivery, Health/Sleep ingestion or Sports Lib reprocessing.
It covers Garmin, Suunto, COROS and Wahoo source queues sharing `processWorkoutTask`.
COROS's Training delivery availability is unrelated to its existing activity import.

## Implementation and activation boundary

Local implementation provides `QS Activity Imports`, eleven versioned log metrics and
six alert policies. Production activation/readback is still pending separate approval.
Nothing in this implementation deploys Functions, applies policies, sends email, calls
providers, changes queue retry/lease/TTL behavior or deletes data/resources.

Deploy the compatible runtime before applying configuration. The affected endpoints are
`processWorkoutTask`, `parseGarminAPIActivityQueue`, `parseSuuntoAppActivityQueue`,
`parseCOROSAPIWorkoutQueue` and `parseWahooAPIWorkoutQueue`.
The current worker remains Gen 2 at 1 GiB/540 seconds; scheduled dispatchers retain
their Gen 1 options, secrets, regions and **every 30 minutes** schedules.
The definitions intentionally distinguish `cloud_run_revision` worker logs from
`cloud_function` dispatcher logs. A later Gen 1 migration must update and verify these
resource filters; it is not part of this ticket.

Offline preview needs no credentials or network:

```bash
node tools/import-monitoring/cli.mjs --project=<project-id>
```

After separate deployment/configuration approval, an authorized operator supplies the
exact existing enabled **Alerts email channel resource**, not an email address:

```bash
node tools/import-monitoring/cli.mjs --project=<project-id> \
  --notification-channel=projects/<project-id>/notificationChannels/<channel-id> \
  --apply --confirm-project=<project-id>
```

The shared provisioner preflights paginated inventories, channel state, ownership and
immutable metric schemas before writing. It preserves unrelated resources, Training
monitoring, dashboard etags and condition IDs. Serial reapply uses the same resources.
Malformed inventory envelopes/entries and title collisions with a different managed
policy ID fail before any write. Renamed policies keep their original managed identity.
Do not run simultaneous applies. Operations are not transactional: an API failure can
leave an earlier metric update in place; inspect and reapply rather than deleting it.
The CLI obtains a gcloud token only for explicit apply, keeps it in memory, and does not
print private API responses. No notification channel is created or changed.
Ownership is `qs-import-monitoring-v1`; metrics are `qs_import_*_v1`.

## Signals and limits

| Signal | Meaning | Not evidence of |
| --- | --- | --- |
| Native task depth | Shared `processWorkoutTask` queued depth, five-minute maximum | Firestore pending totals or successful import |
| Native HTTP attempts | Shared attempts grouped by fixed response code | Provider-specific results; HTTP 200 may skip, defer or acknowledge DLQ |
| Native dispatch delay | Approximate p95 delay between scheduled and actual attempt, milliseconds | Activity freshness or parsing duration |
| Committed outcomes | Post-commit `imported`, `skipped`, `dead_lettered`, grouped by fixed provider | Unique lifetime activities or an audit ledger |
| Worker attempts/latency | Fixed outcome and whole-attempt latency, milliseconds | A successful import merely because `acknowledged` was returned |
| New dead letters | Newly committed moves, not retained `failed_jobs` count | Repeated tasks observing an already dead-lettered job |
| Dispatch failures | Failed scheduled invocations per provider | Individual failed enqueue totals |
| Eligible sample | Bounded eligible **undispatched** rows; a lower bound | Total pending work or already-dispatched retry backlog |
| Sample delay | Maximum age since the last queue write in that sample; conservative lower bound | Exact oldest queue age or original creation age |
| Unknown/failed observation | Missing identity/date, invalid timestamp or failed/timed-out read | Empty backlog or successful processing |

Native metric meanings come from [Cloud Tasks metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_c#cloudtasks).
Log numeric samples use [distribution metrics](https://docs.cloud.google.com/logging/docs/logs-based-metrics/distribution-metrics),
not cumulative job counters. Hourly mean sample charts and approximate percentiles are
explicitly labelled; they are not current total counts.

One bounded probe piggybacks on each existing dispatcher, including idle/capacity-limited
runs. It queries the existing undispatched selection with a field mask and at most
**20 rows plus one look-ahead**. A read-only snapshot rechecks the unchanged queue write,
owner/deletion fence, connection state and exact provider-account credential presence.
Credentials, provider URLs and payloads are not fetched or logged. Active processing
leases, parked rows, missing users, active tombstones, disconnected/reconnect-required
connections and different pinned Wahoo/COROS accounts are excluded. Dispatched token-
refresh recoveries and ordinary future Cloud Task retries are not due in this probe.

Queue creation time is intentionally not the age source: stable IDs can be replaced or
reopened. Any revision/retry/recovery write resets the conservative age. A concurrent
replacement is excluded instead of borrowing the earlier sample's age. A truncated
known sample remains useful but cannot establish complete backlog coverage. Legacy
rows lacking safe owner identity are unknown, not guessed through global token scans.
If every sampled row is unknown, numeric count/age fields are omitted, never zero.
An inaccessible probe emits only `queue_sample_unavailable`; it cannot stop dispatch.
The dispatcher also isolates unexpected probe/client-initialization errors, retaining
its original result or error and emitting the same privacy-safe unavailable observation.
There is a five-second probe deadline and no new scheduler, persistent cursor or queue
write. At most 21 candidate documents plus 20 × (five masked documents + one token
lookup) are read per run: 141 document reads before query minimums/retries. With four
30-minute dispatchers this is at most 27,072 such reads/day under full samples; idle
probes cost an empty query only. Watch actual billing/latency and sample saturation.
No full collection scan or count aggregation is introduced. Sampling can miss later
eligible rows behind excluded/unknown prefixes; the unknown alert and Admin Queue
Monitor must remain visible rather than claiming exhaustive coverage.

Committed outcome logs happen **after** transaction/batch completion, not inside callbacks
that Firestore can retry. Stale/deletion-denied transitions do not count as imports or
new failures. Wahoo explicitly marks the post-event persistence completion path; its
pre-persistence claim-release path is not an imported outcome. Legacy non-awaited
BulkWriter submissions are not counted before their commit. Logs are best effort,
so an invocation crash between commit and emission can undercount. Logger failure
must never undo an import or cause provider work to replay.

## Initial alert policies

All thresholds are initial operating values, not production volume guarantees. Tune
from normal traffic, history-import bursts and actual failure classifications.

| Policy | Initial threshold (per provider unless stated) |
| --- | --- |
| Sustained undispatched work | At least two samples with eligible work untouched for ≥1 hour within 90 minutes |
| Repeated dispatch failures | At least two failed dispatcher invocations within 90 minutes |
| Processing failure surge | At least ten retry/failure attempts within 15 minutes |
| New dead-letter surge | At least three committed DLQ moves within 30 minutes |
| Task HTTP failures | At least twenty non-`ok` attempts within 15 minutes, shared queue |
| Observations unavailable | At least two failed/unknown samples within 90 minutes, or any provider heartbeat missing for two hours |

Threshold conditions remain breached for at least 60 seconds. Numeric missing data is
inactive, not synthesized as zero; the separate heartbeat absence condition monitors
telemetry outages. Absence detection needs an initial series and cannot certify initial
activation. Expected token-refresh contention, processed/stale tasks, lifecycle skips
and deferrals never enter the processing-failure metric. DLQ counts are not percentages
and exclude tasks that only find an existing dead letter.

Cloud Monitoring sends opened/closed notifications directly through the selected email
channel, **not** the Firebase email extension. Reuse #655's approved opened/closed
email proof when using the unchanged Alerts channel; do not inject customer/provider
failures or create/delete temporary test policies without exact separate approval.

## Diagnosis and release evidence

1. Open **QS Activity Imports** in Cloud Monitoring and **Admin → Queue Monitor**.
   Separate native dispatched/retry work from the bounded Firestore sample.
2. Inspect fixed provider/outcome charts and dispatcher executions. An empty/unknown
   sample cannot prove there is no backlog. Missing scopes, disconnected accounts,
   retained DLQ records and HTTP acknowledgement are not successful imports.
3. In Logs Explorer use `jsonPayload.message="[ActivityImport]"` and
   `jsonPayload.telemetryVersion=1`, optionally with one fixed provider/event/outcome.
   Correlate platform execution traces, not identifiers copied into metric labels.
4. Use existing private admin diagnostics for individual records only when authorized.
   No blind replay, purge, rate-limit change or provider enablement is authorized by alerts.
5. After approved activation record API readback of all 11 metrics, dashboard filters,
   six policies, existing channel, no duplicates/unrelated mutations, and query responses
   for the dashboard/conditions. Record four provider idle/live heartbeats and genuine
   committed outcomes as available; absent traffic is not fabricated test proof.

Only fixed provider, event and outcome labels plus bounded numeric/boolean samples enter
these logs. No UIDs, job IDs, titles, emails, signed URLs, payloads, raw errors or credentials
enter metric/incident fields. This does not expose an account-data read API.

## Verification and product/MCP impact

```bash
npm run test:import-monitoring
npm run test:training-monitoring
npm run test:emulator-coverage
npm run test:workflows
npm --prefix functions test -- src/queue/import-monitoring.spec.ts src/tasks/workout-processor.spec.ts \
  src/queue-utils.spec.ts src/queue.spec.ts src/coros/queue-processing.spec.ts \
  src/wahoo/queue-store.spec.ts src/wahoo/processor.spec.ts
npm run test:functions-emulators -- mcp-data
npm --prefix functions run build
npm --prefix functions run entrypoint:check:compiled
npm --prefix functions run secrets:check:compiled
git diff --check
```

The new real-Firestore probe tests run in CI's existing isolated `mcp-data` group; that
group name does not make these probes MCP tools. Functions-only emulation can still
reach production Firestore: use the sanitized demo Firestore/Auth runner above, never
live credentials or actual provider calls for probe/lifecycle tests.

MCP impact review: no exposed tools, metrics, read/write schemas, consent, permissions,
proposals, completion projections, provider actions or bundled skills change. Existing
Training completion calls, event writes and activity sanitizer paths remain unchanged.
Help's import/service/troubleshooting articles were inspected; no user-facing behavior
changes, so no new product Help copy is required. Runtime/config activation and live
readback remain explicitly pending in #829, not a completed local test claim.
