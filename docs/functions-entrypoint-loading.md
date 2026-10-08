# Firebase Functions target-aware entrypoint loading

The Functions package runtime main is `functions/src/index.ts`; the complete deployed-function registry lives in
`functions/src/full-entrypoint.ts`. Google sets `FUNCTION_TARGET` to the exported handler name when it starts a deployed
function container. The runtime main uses that value to load selected handlers without evaluating the complete backend
module graph.

## Loading paths

`functions/src/index.ts` has two paths:

- A recognized optimized target loads its provider module and exports the original Firebase function object under the
  requested name. Keeping the original object preserves trigger metadata, region, secrets, runtime generation, memory,
  timeout, concurrency and IAM configuration.
- Discovery, an absent target and an unknown target load `functions/src/full-entrypoint.ts`. This is the complete export
  surface used before target-aware loading and remains the safe fallback for Firebase CLI discovery, new functions and
  targets that have not been optimized.

Firebase discovery modes (`FUNCTIONS_CONTROL_API` and `FUNCTIONS_MANIFEST_OUTPUT_PATH`) always take precedence over an
inherited `FUNCTION_TARGET`. This prevents a developer or CI environment variable from reducing the deployment manifest
to a single optimized function.

Firebase Admin initialization lives in `functions/src/bootstrap.ts` and runs before either path. It remains idempotent,
uses the migrated EU Storage bucket and configures Firestore to ignore undefined properties.

The initial deployed canary included:

- `getSuuntoAPIAuthRequestTokenRedirectURI`
- `requestAndSetSuuntoAPIAccessToken`

`receiveSuunto247Data` also loads directly from `sleep/webhooks` and exposes only its original Gen 1 HTTP handler.
It uses 512 MiB, retains the 60-second timeout and `SUUNTOAPP_NOTIFICATION_SECRET` binding, and avoids loading the
complete entrypoint, MCP, AI and admin handlers. Signed webhook admission and durable queue staging are unchanged.
Its deployment does not migrate the endpoint to Gen 2 or change the provider's registered webhook URL.

The target map also isolates all 11 exports from `functions/src/admin/marketing/handlers.ts`, including the
`trackMarketingDelivery` Firestore trigger. That trigger observes updates to the shared `mail/{mailId}` collection even
when the updated email is not part of a marketing campaign. Its existing 256 MiB memory limit is unchanged; this routing
change needs a separately approved deployment and production memory check. The former `projectEventTagCatalog` endpoint
has since been retired and is excluded from discovery. Targets absent from the map use the complete entrypoint.

## Admin handler isolation

The remaining 16 exports from `functions/src/admin/index.ts` now load from their direct owner modules: users, queues,
reparse settings, dashboard history, trends, maintenance, impersonation, financials and subscription gifts. Together with
the 11 already isolated marketing exports, every admin export has a target-aware loader. The dynamically named
`retrySportsLibReparseHeavyJob` export retains its existing Firebase name and handler object. No callable behavior,
admin authorization, App Check, scheduled work or resource limit changes.

The users module legitimately imports MCP OAuth account helpers, and `getFinancialStats` legitimately imports BigQuery
for the admin billing view. The entrypoint check permits those dependencies only for their respective owners, while
rejecting unrelated admin modules, Genkit and the complete entrypoint. It also checks every admin export for loader
coverage and verifies each of the 16 newly routed endpoints' generation, region, trigger, memory, timeout, instance
settings and secret bindings. The dashboard snapshot retains its `10 0 * * *` UTC schedule and retry configuration;
financials retains `STRIPE_SECRET_KEY`, and both subscription-gift callables retain `STRIPE_ADMIN_BILLING_KEY`.

On 2026-10-06, three isolated Node 22.23.3 cold-import runs per target measured a 1,015 ms, 245.7 MiB RSS median
for the full entrypoint. Across the 16 new admin targets, the median of their three-run medians was 303 ms and
111.4 MiB RSS; `getFinancialStats`, which needs BigQuery, measured 406 ms and 135.4 MiB. Discovery still exposes
168 endpoints, and all 16 Firebase endpoint descriptors matched a pre-change snapshot byte-for-byte. These are local
import measurements, not production latency or billing savings. After a separately approved deployment, compare
production startup latency, billable CPU, memory, invocation counts and errors over matched complete days.

`mcpApi` loads directly from `mcp/server`, without the full entrypoint, Genkit, BigQuery or unrelated admin handlers.
Its existing Gen 2 HTTP endpoint remains in `europe-west2` with 1 GiB memory, a 120-second timeout, concurrency 4,
unchanged instance settings and only `MAPBOX_ACCESS_TOKEN` / `SUUNTOAPP_GUIDE_OWNER` secrets. This isolates startup;
it does not change MCP/OAuth behavior or keep a paid instance warm. Production deployment remains separately approved.

## Ingestion worker isolation

The loader also routes these existing Gen 2 functions directly to their owner modules:

