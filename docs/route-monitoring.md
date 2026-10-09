# Route queue monitoring (#833)

Issue [#833](https://github.com/jimmykane/quantified-self/issues/833) covers route import and
outbound saved-route copies. It is separate from recorded-activity import (#829),
recorded-activity delivery (#832), Health/Sleep (#830), derived metrics (#831), and
Training planned-workout delivery (#655).

## Current implementation stage

The first slice, deployed on 2026-10-08, adds versioned, fixed-category `[RouteQueue]` observations to
`processRouteSyncTask`, `processRouteDeliverySyncTask`, the existing queue transition
helpers, and rejected-original cleanup. No route monitoring dashboard, metric, alert
policy, email, or production monitoring configuration has been created by that slice.
The follow-up, deployed from commit `67cce336d` on 2026-10-08 at 09:50 UTC, adds bounded
eligibility observations and dispatch-failure telemetry, and isolates the existing route
dispatcher. With separate approval, the independent `tools/route-monitoring/` bundle
was applied from pinned commit `94bc51e35` on 2026-10-08, completing by 10:18 UTC
(13:18 Helsinki): one **QS Routes** dashboard, 16 versioned log metrics and eight
enabled policies using the existing Alerts email channel. Configuration and query
readback passed. The natural 10:30 UTC run initialized all four post-creation
heartbeats and idle count/age series; Monitoring readback at 10:31–10:32 UTC
completed #833's operational verification.

The authoritative provider lifecycle remains in [Provider Integration Guide](provider-integration-guide.md).
No entitlement, provider support, transport, revision, lease, scheduling, retry, rate,
TTL, disconnect, or deletion behavior changes. There is no new scheduler or unbounded
scanner; the bounded observations run on the existing outbound dispatcher.

## Signals and privacy

| Event | Meaning |
| --- | --- |
| `worker_attempt` | Whole task latency and ACK/retry/error classification, including payload unpacking and initial Firestore reads. Malformed payloads still fail and use fixed unknown source/destination labels. ACK is **not** committed import/delivery success. |
| `committed / success` | Explicit successful import persistence, or outgoing acceptance plus metadata and guarded queue finalization. |
| `committed / skipped` | Persisted expected skip, including the guarded disabled-route transition. Never route success or a processing-failure page. |
| `committed / retry` | Actual retry-state persistence; not a successful route send. |
| `committed / expected_contention` | Recognized provider-operation/token-refresh contention; exclude from repeated-failure pages. |
| `committed / dead_lettered` | Newly committed failure record, not the retained `failed_jobs` total or a repeated failed-job ACK. |
| `committed / manual_reconciliation` | Newly durable replay blocker for an accepted/ambiguous provider operation. May overlap with a new dead letter. Never an automatic resend instruction. |
| `original_cleanup` | Deleted, stale/malformed intent discarded, or failed cleanup, with a fixed validation/read/Storage-delete/intent-delete/backoff phase. |
| `dispatch_failure` | Actual immediate or reconciliation guard/enqueue/marker/cleanup failure. A deterministic task duplicate, stale marker or successful lifecycle exclusion is not failure. |
| `dispatch_run` | Scheduled reconciliation completed or threw. Completion is not a provider success and can coexist with individually failed candidates. |
| `queue_sample` | Bounded eligible fresh-undispatched count and age lower bound, with separate excluded/unknown counts and a truncation flag. Never a complete backlog total. |
| `queue_sample_unavailable` | Read/Auth/deadline failure; no healthy-zero count or age. |

Import uses fixed `lane=import`, `source=suunto`, `destination=qs`. Outgoing copies use
`lane=delivery`, `source=suunto`, and `destination=garmin|wahoo|coros`. Mode is
`automatic|manual`; malformed or contradictory categories use `unknown`. Labels come
from the registered route contract, not unchecked queued provider strings. Cleanup
uses `lane=cleanup` and fixed outcome/phase only.

New operational events contain **no** user/account/route/job IDs, route names, bounds,
geometry, original-file paths or buckets, credentials, provider payloads, or raw errors.
Existing private diagnostic logs and queue records are unchanged; do not export them
into metric labels or incident email text.

Observations run after persistence resolves, not inside retryable transaction callbacks.
Stale or deletion-fenced guarded transitions and persistence failures emit no new
commit. Queued, unawaited BulkWriter writes make no commit claim. Logger failures are
best effort and cannot authorize delivery or turn accepted provider work into a retry.
Existing inbound legacy transition semantics are unchanged; this is instrumentation,
not a new concurrency or deletion guarantee for those writes.

## Bounded backlog eligibility

`dispatchRouteDeliverySyncQueue` observes both import and delivery after its existing
reconciliation, even when the transport-depth lookup fails or the native queue is full.
It does not redispatch imports or change candidate selection. Native Cloud Tasks depth
and delay remain authoritative for issued tasks and retry backoff.

Both lanes share a five-second deadline. Each processed-false, oldest-first query uses
an explicit field mask and a 21-document limit: 20 inspected plus a truncation sentinel.
At most 40 candidates enter read-only transactions. Outbound entitlement checks are
cached within the invocation (at most 20 Auth reads). Each destination-token query
reads at most six masked records (five plus a sentinel); incomplete or ambiguous
account selection is unknown, not zero. No original files, geometry, names, credentials,
error arrays, provider URLs or provider payloads are fetched. Internal account/revision
identifiers and credential generations are compared only; they never enter telemetry.

Fresh work excludes processed/terminal outcomes, future dates, retry backoff, issued
tasks, leases, provider-operation claims, persisted acceptance, deferrals and manual-review
blockers. A single read-only transaction rechecks the queue's exact update time, owner,
deletion tombstone and source identity/lifecycle. Delivery additionally checks rollout,
Pro, automatic direction settings (manual copies bypass those settings only), saved-route
provenance and revision, source generations, reconnect/disconnect states,
pinned destination accounts, credential-generation guards and stored route permissions.
The import worker has no blanket processing-time Pro gate: unchanged/unlisted routes
can be retired without an upsert, while new/changed imported-route persistence still
requires Pro. The probe therefore does not exclude all non-Pro inbound work or grant
write access. A route-restoration marker alone does not block incoming imports, enabled
outbound directions or manual copies; the probe matches those worker rules rather than
hiding their backlog. Disabled automatic directions and persisted restoration deferrals
remain excluded. Unsupported/contradictory route categories never count as eligible work.
This is local-state eligibility, not a claim that an OAuth credential or route file will
be accepted by a provider; actual worker failures remain separate observations.

Age starts at the later of creation and the observed queue update time. Exact timestamp
equality retains Firestore's sub-millisecond precision; emitted age is rounded down to
whole milliseconds so it remains a lower bound. COROS's legacy account-ID fallback
accepts only an absent/empty ID, never malformed falsy values such as `0` or `false`.
A positive count/age is a lower bound even in an incomplete sample. A truncated or unknown sample
with no positive eligible records omits count/age entirely; it must not clear an alert
as healthy zero. Read failures and timeout emit unavailable for all four fixed groups.
Already-started reads may finish after the deadline, but no further account reads or
late healthy samples start. Observations never write queue/account state, pin accounts,
refresh tokens, call providers, or authorize processing.

## Entrypoints and resources

`processRouteDeliverySyncTask` and `cleanupRejectedRouteOriginalFile` now use isolated
owner-module loaders, joining already-isolated `processRouteSyncTask` and
`redriveRejectedRouteOriginalCleanup`. The deployed dispatcher follow-up loads directly
from `route-delivery-sync/dispatcher`, retaining Gen 1, `europe-west2`, 256 MiB,
300 seconds, maximum one instance, no secrets and its unchanged 30-minute cron.
Full Firebase discovery still exports 168 endpoints; 82 targets now have isolated loaders.
Both workers retain Gen 2, 1 GiB, 540 seconds, their original secrets and Cloud Tasks
retry settings. Cleanup retains Gen 2, 256 MiB, 60 seconds, concurrency one, maximum
20 instances and retryable document-updated trigger. Redrive retains its 30-minute
schedule, 512 MiB, 540 seconds and maximum one instance.

See [entrypoint contracts and benchmarks](functions-entrypoint-loading.md#route-monitoring-entrypoint-verification-2026-10-08).
Do not use local cold-import RSS measurements to lower runtime memory without
separate worker-load evidence.

## Dashboard and initial alert thresholds

The dashboard has 19 charts plus a semantics/runbook panel. Native task depth,
HTTP attempts and p95 dispatch delay cover exactly `processRouteSyncTask` and
`processRouteDeliverySyncTask` in `europe-west2`, separately by queue. These charts
include normal retries and are diagnostic, not proof of provider success. Worker
commits, attempts, latency, failures, new permanent/manual-review transitions and
original cleanup are Gen 2 signals. Dispatch failures cover both Gen 1 and Gen 2:
the webhook/scheduler and immediate callable/worker enqueues must not be conflated.
The Gen 1 dispatcher supplies all four lane/destination heartbeat and backlog groups.

Policies use fixed lane/destination aggregates except cleanup, which aggregates
failure phases. Missing threshold data is inactive, not fabricated zero; unknown
observations and missing operational heartbeats have independent policies. Each
threshold requires a 60-second retest window and opens/closes notifications through
one explicitly selected existing email channel. Thresholds are initial settings to
tune against measured route volume, not partner quotas or unique-route counts.

| Policy | Initial condition | Important exclusion / interpretation |
| --- | --- | --- |
| Sustained eligible work | Two positive samples with age >= 1 hour per lane/destination in 90 minutes | Fresh undispatched work only; excludes future dates, retries, leases, provider claims and lifecycle waits. A bounded sample is not complete backlog coverage. |
| Repeated dispatch failures | Three actual failures per lane/destination/runtime generation in 90 minutes | Gen 1 and Gen 2 have separate conditions. Deduplicated tasks, stale-marker refusals and successful lifecycle exclusions do not count. Whole-run failures can have unknown destination. |
| Repeated processing failures | Ten failed-attempt or actual committed-retry observations per lane/destination in 15 minutes | A generic retry attempt alone is insufficient; recognized contention, ACKs, skips and deferrals do not count. |
| New permanent failures | Three newly committed DLQ transitions per lane/destination in 30 minutes | Never retained `failed_jobs` totals or already-failed acknowledgements. |
| New unresolved provider outcomes | Three newly durable replay blockers per lane/destination in 30 minutes | May overlap DLQ. Ambiguous/accepted side effects remain protected; an alert never authorizes resend. |
| Repeated original cleanup failures | Three failure-phase observations in 30 minutes | Cleanup and backoff-persistence failures may describe the same attempt. Stale/malformed intent discards are expected. The chart retains the fixed phase for diagnosis. |
| Observations unavailable | Two unavailable/unknown samples per lane/destination in 90 minutes | Includes truncated samples with no proven eligible count. Known saturation with a positive count is diagnostic alone. |
| Required observation heartbeat missing | No operational observation for two hours, independently for import/QS and delivery/Garmin/Wahoo/COROS | Idle lanes still emit. This never pages merely for no new routes. An initial post-activation series is required for each group. |

Sample count and last-write-age charts use hourly distribution means, not summed
workout totals or interpolated histogram percentiles that could show a positive value
for an idle zero observation. Means are diagnostic summaries of lower-bound observations,
not complete counts or oldest ages. The backlog policy instead counts the exact emitted
positive/age predicates. See Google's [aggregation contract](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v1/projects.dashboards#Aggregation)
and [metric-absence initialization requirement](https://docs.cloud.google.com/monitoring/alerts/metric-absence).

## Provisioning and activation

`tools/route-monitoring/cli.mjs` reuses `tools/monitoring/` without changing shared
provisioning behavior. Preview is fully offline: no credentials, network, filesystem
output, email or cloud writes. Definitions carry owner `qs-route-monitoring-v1` and
metric names `qs_route_*_v1`, independent of Training, import, Health/Sleep and activity
delivery bundles. Preflight reads the selected enabled email channel and all paginated
inventories before the first write. Title/owner collisions, duplicate managed resources,
different policy identities, malformed inventories and immutable metric schema drift
fail closed. Serial reapply preserves dashboard etags and condition IDs, with no duplicate
POSTs or DELETEs; unrelated configuration and notification channels are not modified.
The route CLI compares resolved entrypoint paths so a symlinked checkout or macOS
`/tmp` alias cannot silently skip setup. Importing it as a module still performs no
setup; project/channel/confirmation validation and the cloud-write boundary are unchanged.

Preview:

```bash
node tools/route-monitoring/cli.mjs --project=quantified-self-io
```

Only after explicit approval to apply this specific bundle, replace the placeholder
with the existing Alerts email channel's numeric ID and run:

```bash
node tools/route-monitoring/cli.mjs \
  --project=quantified-self-io \
  --notification-channel='projects/quantified-self-io/notificationChannels/EXISTING_ALERTS_CHANNEL_ID' \
  --confirm-project=quantified-self-io --apply
```

The CLI deliberately offers no purge/delete/disable/replay options. Existing Functions
are already deployed; this step creates/updates monitoring configuration only. No new
Functions deployment, Hosting, Rules, indexes, provider calls or email-test policy is
needed for the bundle. Production activation must record:

1. API readback of one owned dashboard, 16 metrics and eight valid enabled policies
   bound to the selected channel; compare unrelated resource identities/configuration.
2. All 19 chart and 12 condition queries, including each native queue, both dispatch
   runtime generations and exact cleanup/heartbeat groups. Empty failure series can be
   normal; a valid empty query is not positive telemetry proof.
3. Positive post-creation metric points from the next natural 30-minute run for all
   four heartbeats and the idle count/age series when present. Earlier raw logs do not
   backfill newly created log metrics or establish metric-absence initialization.
4. Reuse the existing same-channel email evidence where valid. New fault injection,
   temporary policies, test emails, route mutations or resource deletion require
   separate exact-scope approval.

### Cost and diagnosis

The local bundle adds no scanner, scheduler, provider traffic or Firestore reads.
It consumes existing telemetry plus native task metrics; the already-deployed bounded
probe's cost is described above. Activation is not guaranteed free: log-based metric
time series, alert conditions and queries follow current [Google Cloud Observability pricing](https://cloud.google.com/products/observability/pricing).
Keep the six extracted labels fixed and bounded; Cloud Run resource revisions can
still introduce additional series. Check actual billing/series volume before tuning
thresholds or adding dimensions. Never add customer identities to reduce ambiguity.

Start an incident with lane/destination and the relevant queue, then correlate fixed
outcomes, native task transport and private lifecycle diagnostics in Logs Explorer.
ACK/dispatch completion is not provider acceptance. Missing/unknown samples cannot
clear a backlog as healthy zero. Inspect accepted-operation journals privately before
any recovery; do not clear claims, purge queues or blindly replay. Cleanup phase
diagnostics must not become original-file paths or account/route identifiers in email.
Permission, provider, lifecycle or retry fixes belong to their owner workstream, not
an alert-side change to delivery policy.

## Verification and completion evidence

The approved follow-up deployment updated only `dispatchRouteDeliverySyncQueue`,
`processRouteSyncTask`, `insertSuuntoAppRouteToQueue`, `addSuuntoAppRoutesToQueue`, and
`backfillRouteDeliverySyncRoute`. API readback confirmed all five ACTIVE on Node.js 22
with new revisions and unchanged generation, memory, timeout, concurrency, instance
limits, secret bindings and trigger configuration. Both native route task queues remain
RUNNING with unchanged rate/retry settings; the existing dispatcher scheduler remains
ENABLED with its unchanged `*/30 * * * *` schedule and `America/Los_Angeles` time zone.
No other Function update timestamps changed. The required query indexes were already
READY; no indexes, Rules, Hosting or monitoring resources were deployed.

The pinned snapshot passed the Functions build, 246 targeted unit tests, deployment-file
safety, all 168 endpoint / 82 isolated-target entrypoint contracts and all 69 secret-bound
endpoint checks. The same source had previously passed 45 isolated Firestore emulator
tests. At 09:51 UTC, the post-update log query had no new route observations. The natural
10:00 UTC dispatcher run subsequently emitted a completed reconciliation and all four
idle, complete samples with zero eligible count/age, no unknown rows and no truncation.
At that point this proved log emission only, not post-creation metric-series or policy
behavior; the later monitoring verification below completes that evidence. Deployment
success alone is not evidence of backlog, provider receipt or working alerts. No
scheduler was manually invoked and no production route or provider copy was created,
deleted or replayed for this verification.

The separately approved monitoring application on 8 October used the exact reviewed
bundle from `94bc51e35`, without another Functions deployment. The 16 log metrics
were created between 10:16:33 and 10:17:00 UTC. API readback at 10:18–10:19 UTC
confirmed one owned dashboard, 16 matching metric schemas and eight valid, enabled
policies with 12 conditions and the selected existing email channel. Google's metric
descriptor label order differs from request order; comparing labels by key confirmed
the exact schemas, rather than mistaking that ordering for drift.

All 19 dashboard chart queries and 12 condition queries passed, with no execution
errors. Six additional exact-queue queries found native depth, HTTP attempts and
dispatch-delay series for both route queues. Digest comparisons confirmed that every
unrelated dashboard, policy, log metric and all four notification channels remained
unchanged. All 55 offline monitoring/workflow tests passed. No test email, temporary
policy, fault injection, manual scheduler run, route mutation, replay or deletion was
used. Existing same-channel notification proof is reused.

The newly created route log metrics were still empty at the configuration readback;
valid empty queries and the earlier 10:00 UTC logs were not positive metric proof.
The natural 10:30 UTC dispatcher run (13:30 Helsinki) emitted all four complete idle
samples. At 10:31–10:32 UTC, Monitoring returned positive post-creation heartbeat
points and real zero-valued count/age distribution observations for import/QS and
delivery/Garmin, Wahoo and COROS. The four heartbeat conditions' actual queries
returned positive heartbeat data, and both dashboard hourly-mean queries returned
zero for every group. These are observations of an idle bounded sample, not a claim
of complete queue coverage or provider receipt. All eight policies remained valid
and enabled. No scheduler invocation, cloud reapplication, route mutation, provider
call, fault injection or new email test was used for this verification.

Focused tests cover canonical fixed labels, malformed/prototype keys and task payloads,
privacy, logger failure (including preserving a worker ACK), success/skip/ACK separation,
stale replacements, deletion fences, failed persistence, retried transactions, retries,
exhaustion, cleanup failure phases, bounded masks/deadlines, partial samples, actual
immediate/reconciliation failures, deterministic duplicates, pinned-account mismatches,
credential rotation, permission loss, source revisions, reconnects, direction settings,
restoration with enabled versus disabled directions and manual copies,
sub-millisecond commit timestamps and malformed versus absent COROS token identities.
The real Firestore tests use loopback emulators with synthetic `demo-*` projects and
match the app's `ignoreUndefinedProperties` setting. They are registered in CI's
`mcp-data` group, not silently skipped outside the emulator workflow.
The offline bundle tests evaluate actual log-filter definitions against synthetic
idle/old/unknown/saturated/retry/DLQ/cleanup/dispatch entries, verify chart dimensions and
policy scope, and exercise paginated ownership preflight plus serial no-duplicate
reapplication while preserving the four other monitoring bundles. They run in CI's
existing unit job; no emulator or production credentials are needed for these tools.

```bash
npm run test:route-monitoring
npm --prefix functions test -- src/routes/monitoring.spec.ts src/routes/monitoring-probe.spec.ts src/routes/route-sync-queue.spec.ts src/route-delivery-sync/queue.spec.ts src/route-delivery-sync/dispatcher.spec.ts src/tasks/route-queue-monitoring.spec.ts src/queue-utils.spec.ts src/route-delivery-sync/process-queue-item.spec.ts src/routes/rejected-original-cleanup.spec.ts
node --test tools/functions-emulator-suites.test.mjs
npm run test:functions-emulators -- mcp-data
npm --prefix functions run entrypoint:check
npm --prefix functions run deploy:safety:compiled
git diff --check
```

All #833 acceptance criteria are verified; no implementation or activation step
remains. Monitoring impact decision: **covered, activated and verified**, including
positive natural post-creation metric evidence. The 8 October preflight found no
route-owner resources or name collisions; production readback preserved all four
earlier owned bundles. Operational follow-up is threshold tuning against measured
volume, not further activation or provider lifecycle work.

Help was reviewed: operational instrumentation does not change the saved-route or
connection UI, so no Help change is required. **No MCP wire impact:** no tools, schemas,
responses, scopes, consent, Assistant actions or bundled skills change. These events
are internal observations, not athlete data or provider actions exposed through MCP.
