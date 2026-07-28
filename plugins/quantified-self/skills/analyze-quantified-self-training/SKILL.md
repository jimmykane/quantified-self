---
name: analyze-quantified-self-training
description: Analyze the user's authorized Quantified Self training data through its read-only MCP tools. Use for training load, volume, intensity, fitness, fatigue, Training-derived readiness or recovery, activity-type trends, persisted activity metrics, or Training-derived snapshots across time; do not use for one workout's laps or chart streams, sleep-only questions, or body-measurement history.
---

# Analyze Training

Use the live metric catalog instead of assuming that a metric or Training-derived kind exists for the account.

## Workflow

1. Establish the requested period, IANA timezone, activity-type filters, and comparison baseline.
2. Discover available persisted metrics and Training-derived kinds before selecting one.
   If several live metrics plausibly match a broad term such as load, use their returned metadata and units to explain
   the choices and ask which interpretation the user wants; never merge unlike candidates.
3. Use bounded aggregate queries for trends across activities. Use a ready Training snapshot only when its documented
   window and freshness match the question.
4. Preserve the returned aggregation, interval, units, sample counts, missing buckets, and snapshot freshness.
5. Compare totals only with totals and rates or averages only with compatible values. Do not combine unlike activity
   types unless the user requests an overall view.
6. For a compact morning readout, use the server's advertised daily-briefing tool only when the user also granted
   `sleep:read`; supply an explicit IANA timezone. Treat its UTC-day readiness freshness and explicit unavailable
   states as authoritative. Its Training context is the current-versus-usual equivalent 28-day summary, including the
   Running/Cycling/Swimming mix; do not substitute a specialist snapshot unless the user asks for that analysis.

## Limits

- If `metrics:read` is missing, explain that Activity and Training metrics access must be granted through reconnection.
- The daily-briefing tool additionally needs `sleep:read`; do not reconstruct it from raw sleep or turn it into a
  workout prescription.
- Treat a missing metric, missing permission, incomplete page, and a not-ready Training snapshot as distinct outcomes.
- Do not use a current Training-derived body-weight snapshot as historical weigh-in data.
- Describe training and recovery patterns without medical diagnosis or unsupported causal claims.

## Response

- Lead with the training change and period, then the metrics that support it.
- Label values with their returned canonical units and state any material coverage or freshness limitation.
