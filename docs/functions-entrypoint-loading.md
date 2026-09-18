# Firebase Functions target-aware entrypoint loading

The Functions package exposes every application function through `functions/src/index.ts`. Google sets
`FUNCTION_TARGET` to the exported handler name when it starts a deployed function container. The entrypoint uses that
value to load selected handlers without evaluating the complete backend module graph.

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

The initial canary includes only:

- `getSuuntoAPIAuthRequestTokenRedirectURI`
- `requestAndSetSuuntoAPIAccessToken`

Other functions continue through the complete entrypoint until they are deliberately added to the target map and pass
the same checks.

## Verification

Run the routing and discovery contract:

```bash
npm --prefix functions run entrypoint:check
```

The check builds the Functions package and verifies:

- discovery exposes all 153 application exports;
- both Firebase discovery modes ignore an inherited optimized `FUNCTION_TARGET`;
- an unknown target exposes the same complete export set;
- a discovered Gen 1 target retains the complete entrypoint fallback;
- each optimized target exposes only its requested handler;
- the optimized export is the exact object created by the provider wrapper;
- optimized Suunto startup does not import Genkit, BigQuery, MCP or admin handler modules;
- optimized Suunto endpoints remain Gen 2 in `europe-west2` with 512 MiB and the same secret bindings.

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

## Adding another optimized target

1. Add the function name and direct module loader to `functions/src/function-target-loader.ts`. Avoid barrel modules that
   export unrelated handlers.
2. Extend the unit expectation in `functions/src/function-target-loader.spec.ts`. The entrypoint check reads the target
   list directly from the production loader so its coverage cannot drift from the runtime routing table.
3. Run the entrypoint check, the provider's focused tests, the Functions build, deployment safety and secret-binding
   checks.
4. Deploy only the selected function after explicit deployment approval. Keep its existing memory limit during the
   canary.
5. Compare production memory, cold starts, errors and OOM logs with the pre-deployment baseline before expanding the map
   or changing memory.

## Rollback

Remove the target from `TARGET_LOADERS` and redeploy that function from a verified revision. Unknown targets automatically
use the complete entrypoint, so rollback does not require changing the function name or trigger configuration.
