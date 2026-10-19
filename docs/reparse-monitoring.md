# Sports Lib reprocessing monitoring (#834)

This is operational monitoring for original-file activity and saved-route reparses, not
Training provider delivery or normal activity import. The authoritative processing design
remains the [Sports Lib reparse runbook](../functions/src/reparse/SPORTS_LIB_REPARSE_RUNBOOK.md).
It does not enable a campaign, reparse a recording, change worker resources, or implement
the heavy admission cap tracked separately in [#543](https://github.com/jimmykane/quantified-self/issues/543).

## Runtime and data boundary

| Existing Function | Generation / memory / timeout | Monitoring |
| --- | --- | --- |
| `scheduleSportsLibReparseScan` | Gen2 / 512 MiB / 300 s | Existing ten-minute discovery; bounded normal/heavy observation afterward |
| `scheduleSportsLibRouteReparseScan` | Gen2 / 512 MiB / 300 s | Existing ten-minute discovery; bounded route observation afterward |
| `processSportsLibReparseTask` | Gen2 / 1 GiB / 1,800 s | Whole attempt, task admission and committed job outcome |
| `processSportsLibReparseHeavyTask` | Gen2 / 8 GiB / 960 s | Same; existing maxInstances/concurrency/maxConcurrentDispatches remain one |
| `processSportsLibRouteReparseTask` | Gen2 / 4 GiB / 1,800 s | Whole attempt and committed route job outcome |

All five use isolated owning-module entrypoints; discovery still exports the full inventory.
CPU, native task retry/backoff, pacing, parser safe-runtime budgets, target version handling,
deletion guards and persisted queue states are unchanged. No new Function or schedule exists.

Local Node 22.23.3 cold-import verification on 19 October 2026 (three fresh processes per
scenario, medians after GC; startup measurements, **not parsing peaks or production billing**):

| Import path | RSS MiB | Heap MiB | Loaded modules | Startup ms |
| --- | ---: | ---: | ---: | ---: |
| Full discovery / former runtime fallback | 248.5 | 130.4 | 3,298 | 1,221 |
| Activity scanner | 105.1 | 28.0 | 1,083 | 329 |
| Route scanner | 105.7 | 28.0 | 1,084 | 362 |
| Normal worker | 111.3 | 29.9 | 1,251 | 412 |
| Heavy worker | 111.2 | 29.9 | 1,251 | 438 |
| Route worker | 113.8 | 30.2 | 1,267 | 445 |

The compiled entrypoint checker compares fresh isolated/full endpoint and trigger contracts;
normal/heavy/route resource assertions retain the existing 1/8/4 GiB workers rather than
mistaking their isolation for a request to downsize original-file parsing memory.

`[Reparse]` INFO telemetry version 1 has only fixed `normal`, `heavy`, `route` tier labels
and fixed outcome categories. No user/event/route/job/task identifier, source path, version
label, filename, provider response, raw error, activity metric or prescription enters it.
Observability exceptions never replace the original processing return value or error.

Whole-attempt ACK includes stale work, missing jobs, terminal/manual review and skips;
it is **not** a successful rewrite. `job_commit` is emitted only after the existing job
write completes, distinguishing completed, skipped and superseded. Recovered source skips
remain skips. Native HTTP attempts can include deliveries that never reached the handler.
Worker runtime-behind exceptions keep their existing retry behavior but are classified
`rollout_wait`, not operational failures. Deterministic task-name deduplication is not an
enqueue exception. Metrics count observations/attempts, not distinct jobs or athletes.

## Bounded observations, progress and cost

Each existing scanner observes its queue even when **new discovery is disabled**, because
turning discovery off does not cancel tasks already admitted. It queries only its root
job collection, not user histories, activity bodies, Storage, provider APIs or Cloud Tasks:

- At most ten oldest pending/processing/failed job documents, plus one cap sentinel, per
  collection. `limitToLast` reverses the wire order and needs `status ASC, updatedAt ASC`;
  the existing DESC admin-history index is not sufficient.
- Latest completed/skipped job for the running target and each applicable tier (two reads
  for normal/heavy, one for route). This prevents busy normal work hiding heavy starvation.
  Progress can include handled source skips; it does not assert a rewrite or a full batch total.
  Only `updatedAt` is selected. A completion inside the five-second observation window is
  fresh progress; a timestamp beyond that window is unknown rather than a fabricated stall.
- Each potentially eligible candidate is rechecked in a masked **read-only transaction**:
  current unchanged job, owner existence, account-deletion tombstone and exact owner-scoped
  event/route original-file references. A changed job is unknown; missing/deleting owners,
  deleted sources or absent original-file references are excluded. No original file is read.
- Five-second cooperative observation deadline; late reads cannot emit healthy samples or
  start further reads. In-flight reads are not forcibly cancelled. If discovery already used
  290 seconds, observation is skipped rather than extending the existing 300-second budget.
- At most five queue/progress queries and eighty candidate-validation document reads across
  both scanners per ten-minute cycle: at most 105 returned document reads before database
  billing/index details, with no application writes. Empty queries still have billing minima.
  This is bounded overhead, not zero cost; measure actual usage after separately approved activation.

Four new **collection-scoped** indexes use existing fields:

- `sportsLibReparseJobs`: targetSportsLibVersion ASC, processingTier ASC, status ASC, updatedAt DESC.
- `sportsLibRouteReparseJobs`: targetSportsLibVersion ASC, status ASC, updatedAt DESC.
- Each of those two collections: status ASC, updatedAt ASC, for the oldest-first sample.

They do not index recorded activities, routes, derived snapshots or all user subcollections.
They add index maintenance/storage to existing job writes; job TTL remains unchanged.
There is no monitoring document, global progress cursor, campaign record or migration.

Current-target non-terminal jobs are considered only after a five-minute pending enqueue
grace, or the **maximum four-hour native backoff** after failure. Interrupted processing
also gets the longest 30-minute task deadline. Future timestamps, version supersession,
manual-heavy/too-heavy review, terminal source rejection and exhausted failed attempts are
not eligible no-progress work. Existing source classifiers/extractors are reused, not copied.

An eligible sampled job must also be at least one hour old for normal/route, or six hours
for heavy, with no completion for that target/tier during the same window. Successful
same-tier completion suppresses the stall observation; idle/inactive campaigns do not page.
There is intentionally no unconditional missing-heartbeat or raw-depth incident.

Samples are **lower bounds**, not complete per-tier counts. Saturation or malformed/change-raced
metadata withholds a healthy zero; a proven positive remains useful despite a cap. An excluded
old prefix can hide later work, so repeated unknown/saturated observations raise a monitoring
warning, not a fictitious processing failure. Documents missing indexed fields are not scanned.
No-target or missing metadata is not proof of healthy work. Latest completion reads are
conservative suppression evidence, not owner-specific completion or device evidence.

## Owned dashboard and policies

`tools/reparse-monitoring/definitions.mjs` owns dashboard **QS Sports Lib Reprocessing**,
ten `qs_reparse_*_v1` log metrics and seven policies under `qs-reparse-monitoring-v1`.
Native depth, HTTP-attempt and dispatch-delay charts are scoped to the three exact task
queues in `europe-west2`. Heavy depth alone is diagnostic, never critical.

| Policy | Initial condition | Severity |
| --- | --- | --- |
| Normal/route worker failures | Five exceptional attempts per tier in 30 minutes | Error |
| Heavy worker failures | Three exceptional attempts in six hours | Warning |
| Normal/route no progress | Three positive stalled observations per tier in one hour | Error |
| Heavy no progress | Three six-hour-stalled observations in two hours | Warning |
| Task admission failures | Three actual enqueue exceptions per tier in one hour | Error |
| Discovery failures | Three scanner exceptions in one hour | Error |
| Observation health | Two unavailable/unknown observations per tier in one hour | Warning |

Policies use a 60-second retest window, inactive missing-data evaluation and two-hour
autoclose, notifying the independently configured existing Alerts **email channel** on
OPENED and CLOSED. The Firebase email extension is not involved. No new test email or
notification channel is needed; reuse the recorded #655 opened/closed email proof.
Rolling alignment/retest means these are initial sustained thresholds, not exact wall-clock SLAs.
Multi-tier policy filters use exact `one_of` membership rather than mixed label AND/OR
expressions, following [Monitoring filter syntax](https://docs.cloud.google.com/monitoring/api/v3/filters).

## Verification and separately approved activation

Local code, configuration and offline/emulator verification do **not** activate alerts.
The shared provisioner preflights ownership/channel/schema before writes; serial reapply
preserves this bundle's policy/condition IDs and dashboard etag, every other monitoring
bundle and every channel. It never deletes resources or creates channels.

Offline preview (no credentials or network):

```sh
node tools/reparse-monitoring/cli.mjs --project=quantified-self-io
npm run test:reparse-monitoring
npm run test:functions-emulators -- mcp-data
```

After separate explicit approval, deploy **only the four additive job indexes** and
wait for READY, then deploy the five existing Functions listed above. Rules do not change.
Do not enable discovery or change its persisted/compile-time settings. A whole-index
deployment must not silently delete an unrelated cloud index; inspect the proposed diff.

After separate explicit activation approval, apply using the existing enabled email channel:

```sh
node tools/reparse-monitoring/cli.mjs --project=quantified-self-io \
  --notification-channel=projects/quantified-self-io/notificationChannels/7874469028377828627 \
  --apply --confirm-project=quantified-self-io
```

Read back all ten metrics, seven enabled policies, condition IDs, dashboard queries and
the unchanged email channel; reapply serially to verify identity preservation. Await natural
ten-minute scanner samples **after metric creation**, including positive normal/heavy/route
sample series while discovery is inactive. Verify expected zero sampled work, not inferred
successful parsing. Never manually invoke a reparse just to seed telemetry. Actual production
batch success/failure/latency and heavy thresholds require an independently approved reparse;
record aggregate-only evidence in #834 and do not close on missing/unknown telemetry.

On an incident, inspect the independent admin Queue Monitor and private job metadata:
confirm current target, pending eligibility, source/owner guards, backoff, processing budget,
terminal/manual-heavy status, cap saturation and same-tier progress before taking action.
An observation failure may simply mean an index is not READY. Do not blindly retry heavy
jobs, clear task names, purge records, enable discovery or change limits. Those are separate
operator-approved actions, not alert remediation side effects.

## Product and MCP impact review

This change only observes existing internal original-file reprocessing. It adds no public
MCP metric, tool, schema, scope, consent, Assistant instruction, plugin capability or Training
mutation; no wire contract changes. App Help was reviewed: reprocessing behavior and user
actions do not change, so no user-facing help change is appropriate. Parser/model/library
upgrades, provider enablement, retention and recorded-activity projections are unchanged.

## Delivery status

#834 implementation is local on `develop`. No #834 index, Function, metric, dashboard,
policy or channel has been deployed/activated by this change. Production readback, natural
post-creation sample proof and separately approved real-batch evidence remain in #834.

Read-only production preflight on 19 October 2026 found no existing reparse metric, policy
or dashboard among 106 log metrics, 55 policies and nine dashboards. Plan-only Firestore
queries (`analyze: false`, no document results) confirmed both existing DESC job indexes;
the corresponding ASC queries returned `FAILED_PRECONDITION: no matching index found`.
This is why the two oldest-first indexes are included despite passing emulator tests.

Local verification on 19 October 2026:

- Fifteen focused Functions suites: 393 tests passed, including unchanged original-file
  parsing, non-activity skips, normal/heavy routing, native retries and deletion fences.
- Complete isolated `mcp-data` emulator group: twenty files / 496 tests, none skipped;
  nine new reparse cases cover tiers, idle, retry/terminal/source exclusions, caps,
  concurrent replacement, account deletion, malformed progress and recovery.
- All nine offline monitoring bundles: 83 tests, including safe reapplication that preserves
  the eight other bundles, every condition ID and the independent email channel.
- Functions build, compiled entrypoint checks (180 endpoints / 99 isolated targets),
  deployment-package and Secret Manager checks (70 existing secret-bound endpoints) passed.
  These are local checks, not deployments.
- Emulator registration/coverage, delivery shard and reusable workflow guards passed.
  Focused non-mutating ESLint had zero errors; 74 existing `no-explicit-any` warnings
  in the legacy scheduler specs were left out of scope. `git diff --check` passed.
- MCP/Help review: no wire or user-action changes; no additional consent or public metric.
