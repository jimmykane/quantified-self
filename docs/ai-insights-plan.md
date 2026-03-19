# AI Insights Plan

## Current Status
- Phase 1 dashboard aggregation refactor is done.
- Backend v1 foundation is implemented.
- There is currently one deployed AI callable: `aiInsights`.
- The backend uses Genkit with Gemini via `@genkit-ai/google-genai`.
- The backend is aligned with the repo's existing env-based pattern and expects `GEMINI_API_KEY` at runtime.
- The backend is Pro-only, App Check protected, prompt-only, and single-turn.

## Locked V1 Scope
- Data source: `users/{uid}/events` only.
- Query scope: persisted event-level stats only.
- No activity subcollection queries in v1.
- No streams, laps, splits, route geometry, original-file reparse, or multi-turn chat.
- Merged events are excluded before aggregation.
- Firestore access, aggregation, chart selection, and unsupported-case handling are deterministic.
- The model is only used for:
  - prompt normalization into a structured query
  - narrative summary generation

## Backend Shape
- Callable entrypoint:
  - [callable.ts](../functions/src/ai/insights/callable.ts)
- Genkit setup:
  - [genkit.ts](../functions/src/ai/insights/genkit.ts)
- Metric allowlist:
  - [metric-catalog.ts](../functions/src/ai/insights/metric-catalog.ts)
- Prompt normalization:
  - [normalize-query.flow.ts](../functions/src/ai/insights/normalize-query.flow.ts)
- Deterministic execution:
  - [execute-query.ts](../functions/src/ai/insights/execute-query.ts)
- Narrative generation:
  - [summarize-result.flow.ts](../functions/src/ai/insights/summarize-result.flow.ts)
- Shared request/response contract:
  - [ai-insights.types.ts](../shared/ai-insights.types.ts)

## Supported V1 Metrics
- Distance
- Duration
- Ascent
- Descent
- Average cadence
- Average power
- Average heart rate
- Average speed
- Average pace
- Energy / calories

## Deterministic Presentation Rules
- `DateType + Total` -> `ColumnsVertical`
- `DateType + Average/Minimum/Maximum` -> `LinesVertical`
- `ActivityType` -> `ColumnsHorizontal`

## Next Steps
1. Verify the backend with a real Gemini runtime key.
   - Set `GEMINI_API_KEY`
   - Run the callable locally or in a dev deployment
   - Test: `tell me my avg cadence for cycling the last 3 months`
2. Add a dedicated frontend client wrapper.
   - Build an `AiInsightsService`
   - Use the shared [ai-insights.types.ts](../shared/ai-insights.types.ts) contract
3. Add the `/ai-insights` route.
   - Prompt input
   - Suggested prompts
   - Loading, error, unsupported, and empty states
   - Narrative result card
   - One primary chart
4. Add a frontend chart adapter.
   - Convert `EventStatAggregationResult` into the existing dashboard chart row format
   - Reuse existing chart components instead of building a new chart stack
5. Harden after the first end-to-end pass.
   - Better runtime logging
   - Real-provider smoke verification
   - Expand supported metrics only after the first slice is stable

## Open Decision To Confirm During Implementation
- Whether production should stay on Gemini Developer API with `GEMINI_API_KEY`, or later move to Vertex AI for project/IAM-based auth.

## Verification Status
- Backend unit coverage is in place for:
  - metric catalog
  - normalize-query flow
  - execute-query
  - callable wrapper
  - Genkit config
- Last verified commands:
  - `npm --prefix functions test -- src/ai/insights/metric-catalog.spec.ts src/ai/insights/normalize-query.flow.spec.ts src/ai/insights/execute-query.spec.ts src/ai/insights/callable.spec.ts`
  - `npm --prefix functions test -- src/ai/insights/genkit.spec.ts src/ai/insights/callable.spec.ts`
  - `npm --prefix functions run build`
