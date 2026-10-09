# Component fixture benchmark — 9 October 2026

The 106-test user settings suite runs faster when it renders the Material form only for tests that need its view.
Three alternating local comparisons reduced median command wall time from 49.16 seconds to 36.33 seconds,
a saving of 12.82 seconds (26.1%). This measures one focused suite, not the complete frontend suite or hosted CI.

## Change under test

The baseline is develop revision `a5f98aba65171c5d94c6b6ae01a8a33a5ba85fd7`. Its shared `beforeEach` compiles,
creates and renders `UserSettingsComponent` before every test, including form/payload logic and static source checks.
The prototype retains the same module configuration and compilation, but each test explicitly chooses its setup:

| Tests | Setup |
| --- | --- |
| 67 form, payload and route tests | Inject the component through TestBed; set the user, call `ngOnChanges` and `ngOnInit`, and settle initialization promises |
| 36 rendering tests, including the creation smoke | Create the real fixture, initialize the form and run change detection, preserving actual Material controls and the template |
| 3 static template/style checks | Read the same source files without creating a component |

TestBed destroys both injected instances and fixtures, including route/form subscriptions. This component has no
view queries, component-scoped providers or effects requiring a component injection context. Those assumptions
must be reviewed again before applying the pattern to another component or changing this component's dependencies.
Rendering and lifecycle integration tests must keep real Angular fixtures.

Every original test action, assertion, registration and parameter table remains unchanged. An AST comparison verifies
the bodies after removing only the new setup call. All runs preserve the exact file, expanded test names and passing
statuses. There are no skips, TODOs, new mocks, dependency upgrades, environment reclassifications or worker changes.
The entire spec remains in `angular`; this is a fixture optimization within that project.

## Measurements

Measurements used Node 22.23.3, Vitest 3.2.4, macOS arm64 on an Apple M1 Pro, `TZ=UTC`, the existing isolated fork
pool and global two-worker limit, and `NODE_OPTIONS=--max-old-space-size=3072`. One focused file uses one active
worker. Every invocation ran in the same worktree and used the same installed dependencies, reporter arguments
and assertions. No other test commands ran concurrently with the timing samples.

One baseline and one optimized warm-up were excluded. Recorded order was baseline 1, optimized 1, baseline 2,
optimized 2, baseline 3, optimized 3; caches were not cleared between samples.

| Sample | Baseline command wall time | Optimized command wall time |
| --- | ---: | ---: |
| 1 | 49.00 s | 36.27 s |
| 2 | 49.51 s | 37.01 s |
| 3 | 49.16 s | 36.33 s |
| Median | 49.16 s | 36.33 s |

The existing timing reporter's median per-module diagnostic cost fell from 27.38 seconds to 14.30 seconds (47.8%).
It includes environment preparation, setup, collection and test/hook execution; it is not command wall time.
The command still pays Angular compiler startup outside that diagnostic. This pilot does not remove compiler,
jsdom or import overhead and does not establish a hosted-CI speedup.

The exact baseline/optimized source snapshots, JSON assertion reports, timings, commands, hashes and comparison
scripts are retained in the implementation worktree's ignored `tmp/angular-fixture-benchmark/` directory.
Coverage runs use instrumentation and are excluded from the timing samples.

## Verification

The two instrumented runs each pass the same 106 tests. Their source coverage maps and covered locations match
exactly, including teardown; execution hit counts may differ because fewer tests need a component/view.

| Metric | Baseline covered / total | Optimized covered / total |
| --- | ---: | ---: |
| Statements | 637 / 695 | 637 / 695 |
| Functions | 33 / 34 | 33 / 34 |
| Branch locations | 157 / 220 | 157 / 220 |

The focused spec also passes without instrumentation in all timing samples. `npm run test:frontend-config`
passes all five allocation guards, `npm run test:workflows` passes all 15 workflow guards, and focused ESLint
passes without lint errors or warnings. ESLint emits its existing configuration deprecation notice.
No runner, plugin, discovery, shard, product source or package metadata changed, so verification stays focused
on this spec rather than rerunning both complete frontend shards. Plans and chart picker suites remain unmeasured.

## Reproduction and maintenance

Select Node 22 and run the same focused command on the baseline and candidate, using separate output paths for
each run and measuring process wall time:

```sh
TZ=UTC NODE_OPTIONS=--max-old-space-size=3072 \
QS_FRONTEND_TIMING_REPORT=tmp/angular-fixture-benchmark/repro/timing.json \
node node_modules/vitest/vitest.mjs run --project=angular \
  src/app/components/user-settings/user-settings.component.spec.ts \
  --reporter=default --reporter=json --reporter=./tools/frontend-test-timing-reporter.mjs \
  --outputFile=tmp/angular-fixture-benchmark/repro/report.json
```

Choose `createSettings()` for existing component/form logic and `renderSettings()` when assertions need the real
template, control events or Angular rendering behavior. Keep static checks independent of either helper. Avoid
restoring unconditional rendering in shared setup. Pure extracted helpers may use Node only after the separate
[environment registry review](../.agent/rules/frontend-test-environments.md).

This change affects test setup only. Product behavior, Training/MCP contracts, provider actions and production
infrastructure are unchanged; app help does not need an update. The prose and agent guidance have no dedicated
automated tests; the affected spec and environment/workflow guards verify the relevant executable contracts.
