# Sports Lib reprocessing monitoring (#834)

This is operational monitoring for original-file activity and saved-route reparses, not
Training provider delivery or normal activity import. The authoritative processing design
remains the [Sports Lib reparse runbook](../functions/src/reparse/SPORTS_LIB_REPARSE_RUNBOOK.md).
It does not enable a campaign, reparse a recording, change worker resources, or implement
the heavy admission cap tracked separately in [#543](https://github.com/jimmykane/quantified-self/issues/543).

## Runtime and data boundary

| Existing Function | Generation / memory / timeout | Monitoring |
| --- | --- | --- |
| `scheduleSportsLibReparseScan` | Gen2 / 512 MiB / 300 s | Existing ten-minute discovery; bounded normal/heavy observation hourly |
| `scheduleSportsLibRouteReparseScan` | Gen2 / 512 MiB / 300 s | Existing ten-minute discovery; bounded route observation hourly |
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

Each existing scanner observes its queue **hourly**, only on its scheduled tick in the
first ten minutes of each hour. Interval jobs can have a non-zero minute phase: the live
activity job runs at :00/:10/etc., while the route job runs at :06/:16/etc. The Scheduler
event's `scheduleTime`, not the Function's wall-clock start time, owns that decision so
late delivery does not shift the observation slot. The other five
ten-minute ticks still run discovery and emit its existing outcome telemetry, but perform
no monitoring queries. There is no new schedule, timer, persisted throttle or monitoring
record. Missing/invalid scheduled time reports unavailable observation without querying.

Hourly observation still runs when **new discovery is disabled**, because turning
discovery off does not cancel tasks already admitted. It queries only its root job
collection, not user histories, activity bodies, Storage, provider APIs or Cloud Tasks:

- At most ten oldest pending/processing/failed job documents, plus one cap sentinel, per
  collection. `limitToLast` reverses the wire order and needs `status ASC, updatedAt ASC`;
  the existing DESC admin-history index is not sufficient.
- Latest completed/skipped job for the running target, **only for tiers with validated
  eligible outstanding work** (at most two reads for normal/heavy, one for route).
  Empty, excluded or backoff-only tiers require no progress query. This prevents busy
  normal work hiding heavy starvation.
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
- Empty queues require **one query per collection per hour**, no progress or candidate
  validation reads: 48 query-minimum document reads per day across both scanners, down
  from 720. At most five queue/progress queries and eighty candidate-validation document
  reads are performed per hourly observation: at most 105 returned document reads, or
  2,520 per day at continuously full samples, down from 15,120. These are application-level
  budgets for 24 ordinary scheduled observations, before database billing/index details,
  late/repeated Scheduler delivery or service retries. No application writes are added.
  Worker/enqueue/scanner failure telemetry and native Cloud Tasks charts require no extra
  Firestore observation reads. Function runtime, logging and Monitoring are separate costs.
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
manual-heavy/too-heavy review and terminal source rejection are
not eligible no-progress work. Existing source classifiers/extractors are reused, not copied.

The stored job `attemptCount` is a lifetime processing count retained by manual retries and
re-enqueues, not the current Cloud Task's retry budget. It must not be used to infer native
task exhaustion. Non-terminal failed work remains unresolved after the retry grace, even
when native retries may have stopped; an incident never promises or automatically starts a retry.

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
The approved native-timeout correction keeps those counts and extends the existing
scanner policy to two conditions (eight conditions overall); it was applied and
verified on 19 October 2026.
Native depth, HTTP-attempt and dispatch-delay charts are scoped to the three exact task
queues in `europe-west2`. Heavy depth alone is diagnostic, never critical.

| Policy | Initial condition | Severity |
| --- | --- | --- |
| Normal/route worker failures | Five exceptional attempts per tier in 30 minutes | Error |
| Heavy worker failures | Three exceptional attempts in six hours | Warning |
| Normal/route no progress | Two positive hourly stalled observations per tier in three hours | Error |
| Heavy no progress | Two six-hour-stalled hourly observations in three hours | Warning |
| Task admission failures | Three actual enqueue exceptions per tier in one hour | Error |
| Discovery failures | Three structured exceptions per tier OR three native 5xx responses per scanner in one hour | Error |
| Observation health | Two unavailable/unknown hourly observations per tier in three hours | Warning |

Policies use a 60-second retest window, inactive missing-data evaluation and two-hour
autoclose, notifying the independently configured existing Alerts **email channel** on
OPENED and CLOSED. The Firebase email extension is not involved. No new test email or
notification channel is needed; reuse the recorded #655 opened/closed email proof.
Rolling alignment/retest means these are initial sustained thresholds, not exact wall-clock SLAs.
Hourly observation deliberately trades slower silent-stall detection for lower database
load; normal/route still need one-hour eligible age/no progress, heavy still needs six hours.
Three-hour observation windows allow multiple hourly samples despite boundary/ingestion
drift. Event-driven worker/enqueue/discovery failure thresholds are unchanged.
Multi-tier policy filters use exact `one_of` membership rather than mixed label AND/OR
expressions, following [Monitoring filter syntax](https://docs.cloud.google.com/monitoring/api/v3/filters).

The scanner policy's native-timeout correction uses the built-in
`run.googleapis.com/request_count` metric with `response_code_class="5xx"`, scoped
to the exact `schedulesportslibreparsescan` and `schedulesportslibroutereparsescan`
services, this project and `europe-west2`. It includes HTTP 504 timeouts even when
application code subsequently logs an ACK: Cloud Run can return 504 without terminating
the container's work ([request timeout behavior](https://docs.cloud.google.com/run/docs/configuring/request-timeout)).
The existing structured condition/name/identity remains intact. The new native condition
sums across revisions and response codes **per scanner service**, not a nonexistent
native `tier` label and not a combined activity/route total. Both conditions retain
three observations in one hour, a 60-second retest, inactive missing-data handling and
OR combination; their counts must not be added as distinct failures. One isolated
native timeout does not meet the repeated-failure threshold.

A matching native-error chart groups by service and response code. There are still
ten log metrics and seven policies; the active dashboard/condition bundle has
**28 queries**, versus the previously deployed 26. No metric, Function, observer,
Firestore read/write, index, schedule, timeout, retry or worker resource is added.
Native errors are independent of the optional hourly queue observation, so they are
not restricted to the first ten minutes of each hour.

Coverage is intentionally native **5xx request results**, not all scheduler delivery
failures: Cloud Run's request metric excludes requests that never reach a container,
including rejected authentication and some capacity failures
([metric definition](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#run)).
Use existing Cloud Scheduler execution logs to diagnose those or a missing invocation;
do not claim idle or missing native series proves successful dispatch. No unconditional
absence policy, broad severity matcher, new log metric or remediation is introduced.

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
hourly scanner samples **after metric creation**, including positive normal/heavy/route
sample series and genuine idle samples when no eligible work exists. Do not change existing
discovery settings to seed telemetry. Verify expected zero sampled work, not inferred
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

#834 monitoring was deployed and activated in `quantified-self-io` with explicit owner
approval on 19 October 2026. All four indexes are READY, five existing Functions are ACTIVE,
and the dashboard, ten metrics and seven enabled policies have live API readback. No new
Function, schedule or channel was created. Natural route-sample confirmation passed
at 10:06 UTC and representative normal-tier processing evidence is now recorded below.
The native scanner-timeout coverage gap discovered during the final closure check
was subsequently corrected, applied with separate owner approval and verified by
live readback at 12:28–12:32 UTC on 19 October 2026. #834's monitoring acceptance
criteria are complete. Structured attempt ACKs alone still do not establish scanner
health; see the native timeout and unavailable-sample evidence below. This correction
required no additional Functions, index or Rules deployment.

Read-only production preflight on 19 October 2026 found no existing reparse metric, policy
or dashboard among 106 log metrics, 55 policies and nine dashboards. Plan-only Firestore
queries (`analyze: false`, no document results) confirmed both existing DESC job indexes;
the corresponding ASC queries returned `FAILED_PRECONDITION: no matching index found`.
This is why the two oldest-first indexes are included despite passing emulator tests.

Initial implementation verification on 19 October 2026:

- Fifteen focused Functions suites: 394 tests passed, including unchanged original-file
  parsing, non-activity skips, normal/heavy routing, native retries and deletion fences.
- Complete isolated `mcp-data` emulator group: twenty files / 499 tests, none skipped;
  twelve reparse cases cover tiers, idle, retry/terminal/source exclusions, caps,
  concurrent replacement, account deletion, malformed progress, recovery and lifetime
  attempt counters retained by replacement tasks. Explicit terminal/manual-heavy states
  remain excluded; high cumulative counts alone do not hide unresolved failures.
- All nine offline monitoring bundles: 83 tests, including safe reapplication that preserves
  the eight other bundles, every condition ID and the independent email channel.
- Functions build, compiled entrypoint checks (180 endpoints / 99 isolated targets),
  deployment-package and Secret Manager checks (70 existing secret-bound endpoints) passed.
  These are local checks, not deployments.
- Emulator registration/coverage, delivery shard and reusable workflow guards passed.
  Focused non-mutating ESLint had zero errors; 74 existing `no-explicit-any` warnings
  in the legacy scheduler specs were left out of scope. `git diff --check` passed.
- MCP/Help review: no wire or user-action changes; no additional consent or public metric.

Hourly sampling cost review on 19 October 2026:

- Six focused Functions suites / 142 tests passed. Regressions cover all six discovery
  ticks but only one scheduled hourly observation, late delivery, invalid scheduled time,
  unchanged error propagation, deadline protection and one-query empty queues.
- Complete isolated `mcp-data` emulator group: twenty files / 499 tests, none skipped.
  The twelve reparse cases also assert actual query counts: one per empty collection,
  no completion query for excluded/backoff-only work or an idle sibling tier, and no
  candidate validation for empty queues. Account/source fences and tier isolation remain.
- All nine offline monitoring bundles / 84 tests and emulator coverage guards / 14 tests
  passed. Hourly stall/observation policies allow two bad samples in three hours;
  event-driven failure thresholds and resource ownership/reapplication contracts remain.
- Functions build, compiled entrypoint checks (180 endpoints / 99 isolated targets),
  focused non-mutating ESLint and `git diff --check` passed. Index
  definitions, discovery schedules/settings, workers, retry limits, Rules, MCP and Help
  are unchanged by the cost reduction. No production action or push was performed.

The approved deployment's live Scheduler readback exposed the route job's :06 interval
phase. The hourly gate now accepts the scheduled tick in minutes 0–9 rather than requiring
minute 0. Six focused suites / 151 tests and all nine monitoring bundles / 84 tests passed;
the regressions cover all ten possible minute phases, fractional scheduled timestamps,
and the actual :06 route cadence. No schedule or observation budget changed.

## Approved production activation — 19 October 2026

- Created only the four additive collection-scoped job indexes above and waited for READY.
  Firestore estimated about 3,600 activity-job documents for index building, not recorded
  activities or derived snapshots. No index or data deletion was requested.
- Deployed the five existing Functions from `e7f787284`, then redeployed only the two
  scanners with the offset-safe hourly gate from `85d094742`. Final revisions are ACTIVE;
  independent before/after readback preserved runtime generation/version, memory, CPU,
  timeout, concurrency, instance limits, service configuration, both schedules, all three
  queue retry/rate settings and the persisted discovery configuration. Discovery was
  already enabled and remains unchanged. No Rules, Hosting or provider deployment occurred.
- Build, 151 focused unit tests, 84 offline monitoring tests and deployment safeguards
  passed, including 180 endpoint / 99 isolated-target and 70 secret-binding checks.
  The previous complete 499-test isolated emulator run covers the unchanged observation
  queries; all ten minute phases and the production route phase have focused regressions.
- Activated [QS Sports Lib Reprocessing](https://console.cloud.google.com/monitoring/dashboards/builder/1cac6dcc-5ec4-41ec-850d-7773d3373118?project=quantified-self-io),
  ten owned log metrics and seven enabled policies through the existing independent Alerts
  email channel. All 26 actual chart/condition queries validated through the Monitoring API.
  Serial reapplication retained the dashboard and all policy/condition IDs without duplicates.
- Aggregate inventory changed from 106 to 116 log metrics, 55 to 62 policies and nine to ten
  dashboards. All 106 pre-existing metrics, 55 policies, nine dashboards and all four channels
  were hash-verified unchanged. No test email, temporary incident or new channel was created;
  reuse the existing same-channel #655 opened/closed email evidence.
- The natural 12:00 Helsinki / 09:00 UTC activity-scanner run emitted normal/heavy idle
  samples at 09:00:42 UTC after metric creation: zero eligible pending, zero unknown,
  not capped and not stalled. Both queue-sample series have positive post-creation points;
  normal and route scanner acknowledgment series also have positive points. No probe-failure
  series or worker/committed-job outcomes were observed in the bounded activation window.
  These idle/ACK observations do not establish successful reprocessing or real-batch latency.
- The route's 12:06 run preceded the timing correction and is not hourly-sample proof.
  Its corrected revision emitted the first natural route sample at **13:06:02.863 Helsinki /
  10:06:02.863 UTC**. Readback after ingestion confirmed a positive post-creation
  `qs_reparse_queue_samples_v1` route point at 10:08:26.931 UTC. The sample had zero eligible
  pending, zero unknown, no truncation and no stall. Normal/heavy natural samples at
  10:00:39 UTC had the same healthy idle values and positive post-creation points.
- Read-only follow-up through 10:10 UTC reconfirmed all five Functions ACTIVE, the two
  corrected scanner revisions, four READY job indexes, ten matching metrics, the same
  dashboard, seven enabled policies and all 26 valid chart/condition queries. Both existing
  ten-minute schedules and the existing Alerts email channel remain enabled. The bounded
  post-creation log/series window contained no probe failures, worker attempts or job commits;
  absence of worker traffic during idle is not evidence of successful parsing or batch latency.
- **At the 10:10 UTC readback, #834 remained open / In progress for representative real-batch progress, committed
  outcomes and latency evidence.** Reuse natural real work when it occurs; running or
  broadening a reparse requires separate approval. No scanner/worker was manually invoked,
  no task was replayed, no reparse was enabled, no email was sent and no provider API was called.
  No cloud configuration changed during this verification. #543 is unchanged. The heartbeat
  follow-up is paused once this evidence is recorded; another idle poll cannot supply batch proof.

## Representative processing proof and final closure check — 19 October 2026

Bounded read-only verification of the fixed **10:45–11:52 UTC** window confirmed:

- 290 normal-tier `job_commit:completed` observations after job persistence, spanning
  11:50:07.936–11:51:59.992 UTC, and 290 normal-tier worker ACK observations.
- All 290 worker observations carried durations, from 1,576 to 6,241 milliseconds.
  The positive `qs_reparse_worker_latency_v1` distribution contained 290 observations;
  positive worker-attempt and committed-outcome series were present as well. These
  are observations, not a deduplicated count of distinct jobs or accounts.
- Natural normal/heavy samples at 11:00:40.836 UTC and route sample at 11:06:02.177 UTC
  had zero eligible sampled pending work, zero unknowns, no cap and no stall, with
  positive Monitoring sample series for all three tiers. The next route sample at
  12:06:02.883 UTC was healthy too. Normal/heavy and route workloads remain distinct;
  this real-work evidence is normal-tier processing, not a claim of live heavy/route rewrites.
- The targeted structured-failure query returned no exceptional observations in that
  fixed window. All targeted queries were uncapped. The earlier broad 500-entry log
  query was capped and was not used as a complete count or proof of absence.
- Final configuration readback reconfirmed ten owned metrics, seven enabled policies,
  the existing dashboard/channel and all 26 actual chart/condition queries. No cloud
  configuration, source data, scheduler, worker, campaign or queue was changed, and
  no email or provider call was initiated for this verification.

The real-batch progress/outcome/duration evidence was therefore satisfied, but the
12:11 UTC native-health check found a separate coverage issue that prevented closure
at that time:

- The activity scanner's 11:50 UTC scheduled request returned **HTTP 504 after
  299.982 seconds**. Cloud Scheduler recorded **DEADLINE_EXCEEDED at 11:55:04.549 UTC**.
- The same scanner later emitted structured `scan_attempt:acknowledged` at
  **12:00:29.814 UTC**, with `durationMs: 628888`. Work continued after the request's
  native deadline. A later application ACK does not erase the failed scheduled request.
- The then-existing discovery-failure policy selected only structured `scan_attempt:failed`
  observations. It therefore misses this proven native-timeout path. The missing
  normal/heavy 12:00 sample must not be presented as another healthy idle observation.

**Outstanding at that check (subsequently completed below):** separately approved
application/readback of the corrected native scanner condition and matching dashboard
chart. Exact scanner scope, sustained thresholds and upgrade identity preservation
are covered by the regressions below.
Do not change scanner deadlines, discovery settings, worker resources, queue concurrency,
retry policy or the separate #543 admission-cap scope merely to silence this signal.
No native fault was injected and no processing was manually started for these checks.
#834 remained open / In progress until this gap was addressed and verified.

## Local native-timeout correction and review — 19 October 2026

The correction changes only `tools/reparse-monitoring/` definitions/tests and this
operational documentation. It adds one native condition to the existing `scanner`
policy and one chart without changing the existing structured condition or seven
policy identities. Reapplication fixtures start from the deployed structured-only
shape, append the native condition once, preserve all existing condition IDs and
the dashboard identity, and preserve the nine other monitoring bundles and channel.

Thirteen focused tests and all 101 tests across the ten monitoring bundles passed.
Fixtures cover both scanner names, 500/502/503/504/599 results without application
telemetry, successful/client-error exclusion, wrong projects/regions/metrics/resources,
unrelated workers and lookalike service names. Threshold tests retain one/two-error
non-alerting behavior, independent late ACKs, cross-revision sums and separation of
the two scanner services. The filter evaluator now uses Logging's OR-before-AND
precedence and supports exact Monitoring `one_of` membership rather than widening filters.

Read-only Monitoring queries found the already-observed activity-scanner 504 in the
existing native request metric. This is not a new metric waiting for ingestion and
no fault was injected. Read-only validation at **12:20 UTC** accepted all **28 proposed
chart/condition queries**, including the service-grouped native condition and the
service/response-code chart. Both native queries returned a positive point for the
recorded activity-scanner timeout in the fixed 11:40–12:15 UTC window; neither was
truncated. This validates filters and aggregation against real metric data, not
policy activation: the new condition and chart were **not yet applied at that check**.
No runtime code, Firestore query or queue behavior changed, so no Functions build or
new emulator run was required for this configuration-only correction. Existing Help,
MCP/Assistant, Training, parser and provider contracts remain unchanged. #543 is untouched.

## Approved native-timeout activation and completion — 19 October 2026

With the owner's separate approval, pushed `develop` through `5ca0d21ca`, applied
the corrected monitoring bundle and serially reapplied it. Final independent readback
at **12:28–12:32 UTC / 15:28–15:32 Helsinki** verified:

- Ten matching owned log metrics, seven enabled policies and **eight conditions**,
  including the new native 5xx/504 condition on the existing scanner policy. All
  28 actual chart/condition queries were accepted by Monitoring. All 20 chart queries,
  dashboard layout and 56 policy configuration fields match the source definitions,
  allowing API omission of empty repeated fields/default presentation fields.
- The original dashboard, all seven policy IDs and all seven original condition IDs
  were retained. Serial reapplication also retained the new condition ID. No metric,
  policy, dashboard or channel was added or deleted: totals stayed at **125 metrics,
  69 policies, 11 dashboards and four channels**. Hashes of all 115 unrelated metrics,
  62 unrelated policies, ten unrelated dashboards and all four channels are unchanged.
- The existing independent Alerts email channel remains enabled on every policy;
  reuse #655's same-channel OPENED/CLOSED email proof. No test email, fault injection
  or synthetic incident was created.
- The native condition's real time series includes the previously observed activity
  scanner HTTP 504. Its maximum aligned count in the bounded three-hour readback was
  **one**, below the repeated-failure threshold of three per scanner per hour. The
  structured scanner-failure condition had no series in that window. These results
  validate capture and thresholds; they do not erase the failed request or claim
  a real threshold-crossing incident/email was forced.
- Natural activity and route requests most recently returned HTTP 200, with application
  ACKs at **12:22:40 UTC** and **12:26:01 UTC**, respectively. The earlier normal/heavy
  hourly observation at **12:09:52 UTC** explicitly reported unavailable after an
  approximately 290-second scanner attempt. Both tiers have a positive observation-
  failure series, with maximum count one each in three hours (warning requires two).
  These are **not healthy idle samples**. Earlier verified healthy normal/heavy/route
  samples and representative 290 normal-tier committed outcomes/durations remain the
  live progress evidence; no live heavy/route rewrites are claimed.
- All five existing Functions remain ACTIVE. Before/after readback matched their
  revisions and resource controls, both enabled ten-minute schedules, all three task
  queue controls and persisted discovery configuration. This task deployed no Function,
  index or Rule and changed no runtime, retry, campaign, queue or provider behavior.

All 101 offline monitoring tests passed before application; focused reparse tests and
diff checks passed for these completion notes. Monitoring coverage is **covered** and
the approved #834 acceptance criteria are satisfied. This closes the observability
delivery, not the historical runtime timeout or unavailable observation as successful
runs. Further runtime investigation/tuning is separate from monitoring activation;
#543's heavy admission-cap scope/status remains unchanged. No scanner/worker was
manually invoked, no source data was written/deleted and no provider call was made.
