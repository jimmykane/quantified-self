# Event summary readers and performance

Use the smallest read model that supports a view. Sports Lib 23.7.0 adds `EventSummary.fromJSON`, which retains event
metadata and raw canonical stats and constructs metric objects only when requested. Constructor and alias lookup is
also indexed once, benefiting existing full readers automatically. Installing the package does not switch QS read
paths to summaries: most existing event queries still hydrate full events and need deliberate consumer migrations.

## Choose a reader

| Consumer | Reader |
| --- | --- |
| Counts, dates, tags, recorded numeric projections, or start-position inference | Explicit raw-document projection through the existing owner-scoped query service; retain required validation. |
| Dashboard cards, activity lists, chart inputs, map popups or previews needing canonical metrics | `EventSummary.fromJSON` and selected `getStat()` reads. Browser consumers use the `/metrics` package entry to exclude file adapters. |
| Details needing child activities, laps, streams, devices or zones; editing, merge or complete export | Existing full event/activity readers and source hydration where required. |

[Calendar reads](../src/app/services/activity-calendar.service.ts) already use
`AppEventService.watchEventDocumentsBy` and a small projection. Preserve that approach rather than introducing metric
construction where raw values suffice. Reuse the shared event-query service and its listener sharing, incremental
document updates, cache/server handling and resolver seed behavior when adding a summary path.

## Canonical summary reads

This example accepts an already sanitized, typed payload. The storage document ID is separate from its contents.

```ts
import {
  DataDistance,
  EventSummary,
  type EventSummaryJSONInterface,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib/metrics';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

export function readSummary(documentID: string, sanitizedJson: EventSummaryJSONInterface): EventSummary {
  return EventSummary.fromJSON({ ...sanitizedJson, id: documentID });
}

export function distanceLabel(summary: EventSummary, unitSettings: UserUnitSettingsInterface): string {
  return resolveUnitAwareDisplayStat(summary.getStat<number>(DataDistance.type), unitSettings)?.text ?? '';
}
```

Metadata reads construct no metrics. The first `getStat()` constructs and caches the selected metric and any required
speed-derived dependencies. Missing metrics return `undefined`. The reader preserves aliases, canonical precedence,
valid zero, cadence/stroke-rate rules and Diving terrain exclusions. Input dates use native JSON millisecond values;
normalize other storage timestamp representations at the existing read boundary.

Keep sanitization and unknown-type reporting at that boundary. The summary reader defers unknown-type and invalid-value
errors until a metric is requested; it does not replace application validation or diagnostics. Preserve the consumer's
error policy explicitly during migration rather than silently changing which corrupt records are reported or skipped.

Define a narrow read interface for summary consumers. `AppEventInterface` extends the full `EventInterface`, so casting
an `EventSummary` to it is unsafe. Carry required QS tags, benchmark classification/results, sharing state and source
references through explicit metadata adapters. Resolve a full event separately for an action that needs it. Keep
summary objects and raw snapshots out of existing complete-event persistence/export paths.

Treat cached metric instances as read-only within shared UI state: the API caches mutable Sports Lib objects.
`getRawStats()` returns a deep copy captured before lazy pace derivation; changes to cached metrics do not update it.
Neither the raw snapshot nor the summary is a complete event export. Keep the built-in constructor/alias catalog
unchanged at runtime; its one-time index is not a custom registration API.

## Keep consumers lazy

- Use selected `getStat()` reads for displayed columns, active sort/filter fields and aggregation selectors.
  `getStats()` and `getStatsAsArray()` explicitly construct all available metrics, including lazy derived metrics.
  Reserve all-metric enumeration for a consumer that actually displays or exports the complete stat set.
- Do not enumerate and format every stat to decide whether a cached row is reusable. Compute an explicit content
  revision when a document changes and combine it with relevant settings in the cache key. Check reuse before display
  work. Preserve same-ID updates and in-place mutations; do not rely on object identity alone.
- Keep raw sort/filter values available where needed, and format the visible cells through the shared unit-aware
  display helpers. Pagination alone does not help if all rows are formatted before the paginator slices them. Preserve
  hidden-column search, sorting and export behavior when changing the pipeline.
- Avoid repeated full `getRawStats()` copies or whole-document serialization during rendering. Fingerprint data at
  ingestion only where needed for reuse or reconciliation, rather than once per consumer per render.
- Reuse compatible sorted inputs and date buckets across tiles. Include source revision, event filters, selected metric,
  aggregation, metric-specific exclusions, interval and timezone in relevant cache keys. Retain DST, missing-data and
  sport-specific behavior.
- Share deterministic preview datasets instead of constructing complete example events for every thumbnail. Keep
  wall-clock recovery/availability contexts current and avoid retaining one owner's data in another owner's cache.

