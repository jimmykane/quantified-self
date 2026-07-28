---
name: analyze-quantified-self
description: Compare the user's authorized Quantified Self data across two or more health and fitness domains through its read-only MCP tools. Use for cross-domain questions such as sleep versus training, weight versus activity, or recovery trends that require combining measurements, Training metrics, sleep, activities, or routes; use the focused Quantified Self skills for single-domain requests or multiple independent summaries that do not need comparison.
---

# Analyze Quantified Self

Use Quantified Self as the source of record for cross-domain analysis. Keep each domain's recorded values, aggregation
rules, permissions, and coverage distinct until they are aligned for comparison.

## Cross-Domain Workflow

1. Confirm that the question needs at least two domains. Prefer the matching focused plugin skill when one domain is
   sufficient, and use focused skills independently when the user requests separate summaries without a comparison.
   For an unqualified recovery or readiness question, clarify whether the user means Training, sleep, or a comparison
   between them before choosing a workflow.
2. Discover the relevant measurement, metric, sleep, activity, or route capabilities before concluding that data are
   unavailable. For a sleep-vital comparison, first discover which safe aggregate sleep values are recorded for the
   selected period rather than searching activity metrics or inferring from Training readiness.
3. Choose one bounded comparison period and IANA timezone. Query the cheapest summary from each domain before
   requesting individual sessions, activities, charts, or locations. For individual activities, discover canonical
   activity types before filtering; use timezone-aware relative periods for today or yesterday, and preserve the same
   filters across bounded scan cursors until the scan is complete. For saved routes, use the same canonical type filter
   and optional case-insensitive route-name search, preserving both filters with every cursor.
4. Align results only on comparable time buckets. Preserve each result's units, aggregation, coverage, freshness,
   pagination state, and missing values.
5. Describe association rather than causation. Call out sparse or mismatched coverage that weakens the comparison.
6. For a request such as “good morning” or a compact current readout, prefer the server's advertised daily-briefing
   tool when both `metrics:read` and `sleep:read` are available. Pass an explicit IANA timezone, preserve its local-day
   and UTC-day boundary distinction, distinguish its equivalent 28-day Training summary from the preceding 84-day
   comparison source, and do not expand it into a workout plan or medical advice.

## Permissions and Privacy

- Treat a missing permission, unavailable source, processing budget, incomplete page, and genuinely absent data as
  different outcomes. Name the permission that must be granted through reconnection.
- Map each domain to its grant: Training and aggregate metrics use `metrics:read`, body measurements use
  `measurements:read`, sleep uses `sleep:read`, individual activities use `activity-details:read`, and saved routes use
  `routes:read`. Selected per-activity metrics also need `metrics:read`.
- Request activity or route locations only when they materially affect the comparison. Activity coordinates require
  `activity-location:read`; route coordinates require `route-location:read`. One never grants the other.
- Do not expose or speculate about internal identifiers, source files, provider or device provenance, or other fields
  outside the public tool results.
- Distinguish recorded measurements, aggregated activity metrics, normalized sleep data, and Training-derived
  snapshots.
- A daily briefing is a limited current-context projection: its latest completed sleep, current-versus-usual Training
  summary, and readiness status do not establish a long-term trend or causation.
- Describe trends and uncertainty without diagnosing a condition or presenting the result as medical advice.

## Response Style

- Lead with the cross-domain finding, then show the evidence and period from each domain.
- Keep comparisons compact and label every value with its returned unit and time window.
- State material permission, coverage, and interpretation limits next to the conclusion.
