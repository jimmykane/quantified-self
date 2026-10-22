import {
  ActivityInterface, DataIBI, DynamicDataLoader, IBIStream,
  DataRRIntervalCount, DataRRInvalidIntervalCount, DataRRArtifactCount, DataRRArtifactPercentage,
  DataRRSuspectedEctopicPairCount, DataRRSuspectedEctopicPairRate, DataRRCoverage,
  DataRRGapCount, DataRRLongestGap, DataRRMeanInterval, DataRRHeartRateAvg,
  DataRRHeartRateMin, DataRRHeartRateMax, DataRRRMSSD, DataRRSDNN, DataRRPNN50,
  DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max, DataRRDFAWindowCount,
  type RRAnalysis, type RRIntervalSample, type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat, type UnitAwareStatDisplay } from '@shared/unit-aware-display';

export const BENCHMARK_RR_METRICS = [
  { type: DataRRCoverage.type, label: 'R–R coverage', primary: true },
  { type: DataRRArtifactPercentage.type, label: 'Strap artifacts', primary: true },
  { type: DataRRSuspectedEctopicPairCount.type, label: 'Suspected ectopic pairs', primary: true },
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

export interface BenchmarkRRAnalysisInput { samples: RRIntervalSample[]; durationMs: number; }
export type BenchmarkRRWorkerResponse = { analysis: RRAnalysis | null } | { error: string };
export interface BenchmarkRRCell { display: string | null; detail: string | null; }
export interface BenchmarkRRRow { type: string; label: string; cells: BenchmarkRRCell[]; }

export function formatBenchmarkRRValue(
  type: string, value: unknown, settings?: UserUnitSettingsInterface,
): UnitAwareStatDisplay | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  try {
    const stat = DynamicDataLoader.getDataInstanceFromDataType(type, value);
    return stat.isValueTypeValid(value) ? resolveUnitAwareDisplayStat(stat, settings) : null;
  } catch { return null; }
}

function readStat(activity: ActivityInterface, type: string, settings?: UserUnitSettingsInterface): string | null {
  const stat = activity.getStat(type);
  return formatBenchmarkRRValue(type, stat ? stat.getValue() : undefined, settings)?.text ?? null;
}

/** Each cell belongs to one full recording. R–R statistics must never be summed across benchmark sources. */
export function buildBenchmarkRRRows(
  activities: readonly ActivityInterface[], types: readonly string[], settings?: UserUnitSettingsInterface,
): BenchmarkRRRow[] {
  return BENCHMARK_RR_METRICS.filter(metric => types.includes(metric.type)).map(metric => ({
    type: metric.type, label: metric.label,
    cells: activities.map(activity => {
      const display = readStat(activity, metric.type, settings);
      let detail: string | null = null;
      if (display !== null && metric.type === DataRRArtifactPercentage.type) {
        const count = readStat(activity, DataRRArtifactCount.type, settings);
        if (count !== null) detail = `${count} flagged intervals`;
      } else if (display !== null && metric.type === DataRRSuspectedEctopicPairCount.type) {
        detail = readStat(activity, DataRRSuspectedEctopicPairRate.type, settings);
      } else if (display !== null && metric.type === DataRRDFAAlpha1Median.type) {
        const min = readStat(activity, DataRRDFAAlpha1Min.type, settings);
        const max = readStat(activity, DataRRDFAAlpha1Max.type, settings);
        if (min !== null && max !== null) detail = `Range ${min}–${max}`;
      }
      return { display, detail };
    }),
  }));
}

export function hasBenchmarkRRStats(activity: ActivityInterface): boolean {
  return BENCHMARK_RR_METRICS.some(metric => readStat(activity, metric.type) !== null);
}

/** Reject regular one-second chart streams; retain original per-beat timing and gaps. */
export function buildBenchmarkRRAnalysisInput(activity: ActivityInterface): BenchmarkRRAnalysisInput | null {
  const durationMs = activity.endDate?.getTime() - activity.startDate?.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !activity.hasStreamData(DataIBI.type)) return null;
  const stream = activity.getStream(DataIBI.type);
  if (!(stream instanceof IBIStream)) return null;
  const samples = stream.getStreamDataByDuration().map(sample => ({ time: sample.time, interval: sample.value ?? NaN }));
  return samples.length ? { durationMs, samples } : null;
}

export function getBenchmarkRRLabels(activities: readonly ActivityInterface[]): string[] {
  const labels = activities.map((activity, index) => activity.creator?.name?.trim() || `Recording ${index + 1}`);
  return labels.map((label, index) => labels.filter(value => value === label).length > 1 ? `${label} (${index + 1})` : label);
}
