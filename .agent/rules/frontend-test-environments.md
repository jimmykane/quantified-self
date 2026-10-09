---
trigger: always_on
description: Keep frontend helper tests in the lightest correct environment without weakening coverage.
---

# Frontend test environments

Apply when adding/changing frontend specs or helper runtime imports, or changing frontend Vitest configuration,
discovery checks or CI execution. See [CI test coverage](../../docs/ci-testing.md#ordinary-unit-runner) for the
runner configuration and verification commands.

- Run new pure helper specs under `src/app/helpers/` in `helpers-node`, registering them in the same change.
  Inspect transitive runtime imports and test assumptions, add the exact spec path to the sorted `node` list in
  `tools/frontend-test-environments.json`, and verify it in that project. Keep framework fixture builders out
  of pure helper tests when equivalent plain fixtures suffice. Record why a new helper needs a heavier environment
  when it cannot use Node. Other pure application specs, such as static content contracts under `src/app/shared/`,
  can use the same explicit Node opt-in after their imports and assertions are verified.
  State services without injected dependencies or Angular lifecycle behavior can use plain construction for behavioral
  unit tests after verifying their imports in Node; retain Angular integration coverage for provider scope, injection
  and lifecycle contracts.
- Use `helpers-dom` and the registry's `dom` list for DOM APIs or browser locale/storage semantics that require
  jsdom. Use `angular` for TestBed, Angular component/service/router compilation or the existing global setup.
  Unclassified specs retain the Angular fallback until verified; do not classify an entire directory by name.
- Recheck an opted-in spec's environment when its helper's transitive runtime imports or browser assumptions
  change. Move its exact registry entry to the correct project (or remove it to restore Angular) when needed.
  Do not alter product locale fallbacks, weaken assertions, skip tests or add fake browser/framework globals
  merely to make a spec pass in a lighter environment. Explicit mocks for the behavior under test remain valid.
- Keep the Angular compiler plugin and `src/test-setup.ts` scoped to `angular`; Node/DOM helpers have no global
  setup file. Preserve isolated forks and the global two-worker cap. Optimize setup and imports without reducing
  required coverage or ignoring runner errors.
- In mixed component suites, keep shared setup free of unconditional fixture rendering. Use explicit setup for
  logic tests and real fixtures for template bindings, controls, view queries, effects or Angular lifecycle behavior.
  Static source/style contract checks must not configure TestBed or create components; keep fixture setup local
  to the tests that need it, even when those checks share an Angular spec file.
  A component injected through TestBed still belongs in `angular`; initialize the hooks it needs and preserve
  TestBed teardown. Only use this approach after checking for component/view-scoped dependencies, and compare
  unchanged assertions and covered source locations when benchmarking. See the
  [component fixture benchmark](../../docs/ci-component-fixture-benchmark.md) for a verified example.
- Discovery guards must use Vitest's glob library and matching options, including `dot: true` and the existing
  Functions/Rules exclusions. Node's native glob API omits hidden specs. Preserve the hidden-file/future-file
  regression fixtures and ensure each ordinary spec belongs to exactly one project.
- Keep frontend CI shards generated from current discovery and one shared plan for the tested commit. Never maintain
  permanent per-shard file lists. Timing history is optional scheduling data: it must not add, omit, skip or reclassify
  tests. Preserve the two-worker cap per runner and require both JSON reports to cover the plan exactly once before
  the protected gate succeeds. Keep timing publication after all mandatory jobs and report validation pass.
- For shard planning, sequencing, timing reporter or CI gate changes, run `npm run test:frontend-shards` alongside
  the configuration/workflow guards. Verify both complete shards against the unsharded file/assertion set and run
  coverage across all three environments. New specs enter discovery automatically; unusually large individual specs
  should be split by responsibility while preserving every assertion rather than increasing worker limits.
- With Node 22 selected, run the affected specs in their chosen project using
  `npm run test -- --run --project=<project-name> <spec-path>`, plus `npm run test:frontend-config` and
  `npm run test:workflows` after registry or runner changes. Runner/plugin/discovery changes also require the
  complete frontend suite and a coverage smoke across all projects. Compare exact files and assertion
  names/statuses when benchmarking; report timings only for equivalent passing workloads without skips.
- Every new ordinary spec must be classified in the same change: register Node/DOM paths in
  `tools/frontend-test-environments.json`; record new Angular paths with `environment: "angular"` and a concrete
  reason in the sorted `tools/frontend-test-environment-reasons.json` map. Existing Angular specs are grandfathered.
  Moving an existing Node/DOM spec to a heavier project also requires a matching reason record. Remove stale reasons
  when deleting or moving specs to Node. Run `npm run test:frontend-policy` against the branch's base before committing;
  use `-- --base <revision>` when the base is not `origin/develop`. Never skip a missing comparison or invent a reason
  to retain unnecessary setup. CI enforces this policy before either frontend shard starts.
  Node/DOM tests must not load Angular testing/compiler/global setup through runtime imports, including local transitive
  imports or mocks. Type-only imports and plain Angular core decorators remain allowed after verifying the suite.
  Keep the policy's runtime import scan aligned with Vite resolution and each project's aliases; TypeScript resolution
  can inspect an unused sibling or declaration instead of the file the test loads. Data/raw imports are not executable source.
  Shared fixture hooks in new/changed Angular specs generate review warnings; inspect them and keep pure/static tests
  in separate light suites where practical. Keep real fixtures where bindings, view effects or teardown need coverage.