| Target | Owner module | Preserved runtime and trigger |
| --- | --- | --- |
| `processSleepSyncTask` | `tasks/sleep-sync-worker` | 1 GiB, 540 seconds, Cloud Tasks |
| `processWorkoutTask` | `tasks/workout-processor` | 1 GiB, 540 seconds, Cloud Tasks |
| `uploadActivity` | `events/upload-activity` | 4 GiB, 2 CPUs, 3,600 seconds, HTTP, concurrency 1, max instances 20 |
| `fanOutSuuntoHealthWebhookIngress` | `suunto/health-webhook-ingress` | 512 MiB, 120 seconds, Firestore document created, concurrency 1, max instances 50 |

All four retain `europe-west2`, their original Firebase handler objects and their secret bindings. Both task workers
retain 10 attempts, 4 doublings, 900–14,400-second backoff, and unspecified task rate limits. The fan-out trigger retains
`suuntoHealthWebhookIngress/{ingressID}` and retries. Authentication, provider requests, correction/reconciliation
coverage, queue processing, writes and telemetry continue through the existing handlers.

This internal import change has no effect on MCP contracts, Training planning or user-facing help. No additional
instances are kept warm and runtime resources are unchanged.

## Health/Sleep backfill and dispatcher isolation

The remaining two #830 handlers now load directly from their existing owner modules, so all three affected
Health/Sleep functions have target-aware loading:

| Target | Owner module | Preserved runtime and trigger |
| --- | --- | --- |
| `processGarminHealthBackfillTask` | `tasks/garmin-health-backfill-worker` | Gen 2, 512 MiB, 1,800 seconds, Cloud Tasks |
| `dispatchSleepSyncQueue` | `sleep/dispatcher` | Gen 1, 256 MiB, 300 seconds, maximum one instance, `*/30 * * * *` |

Both retain `europe-west2` and the original Firebase handler objects. The backfill worker keeps its Garmin client
ID/secret bindings, 10 attempts, 4 doublings, 900–14,400-second backoff, one concurrent dispatch and one dispatch
per second. The dispatcher keeps no secrets and its default time-zone/retry settings. Neither gains explicit CPU,
minimum-instance or concurrency settings. This is startup isolation, not a Gen 2 migration of the scheduler or
an increase in its memory limit. Processing, lifecycle guards, account deletion, acknowledgement, retries and
single-task pacing continue through the unchanged handlers.

The compiled check captures their complete endpoint/trigger descriptors before importing the full registry and
compares them with a separate fresh discovery process. It also checks both inherited-target discovery modes,
standalone secret validation and the absence of the full entrypoint, Genkit, BigQuery, MCP and admin handlers.
Monitoring coverage is **unchanged**: #830 still uses `cloud_function` for the dispatcher and `cloud_run_revision`
for both workers. No dashboard, metric, policy, provider availability, Help or MCP contract change is needed.
Deployment and #830 monitoring activation/readback remain separately approved operational work.

## Recorded-activity delivery dispatcher isolation

`dispatchActivitySyncQueue` loads directly from `activity-sync/dispatcher`, alongside
the already isolated `processActivitySyncTask` worker. The dispatcher remains Gen 1
in `europe-west2`, 256 MiB, 300 seconds, maximum one instance, no secrets and
`*/30 * * * *` with unchanged default time-zone/retry settings. The original Firebase
handler object is preserved; full discovery still exposes 168 endpoints. This is not
a scheduler generation migration or a memory increase.

The compiled check compares isolated endpoint/trigger descriptors with fresh full
discovery and verifies both inherited-target discovery paths, standalone secrets and
absence of the complete entrypoint, Genkit, BigQuery, MCP and admin modules. #832's
telemetry uses `cloud_function` for this dispatcher and `cloud_run_revision` for the
worker. Monitoring is additive; existing delivery, cleanup, polling, retry and claim
behavior stays unchanged. Both handlers were deployed with separate approval on
8 October 2026 and passed active-state/configuration readback. Cloud alert activation
still requires separate approval. See [recorded-activity delivery monitoring](activity-delivery-monitoring.md).

Three local Node 22.23.3 cold-import runs on 2026-10-08 measured medians of 1,098 ms /
239.2 MiB RSS for full discovery, 365 ms / 120.7 MiB for `processActivitySyncTask`,
and 378 ms / 127.1 MiB for `dispatchActivitySyncQueue`. Isolated handlers each exported
one Function (1,439 / 1,421 loaded modules), versus 168 exports / 3,154 modules in full
discovery. These are local import measurements, not production latency, memory or
billing guarantees; no memory/runtime limit was changed.

## Recorded-activity import dispatcher isolation

The four existing source-queue dispatchers load directly from their shared owner module, `queue`, and export only
the requested original Firebase handler. They remain Gen 1 scheduled functions, not Gen 2 migrations:

| Target | Memory | Timeout |
| --- | --- | --- |
| `parseGarminAPIActivityQueue` | 1 GiB | 540 seconds |
| `parseSuuntoAppActivityQueue` | 1 GiB | 540 seconds |
| `parseCOROSAPIWorkoutQueue` | 256 MiB | 300 seconds |
| `parseWahooAPIWorkoutQueue` | 1 GiB | 540 seconds |

