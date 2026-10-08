# CI test coverage

`.github/workflows/_run-tests.yml` is the shared test gate for branch pushes, fork pull requests, beta/main builds and
approved manual deployment workflows. Independent jobs run the same mandatory checks on separate Ubuntu runners:

| Job | Required checks |
| --- | --- |
| `unit_tests` | Credentials, workflow/emulator coverage contracts, monitoring definitions, plugin validation and frontend lint |
| `functions_tests` | Functions install/lint, complete ordinary suite, build, compiled entrypoint and MCP contract checks |
| `frontend_tests` | Frontend environment allocation and the complete suite across all three projects |
| `rules_tests` | Firestore and Storage Rules tests with Java/Firebase emulators |
| `functions_emulators` | Complete four-group Functions emulator matrix |

Only the final `run_tests` job depends on these jobs. It uses `always()` and fails unless every dependency succeeded,
including failed, cancelled, skipped or missing results. It preserves the protected-branch check name
`run-tests / run_tests`; no individual successful job can make the required gate green. Reusable-workflow deployment
dependencies continue to wait for the complete gate.

Keep suite jobs independent when adding CI checks. Add any new mandatory job to the final gate and its executable
failure tests. Do not put frontend or Rules tests back after the Functions suite, or raise per-runner worker limits
to obtain parallelism. Node setup caches npm downloads using the applicable lockfiles; each runner still uses `npm ci`.
Functions installs root dependencies too because its compiled shared sources resolve them there. Only Rules and
emulator runners need Java/Firebase Tools; the Rules job shares the existing emulator binary cache.

The previous serial job took about 32 minutes in [run 37779620977](https://github.com/jimmykane/quantified-self/actions/runs/37779620977):
Functions install/lint/tests/build/contracts took 14m38s and frontend tests took 14m19s. These observed step durations
motivate running the suites concurrently; they do not establish a measured speedup for the split. Extra runners
repeat dependency setup and consume concurrent runner capacity. Measure the full required gate after CI completes.

## Ordinary unit runner

All check jobs use Node 22, matching `functions/package.json` rather than testing Functions on an older
runtime. `npm run test:workflows` checks that alignment against the actual YAML.

Ordinary Functions tests use at most two isolated Vitest fork workers, with a minimum of one. This bounds concurrent
imports and worker reporting on shared CI runners instead of scaling automatically with the runner's CPU count.
The cap addresses runner pressure after a CI run passed every test but failed with an unhandled
`[vitest-worker]: Timeout calling "onTaskUpdate"`. Emulator commands retain their explicit one-worker, serial-file
override. Test isolation and unhandled-error failure behavior remain enabled; there is no retry, ignored error or
extended timeout masking a failure. `test-runner-config.spec.ts` covers these configuration boundaries.

Frontend tests use the same global two-worker bound, with isolated forks across three Vitest projects:
`helpers-node` runs 164 verified pure specs (helpers and help content) in Node with no setup file,
`helpers-dom` runs 10 DOM/locale specs in jsdom with no Angular setup, and `angular` retains the Angular compiler
plugin and `src/test-setup.ts` for all remaining ordinary specs. The Angular project is the fallback for new or
unclassified files. The shared
runner still uses `npm run test -- --run`, so every project runs on every ordinary app test invocation.

`tools/frontend-test-environments.json` is the explicit Node/DOM opt-in registry. To move another pure application
spec, first verify its tests and transitive imports in the intended environment, then add its exact repository-relative
path to the registry. DOM rendering and browser-locale assumptions require jsdom; component/service/router imports may
require the Angular pipeline. Do not route the whole helper directory to Node or add fake browser/Angular globals
to conceal an unsupported import. Removing a registry entry returns that spec to Angular automatically.

`npm run test:frontend-config` loads the real configuration and compares project discovery with the original
ordinary-test boundary. It rejects missing files, duplicates and overlapping opt-ins, exercises future-file
fallback (including hidden specs) plus Functions/Rules exclusions, and checks plugin/setup isolation, aliases,
dependency inlining and the global worker bound. CI runs this check before the suites. The root retains the original include/exclude
boundary for coverage, and reporters/coverage remain global across projects. A focused command can use
`npm run test -- --run --project helpers-node <spec>` without initializing the Angular project.
The guard uses Vitest's `tinyglobby` library with matching discovery options, including `dot: true`.
It is an explicit dev dependency reusing the already locked version; no package versions change.

See the [helper test environment benchmark](ci-helper-test-benchmark.md) for the verified allocation and local
performance measurements. This changes the test runner only; application behavior, Training/MCP contracts,
provider actions and production infrastructure have no impact, so product help does not need an update.

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
deployment dependencies and the actual gate script's rejection of every job's failed, cancelled, skipped, missing
or unknown result. It also protects job independence and the placement of the existing checks. `js-yaml` is an
explicit dev dependency reusing the already locked parser; it adds no app or Functions runtime dependency.

## Deployment triggers

Publishing a GitHub release or prerelease does not run a build or deployment workflow. The former release-triggered
production workflow has been removed. `npm run test:workflows` checks every workflow for release triggers to prevent
accidental reintroduction.

After the shared test gate succeeds, `develop` pushes deploy beta Hosting and `main` pushes deploy production Hosting.
A successful main Hosting deployment creates the package version tag when the version changed; it does not publish
a GitHub release. Functions deployment remains available through the separate `Deploy Functions (manual)` workflow,
which tests a commit contained in `main` before deploying Functions. Firestore rules/indexes and Storage rules require
a separately approved manual deployment.

## CodeQL routing

CodeQL keeps push scans for `main`, `develop` and `feature/**`, plus its existing weekly scan of the default branch.
Internal PRs sourced from those branches skip the duplicate analysis. The job uses the static name `Analyze`,
because GitHub can display name expressions literally for skipped jobs. Other internal source branches
(including `codex/*`) and all forks still get a PR scan when targeting
`main` or `develop`; a fork's `develop` or `feature/*` name never counts as coverage from this repository's push run.
The lightweight routing job uses no token permissions or checkout. Its shell branch matching is case-sensitive:
`Develop` and `Feature/*` are not treated as the push-scanned `develop` and `feature/**` branches.

Covered internal PRs reuse **branch-head** findings; they do not additionally scan the synthesized merge commit.
GitHub [maps push-scan findings to open PRs](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).
PR-only scans retain checkout's default merge ref. No `pull_request_target`, secrets or deployment permissions are added;
CodeQL's existing SARIF upload permissions and analysis configuration remain unchanged. The existing in-flight runs
are unaffected by this routing change. `npm run test:workflows` covers the actual YAML conditions, source branches,
forks, the static scan name, permissions and schedule.
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
