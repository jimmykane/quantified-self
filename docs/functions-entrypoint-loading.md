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

The target map also isolates all 11 exports from `functions/src/admin/marketing/handlers.ts`, including the
`trackMarketingDelivery` Firestore trigger. That trigger observes updates to the shared `mail/{mailId}` collection even
when the updated email is not part of a marketing campaign. Its existing 256 MiB memory limit is unchanged; this routing
change needs a separately approved deployment and production memory check. The map also isolates
`projectEventTagCatalog` directly from its event-tag trigger module, preserving its `users/{uid}/events/{eventId}`
Firestore written-event trigger, retry behavior and 256 MiB limit. The four connection history endpoints load directly
from their coordinator module, preserving the task queue, Firestore trigger, recovery schedule, callable, pacing,
retry policy, and secret bindings. Other functions continue through the complete entrypoint.

## Verification

Run the routing and discovery contract:

```bash
npm --prefix functions run entrypoint:check
```

The check builds the Functions package and verifies:

- discovery exposes all 169 application exports;
- both Firebase discovery modes ignore an inherited optimized `FUNCTION_TARGET`;
- an unknown target exposes the same complete export set;
- a discovered Gen 1 target retains the complete entrypoint fallback;
- each optimized target exposes only its requested handler;
- the optimized export is the exact object created by the provider wrapper;
- optimized Suunto startup does not import Genkit, BigQuery, MCP or admin handler modules;
- optimized marketing startup does not import Genkit, BigQuery, MCP or unrelated admin modules;
- optimized Suunto endpoints remain Gen 2 in `europe-west2` with 512 MiB and the same secret bindings;
- optimized marketing endpoints retain their callable, schedule, Firestore or HTTP triggers, existing memory limits,
  region and secret bindings.
- the isolated event-tag catalog endpoint retains its Firestore trigger path and type, retry setting, region, 256 MiB
  memory limit and absence of secrets.
- the isolated connection history endpoints retain their task pacing and retry policy, Firestore trigger, recovery
  schedule, callable type, region, runtime limits, and secret bindings.

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

One local Node 20.19.3 cold-import run on 2026-09-25 measured 216.9 MiB RSS, 1,034 ms, and 3,118 modules for the
complete entrypoint. Each of the four isolated connection history targets loaded the same 1,535-module coordinator
graph in 385–399 ms and used 124.5–125.3 MiB RSS. This single-run comparison checks that direct loading avoids the
complete graph; production memory and cold-start monitoring remain necessary before changing runtime limits.

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