All four retain `europe-west2`, maximum one instance, `*/30 * * * *`, default time-zone/retry settings and no secret
bindings. Minimum instances, CPU and concurrency remain unspecified. The shared dispatch implementation and its
provider-processing dependencies remain in `queue`; this isolates the full application registry without introducing
a competing dispatch path or claiming a dependency-free scheduler. The original capacity limit, task spreading,
revision/connection/deletion guards, dispatch recovery and #829 observations are unchanged. Discovery and standalone
secret validation still expose the complete registry even with any of these targets inherited.

Monitoring coverage is **unchanged**: #829 still filters these dispatchers as `cloud_function`, and the Gen 2 worker
as `cloud_run_revision`. Existing metrics, dashboard and policies remain valid; activation/readback remains #829's
separate operational step. Help was reviewed; this internal loading change needs no user-facing copy. There is no
MCP tool, schema, scope, consent, projection, provider action or bundled-skill change.

## Scheduled maintenance isolation

Four existing Gen 2 scheduled functions load directly from their owner modules:

| Target | Owner module | Preserved runtime options |
| --- | --- | --- |
| `scheduleSuuntoHealthSync` | `sleep/polling` | 512 MiB, 300 seconds |
| `scheduleSuuntoSleepSync` | `sleep/polling` | 512 MiB, 300 seconds |
| `redriveRejectedRouteOriginalCleanup` | `routes/rejected-original-cleanup` | 512 MiB, 540 seconds, max instances 1 |
| `retryPendingServiceDisconnects` | `schedule/retry-pending-service-disconnects` | 512 MiB, 300 seconds |

All four retain `europe-west2`, their original Firebase handler objects, the `every 30 minutes` schedule and existing
time-zone and retry defaults. CPU, concurrency and minimum-instance options remain unspecified. Only the disconnect
retry job binds secrets: the existing client ID and client secret for COROS, Garmin, Suunto and Wahoo. Polling windows,
cursor progression, correction/reconciliation coverage, cleanup and disconnect recovery continue through the same
handlers. The internal loading change has no MCP, Training planning or user-facing help impact.

## Connection projection and Garmin Health isolation

Three more existing functions load directly from their owner modules:

| Target | Owner module | Preserved runtime and trigger |
| --- | --- | --- |
| `projectSuuntoConnectionOnTokenWrite` | `service-connection-account-projection` | Gen 2, 512 MiB, Firestore document written, concurrency 10, max instances 20 |
| `projectGarminConnectionOnTokenWrite` | `service-connection-account-projection` | Gen 2, 512 MiB, Firestore document written, concurrency 10, max instances 20 |
| `receiveGarminAPIHealthData` | `sleep/webhooks` | Gen 1, 1 GiB, 60 seconds, HTTP |

All three retain `europe-west2` and their original Firebase handler objects. The token projections retain retries and
their respective `suuntoAppAccessTokens/{userID}/tokens/{tokenID}` and `garminAPITokens/{userID}/tokens/{tokenID}` paths.
Their timeout, CPU and minimum-instance options remain unspecified; neither binds secrets. Projection bounds, revision
ordering, safe account fields and transaction-owned account-deletion checks continue through the same implementation.
The shared COROS projection remains on its previous loading path.

The Garmin receiver retains only `GARMINAPI_WEBHOOK_SECRET`, its existing instance defaults, webhook authentication,
payload validation and durable queue staging. Its generation and registered webhook URL are unchanged. No provider
request, feed selection, reconciliation, retry, write, telemetry or MCP contract changes are introduced. The app help
and connected-service content were reviewed; this internal startup change has no user-facing or Training planning impact.

## Activity, route and event cleanup isolation

Three more existing Gen 2 functions load directly from their owner modules:

| Target | Owner module | Preserved runtime and trigger |
| --- | --- | --- |
| `processActivitySyncTask` | `tasks/activity-sync-worker` | 1 GiB, 540 seconds, Cloud Tasks |
| `processRouteSyncTask` | `tasks/route-sync-worker` | 1 GiB, 540 seconds, Cloud Tasks |
| `cleanupEventFile` | `events/cleanup` | 1 GiB, 300 seconds, Firestore document deleted, concurrency 5, max instances 10 |

All three retain `europe-west2` and their original Firebase handler objects. Both workers retain 10 attempts,
4 doublings and 900–14,400-second backoff. Activity sync keeps its explicit limits of 500 concurrent dispatches and
250 dispatches per second; route sync keeps unspecified task rate limits. Activity sync binds only its existing COROS,
Suunto API and Wahoo secrets; route sync binds only its existing Suunto API secrets. CPU and minimum-instance settings
remain unspecified, as do the workers' runtime concurrency and maximum-instance settings.

