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

## Existing migration candidates

The 23 October 2026 scan identified these candidates; this guide does not claim they have already been converted.

| Area | Current work to remove |
| --- | --- |
| [Shared event reader](../src/app/services/app.event.service.ts) | Full stat construction for dashboard, activity-list and preview queries. Add a separate summary path while preserving existing full-event callers and QS metadata. |
| [Event table](../src/app/components/event-table/event.table.component.ts) | All-stat enumeration in row construction and cache-key generation, including before cache-hit reuse. Migrate alongside the reader. |
| [Chart picker examples](../src/app/helpers/dashboard-chart-preview.helper.ts) | Eighteen full events with child activities per example preview. Reuse fixtures and use summaries where a preview only needs stats. |
| [Dashboard aggregation](../shared/event-stat-aggregation.ts) | Repeated sorting and date grouping for each chart selector. Reuse compatible work without changing per-metric exclusions or time semantics. |
| [My Tracks](../src/app/components/tracks/tracks.component.ts) | Full event hydration for home inference that needs only IDs, dates and start positions. Keep detailed track/source loading separate. |
| [MCP metric aggregation](../functions/src/mcp/data.service.ts) | Selected metrics constructed for validation and again during import. Existing field masks already limit reads, making this a lower-priority opportunity. |

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
