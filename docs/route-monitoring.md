# Route queue monitoring (#833)

Issue [#833](https://github.com/jimmykane/quantified-self/issues/833) covers route import and
outbound saved-route copies. It is separate from recorded-activity import (#829),
recorded-activity delivery (#832), Health/Sleep (#830), derived metrics (#831), and
Training planned-workout delivery (#655).

## Current implementation stage

The first local slice adds versioned, fixed-category `[RouteQueue]` observations to
`processRouteSyncTask`, `processRouteDeliverySyncTask`, the existing queue transition
helpers, and rejected-original cleanup. No route monitoring dashboard, metric, alert
policy, email, or production configuration has been created by this slice. The queue
backlog probe and route-specific monitoring bundle remain in #833's scope; the issue
must remain In progress until those and separately approved live activation pass.

The authoritative provider lifecycle remains in [Provider Integration Guide](provider-integration-guide.md).
No entitlement, provider support, transport, revision, lease, scheduling, retry, rate,
TTL, disconnect, or deletion behavior changes. There is no new scheduler or queue scan.

## Signals and privacy

| Event | Meaning |
| --- | --- |
| `worker_attempt` | Whole task latency and ACK/retry/error classification, including initial Firestore reads. ACK is **not** committed import/delivery success. |
| `committed / success` | Explicit successful import persistence, or outgoing acceptance plus metadata and guarded queue finalization. |
| `committed / skipped` | Persisted expected skip, including the guarded disabled-route transition. Never route success or a processing-failure page. |
| `committed / retry` | Actual retry-state persistence; not a successful route send. |
| `committed / expected_contention` | Recognized provider-operation/token-refresh contention; exclude from repeated-failure pages. |
| `committed / dead_lettered` | Newly committed failure record, not the retained `failed_jobs` total or a repeated failed-job ACK. |
| `committed / manual_reconciliation` | Newly durable replay blocker for an accepted/ambiguous provider operation. May overlap with a new dead letter. Never an automatic resend instruction. |
| `original_cleanup` | Deleted, stale/malformed intent discarded, or failed cleanup, with a fixed validation/read/Storage-delete/intent-delete/backoff phase. |

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

## Entrypoints and resources

`processRouteDeliverySyncTask` and `cleanupRejectedRouteOriginalFile` now use isolated
owner-module loaders, joining already-isolated `processRouteSyncTask` and
`redriveRejectedRouteOriginalCleanup`. Full Firebase discovery still exports 168 endpoints.
Both workers retain Gen 2, 1 GiB, 540 seconds, their original secrets and Cloud Tasks
retry settings. Cleanup retains Gen 2, 256 MiB, 60 seconds, concurrency one, maximum
20 instances and retryable document-updated trigger. Redrive retains its 30-minute
schedule, 512 MiB, 540 seconds and maximum one instance.

See [entrypoint contracts and benchmarks](functions-entrypoint-loading.md#route-monitoring-entrypoint-verification-2026-10-08).
Do not use local cold-import RSS measurements to lower runtime memory without
separate worker-load evidence.

## Verification and next slice

Focused tests cover canonical fixed labels, malformed/prototype keys, privacy, logger
failure, success/skip/ACK separation, stale replacements, deletion fences, failed
persistence, retried transactions, retries, exhaustion, and cleanup failure phases.
The real Firestore tests use loopback emulators with synthetic `demo-*` projects and
match the app's `ignoreUndefinedProperties` setting. They are registered in CI's
`mcp-data` group, not silently skipped outside the emulator workflow.

```bash
npm --prefix functions test -- src/routes/monitoring.spec.ts src/tasks/route-queue-monitoring.spec.ts src/queue-utils.spec.ts src/route-delivery-sync/process-queue-item.spec.ts src/routes/rejected-original-cleanup.spec.ts
node --test tools/functions-emulator-suites.test.mjs
npm run test:functions-emulators -- mcp-data
npm --prefix functions run entrypoint:check
npm --prefix functions run deploy:safety:compiled
git diff --check
```

Remaining work tracked directly in #833:

- Bound, field-mask and lifecycle/revision-fence import/delivery eligibility observations
  on the existing dispatcher. Exclude future work, leases, backoff, disconnected or
  deleted owners, disabled directions, unsupported/permission skips and obsolete source
  revisions. Unknown/unavailable observations must not become healthy zero.
- Instrument actual immediate/reconciliation dispatch failures without treating deterministic
  deduplication, stale markers or lifecycle exclusions as failures.
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