Cleanup retains `users/{userId}/events/{eventId}`, its existing disabled trigger retries and no secret bindings. Its
event-recreation guards, transaction-owned cleanup of linked documents and metadata leaves, and Storage generation
preconditions continue through the same handler. Queue retries, provider status polling, provider requests, account
deletion checks and data writes also continue through their existing implementations.

The app help and connected-service content were reviewed. This internal loading change has no user-facing, Training
planning, MCP read/mutation contract or provider integration behavior impact.

## Garmin Ping dispatcher isolation

`dispatchGarminPingBatchOnWrite` loads directly from `sleep/garmin-ping-batch-dispatcher`. It retains the original Gen 2
Firebase handler in `europe-west2`, 512 MiB, concurrency 10, maximum 100 instances and retries on writes to
`sleepSyncQueue/{queueItemId}`. CPU, timeout and minimum-instance settings remain unspecified; no secrets are bound.
The compiled check serializes an unspecified timeout as null, matching Firebase's reset value without assigning a new
runtime timeout.

The dispatcher still watches the shared queue. Revision admission, account-deletion guards, revision-bound task
identity, ambiguous-enqueue recovery and dispatch-marker transactions use the same implementation. The scheduled
Sleep dispatcher remains its recovery path. No provider request selection, queue writes, trigger filtering or telemetry
changes are introduced. The app help was reviewed; there is no user-facing, Training planning or MCP contract impact.

This loading change is the first step of #759. Investigating invocation amplification remains separate: compare useful
dispatches with ignored queue writes before proposing a narrower durable dispatch path. A create-only trigger would
miss new revisions written to existing queue documents. The existing October 1–5 sample showed 111,970 requests and
only nine container starts, so local startup improvements alone do not establish a material reduction in daily costs.

## Verification

Run the routing and discovery contract:

```bash
npm --prefix functions run entrypoint:check
```

The check builds the Functions package and verifies:

- discovery exposes all 168 application exports;
- both Firebase discovery modes ignore an inherited optimized `FUNCTION_TARGET`;
- standalone secret-binding validation forces complete discovery even with an inherited ingestion `FUNCTION_TARGET`;
- an unknown target exposes the same complete export set;
- a non-optimized Gen 1 target retains the complete entrypoint fallback;
- each optimized target exposes only its requested handler;
- the optimized export is the exact object created by the provider wrapper;
- optimized Suunto startup does not import Genkit, BigQuery, MCP or admin handler modules;
- optimized marketing startup does not import Genkit, BigQuery, MCP or unrelated admin modules;
- optimized MCP startup avoids the full entrypoint, Genkit, BigQuery and unrelated admin handlers, preserves its
  original HTTP handler object, and retains the region, memory, timeout, concurrency, instance settings and secrets;
- optimized Suunto OAuth endpoints remain Gen 2 in `europe-west2` with 512 MiB and the same secret bindings;
- the isolated Suunto 24/7 receiver remains Gen 1 HTTP in `europe-west2`, with 512 MiB, a 60-second timeout,
  unchanged instance settings and only the notification secret;
- optimized marketing endpoints retain their callable, schedule, Firestore or HTTP triggers, existing memory limits,
  region and secret bindings;
- the four ingestion targets avoid the full entrypoint, Genkit, BigQuery, MCP and admin modules, while retaining CPU,
  memory, timeout, concurrency, instance settings, secrets, trigger kinds, retry options and task rate limits;
- the Garmin Health backfill worker and Sleep dispatcher avoid those unrelated modules, compare complete
  runtime endpoint/trigger descriptors with fresh full discovery, and preserve the backfill's 1,800-second/single-task
  contract and the dispatcher's Gen 1/256 MiB/30-minute schedule; inherited-target discovery and standalone secret
  validation remain complete;
- the four recorded-activity dispatchers avoid those unrelated modules, retain their Gen 1 scheduled-handler contracts,
  compare complete runtime endpoint/trigger snapshots with a separate fresh full-discovery process, and preserve
  complete discovery and standalone secret validation with each target inherited;
- the four scheduled maintenance targets avoid those unrelated modules, preserve their complete scheduled-handler
  contracts and allow standalone secret validation with any of their targets inherited;
- the two token projections and Garmin Health receiver avoid those unrelated modules, preserve their original trigger,
  generation, resource and secret settings, and allow complete discovery and standalone secret validation with each
  of their targets inherited;
- the activity/route workers and event cleanup avoid those unrelated modules, preserve their original Gen 2 runtime,
  secrets, task limits, retry behavior and deleted-document trigger, and allow complete discovery and standalone secret
  validation with each of their targets inherited;
- the Garmin Ping dispatcher avoids those unrelated modules, retains its original queue-write trigger, retries,
  resource defaults and zero-secret policy, and permits complete discovery and standalone secret validation with its
  target inherited;
- retired event-tag catalog and Garmin probe endpoints remain excluded from discovery.

CI runs the compiled check after the Functions build. Firebase Functions predeploy first rejects forbidden local
credential, environment and operational files, then runs the compiled entrypoint check and secret-binding validation.
This ordering prevents the full entrypoint from being evaluated before deployment-source safety succeeds, and a broken
discovery inventory cannot proceed to deployment.

