# CI test coverage

`.github/workflows/_run-tests.yml` is the shared test gate for branch pushes, beta/main builds and approved manual
deployment workflows. Its existing job runs credential/plugin checks, ordinary Functions tests, compiled
entrypoint/MCP contract checks, lint, Firestore/Storage Rules tests and frontend tests. A reusable workflow caller
finishes successfully only when **all** of its jobs succeed; existing deployment `needs: run-tests` gates therefore
include the emulator matrix, not just the ordinary test job.

## Functions emulator matrix

All real Functions emulator/integration files are mandatory on every invocation, including 400-workout stress cases.
Four independent Ubuntu runners keep emulator load out of the app/unit test runner. Each uses Node 22 (the Functions
runtime), Java 21, one Vitest worker and serial files within its group. There is no nightly-only or path-filtered hole.

| Group | Coverage | Measured local test runtime |
| --- | --- | --- |
| `delivery` | Common ledger/reconciliation and Garmin, COROS, Wahoo and Suunto delivery adapters | 218 s / 171 tests |
| `lifecycle` | 400-workout shifts/restores/deletion, strength companions and deleted-workout expiry/cleanup | 53 s / 21 tests |
| `completion` | Garmin FIT, Wahoo and COROS completion markers plus admin delivery counts | 10 s / 46 tests |
| `mcp-data` | Training MCP reads/writes, content writes, derived reuse, tag concurrency, marketing durability and interrupted disconnects | 95 s / 101 tests |

The local verification ran all 19 files / 339 tests without skips on Node 22 and Java 23. Timings include Vitest startup,
not installs, the Functions build or emulator startup, and are not hosted-runner timing guarantees. The 400-workout
cases took about 24 seconds within `lifecycle`, so they remain in the normal gate rather than a nightly-only workflow.

`tools/functions-emulator-suites.mjs` lists exact files, avoiding redundant execution of provider unit tests.
`npm run test:emulator-coverage` compares the registry with every `*.emulator.spec.ts` and `*.integration.spec.ts` below
`functions/src`, plus any ordinary `*.spec.ts` referencing the Firestore/Auth emulator host variables, and with the
CI matrix. A newly added, removed or duplicated suite fails the gate until the registry
is updated. `queue-integration.spec.ts` is an ordinary mocked unit test, not an emulator file, and remains in the
ordinary Functions test suite.

The runner also validates Vitest's JSON report: every selected file must contain passing tests, with no skipped,
pending or TODO assertions. All counters must be non-negative integers, passing counts must match totals, and the
reported assertion count must equal the total test count. Missing or inconsistent report fields fail closed.
Missing emulator environment variables cannot silently turn a mandatory suite green.
Vitest failures, unhandled errors, setup/teardown failures and a missing report remain failures.

## Local commands and isolation

Install root and Functions dependencies, Firebase CLI and Java 21, then run:

```sh
npm run test:emulator-coverage
npm run test:functions-emulators -- lifecycle
npm run test:functions-emulators
```

The last command runs all four groups serially. The runner builds Functions before starting emulators; it never
starts the Functions emulator. Existing `test:disconnect` and `test:training-delivery` remain convenient focused
developer commands, but are not run a second time in CI.

`firebase.functions-test.json` starts only Firestore and Auth on loopback (8081 and 9099), with UI disabled and
multi-project mode enabled for the suites' separate `demo-*` namespaces. Firebase CLI receives the explicit
`demo-functions-ci` project. Expiry tests also require the exact `TRAINING_TEST_DEMO_PROJECT_ID=demo-training-657`
guard. The runner excludes inherited provider credentials, ADC override variables, Firebase tokens and emulator
endpoints from its child environment. CI does not authenticate to Google Cloud or receive production secrets.
Provider HTTP and Cloud Tasks are synthetic/mocked in these tests; marketing has no mail Extension running.
These commands do not deploy, send provider workouts or use production account data.

MCP impact: this change executes the existing read/write isolation and lifecycle tests in CI. It changes no tool,
wire schema, permission, consent, projection, provider action, registered contract or bundled plugin/skill; no client
refresh or deployment is required.

Measure group durations from the runner's final summary before adding more concurrency or splitting groups. CI
allows 25 minutes per group to accommodate dependency installs, cold emulator downloads and slower hosted machines;
it does not retry failures or weaken assertions to hide regressions.
