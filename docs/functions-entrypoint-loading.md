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
- the four scheduled maintenance targets avoid those unrelated modules, preserve their complete scheduled-handler
  contracts and allow standalone secret validation with any of their targets inherited;
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