Run the isolated-process benchmark:

```bash
npm --prefix functions run entrypoint:benchmark
```

Set `ENTRYPOINT_BENCHMARK_RUNS` to change the default five runs. Run it with Node 22 when comparing against production.
The command benchmarks the complete entrypoint and every target in the production routing table. It reports the minimum,
median and maximum import time, RSS, RSS delta, heap usage and CommonJS module count.

## Initial local benchmark

Three isolated Node 22.23.2 runs on 2026-09-18 produced these medians:

| Loading path | RSS after import | Import time | Heap used | Loaded modules |
| --- | ---: | ---: | ---: | ---: |
| Complete entrypoint | 227.9 MiB | 917 ms | 112.9 MiB | 3,086 |
| Suunto auth start | 120.4 MiB | 323 ms | 33.9 MiB | 1,411 |
| Suunto token exchange | 120.1 MiB | 318 ms | 33.9 MiB | 1,411 |

These are local cold-import measurements rather than production container measurements. They establish that the loader
avoids about 108 MiB of local startup RSS and more than half of the module graph. Production Cloud Monitoring remains
the source for rollout decisions.

Three isolated Node 20.19.3 runs on 2026-09-25, using the same machine and dependencies before and after the marketing
target-map change, produced these medians:

| Loading path | RSS after import | Import time | Heap used | Loaded modules |
| --- | ---: | ---: | ---: | ---: |
| Complete entrypoint before marketing routing | 218.2 MiB | 1,387 ms | 106.2 MiB | 3,104 |
| Complete entrypoint after marketing routing | 217.4 MiB | 1,052 ms | 106.3 MiB | 3,104 |
| Isolated `trackMarketingDelivery` | 116.7 MiB | 329 ms | 28.9 MiB | 1,306 |

All 11 marketing targets loaded the same 1,306-module marketing graph and measured 116.3–116.9 MiB median RSS. The
comparison suggests about 101 MiB less local startup RSS for the 256 MiB delivery trigger. It is not a production
memory guarantee; keep its memory limit unchanged for rollout measurement.

Three isolated Node 20.19.3 runs on 2026-09-25 measured 216.6 MiB median RSS, 954 ms import time and 3,108 modules
for the complete entrypoint, versus 62.2 MiB RSS, 83 ms and 264 modules for isolated `projectEventTagCatalog`. This
suggests about 154 MiB less local startup RSS. Production memory and retry logs must confirm the rollout.

Three isolated Node 22.23.3 runs on 2026-10-03 measured 234.9 MiB median RSS, 901 ms import time and 3,133 modules
for the complete entrypoint, versus 127.6 MiB RSS, 339 ms and 1,467 modules for `receiveSuunto247Data` with one export.
The approximately 107 MiB local startup reduction is not a production memory guarantee; the receiver also uses 512 MiB
to leave room for validated webhook admission and durable staging.

## Ingestion benchmark and verification (2026-10-06)

Three isolated Node 22.23.3 runs per target, with the same machine and dependencies before and after the ingestion
loader change, produced these medians. The baseline was `cc4bc8497`, where each target loaded the complete entrypoint.
Samples used the compiled benchmark's `--probe` mode with `--expose-gc`, the matching `FUNCTION_TARGET`, and neither
Firebase discovery environment variable set.

| Target | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `processSleepSyncTask` | 980 ms | 342 ms | 236.8 MiB | 120.3 MiB | 3,141 | 1,433 |
| `processWorkoutTask` | 944 ms | 371 ms | 237.7 MiB | 130.9 MiB | 3,141 | 1,513 |
| `uploadActivity` | 1,135 ms | 278 ms | 237.6 MiB | 110.8 MiB | 3,141 | 1,246 |
| `fanOutSuuntoHealthWebhookIngress` | 972 ms | 347 ms | 238.0 MiB | 121.3 MiB | 3,141 | 1,438 |
| Complete entrypoint control | 942 ms | 962 ms | 237.6 MiB | 236.6 MiB | 3,141 | 3,141 |

Each isolated target now exports one handler; discovery still exports 168. The local import reductions are about
61–75%, with 107–127 MiB less startup RSS. These measurements cover module import, and daily billing savings depend
on production container starts and their CPU time. Compare production startup latency, billable CPU, CPU per request,
memory, request volume, errors and retry/dead-letter outcomes over comparable complete days after deployment.

Verification passed:

- 129 tests across the loader, Firebase bootstrap, secret policy, deployment safety, Sleep worker, workout worker,
  upload and Suunto ingress specs;
- Functions TypeScript build and compiled entrypoint check: 168 endpoints and 45 isolated targets;
- complete Firebase endpoint descriptors for all four targets matched the pre-change baseline;
- deployment-source safety and secret-binding check: 69 secret-bound endpoints.

