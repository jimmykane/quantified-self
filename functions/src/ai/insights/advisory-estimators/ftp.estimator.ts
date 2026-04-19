import type {
  AdvisoryEstimatorEstimateResult,
  AdvisoryMetricEstimator,
} from '../advisory-estimator';

const UNSUPPORTED_REASON = 'FTP advisory estimator is scaffolded but not enabled yet.';

export const FTP_ADVISORY_ESTIMATOR: AdvisoryMetricEstimator = {
  metricKey: 'ftp',
  enabled: false,
  isEligible: () => ({
    status: 'unsupported',
    reason: UNSUPPORTED_REASON,
  }),
  estimate: (): AdvisoryEstimatorEstimateResult => ({
    pointEstimate: 0,
    rangeLow: 0,
    rangeHigh: 0,
    confidenceTier: 'low',
    evidence: [],
  }),
  explainability: () => UNSUPPORTED_REASON,
};
