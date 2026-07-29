---
name: analyze-quantified-self-training
description: Analyze the user's authorized Quantified Self training data through its read-only MCP tools. Use for training load, volume, intensity, fitness, fatigue, Training-derived readiness or recovery, activity-type trends, persisted activity metrics, or Training-derived snapshots across time; do not use for one workout's laps or chart streams, sleep-only questions, or body-measurement history.
---

# Analyze Training

Use the live metric catalog instead of assuming that a metric or Training-derived kind exists for the account.

## Workflow

1. Establish the requested period, IANA timezone, activity-type filters, and comparison baseline.
2. Discover available persisted metrics and use the Training capability catalog to distinguish a supported kind from
   a ready, rebuilding, stale, missing, failed, or schema-incompatible snapshot before selecting one.
   If several live metrics plausibly match a broad term such as load, use their returned metadata and units to explain
   the choices and ask which interpretation the user wants; never merge unlike candidates.
3. Use one shared bounded aggregate request when comparing up to four activity metrics over the same range, grouping,
   timezone, and activity filters. Use a ready Training snapshot only when its documented window and freshness match
   the question.
4. Preserve the returned aggregation, interval, units, sample counts, missing buckets, and snapshot freshness.
5. Compare totals only with totals and rates or averages only with compatible values. Do not combine unlike activity
   types unless the user requests an overall view.
6. For the current recovery-aware readiness score, prefer the server's advertised live-readiness tool when the user
   also granted `sleep:read`; supply an explicit IANA timezone. Preserve its UTC-day score boundary, local-day context,
   load freshness, recorded-versus-duration sleep score source, same-provider HRV and overnight-heart-rate baselines,
   evidence counts, and explicit missing or insufficient-baseline states. Do not reconstruct those drivers from a
   historical readiness snapshot.
7. For a morning or daily readout, use the server's advertised daily report tool only when the user also granted
   `sleep:read`; supply an explicit IANA timezone. Lead with the latest sleep and recorded aggregate HRV/heart-rate
   values, summarize Readiness in one sentence using at most two relevant available drivers, then present the
   current-versus-usual equivalent 28-day Training summary and Running/Cycling/Swimming mix. Treat UTC-day readiness
   freshness and explicit unavailable states as authoritative; do not substitute a specialist snapshot unless asked.

## Limits

- If `metrics:read` is missing, explain that Activity and Training metrics access must be granted through reconnection.
- The live-readiness and daily-report tools additionally need `sleep:read`; do not reconstruct either from raw sleep
  or turn the result into a workout prescription.
- Treat an unsupported metric, a supported but not-ready Training snapshot, missing permission, and incomplete page as
  distinct outcomes. Do not conclude that a Training capability is unsupported before checking its catalog status.
- Do not use a current Training-derived body-weight snapshot as historical weigh-in data.
- Describe training and recovery patterns without medical diagnosis or unsupported causal claims.

## Response

- Lead with the training change and period, then the metrics that support it.
- Label values with their returned canonical units and state any material coverage or freshness limitation.
