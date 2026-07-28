---
name: analyze-quantified-self-sleep
description: Analyze the user's authorized Quantified Self sleep data through its read-only MCP tools. Use for sleep sessions, duration, stages, efficiency, naps, bedtime or wake-time patterns, and sleep-oriented recovery trends; use the cross-domain Quantified Self skill when comparing sleep with training, measurements, or activities.
---

# Analyze Sleep

Use normalized sleep summaries as the source of record. Never infer raw samples or provider details that are not
returned.

## Workflow

1. Establish the requested period, IANA timezone, whether naps belong in the analysis, and whether the user explicitly
   asked to filter by provider.
2. For a sleep trend—including recent duration, score, stage, HRV, heart-rate, blood-oxygen, or respiration changes—
   prefer the available one-call trend capability so recorded-vital coverage and grouped values come from one bounded
   read. Use capability discovery only for availability questions, and request individual sessions only when nightly
   timing or variation matters. When naps are requested, keep the main-sleep headline separate and report naps and any
   nap-inclusive total explicitly unless the user asks for a combined headline.
3. Preserve local-day boundaries, units, session counts, stage coverage, missing values, and pagination state.
4. Compare like periods and state when sparse sessions, excluded naps, or incomplete stage data limit the conclusion.
5. For a compact same-day morning readout, use the server's advertised daily-briefing tool only when both sleep and
   Training-metrics access are available. Supply the user's explicit IANA timezone. It is a current-context shortcut,
   not a historical sleep trend or a medical assessment.

## Limits

- If `sleep:read` is missing, explain that Sleep summaries access must be granted through reconnection.
- The daily-briefing tool additionally needs `metrics:read`; without both grants, use the ordinary sleep tools and do
  not infer Training readiness.
- Treat a missing permission, no recorded sessions, filtered-out naps, and unavailable stage values as different
  outcomes.
- Treat unavailable aggregate vital types as missing source data for that period; do not infer them from Training
  readiness or from raw samples, which are never exposed.
- Do not interpret missing stages as zero or use a provider filter unless the user asks for it.
- Discuss sleep and recovery patterns without diagnosing a condition or claiming that sleep caused another outcome.

## Response

- Lead with the sleep trend and period, then show the supporting duration, timing, stage, or session evidence.
- State the timezone, nap treatment, and material coverage limitations.
