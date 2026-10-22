import {
  DataRRIntervalCount, DataRRInvalidIntervalCount, DataRRArtifactCount, DataRRArtifactPercentage,
  DataRRSuspectedEctopicPairCount, DataRRSuspectedEctopicPairRate, DataRRCoverage,
  DataRRGapCount, DataRRLongestGap, DataRRMeanInterval, DataRRHeartRateAvg,
  DataRRHeartRateMin, DataRRHeartRateMax, DataRRRMSSD, DataRRSDNN, DataRRPNN50,
  DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max, DataRRDFAWindowCount,
} from '@sports-alliance/sports-lib/metrics';

export const RR_METRICS = [
  { type: DataRRCoverage.type, label: 'R–R coverage', shortLabel: 'Coverage', primary: true },
  { type: DataRRArtifactPercentage.type, label: 'Strap artifacts', shortLabel: 'Artifacts', primary: true },
  { type: DataRRSuspectedEctopicPairCount.type, label: 'Suspected ectopic pairs', shortLabel: 'Suspected pairs', primary: true },
  { type: DataRRRMSSD.type, label: 'RMSSD', primary: true },
  { type: DataRRSDNN.type, label: 'SDNN', primary: true },
  { type: DataRRPNN50.type, label: 'pNN50', primary: true },
  { type: DataRRDFAAlpha1Median.type, label: 'DFA α1 · median', primary: true },
  { type: DataRRArtifactCount.type, label: 'Artifact count', primary: false },
  { type: DataRRSuspectedEctopicPairRate.type, label: 'Suspected pairs per hour', primary: false },
  { type: DataRRIntervalCount.type, label: 'Interval count', primary: false },
  { type: DataRRInvalidIntervalCount.type, label: 'Invalid intervals', primary: false },
  { type: DataRRGapCount.type, label: 'Recording gaps', primary: false },
  { type: DataRRLongestGap.type, label: 'Longest gap', primary: false },
  { type: DataRRMeanInterval.type, label: 'Mean R–R interval', primary: false },
  { type: DataRRHeartRateAvg.type, label: 'R–R-derived average HR', primary: false },
  { type: DataRRHeartRateMin.type, label: 'R–R-derived minimum HR', primary: false },
  { type: DataRRHeartRateMax.type, label: 'R–R-derived maximum HR', primary: false },
  { type: DataRRDFAAlpha1Min.type, label: 'DFA α1 · minimum', primary: false },
  { type: DataRRDFAAlpha1Max.type, label: 'DFA α1 · maximum', primary: false },
  { type: DataRRDFAWindowCount.type, label: 'Valid DFA windows', primary: false },
] as const;

export const RR_STAT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  RR_METRICS.map(metric => [metric.type, 'shortLabel' in metric ? metric.shortLabel : metric.label]));