Review reproduced a predeploy failure when `FUNCTION_TARGET=processSleepSyncTask` was inherited: standalone secret
validation loaded only that worker and reported the other policy endpoints as missing. The secret-check script now
sets `FUNCTIONS_CONTROL_API=true` before loading the index so it always validates the complete registry. The compiled
entrypoint check runs standalone secret validation with each of the four ingestion targets inherited and discovery
flags cleared. Deployment safety also passed with an inherited `FUNCTION_TARGET=uploadActivity`.

The documentation-only changes were checked with `git diff --check`; they have no separate automated tests.
After separate explicit deployment approval, deploy the selected functions from this verified revision:

```bash
firebase deploy --project quantified-self-io \
  --only functions:processSleepSyncTask,functions:processWorkoutTask,functions:uploadActivity,functions:fanOutSuuntoHealthWebhookIngress
```

## Scheduled maintenance benchmark and verification (2026-10-06)

Three isolated Node 22.23.3 runs per target used the compiled benchmark's `--probe` mode, `--expose-gc`, the matching
`FUNCTION_TARGET` and neither Firebase discovery flag. The baseline was `6c4874fc6`, with the same machine and
dependencies before and after the loader change.

| Target | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `scheduleSuuntoHealthSync` | 937 ms | 335 ms | 236.8 MiB | 120.9 MiB | 3,141 | 1,431 |
| `scheduleSuuntoSleepSync` | 931 ms | 333 ms | 237.7 MiB | 120.2 MiB | 3,141 | 1,431 |
| `redriveRejectedRouteOriginalCleanup` | 937 ms | 73 ms | 237.6 MiB | 70.3 MiB | 3,141 | 262 |
| `retryPendingServiceDisconnects` | 944 ms | 322 ms | 237.2 MiB | 122.1 MiB | 3,141 | 1,422 |
| Complete entrypoint control | 937 ms | 951 ms | 237.7 MiB | 237.8 MiB | 3,141 | 3,141 |

Each runtime target exports one handler; discovery still exports 168. Local imports are about 64–92% faster, with
115–167 MiB less startup RSS. These measurements do not establish production billing savings. After deployment,
compare startup latency, billable CPU, memory, request counts, errors and scheduled recovery outcomes over comparable
complete days before considering changes to resource limits or polling frequency.

Verification passed:

- 69 tests across the loader, Firebase bootstrap, secret policy, Suunto polling, rejected-route cleanup and disconnect
  retry specs;
- Functions TypeScript build and compiled entrypoint check: 168 endpoints and 49 isolated targets;
- all four complete Firebase endpoint descriptors matched the pre-change baseline;
- deployment-source safety and secret-binding validation: 69 secret-bound endpoints, including an inherited
  `FUNCTION_TARGET=retryPendingServiceDisconnects`;
- scoped ESLint for the three changed TypeScript files and `git diff --check`.

The app help page and connected-service help were reviewed; startup isolation needs no user-facing content change.
The documentation-only changes have no separate automated tests. After separate explicit deployment approval,
deploy only these four functions from the verified revision:

```bash
firebase deploy --project quantified-self-io \
  --only functions:scheduleSuuntoHealthSync,functions:scheduleSuuntoSleepSync,functions:redriveRejectedRouteOriginalCleanup,functions:retryPendingServiceDisconnects
```

## Connection projection and Garmin Health benchmark and verification (2026-10-06)

Three isolated Node 22.23.3 runs per target used the compiled benchmark's `--probe` mode, `--expose-gc`, the matching
`FUNCTION_TARGET` and neither Firebase discovery flag. The baseline was `c7ac8e0af`, with the same machine and
dependencies before and after the loader change.

| Target | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `projectSuuntoConnectionOnTokenWrite` | 945 ms | 170 ms | 236.9 MiB | 87.0 MiB | 3,141 | 753 |
| `projectGarminConnectionOnTokenWrite` | 932 ms | 154 ms | 238.2 MiB | 86.8 MiB | 3,141 | 753 |
| `receiveGarminAPIHealthData` | 947 ms | 368 ms | 237.5 MiB | 130.2 MiB | 3,141 | 1,468 |
| Complete entrypoint control | 945 ms | 937 ms | 238.2 MiB | 237.3 MiB | 3,141 | 3,141 |

Each runtime target exports one handler; discovery still exports 168. Local imports are about 82–83% faster for the
projections and 61% faster for Garmin Health, with 107–151 MiB less startup RSS. These are module-import measurements,
not production memory guarantees or billing savings. After a separately approved deployment, compare production
startup latency, memory, billable time per request, failures and retry outcomes over comparable complete days.

Verification passed:

- 78 tests across the loader, Firebase bootstrap, secret policy, account projection and Sleep/Health webhook specs;
- Functions TypeScript build and compiled entrypoint check: 168 endpoints and 52 isolated targets;
- complete Firebase endpoint descriptors for all 168 exports matched the pre-change baseline;
- deployment-source safety and secret-binding validation: 69 secret-bound endpoints, including inherited targets;
- scoped ESLint for the three changed TypeScript files and `git diff --check`.

