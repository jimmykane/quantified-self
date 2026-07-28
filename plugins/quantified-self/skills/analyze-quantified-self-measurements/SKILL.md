---
name: analyze-quantified-self-measurements
description: Analyze the user's authorized Quantified Self body measurements through its read-only MCP tools. Use for weight, body mass, weigh-ins, recorded measurement history, rates of change, plateaus, or other discoverable personal measurement trends; do not substitute a current Training-derived snapshot for historical measurements.
---

# Analyze Body Measurements

Use first-class recorded measurements as the source of history. Keep recorded values distinct from Training-derived
snapshots.

## Workflow

1. Discover the available measurement types, canonical units, supported aggregations, date limits, and optional current
   snapshot before concluding that a measurement is unavailable.
2. Establish the requested period, IANA timezone, interval, and aggregation. Prefer a median trend for repeated noisy
   weigh-ins unless the user asks for latest, average, minimum, or maximum values. When the interval is unspecified,
   use daily buckets through 31 days, weekly buckets through 180 days, and monthly buckets for longer supported ranges,
   and state that choice.
3. Use the returned time series and change summary. Preserve units, bucket boundaries, counts, missing values, and
   partial coverage.
4. Calculate an additional rate only when the returned period and samples support it, and label the calculation.

## Limits

- If `measurements:read` is missing, explain that Body measurements access must be granted through reconnection.
- Treat a missing permission, unsupported measurement type, empty date range, and missing bucket as distinct outcomes.
- Never infer provider, device, or source provenance from the public result.
- Describe trends and uncertainty without assessing health status, prescribing a target, or making a medical diagnosis.

## Response

- Lead with the direction and magnitude of the measurement trend, then show the period and supporting buckets.
- Label every value with its returned canonical unit and state any aggregation or coverage limitation.
