---
trigger: always_on
description: Preserve complete, isolated Functions emulator coverage and automatic delivery shard balancing.
---

# Functions emulator shards

Apply when adding/changing Functions emulator or integration specs, their runner, discovery or CI execution.
See [CI test coverage](../../docs/ci-testing.md#functions-emulator-matrix) for commands and isolation details.

- Register each real emulator spec exactly once in `tools/functions-emulator-suites.mjs`, including ordinary specs
  reading Firestore/Auth emulator hosts. Literal `vi.stubEnv`/`vitest.stubEnv` host keys alone do not imply an emulator
  dependency: keep mocked or strictly offline environment-behavior tests in the ordinary suite and verify them there.
  Real emulator users must retain emulator/integration filenames and registration even if they set hosts with stubs.
  Discovery changes must retain regression cases for host reads alongside stubs and named emulator files.
  Preserve the mandatory stress cases. New delivery specs join the
  `delivery` registry; never assign permanent file lists to its two CI shards. Inspect heavier group growth using
  successful CI timings before proposing additional concurrency.
- Ordinary Functions tests use `functions/vitest.config.ts`, which excludes exact registered emulator paths before
  collection. Real emulator entry points must use `functions/vitest.emulators.config.ts`; never switch this split
  implicitly through inherited environment variables or broad filename exclusions. Keep emulator files wholly
  emulator-gated and split mixed unit cases into ordinary specs before registering them. The coverage guard checks
  both configurations, hidden/future unit discovery and mixed registrations; preserve complete, non-overlapping coverage.
- Derive retry-exhaustion fixtures from the applicable shared retry budget. Provider and internal/Training budgets
  differ: verify the last pending retry, committed exhaustion and transaction rollback in affected emulator specs
  when a budget changes. Keep coverage that provider retries remain pending beyond the internal budget.
- Give real contending Firestore transaction cases an explicit bounded timeout for lock waits and SDK backoff
  (the existing pattern is 30 seconds). Scope it to the contention case; preserve simultaneous operations and durable
  state assertions. Do not add test retries or increase ordinary/global timeouts to hide a failure.
- For private-field exclusion checks, validate the existing strict public output schema or inspect property names
  recursively. Do not scan the entire serialized payload for bare field names: random opaque references can contain
  substrings such as `uid`. Keep explicit private-value canaries and negative nested-field fixtures as well.
- Generate one delivery plan from the current registry and tested commit, shared by both runners. Timing history
  is optional scheduling data; corrupt/missing history or a newly registered file must never drop or skip tests.
  Preserve exact registry/discovery checks and reject stale, missing or duplicate selections.
- Keep isolated forks, one Vitest worker and serial files per emulator runner. Each CI shard has its own Firestore
  and Auth emulators on loopback, exact demo projects, and the scrubbed child environment. Never share emulators
  between concurrent runners, forward credentials, start Functions/Extensions or change product behavior to speed tests.
- Require both complete delivery reports and every mandatory job before the protected gate succeeds or publishes
  timing history. Preserve failed/skipped/TODO/empty/counter validation; no retries, ignored runner errors, weakened
  assertions or path filters. A single long spec may need splitting by responsibility with all assertions preserved.
- Use Node 22. After registry/runner/CI changes, run `npm run test:emulator-coverage`, `npm run test:delivery-shards`
  and `npm run test:workflows`. Delivery scheduling changes also require both complete delivery shards and an exact
  file/assertion-name/status comparison against an unsharded passing delivery run. Verify affected non-delivery
  groups when changing the shared emulator runner. Publish timing claims only for equivalent passing workloads,
  and distinguish local serial verification from parallel hosted job measurements.