The documentation-only changes have no separate automated tests. This change is prepared locally; deployment requires
separate explicit approval. Deploy only these three functions from the verified revision:

```bash
firebase deploy --project quantified-self-io \
  --only functions:projectSuuntoConnectionOnTokenWrite,functions:projectGarminConnectionOnTokenWrite,functions:receiveGarminAPIHealthData
```

## Activity, route and event cleanup benchmark and verification (2026-10-06)

Three isolated Node 22.23.3 runs per target used the compiled benchmark's `--probe` mode, `--expose-gc`, the matching
`FUNCTION_TARGET` and neither Firebase discovery flag. The baseline was local `develop` at `de06afb34`, before this
loader change, using the same machine and dependencies. Existing unrelated local Training edits were present in both
builds and are outside this change.

| Target | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `processActivitySyncTask` | 1,031 ms | 416 ms | 237.7 MiB | 122.5 MiB | 3,141 | 1,431 |
| `cleanupEventFile` | 1,010 ms | 186 ms | 238.2 MiB | 87.3 MiB | 3,141 | 777 |
| `processRouteSyncTask` | 972 ms | 362 ms | 238.4 MiB | 123.8 MiB | 3,141 | 1,443 |
| Complete entrypoint control | 902 ms | 1,065 ms | 236.8 MiB | 237.4 MiB | 3,141 | 3,141 |

Each runtime target exports one handler; discovery still exports 168. Local imports are approximately 60–82% faster,
with 115–151 MiB less startup RSS. The unchanged full-entrypoint module count and similar RSS, with variable import
time, illustrate the limits of local timing comparisons. These measurements do not establish production billing
savings. After a separately approved deployment, compare container starts, startup latency, billable time per request,
memory, request volume, errors, queue recovery and cleanup outcomes over comparable complete days.

Verification passed:

- 81 tests across the loader, Firebase bootstrap, secret policy, activity worker, event cleanup and route processor;
- Functions TypeScript build and compiled entrypoint check: 168 endpoints and 55 isolated targets;
- all 168 complete Firebase endpoint descriptors matched the pre-change baseline;
- independent fresh-process comparisons for each target's runtime/discovery descriptors, both inherited-target
  discovery guards, unknown-target fallback and shared Admin initialization;
- deployment-source safety and secret-binding validation: 69 secret-bound endpoints, including inherited targets;
- scoped ESLint for the three changed TypeScript files and `git diff --check`.

The documentation-only changes have no separate automated tests. This batch is prepared locally; deployment requires
separate explicit approval. Deploy only these three functions from the verified revision:

```bash
firebase deploy --project quantified-self-io \
  --only functions:processActivitySyncTask,functions:cleanupEventFile,functions:processRouteSyncTask
```

## Garmin Ping dispatcher benchmark and verification (2026-10-06)

Three isolated Node 22.23.3 processes per target used the compiled benchmark's `--probe` mode with `--expose-gc`, the
matching `FUNCTION_TARGET` and neither discovery flag. The baseline was clean local `develop` at `ce4423eaf`, using the
same machine and dependencies before and after the loader change.