## Implemented QS read paths

`AppEventService.getEventSummariesBy`, `getEventSummariesOnceBy` and `getEventSummariesOnceByWithMeta` return
`EventRead[]`. They share the existing query, sanitization, diagnostics and incremental listener machinery. Summary
and full-event prefetch seeds are isolated by owner/query and reader kind. Full `getEventsBy` / `getEventsOnceBy`
APIs remain available to callers that require complete models.

```ts
const events$ = eventService.getEventSummariesBy(user, whereClauses, 'startDate', false, 0);
// Pass EventRead to list/chart inputs; request each metric through getStat with the user's units.
```

`shared/event-summary.ts` composes Sports Lib's summary with explicit QS metadata. It has no `toJSON`, activity
collection or full-event mutators. A source revision identifies each restored snapshot, while the bounded set of
already requested metric instances is observed for in-place value changes. `applySavedStat` reflects an already
committed elevation patch locally, including zero and removal; it does not write to Firestore. Existing Training
source validation alone may call `getSourceSnapshot`. The adapter captures the persisted stats before sanitization,
alias resolution and sport normalization, preserving the server fingerprint even for legacy or unknown fields.
Optional metric reads do not rewrite that source. Committed patches and subsequent in-place metric edits are reflected
without adding implicit lazy-derived fields. Never use that whole-source operation in row construction or caching.
Full action reads normalize source-file dates on copies and fall back to the event date for legacy path-only references;
missing optional metadata must not prevent an otherwise valid export or repaired-event refresh.
`getEventAndActivitiesOnce` fetches the parent and its child activities from the server for GPX/benchmark hydration
and post-reprocess refresh. It waits for both reads and propagates failures; taking the first cache-backed live emission
can otherwise mistake missing cached children or stale stats for the complete result. Keep list queries on summaries.
Capture the authenticated UID as well as input ownership for asynchronous actions; profile inputs can lag an auth switch.
Forward the action's local cancellation guard through App Check preparation and retries. A confirmed backend reprocess
followed by a failed read is a completed mutation requiring refresh, not a failed save or an automatic retry.

| Area | Implemented behavior |
| --- | --- |
| Shared event reader | Dashboard resolver/listener, Activities, range tables, summary tiles and preview queries use explicit summary APIs. Dashboard captures one comparison snapshot per emission and compares it with the captured resolver/previous state. Metric-only changes and in-place edits remain visible without rescanning previous objects. Summary revisions compare selected numeric values directly and serialize structured values to detect nested edits. Details and tools that need full models retain their readers. |
| Event table | Reads selected metrics and memoizes display/sort cells on first access. Cache validation uses revisions for summaries and bounded metric values for full events, without formatting. Hidden-column search/sort and CSV still request their required cells. Settings and owner changes invalidate display context. |
| Row actions and maps | GPX and benchmark actions load complete events explicitly. Reprocess sends the stable event ID to the existing backend before restoring the repaired result; malformed source stats must not block a repair. Complete detail models retain their refresh behavior. Capture the event and owner before awaiting confirmation/loading; abandon stale work before starting an action when its row, owner or component changes. Source downloads and metadata patches use existing paths. Map markers/popups accept read models, and selecting a track retains explicit stream hydration. |
| Chart picker examples | Private deterministic seeds are shared across cards; the 18 example events use summaries without child models. Recovery's wall-clock context is rebuilt for every preview. |
| Dashboard aggregation | Map and chart tiles use one input preparation path. Each source array is normalized only when needed, once per build; sport filters reuse that ordering. Route-only maps skip event preparation. One synchronous build/request shares activity keys and timezone/interval bucket keys. Discard `EventStatAggregationContext` after each build; never retain it across live updates or owners. Auto interval selection scans endpoints without sorting. |
| My Tracks | Home inference projects only persisted IDs, dates and valid start positions, with no metric construction. Detailed track/source loading remains full. |
| MCP metric aggregation | Reuses validated selected metric instances directly, with canonical compatibility renames where needed. It does not derive missing persisted metrics or hydrate unrelated stats. Existing masks and cumulative budgets remain in force. |

