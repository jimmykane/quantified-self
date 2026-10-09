# Recorded-activity delivery monitoring (#832)

This bundle monitors **outbound recorded activities** in `activitySyncQueue`,
`processActivitySyncTask` and `dispatchActivitySyncQueue`. Automatic cross-provider
routes, historical sends and retained manual FIT uploads are included. Suunto, Wahoo
and COROS are delivery destinations; Garmin is a source, not a recorded-activity
upload destination. This is neither inbound import monitoring (#829), Health/Sleep
ingestion (#830), route delivery (#833), nor Training planned-workout delivery (#655).

The two affected Functions were deployed with separate approval on 8 October 2026.
The twelve log metrics, dashboard and seven enabled alert policies were subsequently
activated with separate approval using the existing Alerts email channel. Configuration
readback and positive post-creation heartbeat time series for all three destinations
passed. This completes #832's operational activation evidence, distinct from the
successful deployment/apply alone.
There is no additional scheduler, paid warm instance or email Function. Cloud
Monitoring sends opening/closing notifications to the existing enabled Alerts email
channel, independently of the Firebase mail extension.

## Outcome semantics and privacy

The versioned `[ActivityDelivery]` structured events contain fixed source,
destination, mode and outcome categories only. They never include user/account/event
IDs, titles, original files, provider upload IDs, signed continuation URLs,
credentials or raw exceptions. Unknown/contradictory routes use `unknown`, not an
untrusted label. All twelve current automatic/manual route contracts are tested.

| Observation | Meaning |
| --- | --- |
| Committed `delivered` | Guarded queue finalization persisted explicit `resultStatus: success` |
| Committed `skipped` | An explicit terminal skip, not delivered |
| `provider_pending` | Accepted Wahoo/COROS status-only polling or recognized Suunto `NEW`/`PROCESSING` wait, not delivered or a failure |
| `retry` | A real committed retry, excluding normal pending polls and expected contention |
| `expected_contention` | A known provider-operation/token-refresh wait, not an outage |
| `dead_lettered` | A newly committed guarded DLQ transition, not retained failed-job totals |
| `manual_reconciliation` | A newly durable unresolved-provider outcome; automatic upload replay is unsafe |
| Worker `acknowledged` | The task returned normally; it does **not** prove delivery |

DLQ and manual-reconciliation observations may overlap for the same transition.
Stale writes, deleted-user refusals and failed persistence emit no successful commit.
A failed finalization can resume the accepted provider operation without uploading
again. Normal retries are counted once via the committed transition, not again by
the worker's intentionally thrown retry response. Queue polling latency and native
HTTP attempts include expected waits and are diagnostic rather than success rates.
Suunto retains its existing Cloud Task retry/backoff flow and resume identifiers;
its explicit `NEW`/`PROCESSING` results emit pending instead of failure telemetry.
Unknown/malformed status, transport failures and exhausted retries still emit actual
failure/DLQ observations. This classification does not change polling or retry budgets.

Confirmed COROS processing-failure restarts are covered by the existing committed
`retry` outcome and per-destination processing-failure policy. Pending status checks
remain `provider_pending`; budget exhaustion retains the failed upload identifiers
and emits the existing DLQ/manual-reconciliation outcomes only after commit.
Monitoring definitions, labels, thresholds and native queue scope are unchanged.

Telemetry is best-effort after existing commits, not an audit ledger or an exactly-once
counter: logging can fail, and a committed write followed by container loss can omit
an observation. Logging failures never change delivery/acknowledgement behavior.
Existing private operational logs and retained jobs remain the investigation source;
do not copy their sensitive contents into issues, email or metric labels.

## Bounded read-only observation

The existing **30-minute** dispatcher emits three destination observations, even when
idle. Its probe reads at most **20 unprocessed records plus one look-ahead**, ordered
by creation time, with a field mask. It does not read original files, errors, secrets
or continuation payloads, write records, or call providers.

New undispatched candidates require zero retries, no active operation/lease, current
Pro access (cached per user for this invocation), an existing non-deleting user,
connected token roots/token presence and the applicable enabled automatic route.
Historical/manual sends need only their destination connection and do not require
an automatic-route setting or the source connection. These are conservative lifecycle
checks, not proof that a token is refreshable or a provider will accept the file.

Ordinary retries/backoff, future dates, parked disconnect/reconnect work, active
claims and lifecycle skips are excluded. Accepted Wahoo/COROS status polls qualify
only when their saved due marker is **at least two hours overdue**, the dispatcher
successfully observed **zero native tasks**, and no active operation remains. COROS
also requires its saved provider-account resume ID. Already accepted polls do not
require renewed new-upload entitlement, new-send allowlisting or the automatic route
setting. They are observed, never reset or resent. Missing native depth/resume
information is unknown.

Each eligible row is re-read in a read-only transaction with owner, deletion,
settings and connection snapshots; a changed queue revision is excluded. Token
subqueries select only service metadata. Age is measured from the later of the
queue's last write and creation/due time, not the source recording's date. Unknown
data/read failure emits unknown/unavailable, never healthy zero. A five-second probe
deadline prevents further iterations or late healthy samples; an already-started
Firestore read cannot be cancelled and may finish after the deadline.

The shared oldest-prefix sample is a **lower bound**, not a complete count or global
health guarantee. A saturated prefix (including intentionally excluded rows) can
hide later destinations/work. `truncated`, unknown/excluded counts and native queue
charts expose this limitation; inspect Queue Monitor privately when diagnosing.
Legacy records without the ordered field cannot appear in this query. No new index
is required: the existing `processed`/`dateCreated` query is reused.

## Dashboard and seven initial policies

`tools/activity-delivery-monitoring/definitions.mjs` owns twelve log metrics, the
**QS Activity Delivery** dashboard and seven enabled-policy definitions. The native
charts select only `processActivitySyncTask` in `europe-west2`: depth, HTTP attempts
and dispatch delay. Other charts distinguish fixed source/destination/mode outcomes,
whole-worker latency, actual failures, new DLQ/manual cases and bounded observations.
The sample distributions are presented as hourly means of lower-bound observations,
not sums of a backlog. Distribution alignment/reduction follows the
[Cloud Monitoring aggregation contract](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aggregation).

| Policy | Initial condition, per destination unless noted |
| --- | --- |
| Sustained eligible work | Two samples with eligible work at least one hour old within 90 minutes |
| Repeated dispatch failures | Three dispatch/deletion-guard read failures within 90 minutes, globally |
| Repeated processing failures | Ten failed attempts/actual committed retries within 15 minutes |
| New permanent failures | Three new DLQ commits within 30 minutes |
| New unresolved provider outcomes | Three new durable manual-reconciliation cases within 30 minutes |
| Observations unavailable | Two unknown/unavailable observations within 90 minutes |
| Required observation heartbeat missing | No observation for two hours, independently for each destination |

Threshold violations require 60 seconds of persistence and treat missing data as
inactive. The separate absence policy detects operational observation loss, never
the absence of athlete uploads. Absence detection requires an initial series, so
positive heartbeat proof is part of activation. Thresholds are starting values to
tune against volume; an existing backlog alone does not emit new-failure metrics.
The enqueue helper returns `false` only for deterministic-name deduplication;
actual transport failures throw. Deduplication and stale marker refusals do not
feed the dispatch-failure metric, nor do normal worker poll acknowledgements.
Correlate dispatch errors with native transport and persisted markers before
taking action; a dispatch failure is not a provider rejection.

Incident response: inspect the aggregate dashboard/native task transport, then the
affected persisted job privately. Pending processing, ambiguous acceptance and DLQ
are different states. Do not blindly replay an upload, clear a claim, purge a queue,
change retries/concurrency or grant credentials to make an alert disappear. Any such
mutation needs its own authorization and the existing lifecycle-safe workflow.

## Cost bounds and verification

No new recurring invocation is added. Idle observation costs one query and three
logs every 30 minutes (48 times/day). A busy probe reads at most 21 queue snapshots,
then up to 20 read-only transactions (at most eight guarded documents plus two
single-token subqueries each) and 20 cached Auth lookups per run. Transaction retries
can add reads. This is bounded, but not free: ordinary Firestore reads, extra runtime,
structured logs and user-defined Monitoring metric ingestion/time-series costs apply.
Fixed dimensions avoid per-user cardinality; keep provider payloads out of labels.
The existing task-depth lookup is reused, not fetched a second time by the probe.

Local checks:

```sh
npm run test:activity-delivery-monitoring
npm run test:emulator-coverage
npm run test:workflows
npm --prefix functions test -- src/activity-sync src/tasks/activity-sync-worker.spec.ts src/queue-utils.spec.ts src/function-target-loader.spec.ts
npm run test:functions-emulators -- mcp-data
npm --prefix functions run entrypoint:check
npm --prefix functions run secrets:check
npm --prefix functions run deploy:safety:compiled
git diff --check
```

The isolated demo Firestore suite covers idle samples, all three destinations,
historical/manual routes, entitlement, deletion/disconnect/route exclusion, pending
polls, overdue polls after new-send allowlist changes, malformed scheduling metadata,
changed revisions, field masking and twenty-row saturation.
Unit tests protect post-commit success/manual/DLQ semantics, failure/no-replay paths,
expected task deduplication, timeouts and logging isolation. Offline provisioning tests exercise create/reapply,
ownership/immutable-schema rejection and preservation of all other monitoring bundles.
These tests run in CI; no production fault injection or test upload is required.

## Approved deployment and activation steps

After separate approval, deploy only the two affected handlers:

```sh
npm --prefix functions run build
firebase deploy --only functions:processActivitySyncTask,functions:dispatchActivitySyncQueue --project quantified-self-io
```

Both use direct owner-module target loading. The worker retains Gen 2, 1 GiB, 540
seconds, its existing secrets/retries/rate limits; the dispatcher retains Gen 1,
256 MiB, 300 seconds, maximum one instance, no secrets and its 30-minute schedule.
See [entrypoint verification](functions-entrypoint-loading.md#recorded-activity-delivery-dispatcher-isolation).
There is no generation migration, schema/Rules/TTL change or new deployment export.

The approved deployment from commit `66bc89cb2` completed on 8 October 2026 at
06:29 UTC. Readback confirmed both Functions active on Node.js 22 with the above
resources, the worker's latest Cloud Run revision ready, and unchanged task-queue
retry/rate limits. The existing enabled scheduler remains every 30 minutes with
its `America/Los_Angeles` time zone; its job is in `europe-west3`, while the Function
and Pub/Sub topic remain in `europe-west2`. No manual invocation, direct provider QA request,
test email or monitoring-bundle apply was performed. This is deployment/configuration
evidence, not post-creation metric-series or provider-delivery proof.

Preview is offline and needs no credentials or network:

```sh
node tools/activity-delivery-monitoring/cli.mjs --project=quantified-self-io
```

After separate approval to activate the twelve metrics, one dashboard and seven
policies using the existing enabled email channel, supply its exact resource name:

```sh
node tools/activity-delivery-monitoring/cli.mjs --project=quantified-self-io --notification-channel=projects/quantified-self-io/notificationChannels/EXISTING_CHANNEL_ID --apply --confirm-project=quantified-self-io
```

The shared provisioner checks inventories and ownership before writes, refuses
title-only adoption or incompatible metric schemas, preserves condition IDs and
dashboard etags, updates serially, and never deletes resources or creates email
channels. It preserves the Training, import and Health/Sleep bundles. Reapplying
does not duplicate this bundle. Private API errors/channel labels are not printed.

After activation, read back exactly one owned dashboard, twelve log metrics and seven
enabled policies, their conditions and the unchanged email channel. Check policy
validity and each dashboard query through the API. After the next normal dispatcher
run, verify a post-metric-creation heartbeat **time series** for Suunto, Wahoo and COROS;
pre-creation raw logs are not enough. Record aggregate-only dated evidence in #832,
then close it. Alert email exercises or production data changes need separate approval.

### Production activation readback — 8 October 2026

The approved apply completed at approximately 06:49 UTC. Readback at 06:49:54 UTC
confirmed exactly one owned dashboard, twelve owned log metrics and seven enabled,
valid policies, matching the source-controlled definitions. API default omission of
zero tile positions and default STRING label types, and label-descriptor ordering,
were normalized for comparison; no semantic configuration difference was accepted.
All fourteen dashboard time-series queries passed API validation. Baseline hashes
confirmed that all four notification channels and the unrelated four dashboards,
nineteen policies and thirty-six log metrics remained unchanged. No channel was
created, no resource deleted, and no test email, provider request or manual dispatcher
invocation was performed.

The dashboard is [QS Activity Delivery](https://console.cloud.google.com/monitoring/dashboards/builder/0511b72f-0b84-4d20-9daf-022f6f354eae?project=quantified-self-io).
It uses the existing enabled **Alerts** email channel, whose prior opening/closing
notification proof from completed #655 is reused rather than sending a new test email.

The deployed dispatcher naturally completed at 06:30 UTC and emitted idle observations
for all three destinations, with no unknown or truncated sample. Those logs preceded
the heartbeat metric's creation at 06:48:09 UTC and are **not** post-creation time-series
proof. At the initial configuration readback, the new heartbeat metric had no series yet.

The next normal run completed at 07:00:07 UTC (10:00 Helsinki). Read-only Monitoring
API verification at 07:01:16 UTC confirmed one positive heartbeat count for each of
Suunto, Wahoo and COROS, in the 07:00:16–07:01:16 UTC interval, after metric creation.
The corresponding logs reported an idle bounded sample with no unknown, excluded or
truncated records for every destination. These are genuine metric series, not inferred
from raw logs or synthesized zeroes. A natural automatic Garmin-to-Suunto delivery also
produced a positive committed `delivered` series after activation, separately from the
worker acknowledgement and latency series. No production fault or manual upload was
introduced to obtain this evidence.

The deployment, configuration/query readback, live heartbeat and reused same-channel
email proof complete #832. Idle lower-bound samples do not establish global backlog
coverage or receipt on a provider's app/watch, and absence of failure series is not a
fabricated failure test. Future tuning, cloud changes, email exercises and queue/data
mutations continue to require their own authorization.

## MCP, Assistant and Help impact

This is operational-only telemetry: no MCP tools, metrics exposed to athlete-data
reads, schemas, scopes, consent, Assistant permissions, provider actions, activity
data projections or bundled skills change. Training planning is untouched. Existing
Activity sync Help/status explanations were reviewed and remain accurate; an admin
Cloud Monitoring dashboard changes no user action or public provider capability.
