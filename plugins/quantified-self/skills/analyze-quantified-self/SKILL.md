---
name: analyze-quantified-self
description: Analyze the user's authorized Quantified Self fitness and health data through its read-only MCP tools. Use for questions about activities, workout charts, body measurements such as weight, Training-derived metrics, recovery, sleep, routes, waypoints, or location-based activity and route history.
---

# Analyze Quantified Self

Use Quantified Self as the source of record. Discover the available public tools and metrics instead of guessing from
tool names or assuming a data category is unavailable.

## Query Workflow

1. Inspect the relevant catalog before concluding data is unavailable:
   - Use measurement discovery for weight and other body measurements.
   - Use metric discovery for activity statistics and Training-derived snapshots.
   - Use chart-metric discovery before requesting an activity chart.
2. Start with the cheapest summary query that can answer the request. Parse an original activity source only when the
   user asks for chart-series detail that summaries cannot provide.
3. Request the narrowest date range, page size, metric set, and location access needed. Continue through pagination
   only when the user's question requires more history.
4. Treat a missing permission, an unavailable source file, a processing budget, and genuinely absent data as different
   outcomes. Explain which one applies. If access is missing, tell the user which Quantified Self permission must be
   granted through reconnection; do not claim that the data do not exist.
5. Use the units, timezone, date range, counts, pagination state, and missing-sample metadata returned by the tools.
   Never infer units or silently treat missing values as zero.

## Privacy and Interpretation

- Ask for activity or route locations only when they materially help answer the request.
- Do not expose or speculate about internal identifiers, source files, provider or device provenance, or other fields
  outside the public tool results.
- Distinguish recorded measurements, aggregated event metrics, and Training-derived metrics. State the applicable
  window and freshness when interpreting a derived value.
- Describe trends and uncertainty without diagnosing a condition or presenting the result as medical advice.
- When history is partial, say whether a page cursor, scan limit, original-source availability, or missing samples
  constrain the conclusion.

## Response Style

- Lead with the answer, then show the evidence and period used.
- Keep charts and tables compact and label every axis or value with its returned canonical unit.
- Call out material limitations instead of burying them.
