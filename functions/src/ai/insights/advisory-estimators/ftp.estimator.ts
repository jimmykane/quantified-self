import type {
  AdvisoryEstimatorEstimateResult,
  AdvisoryMetricEstimator,
} from '../advisory-estimator';

const UNSUPPORTED_REASON = 'FTP advisory estimator is scaffolded but not enabled yet.';
const SUGGESTED_QUERY = 'Show my FTP over time this year.';

export const FTP_ADVISORY_ESTIMATOR: AdvisoryMetricEstimator = {
  metricKey: 'ftp',
  enabled: false,
  isEligible: () => ({
    status: 'unsupported',
    message: UNSUPPORTED_REASON,
    suggestedQuery: SUGGESTED_QUERY,
  }),
  estimate: (): AdvisoryEstimatorEstimateResult => ({
    semanticKind: 'current_ceiling',
    estimate: {
      value: 0,
      unit: 'watts',
    },
    interval: {
      low: 0,
      high: 0,
      kind: 'deterministic_range',
      confidenceLevel: 'low',
    },
    observed: {
      bestValue: null,
      bestDate: null,
      sampleCount: 0,
      qualifyingSampleCount: 0,
      trainingWeeks: 0,
      recencyDays: null,
    },
    confidence: {
      tier: 'low',
      score: 0,
      reasons: [],
    },
    method: {
      id: 'ftp_current_ceiling_deterministic',
      version: 'v2',
      deterministic: true,
    },
    evidence: [{
      code: 'unsupported',
      label: 'Unsupported',
      value: UNSUPPORTED_REASON,
    }],
  }),
  explainability: () => UNSUPPORTED_REASON,
};
