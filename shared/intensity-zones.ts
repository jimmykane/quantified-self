import { DERIVED_METRIC_KINDS } from './derived-metrics';

/** App-owned approximate grouping of existing recorded zones, not new zone boundaries. */
export const INTENSITY_POLICY_VERSION = 1;

const INTENSITY_METRIC_KINDS: readonly string[] = [
  DERIVED_METRIC_KINDS.IntensityDistribution,
  DERIVED_METRIC_KINDS.EasyPercent,
  DERIVED_METRIC_KINDS.HardPercent,
  DERIVED_METRIC_KINDS.TrainingSummary,
  DERIVED_METRIC_KINDS.TrainingBuildComparison,
];

export function hasCurrentIntensityPolicy(metricKind: string, payload: unknown): boolean {
  if (!INTENSITY_METRIC_KINDS.includes(metricKind)) return true;
  return !!payload && typeof payload === 'object' && !Array.isArray(payload)
    && (payload as Record<string, unknown>).intensityPolicyVersion === INTENSITY_POLICY_VERSION;
}

export interface GroupedIntensityZones {
  source: 'power' | 'heart-rate';
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
  totalSeconds: number;
}

export function groupRecordedIntensityZones(
  powerDurations: readonly unknown[],
  heartRateDurations: readonly unknown[],
): GroupedIntensityZones | null {
  const duration = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const power = Array.from({ length: 7 }, (_, index) => duration(powerDurations[index]));
  const heartRate = Array.from({ length: 5 }, (_, index) => duration(heartRateDurations[index]));
  const powerTotal = power.reduce((sum, value) => sum + value, 0);
  const hrTotal = heartRate.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(powerTotal) && powerTotal > 0) {
    return { source: 'power', easySeconds: power[0] + power[1], moderateSeconds: power[2] + power[3],
      hardSeconds: power[4] + power[5] + power[6], totalSeconds: powerTotal };
  }
  if (!Number.isFinite(hrTotal) || hrTotal <= 0) return null;
  return { source: 'heart-rate', easySeconds: heartRate[0] + heartRate[1], moderateSeconds: heartRate[2],
    hardSeconds: heartRate[3] + heartRate[4], totalSeconds: hrTotal };
}