Backend reader optimization must preserve explicit projections, persisted-only metric availability, query/work limits,
consent and location exclusions. Lazy derivation does not authorize exposing a missing persisted stat. Follow the
existing [MCP workflow](../.agent/skills/mcp-metric-surface/SKILL.md) for any affected MCP contract and retain
[Training's existing semantics](training-workspace.md) for Training or derived consumers.

## Verification for future changes

Use focused behavioral tests to establish that metadata reads construct no metrics, selected reads construct only
requested metrics and dependencies, and cache hits avoid all-stat enumeration/formatting. Cover changed documents with
the same ID, owner/settings changes, missing versus zero, aliases, explicit canonical precedence, malformed/unknown
stats, sport semantics and default/non-default display units. Preserve full-event edit/export behavior and existing
authorization/output tests for any migrated backend surface.

Benchmark representative complete paths: sanitizer, reader, metric selection, row cache keys, formatting and aggregation.
Use repeated warmed samples and verify equivalent values first. Report construction counts or work avoided alongside
timings; do not use noisy absolute timing assertions as the sole regression guard. Keep fixtures synthetic and record
runtime, event/stat counts and workload exclusions. Browser profiling remains necessary to measure whole-view latency.

A local synthetic check on 23 October 2026 used Node 22.23.3, 438 events with 80 numeric stats plus activity types and
position, two warmups and seven measured rounds. With QS's sanitizer included, six metric reads took medians of
19.870 ms with full hydration and 8.714 ms with summaries. Including the table's all-stat display/cache-key pattern
instead took 32.647 ms and 34.679 ms respectively. Six-read metric JSON values agreed for all 438 events. These figures
exclude Firestore, network, module startup and rendering; they demonstrate why the consumer must stay lazy, not a
whole-dashboard speedup or a production latency budget.

See the [Sports Lib summary API and benchmark guide](https://github.com/sports-alliance/sports-lib/blob/v23.7.0/docs/guides/json-summaries.md)
for the library contract. The [always-on summary read rule](../.agent/rules/event-summary-reads.md) makes this guidance
part of the repository workflow.

## Reproducible consumer benchmark

Run with Node 22 and a baseline ref:

```sh
node tools/benchmarks/event-summary-read.mjs 6e0974c88
```

The script extracts each version's actual table cache methods and dashboard duplicate-filter operators and uses its
real metric row builder, summary wrapper and shared aggregator. It resolves the baseline to a commit and selects
full or summary readers according to that version's cache path, so a baseline after the migration also works. It
includes QS sanitization, restored readers, cache-key work and six displayed cells for 438 synthetic
events containing 80 numeric stats plus activity types, device names and start position. It verifies displayed-value
and eight-selector aggregation parity before reporting three warmups and eleven median samples. No user data is used;
temporary generated modules are removed automatically. A parity mismatch exits unsuccessfully. Module startup,
Firestore/network, Angular change detection, DOM/ECharts/Mapbox rendering and whole-page latency are excluded.

A verified local Node 22.23.3 run on 23 October 2026 measured:

| Work for 438 events | Baseline | Summary consumer |
| --- | ---: | ---: |
| Sanitize, restore, cache key and six displayed cells | 47.722 ms | 23.351 ms |
| Repeated row cache-key pass | 18.685 ms | 1.165 ms |
| Eight daily selectors in Europe/Helsinki | 210.255 ms | 27.380 ms |
| Metric factory calls for the first workload | 36,354 | 3,066 |

All displayed values and aggregation outputs matched. Timings vary with machine load; factory-call counts and parity
are the stable work checks. Factory counts instrument `DynamicDataLoader.getDataInstanceFromDataType`, not all JavaScript allocations. This is a consumer CPU comparison, not a measured production dashboard speedup.
The Help content was reviewed: no new user option or workflow is introduced by these performance changes.

For the subsequent simplification pass, use `6f224a53b` as the baseline. In a Node 22.23.3 run, unchanged dashboard
emission handling fell from 1.020 ms to 0.278 ms for the same 438 events. Each emission now scans selected metrics
438 times instead of 1,314; JSON serialization calls fell from 11,388 to 439. Repeated table cache-key serialization
calls fell from 3,942 to 876. The script counts these operations separately from timing and asserts that unchanged
emissions are suppressed and changed emissions still pass through.

Fresh row work (17.433 vs 17.547 ms) and eight-selector aggregation (25.767 vs 26.006 ms) were effectively unchanged.
Both versions made 3,066 metric factory calls, and displayed values and aggregation outputs agreed. These small
timing differences are noise, not evidence of a regression or a speedup in those paths. Capture immutable comparison
keys at the emission boundary; avoid re-reading mutable previous objects in a duplicate comparator or serializing
numeric metrics on every cache check. Preserve structural mutation detection for array/object metrics.

The benchmark also checks input preparation for 12 map/intensity-zone tiles sharing three source arrays with
different sport filters. Comparing with `983844da4`, removing the separate map path and repeated normalization
reduced event-array sorts from 10 to 3. One warmed run measured 0.609 vs 0.513 ms, with matching tile event IDs,
displayed values and aggregation output. This is a small saving in this fixture; the sort count is the stable check.
Keep input reuse local to one build, isolate source arrays and filter variants, and normalize each source before
filtering rather than sorting again for each variant. The helper's source and filter tests also cover new builds
after in-place edits and immutable input arrays. These internal changes introduce no new Help workflow.