| Loading path | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dispatchGarminPingBatchOnWrite` | 985 ms | 297 ms | 238.7 MiB | 111.2 MiB | 3,141 | 1,260 |
| Complete entrypoint control | 968 ms | 988 ms | 237.7 MiB | 238.2 MiB | 3,141 | 3,141 |

Runtime now exports one handler; full discovery still exports 168. Local import time decreased by about 70%, and
startup RSS by 127.5 MiB. These are import measurements, not production memory guarantees or billing savings. Keep
the runtime resources unchanged for rollout verification. The high-volume investigation should attribute ignored
writes, new batch revisions, dispatched tasks, retries and billable time without equating every trigger invocation to
a Garmin provider request.

Verification passed:

- 30 tests across the loader, Firebase bootstrap, secret policy and Garmin Ping dispatcher;
- TypeScript build and compiled entrypoint check: 168 endpoints / 56 isolated targets;
- all 168 complete Firebase endpoint descriptors matched baseline;
- independent fresh-process runtime/discovery descriptors, both inherited-target discovery guards, unknown-target
  fallback and shared Admin initialization;
- deployment-source safety, secret-binding validation for 69 endpoints and validation with the dispatcher inherited;
- scoped ESLint for the three changed TypeScript files and `git diff --check`.

Documentation-only changes have no separate automated tests. This change is local; deployment requires separate
explicit approval. Deploy only the dispatcher from the verified revision:

```bash
firebase deploy --project quantified-self-io --only functions:dispatchGarminPingBatchOnWrite
```

## Recorded-activity dispatcher benchmark and verification (2026-10-07)

Three isolated Node 22.23.3 processes per target used the compiled benchmark's `--probe` mode, `--expose-gc`, matching
`FUNCTION_TARGET` and neither discovery flag. The baseline was clean local `develop` at `1f9e4b509`, with the same
machine and dependencies before and after the loader change.

| Loading path | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `parseGarminAPIActivityQueue` | 1,098 ms | 413 ms | 239.4 MiB | 133.1 MiB | 3,151 | 1,514 |
| `parseSuuntoAppActivityQueue` | 1,144 ms | 421 ms | 238.0 MiB | 132.5 MiB | 3,151 | 1,514 |
| `parseCOROSAPIWorkoutQueue` | 1,106 ms | 407 ms | 238.0 MiB | 130.4 MiB | 3,151 | 1,514 |
| `parseWahooAPIWorkoutQueue` | 987 ms | 405 ms | 238.1 MiB | 131.3 MiB | 3,151 | 1,514 |
| Complete entrypoint control | 996 ms | 1,038 ms | 239.0 MiB | 238.1 MiB | 3,151 | 3,151 |

Each dispatcher exports one handler; discovery still exposes 168. Local imports are about 59–63% faster with
105–108 MiB less startup RSS. These are import measurements, not production memory guarantees or billing savings.
Keep existing resources unchanged and compare production starts, memory, errors, dispatch/recovery outcomes and
monitoring heartbeats after a separately approved deployment.

Verification passed:

- 157 focused tests across loader, bootstrap, secret policy, queue and import monitoring;
- nine offline monitoring definition/provisioning tests;
- TypeScript build and compiled entrypoint check: 168 endpoints and 76 isolated targets;
- all 168 full Firebase endpoint descriptors matched the pre-change baseline byte-for-byte;
- inherited-target discovery and standalone secret validation for all four dispatchers;
- deployment-source safety, secret-binding validation for 69 endpoints, scoped ESLint and `git diff --check`.

Review follow-up made the fresh-process comparison permanent in CI/predeploy. Each dispatcher snapshot is captured
before importing the full registry, avoiding a same-process module-cache comparison that could mask an import-order
metadata change. Four synthetic runtime-only memory-descriptor changes were detected despite passing the older
handler-identity checks; all four normal contracts matched. The review rerun passed 183 focused tests and nine
monitoring tests. This changes verification only, not any deployed handler or its startup graph.

Documentation-only changes have no separate automated suite. No provider calls, production deployment or cloud
configuration apply was performed. This change is local on `develop`; pushing and deployment require approval.

## Health/Sleep benchmark and verification (2026-10-07)

Three isolated Node 22.23.3 processes per target used the compiled benchmark's `--probe` mode, `--expose-gc`,
matching `FUNCTION_TARGET` and neither discovery flag. The baseline was clean local `develop` at `53a009285`,
with the same machine and dependencies before and after this loader change.

| Loading path | Import before | Import after | RSS before | RSS after | Modules before | Modules after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `processGarminHealthBackfillTask` | 1,025 ms | 361 ms | 239.5 MiB | 122.4 MiB | 3,152 | 1,423 |
| `dispatchSleepSyncQueue` | 991 ms | 381 ms | 239.2 MiB | 121.3 MiB | 3,152 | 1,290 |
| Complete entrypoint control | 985 ms | 1,066 ms | 239.1 MiB | 238.8 MiB | 3,152 | 3,152 |

Each isolated target exports one handler; full discovery still exposes 168. All 168 complete endpoint/trigger
descriptors matched the pre-change baseline byte-for-byte. Local startup RSS decreased by about 117–118 MiB;
these import measurements are not production memory guarantees or billing savings. Keep current runtime settings
and compare real container starts, memory, errors, dispatch recovery and observation heartbeats after deployment.

Verification passed: 108 focused loader/bootstrap/secrets/worker/dispatcher/backfill/deployment-safety tests,
seven offline Health/Sleep monitoring tests, the TypeScript build and compiled entrypoint check (168 endpoints /
78 isolated targets), deployment-source safety, secret-binding validation for 69 endpoints, scoped ESLint and
`git diff --check`. Documentation-only changes have no separate automated suite. No provider call, deployment or
cloud configuration apply is part of this loading change. The existing #830 deployment command in
[Sleep sync operations](sleep-sync-operations.md#cost-verification-and-activation) includes all three handlers and
still requires separate explicit approval.

## Adding another optimized target

1. For each new deployed Function, add the full export and a direct owner-module loader in
   `functions/src/function-target-loader.ts` before deployment. Avoid barrel modules that export unrelated handlers.
2. Extend the unit expectation in `functions/src/function-target-loader.spec.ts` and the metadata assertions in
   `functions/src/scripts/check-entrypoint-loading.ts` for the function's trigger and configured options. The entrypoint
   check reads the target list directly from the production loader so its coverage cannot drift from runtime routing.
3. Run the entrypoint check, the provider's focused tests, the Functions build, deployment safety and secret-binding
   checks.
4. Deploy only the selected function after explicit deployment approval. Keep its existing memory limit during the
   canary.
5. Compare production memory, cold starts, errors and OOM logs with the pre-deployment baseline before expanding the map
   or changing memory.

## Rollback

Remove the target from `TARGET_LOADERS` and redeploy that function from a verified revision. Unknown targets automatically
use the complete entrypoint, so rollback does not require changing the function name or trigger configuration.
