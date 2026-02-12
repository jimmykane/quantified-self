# Task Proposals (Issue Backlog)

## 1) Fix a typo

**Task:** Correct spelling mistakes in inline comments within the chart and activity form components (e.g., `interacttivity`, `doesnt`, `its`).

**Why:** Typos in comments reduce readability and make code search less reliable.

**Acceptance criteria:**

- Fix identified typos in comments without changing runtime behavior.
- Run targeted lint/test checks for edited files.

---

## 2) Fix a bug

**Task:** Handle events with zero activities in `attachStreamsLegacy` so the observable still emits an event.

**Why:** `combineLatest([])` completes without emitting; currently `attachStreamsLegacy` can return an observable that never emits when `event.getActivities()` is empty.

**Acceptance criteria:**

- Add an early return path that emits `event` (e.g., `of(event)`) when there are no activities.
- Confirm non-empty activity behavior remains unchanged.

---

## 3) Fix a code comment/documentation discrepancy

**Task:** Update the README visualization stack to match the actual implementation.

**Why:** README currently says visualization uses `Chart.js` and `Leaflet`, but the project dependencies and map/chart code use `@amcharts/amcharts4`, `echarts`, and `mapbox-gl`.

**Acceptance criteria:**

- README visualization section reflects current libraries.
- Cross-check against `package.json` dependencies and representative component imports/usages.

---

## 4) Improve a test

**Task:** Add a unit test in `app.event.service.spec.ts` to cover the zero-activities edge case for stream attachment.

**Why:** There is currently no explicit test coverage for `attachStreamsLegacy` behavior when an event has no activities.

**Acceptance criteria:**

- New test proves the observable emits the original event for zero activities.
- Existing tests continue to pass.
