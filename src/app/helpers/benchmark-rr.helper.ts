import {
  ActivityInterface, DataIBI, DynamicDataLoader, IBIStream,
  DataRRArtifactCount, DataRRArtifactPercentage, DataRRSuspectedEctopicPairCount, DataRRSuspectedEctopicPairRate,
  DataRRDFAAlpha1Median, DataRRDFAAlpha1Min, DataRRDFAAlpha1Max,
  type RRAnalysis, type RRIntervalSample, type UserUnitSettingsInterface,
  type DataInterface,
} from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat, type UnitAwareStatDisplay } from '@shared/unit-aware-display';
import { RR_METRICS as BENCHMARK_RR_METRICS } from '../constants/rr-metrics';
export { RR_METRICS as BENCHMARK_RR_METRICS } from '../constants/rr-metrics';

export interface BenchmarkRRAnalysisInput { samples: RRIntervalSample[]; durationMs: number; }
export interface BenchmarkRRIntervalSource { stream: IBIStream; durationMs: number; }
export type BenchmarkRRWorkerResponse = { analysis: RRAnalysis | null } | { error: string };
export interface BenchmarkRRCell { display: string | null; detail: string | null; }
export interface BenchmarkRRRow { type: string; label: string; cells: BenchmarkRRCell[]; }
export interface RRStatSummary { stats: DataInterface[]; primaryTypes: string[]; detailTypes: string[]; }

/** Saved statistics for one recording only; never aggregate beats or sources here. */
export function buildRRStatSummary(stats: readonly DataInterface[]): RRStatSummary {
  const byType = new Map(stats.map(stat => [stat.getType(), stat]));
  const available = BENCHMARK_RR_METRICS.filter(metric => {
    const stat = byType.get(metric.type);
    return stat && formatBenchmarkRRValue(metric.type, stat.getValue()) !== null;
  });
  const primaryTypes = available.filter(metric => metric.primary).map(metric => metric.type);
  const detailTypes = available.filter(metric => !metric.primary).map(metric => metric.type);
  return {
    stats: available.map(metric => byType.get(metric.type)!),
    primaryTypes: primaryTypes.length ? primaryTypes : detailTypes,
    detailTypes: primaryTypes.length ? detailTypes : [],
  };
}

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

/** Inspect eligibility without copying beat arrays or expanding original timing. */
export function getBenchmarkRRIntervalSource(activity: ActivityInterface): BenchmarkRRIntervalSource | null {
  const durationMs = activity.endDate?.getTime() - activity.startDate?.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const stream = activity.getAllStreams().find(candidate => candidate.type === DataIBI.type);
  if (!(stream instanceof IBIStream)) return null;
  // Display filters must not run while checking or analyzing original intervals.
  // A filtered empty stream is handled on demand by getStreamDataByDuration().
  return stream.hasFilter() || stream.getData().length ? { stream, durationMs } : null;
}

/** Reject regular one-second chart streams; retain original per-beat timing and gaps. */
export function buildBenchmarkRRAnalysisInput(activity: ActivityInterface): BenchmarkRRAnalysisInput | null {
  const source = getBenchmarkRRIntervalSource(activity);
  if (!source) return null;
  try {
    const samples = source.stream.getStreamDataByDuration().map(sample => ({ time: sample.time, interval: sample.value ?? NaN }));
    return samples.length ? { durationMs: source.durationMs, samples } : null;
  } catch {
    throw new Error('The recorded R–R timing could not be read. Summary statistics remain available.');
  }
}

export function getBenchmarkRRLabels(activities: readonly ActivityInterface[]): string[] {
  const labels = activities.map((activity, index) => activity.creator?.name?.trim() || `Recording ${index + 1}`);
  return labels.map((label, index) => labels.filter(value => value === label).length > 1 ? `${label} (${index + 1})` : label);
}
