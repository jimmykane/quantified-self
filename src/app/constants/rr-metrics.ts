import {
  DataRRIntervalCount, DataRRInvalidIntervalCount, DataRRArtifactCount, DataRRArtifactPercentage,
  DataRRSuspectedEctopicPairCount, DataRRSuspectedEctopicPairRate, DataRRCoverage,
  DataRRGapCount, DataRRLongestGap, DataRRMeanInterval, DataRRHeartRateAvg,
  DataRRHeartRateMin, DataRRHeartRateMax, DataRRRMSSD, DataRRSDNN, DataRRPNN50,
  DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max, DataRRDFAWindowCount,
} from '@sports-alliance/sports-lib/metrics';

export const RR_METRICS = [
  { type: DataRRCoverage.type, label: 'R–R coverage', shortLabel: 'Coverage', primary: true, icon: 'data_usage' },
  { type: DataRRArtifactPercentage.type, label: 'Strap artifacts', shortLabel: 'Artifacts', primary: true, icon: 'filter_alt' },
  { type: DataRRSuspectedEctopicPairCount.type, label: 'Suspected ectopic pairs', shortLabel: 'Suspected pairs', primary: true, icon: 'join_inner' },
  { type: DataRRRMSSD.type, label: 'RMSSD', primary: true, icon: 'ssid_chart' },
  { type: DataRRSDNN.type, label: 'SDNN', primary: true, icon: 'scatter_plot' },
  { type: DataRRPNN50.type, label: 'pNN50', primary: true, icon: 'percent' },
  { type: DataRRDFAAlpha1Median.type, label: 'DFA α1 · median', primary: true, icon: 'timeline' },
  { type: DataRRArtifactCount.type, label: 'Artifact count', primary: false, icon: 'filter_alt' },
  { type: DataRRSuspectedEctopicPairRate.type, label: 'Suspected pairs per hour', primary: false, icon: 'join_inner' },
  { type: DataRRIntervalCount.type, label: 'Interval count', primary: false, icon: 'format_list_numbered' },
  { type: DataRRInvalidIntervalCount.type, label: 'Invalid intervals', primary: false, icon: 'rule' },
  { type: DataRRGapCount.type, label: 'Recording gaps', primary: false, icon: 'pause_circle' },
  { type: DataRRLongestGap.type, label: 'Longest gap', primary: false, icon: 'timer_off' },
  { type: DataRRMeanInterval.type, label: 'Mean R–R interval', primary: false, icon: 'straighten' },
  { type: DataRRHeartRateAvg.type, label: 'R–R-derived average HR', primary: false, icon: 'ecg_heart' },
  { type: DataRRHeartRateMin.type, label: 'R–R-derived minimum HR', primary: false, icon: 'ecg_heart' },
  { type: DataRRHeartRateMax.type, label: 'R–R-derived maximum HR', primary: false, icon: 'ecg_heart' },
  { type: DataRRDFAAlpha1Min.type, label: 'DFA α1 · minimum', primary: false, icon: 'timeline' },
  { type: DataRRDFAAlpha1Max.type, label: 'DFA α1 · maximum', primary: false, icon: 'timeline' },
  { type: DataRRDFAWindowCount.type, label: 'Valid DFA windows', primary: false, icon: 'view_module' },
] as const;

export const RR_STAT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  RR_METRICS.map(metric => [metric.type, 'shortLabel' in metric ? metric.shortLabel : metric.label]));

const ARTIFACT_TOOLTIP = 'Potential artifacts flagged using QS’s rules. The same rules apply to each recording for comparisons within QS, but values aren’t directly comparable with other apps. Flags aren’t confirmed strap errors.';

export const RR_STAT_TOOLTIPS: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  [DataRRArtifactPercentage.type]: ARTIFACT_TOOLTIP,
  [DataRRArtifactCount.type]: ARTIFACT_TOOLTIP,
}));
