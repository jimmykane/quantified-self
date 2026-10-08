# Route queue monitoring (#833)

Issue [#833](https://github.com/jimmykane/quantified-self/issues/833) covers route import and
outbound saved-route copies. It is separate from recorded-activity import (#829),
recorded-activity delivery (#832), Health/Sleep (#830), derived metrics (#831), and
Training planned-workout delivery (#655).

## Current implementation stage

The first slice, deployed on 2026-10-08, adds versioned, fixed-category `[RouteQueue]` observations to
`processRouteSyncTask`, `processRouteDeliverySyncTask`, the existing queue transition
helpers, and rejected-original cleanup. No route monitoring dashboard, metric, alert
policy, email, or production configuration has been created by that slice. The next
local slice adds bounded eligibility observations and dispatch-failure telemetry, and
isolates the existing route dispatcher. This new code is not deployed. The independent
route monitoring bundle and separately approved activation remain in #833's scope;
the issue stays In progress.

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
provenance and revision, source generations, reconnect/restore/disconnect states,
pinned destination accounts, credential-generation guards and stored route permissions.
The import worker has no processing-time Pro gate, so the import observation does not
invent one. Unsupported/contradictory route categories never count as eligible work.
This is local-state eligibility, not a claim that an OAuth credential or route file will
be accepted by a provider; actual worker failures remain separate observations.

Age starts at the later of creation and the observed queue update time. A positive
count/age is a lower bound even in an incomplete sample. A truncated or unknown sample
with no positive eligible records omits count/age entirely; it must not clear an alert
as healthy zero. Read failures and timeout emit unavailable for all four fixed groups.
Already-started reads may finish after the deadline, but no further account reads or
late healthy samples start. Observations never write queue/account state, pin accounts,
refresh tokens, call providers, or authorize processing.

## Entrypoints and resources

`processRouteDeliverySyncTask` and `cleanupRejectedRouteOriginalFile` now use isolated
owner-module loaders, joining already-isolated `processRouteSyncTask` and
`redriveRejectedRouteOriginalCleanup`. The local dispatcher follow-up loads directly
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

## Verification and next slice

Focused tests cover canonical fixed labels, malformed/prototype keys and task payloads,
privacy, logger failure (including preserving a worker ACK), success/skip/ACK separation,
stale replacements, deletion fences, failed persistence, retried transactions, retries,
exhaustion, cleanup failure phases, bounded masks/deadlines, partial samples, actual
immediate/reconciliation failures, deterministic duplicates, pinned-account mismatches,
credential rotation, permission loss, source revisions, reconnects and direction settings.
The real Firestore tests use loopback emulators with synthetic `demo-*` projects and
match the app's `ignoreUndefinedProperties` setting. They are registered in CI's
`mcp-data` group, not silently skipped outside the emulator workflow.

```bash
npm --prefix functions test -- src/routes/monitoring.spec.ts src/routes/monitoring-probe.spec.ts src/routes/route-sync-queue.spec.ts src/route-delivery-sync/queue.spec.ts src/route-delivery-sync/dispatcher.spec.ts src/tasks/route-queue-monitoring.spec.ts src/queue-utils.spec.ts src/route-delivery-sync/process-queue-item.spec.ts src/routes/rejected-original-cleanup.spec.ts
node --test tools/functions-emulator-suites.test.mjs
npm run test:functions-emulators -- mcp-data
npm --prefix functions run entrypoint:check
npm --prefix functions run deploy:safety:compiled
git diff --check
```

Remaining work tracked directly in #833:

- Add a separately owned route dashboard, native transport depth/delay charts, independent
  sustained-backlog/processing/DLQ/manual-review/cleanup/telemetry policies using
  `tools/monitoring/` provisioning. Prove idempotent reapply, ownership and preservation
  of existing bundles; use fixed labels only.
- With separate approval, deploy the affected Functions, apply the bundle with the
  existing enabled email channel, and verify configuration plus positive natural
  post-creation samples without creating/deleting production routes or replaying sends.

Help was reviewed: operational instrumentation does not change the saved-route or
connection UI, so no Help change is required. **No MCP wire impact:** no tools, schemas,
responses, scopes, consent, Assistant actions or bundled skills change. These events
are internal observations, not athlete data or provider actions exposed through MCP.
