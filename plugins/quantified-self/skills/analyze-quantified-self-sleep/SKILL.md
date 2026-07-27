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
2. Prefer grouped summaries for trends. Request individual sessions only when timing, stages, or session-level
   variation matters. When naps are requested, keep the main-sleep headline separate and report naps and any
   nap-inclusive total explicitly unless the user asks for a combined headline.
3. Preserve local-day boundaries, units, session counts, stage coverage, missing values, and pagination state.
4. Compare like periods and state when sparse sessions, excluded naps, or incomplete stage data limit the conclusion.

## Limits

- If `sleep:read` is missing, explain that Sleep summaries access must be granted through reconnection.
- Treat a missing permission, no recorded sessions, filtered-out naps, and unavailable stage values as different
  outcomes.
- Do not interpret missing stages as zero or use a provider filter unless the user asks for it.
- Discuss sleep and recovery patterns without diagnosing a condition or claiming that sleep caused another outcome.

## Response

- Lead with the sleep trend and period, then show the supporting duration, timing, stage, or session evidence.
- State the timezone, nap treatment, and material coverage limitations.
