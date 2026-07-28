---
name: analyze-quantified-self-sleep
description: Analyze the user's authorized Quantified Self sleep data through its read-only MCP tools. Use for sleep sessions, duration, stages, efficiency, naps, bedtime or wake-time patterns, HRV, sleep heart rate, blood oxygen, respiration, and sleep-oriented recovery trends; use the cross-domain Quantified Self skill when comparing sleep with training, measurements, or activities.
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
3. Preserve the exact returned statistic and unit for every vital. An individual-session blood-oxygen value is that
   session's maximum; a grouped trend value averages the contributing sessions' maxima. Likewise, grouped respiration
   averages the contributing sessions' average respiration. Do not reinterpret either as an overnight mean or minimum
   reading, a desaturation or respiratory event, or a diagnosis.
4. Preserve local-day boundaries, units, session counts, stage coverage, vital coverage, missing values, and pagination
   state.
5. Compare like periods and state when sparse sessions, excluded naps, or incomplete stage or vital data limit the
   conclusion.
6. For a same-day morning readout, use the server's advertised daily report tool only when both sleep and
   Training-metrics access are available. Supply the user's explicit IANA timezone. Lead with recorded aggregate HRV
   and average/minimum sleep heart rate when present, then keep Readiness to one sentence using at most two relevant
   available drivers. It is a current-context shortcut, not a historical sleep trend or a medical assessment.
7. If the user asks specifically how today's Training readiness incorporates sleep or HRV, use the advertised
   live-readiness capability when both permissions are present. Keep its latest safe aggregate HRV/heart-rate values,
   same-provider baseline medians, ratios, and evidence states distinct from the longer sleep trend. Readiness does not
   include blood oxygen or respiration; query the ordinary sleep trend separately when the user asks about those vitals.

## Limits

- If `sleep:read` is missing, explain that Sleep summaries access must be granted through reconnection.
- The live-readiness and daily-report tools additionally need `metrics:read`; without both grants, use the ordinary
  sleep tools and do not infer Training readiness.
- Treat a missing permission, no recorded sessions, filtered-out naps, and unavailable stage values as different
  outcomes.
- Treat unavailable aggregate vital types as missing source data for that period; do not infer them from Training
  readiness or from raw samples, which are never exposed.
- Do not describe maximum blood oxygen as average or minimum SpO₂, and do not infer oxygen desaturations, sleep apnea,
  illness, or respiratory events from the aggregate.
- Do not interpret missing stages as zero or use a provider filter unless the user asks for it.
- Discuss sleep and recovery patterns without diagnosing a condition or claiming that sleep caused another outcome.

## Response

- Lead with the sleep trend and period, then show the supporting duration, timing, stage, or session evidence.
- When the user asks about recorded sleep vitals, include the available HRV, sleep heart-rate, blood-oxygen, and
  respiration values that answer the question; do not bury a recorded requested vital behind duration or score alone.
- State the timezone, nap treatment, exact vital statistic, and material coverage limitations.
