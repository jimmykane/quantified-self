# CI test coverage

`.github/workflows/_run-tests.yml` is the shared test gate for branch pushes, fork pull requests, beta/main builds and
approved manual deployment workflows. `unit_tests` runs credential/plugin checks, ordinary Functions tests, compiled
entrypoint/MCP contract checks, lint, Firestore/Storage Rules tests and frontend tests. The final `run_tests` job waits
for both `unit_tests` and the complete emulator matrix, then fails unless both succeeded (including failed, cancelled
or skipped dependencies). It preserves the protected-branch check name `run-tests / run_tests`; an emulator failure
must not leave the required check green. Reusable-workflow deployment dependencies also wait for all jobs.

## Trigger policy without duplicate test runs

- Internal feature-branch pushes run Testing; opening/updating an internal PR does not repeat the suites.
- `develop` pushes run the beta workflow, and `main` pushes run the main workflow, each with the same test gate.
- Fork PRs run Testing on `opened`, `synchronize` and `reopened`. Fork pushes cannot trigger this repository's push
  workflow. First-time contributors may still need GitHub's normal maintainer approval before their tests run.

`testing.yaml` uses `pull_request`, never `pull_request_target`, with only read permissions and no inherited secrets,
deployment environment or deploy job. Fork runs use the default PR merge SHA; the MCP comparison uses the PR base SHA.
The caller's job condition runs suites only for pushes or PRs whose head repository differs from this repository.
Skipped internal PR callers use the distinct name `Internal PR - covered by push`, so a skipped duplicate cannot
publish the protected push check's name. They may appear as a skipped entry, but perform no test/dependency setup.

`npm run test:workflows` parses the real YAML and tests fork/internal event routing, check names, permissions,
deployment dependencies and all success/failure/cancelled/skipped combinations of the final gate. `js-yaml` is an
explicit dev dependency reusing the already locked parser; it adds no app or Functions runtime dependency.

## CodeQL routing

CodeQL keeps push scans for `main`, `develop` and `feature/**`, plus its existing weekly scan of the default branch.
Internal PRs sourced from those branches skip the duplicate analysis with a distinct `Internal PR - covered by push`
check name. Other internal source branches (including `codex/*`) and all forks still get a PR scan when targeting
`main` or `develop`; a fork's `develop` or `feature/*` name never counts as coverage from this repository's push run.
The lightweight routing job uses no token permissions or checkout. Its shell branch matching is case-sensitive:
`Develop` and `Feature/*` are not treated as the push-scanned `develop` and `feature/**` branches.

Covered internal PRs reuse **branch-head** findings; they do not additionally scan the synthesized merge commit.
GitHub [maps push-scan findings to open PRs](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).
PR-only scans retain checkout's default merge ref. No `pull_request_target`, secrets or deployment permissions are added;
CodeQL's existing SARIF upload permissions and analysis configuration remain unchanged. The existing in-flight runs
are unaffected by this routing change. `npm run test:workflows` covers the actual YAML conditions, source branches,
forks, scan names, permissions and schedule.
The routing tests pass a separate temporary regular file as `GITHUB_OUTPUT` for each invocation, read the actual
script output, and remove the files after the test. Do not replace that file with `/dev/stdout`: reopening a Node
child-process pipe through that path fails on Linux CI even when it works locally on macOS.

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
