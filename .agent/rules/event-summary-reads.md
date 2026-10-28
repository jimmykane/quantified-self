---
trigger: always_on
description: Keep event summary consumers lazy and prevent repeated full hydration and metric enumeration.
---

# Event Summary Reads

Read [the summary reader guide](../../docs/event-summary-reads.md) before adding or changing event summary, list,
dashboard, chart, map, preview, or aggregation reads in the frontend or Functions.

- Use `EventSummary.fromJSON` from `@sports-alliance/sports-lib/metrics` when a read needs canonical metric objects on
  demand. Use an explicit raw-document projection when it needs only metadata or selected raw values. Reuse existing
  query services; do not introduce full `EventImporterJSON` / `SportsLib` hydration for a new summary-only consumer.
- Keep full models for details that require child activities, laps, streams or zones, and for editing, merging and
  exports. `EventSummary` is not `EventInterface`: use a narrow read interface and explicit QS metadata rather than
  casting it into a full event. Preserve existing sanitization, diagnostics and authorized projections.
- Read the required metrics with `getStat`. `getStats()` and `getStatsAsArray()` eagerly materialize every available
  metric; do not use them for summary row construction, cache keys, filtering or change detection. Do not deep-copy
  `getRawStats()` or stringify every stat on each render to work around this restriction.
- Base caches on explicit document/content revisions plus relevant owner, filter, timezone and display settings.
  Reuse unchanged work before formatting metrics. Preserve in-place update detection, hidden-column sorting/filtering
  and exports; object identity alone does not establish unchanged content. Bound caches and isolate owners.
- Reuse deterministic example fixtures and compatible sorted/grouped event inputs across previews and charts.
  Recompute contexts that depend on wall-clock time. Do not generate full child activity models just to draw a card.
- Render selected canonical metrics through `shared/unit-aware-display.ts` with the user's settings. Keep missing
  values distinct from zero and preserve aliases, explicit-value precedence and sport-specific semantics.
- Verify that metadata-only reads construct no metrics and selected reads leave unrelated metrics unconstructed.
  Benchmark the actual sanitizer, reader, cache-key and display path; a reader-only timing does not cover the table.
  Preserve the existing data/authorization contract and follow the applicable focused test rules.
