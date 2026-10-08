# Helper test environment investigation — 8 October 2026

Separating helper specs from the Angular test setup is a useful CI optimization with the current dependencies.
In a matched local run, all 181 helper files / 2,036 tests took 134.84 seconds with the existing Angular/jsdom
configuration and 81.45 seconds with separate Node, DOM and Angular projects: 53.39 seconds saved, or 39.6%.
The split passed a second complete run in 104.44 seconds. These measurements cover the helper directory, not
the complete frontend suite or the GitHub Actions gate.

## Original setup

Before the split, the root `vitest.config.ts` applied Analog's Angular plugin, jsdom and `src/test-setup.ts`
to every ordinary frontend spec. That setup imports Zone.js and Angular testing libraries, initializes Angular TestBed and
installs chart-queue, Google Maps, matchMedia and IntersectionObserver mocks. The Angular plugin also compiles
the program described by `src/tsconfig.spec.json`, whose include patterns cover all frontend specs.

Changing only `environment` to Node would retain the plugin and setup. They must be scoped to the Angular
project to remove the helper overhead. Vitest 3.2 already supports independently configured
[test projects](https://v3.vitest.dev/guide/projects), including different plugins and setup files. No dependency
upgrade is needed for this experiment.

## Verified allocation

| Environment | Files | Tests | Setup |
| --- | ---: | ---: | --- |
| Node | 163 | 1,744 | No setup file, Angular compiler plugin or jsdom |
| jsdom | 10 | 203 | No setup file or Angular compiler plugin |
| Angular + jsdom | 8 | 89 | Existing Angular plugin and `src/test-setup.ts` |
| Total | 181 | 2,036 | Every file selected exactly once |

All files are under `src/app/helpers/`. The allocation was established by actual execution and inspection of
transitive runtime imports after TypeScript type removal. A passing Node spec does not mean its entire import
graph is Angular-free: 17 of the 163 still import Angular core, typically through constants or service modules,
but do not need the compiler or TestBed setup for their assertions. The other 146 have no Angular runtime
import identified by this inspection. Future changes to those graphs must be verified again.

The eight files requiring the current Angular pipeline are:

- `admin-dashboard-summary.helper.spec.ts`
- `calendar-day-health.helper.spec.ts`
- `chart-viewport-queue.spec.ts`
- `compact-count.pipe.spec.ts`
- `echarts-host-controller.spec.ts`
- `timeline-notes-adapters.spec.ts`
- `timeline-notes-chart.interaction.spec.ts`
- `training-plans-navigation.helper.spec.ts`

The ten files that pass with jsdom alone are:

- `assistant-message-format.helper.spec.ts`
- `dashboard-echarts-style.helper.spec.ts`
- `dashboard-sleep-chart.helper.spec.ts`
- `echarts-horizontal-touch-gesture.controller.spec.ts`
- `echarts-tooltip-host.helper.spec.ts`
- `health-metric-chart.helper.spec.ts`
- `health-workspace.helper.spec.ts`
- `reveal-calendar-day-context.helper.spec.ts`
- `table-row-activation.helper.spec.ts`
- `timeline-notes-chart.helper.spec.ts`

Three of these (`dashboard-sleep-chart`, `health-metric-chart` and `health-workspace`) need the current browser
locale semantics rather than DOM rendering. The locale adapter deliberately defaults to `en-GB` in Node/SSR;
jsdom supplies `en-US`. Running the existing specs in Node changes date/time labels and fails assertions.
Keep them in jsdom until their locale assumptions are made explicit. Do not change the product fallback or
add fake browser globals to make the tests pass.

The Angular exceptions include indirect coupling. Admin summary imports a date coercer from the What's New
service; calendar day health's spec imports a missing-state factory from a service; navigation's spec imports
`convertToParamMap` from Angular Router. Chart controllers import browser compatibility services and dialogs,
and the timeline adapter spec exercises actual Angular components. Extracting pure functions or replacing
framework fixture builders with equivalent plain fixtures could enable additional Node tests later.

## Measurements and verification

| Workload | Existing Angular/jsdom | Split or Node | Result |
| --- | ---: | ---: | --- |
| Same 163 Node-capable files / 1,744 tests | 128.46 s | 50.89 s | Both passed; 60.4% lower wall time |
| All 181 helper files / 2,036 tests | 134.84 s | 81.45 s | Both passed; 39.6% lower wall time |
| Repeat of the complete split | — | 104.44 s | Same 181 files / 2,036 tests passed |
| Repeat of the existing configuration | 132.96 s | — | Invalid: 37 collection failures from `ENOSPC` |

The repeated baseline ran out of disk space while writing Vitest's temporary transform cache. It collected only
1,744 assertions, so its elapsed time is excluded from the speed comparison. The cache directory was already
removed by runner teardown when inspected; no unrelated files were deleted. Available disk space was approximately
149 MiB after that run. The valid runs also experienced variable desktop load, so these are exploratory local
measurements rather than a statistically established or hosted-CI speed guarantee.

The first complete comparison reported these aggregate worker phases:

| Phase | Existing | Split |
| --- | ---: | ---: |
| Setup | 45.99 s | 2.44 s |
| Environment | 63.41 s | 6.34 s |
| Collection | 56.00 s | 56.64 s |
| Test bodies | 13.11 s | 12.07 s |
| Vitest duration | 110.49 s | 57.10 s |

Worker phase totals are not wall times and must not be added to estimate CI savings. Both complete configurations
still paid about 24 seconds outside the reported Vitest duration for startup/shutdown, including the Angular
compiler. The standalone Node comparison removes that startup too, which explains its larger percentage gain.
Collection remains significant: 116 Node-capable specs import Sports Lib. Per-file isolation stayed enabled.

Verification compared the exact file set, each assertion's full name and status, total assertions, successful
exit codes, and zero skipped/pending/TODO tests. Project selections have no overlap or missing helper files.
Both split runs match the accepted baseline and each other. The diagnostic all-Node/all-jsdom runs intentionally
failed on unsupported files and were used only for classification.

## Method and retained artifacts

This investigation reused the attached `codex/vitest5-benchmark` worktree at `1b6913e51`, based on committed
`develop` source `17190900c703af9d545fa26ef95061d5b334fbdb`. The frontend source, shared source, scripts, runner
configuration and package lock were identical to `develop` revision `67cce336d` inspected at the start of this
task. Dependencies and application/test source were not changed.

Runs used Node 22.23.3, Vitest 3.2.4, Analog 2.3.1, jsdom 27.4.0 and Angular 20.3.17 on an Apple M1 Pro with
10 logical CPUs and 32 GiB RAM. They ran sequentially with `CI=true`, `TZ=UTC`, two isolated fork workers,
minimum one worker and a 3 GiB heap. Wall time includes startup and shutdown, excluding installation and coverage.
Default and JSON reporters were identical across variants.

Ignored `tmp/helper-test-benchmark/` contains the exact Node/DOM/Angular file manifests, import analysis,
experimental configurations, launcher, raw logs, JSON reports, timings and assertion-parity verification.
These are local investigation artifacts. The initial investigation committed documentation only; the subsequent
implementation uses the verified manifests in `tools/frontend-test-environments.json`. The reproduction configs
now import the frozen `baseline.vitest.config.mts`, preserving the original configuration after implementation.

From that worktree with Node 22 selected, reproduce with:

```sh
node tmp/helper-test-benchmark/run.mjs baseline angular
node tmp/helper-test-benchmark/run.mjs candidate mixed
node tmp/helper-test-benchmark/verify.mjs baseline candidate
```

Ensure adequate free disk space before another run. The launcher rejects other Node majors; a login shell in
this worktree can otherwise select Node 20 even when the primary checkout selects Node 22.

## Implementation

The root configuration keeps global reporters, coverage and the two-worker cap. It defines a Node project for
explicitly verified specs with no setup/plugin, a small jsdom project for the ten DOM/locale specs, and an Angular
project containing the existing plugin/setup. Every project receives the required aliases, globals and dependency
inlining explicitly; project settings do not inherit automatically.

An explicit Node/DOM opt-in manifest controls helper allocation. Every remaining ordinary spec falls back
to the Angular project. Functions and Rules exclusions are preserved. `npm run test:frontend-config` checks
selection parity against the old discovery pattern so no new spec disappears or runs twice. A directory-wide
Node rule would misclassify the 18 exceptions above.

The existing `npm run test -- --run` CI command executes all projects in one process. The initial investigation
verified the complete helper workload. Implementation verification is recorded below; hosted CI timing still
needs measurement after the PR runs.


## Implementation verification

The complete frontend suite passed on Node 22.23.3 with the production configuration: 592 files / 8,633 tests,
with no skipped, pending or TODO assertions and no runner errors. Exact file sets and assertion full names/statuses
match the earlier complete baseline. Frontend/shared/script source and package-lock content were unchanged between
those runs. The observed complete-suite wall time changed from 519.46 seconds (8m 39s) to 449.75 seconds (7m 30s),
about 69.71 seconds / 13.4% lower. These are one accepted complete local run per configuration under variable
desktop load, not a forecast for the complete CI gate. The lightweight allocation guard adds about 1–2 seconds
before CI suites; its time is excluded from the frontend runner measurement.

A focused `--project helpers-node` run of `workout-reflection.shared.spec.ts` passed all five tests in 1.61 seconds
wall time, with Vitest reporting 247 ms and zero setup/environment time. The original Angular/jsdom filtered run
took about 24 seconds, chiefly because of compiler startup.

Additional checks passed:

- `npm run test:frontend-config`: five checks, including current discovery parity and future-file fallback.
- `npm run test:workflows`: eleven checks, including execution of all projects by the ordinary app CI command.
- Standalone TypeScript checking and ESLint for `vitest.config.ts`.
- Representative smoke: four files / 38 tests spanning Node, DOM, chart queue and Angular component rendering.
- V8 coverage smoke: three files / 22 tests spanning every project, with the tested Node/Angular sources and an
  uncovered Angular service included in the coverage report.

Ignored `tmp/vitest-benchmark/helpers-split-full-frontend.*` retains the full run and exact assertion-parity evidence.
The registry, discovery guard, workflow integration and operational documentation are included in the implementation.
No dependency upgrade, test assertion change, product behavior change or MCP/Training/provider contract change is involved.
