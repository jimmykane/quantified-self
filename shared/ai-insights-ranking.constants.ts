export const AI_INSIGHTS_TOP_RESULTS_DEFAULT = 10;
export const AI_INSIGHTS_TOP_RESULTS_MAX = 50;
export const AI_INSIGHTS_TOP_RESULTS_MIN = 1;

export function clampAiInsightsTopResultsLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return AI_INSIGHTS_TOP_RESULTS_DEFAULT;
  }

  const normalized = Math.trunc(value);
  if (normalized < AI_INSIGHTS_TOP_RESULTS_MIN) {
    return AI_INSIGHTS_TOP_RESULTS_MIN;
  }
  if (normalized > AI_INSIGHTS_TOP_RESULTS_MAX) {
    return AI_INSIGHTS_TOP_RESULTS_MAX;
  }
  return normalized;
}
