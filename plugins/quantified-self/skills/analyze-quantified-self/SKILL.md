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
   unavailable. For a sleep-vital comparison, prefer the one-call sleep trend capability so coverage and grouped values
   share one bounded read rather than searching activity metrics or inferring from Training readiness. Preserve that an
   individual blood-oxygen value is a session maximum while a grouped trend averages session maxima, and that grouped
   respiration averages session-level averages. Neither belongs to the Readiness formula, so request the sleep trend
   separately when the comparison needs them.
3. Choose one bounded comparison period and IANA timezone. Query the cheapest summary from each domain before
   requesting individual sessions, activities, charts, or locations. For individual activities, discover canonical
   activity types before filtering; use timezone-aware relative periods for today or yesterday, and preserve the same
   filters across bounded scan cursors until the scan is complete. For saved routes, use the same canonical type filter
   and optional case-insensitive route-name search, preserving both filters with every cursor.
4. Align results only on comparable time buckets. Preserve each result's units, aggregation, coverage, freshness,
   pagination state, and missing values.
5. Describe association rather than causation. Call out sparse or mismatched coverage that weakens the comparison.
6. For a current readiness or recovery-aware score, prefer the server's advertised live-readiness capability when
   `metrics:read` and `sleep:read` are available. Preserve its UTC-day scoring boundary, local-day context, current load
   freshness, safe latest aggregate HRV/heart-rate values, same-provider baseline medians, ratios, and evidence states.
   Use a separate bounded sleep trend when the user asks whether those values changed over several days.
7. For a request such as “good morning,” a daily report, or a current readout, prefer the server's advertised daily
   report tool when both `metrics:read` and `sleep:read` are available. Pass an explicit IANA timezone. Lead with the
   latest sleep and recorded aggregate HRV/heart-rate values, summarize Readiness in one sentence using at most two
   relevant available drivers, then summarize the equivalent 28-day Training context. Preserve the local-day versus
   UTC-day boundary distinction and the preceding 84-day Training comparison source. Use the legacy daily briefing only
   when the user explicitly asks for its physiology-free projection.

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
- A daily report is a limited current-context projection: its latest completed sleep, aggregate HRV/heart-rate values,
  current-versus-usual Training summary, and live readiness do not establish a long-term trend or causation.
- The live readiness result explains the current score inputs; it is not itself a multi-day HRV or sleep trend.
- Do not infer oxygen desaturations, respiratory events, illness, or a diagnosis from aggregate blood-oxygen or
  respiration values.
- Describe trends and uncertainty without diagnosing a condition or presenting the result as medical advice.

## Response Style

- Lead with the cross-domain finding, then show the evidence and period from each domain.
- Keep comparisons compact and label every value with its returned unit and time window.
- State material permission, coverage, and interpretation limits next to the conclusion.
