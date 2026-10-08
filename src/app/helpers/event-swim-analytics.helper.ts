import {
  ActivityInterface, ActivityUtilities, DataActiveLengths, DataCadenceAvg,
  DataInterface, DataNumber, DataStrokeRateAvg, DataSwimPaceAvg, DataTotalCycles,
  LapInterface, SwimPaceUnits, UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  createSwimDistanceDisplayStat, normalizeUserUnitSettings, resolveUnitAwareDisplayStat,
} from '@shared/unit-aware-display';
import { AppSwimLength, getRecordedLapActive, getSwimLapLengths, isRestSwimLength } from './event-swim-length.helper';

export const EVENT_LAP_STROKES_COLUMN = 'Total strokes';
/** Display-only calculation; does not replace the recorded provider SWOLF. */
export class DataNormalizedSwolf extends DataNumber {
  static override type = 'Normalized SWOLF';
  constructor(value: number) {
    super(ActivityUtilities.round(value, 1));
  }
}
export const EVENT_LAP_SWOLF_COLUMN = DataNormalizedSwolf.type;

export interface SwimLapAnalytics {
  lengths: AppSwimLength[];
  isRest: boolean;
  activeDuration: number | null;
  activeDistance: number | null;
  cadenceDuration: number | null;
  /** Keep the legacy cadence column available only when it was recorded. */
  hasRecordedCadence: boolean;
  strokes: DataTotalCycles | null;
  cadence: DataStrokeRateAvg | null;
  pace: DataSwimPaceAvg | null;
  swolf: DataNormalizedSwolf | null;
}

export function getSwolfReferenceDistance(settings?: UserUnitSettingsInterface | null): number {
  return normalizeUserUnitSettings(settings).swimPaceUnits[0] === SwimPaceUnits.MinutesPer100Yard
    ? 25 * 0.9144 : 25;
}

export function getSwolfColumnLabel(settings?: UserUnitSettingsInterface | null): string {
  const distance = createSwimDistanceDisplayStat(getSwolfReferenceDistance(settings), settings);
  return `SWOLF (${resolveUnitAwareDisplayStat(distance, settings)?.text || ''})`;
}

function finite(stat: DataInterface | void | null): number | null {
  const value = stat ? stat.getValue?.() : null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Compensated addition keeps repeated recorded yard distances from losing a pace display second. */
export function sumSwimValues(values: readonly number[]): number {
  let total = 0;
  let compensation = 0;
  values.forEach(value => {
    const corrected = value - compensation;
    const next = total + corrected;
    compensation = (next - total) - corrected;
    total = next;
  });
  return total;
}

function completeSum(lengths: readonly AppSwimLength[], getValue: (length: AppSwimLength) => number | null): number | null {
  if (!lengths.length) {
    return null;
  }
  const values = lengths.map(getValue);
  return values.every(value => value !== null && Number.isFinite(value) && value >= 0)
    ? sumSwimValues(values) : null;
}

export function getSwimLengthDuration(length: AppSwimLength): number | null {
  return finite(length.timerTime ?? length.elapsedTime);
}

export function getSwimLengthDistance(length: AppSwimLength): number | null {
  return finite(length.distance ?? length.poolLength);
}

export function getNormalizedSwolf(
  duration: number | null, distance: number | null, strokes: number | null,
  settings?: UserUnitSettingsInterface | null,
): DataNormalizedSwolf | null {
  if (duration === null || distance === null || strokes === null
    || ![duration, distance, strokes].every(Number.isFinite) || duration <= 0 || distance <= 0 || strokes < 0) {
    return null;
  }
  return new DataNormalizedSwolf(ActivityUtilities.computeSwimSwolf(
    100 * duration / distance, 60 * strokes / duration, getSwolfReferenceDistance(settings),
  ));
}

/** Never classify a recorded active drill as rest just because its stroke rate is zero. */
export function isRestSwimLap(lap: LapInterface, lengths: readonly AppSwimLength[] = []): boolean {
  const active = getRecordedLapActive(lap);
  if (active !== null) {
    return !active;
  }
  if (lengths.some(length => length.type.trim().toLowerCase() === 'active')) {
    return false;
  }
  if (lengths.length && lengths.every(isRestSwimLength)) {
    return true;
  }
  const cadence = finite(lap.getStat?.(DataStrokeRateAvg.type)) ?? finite(lap.getStat?.(DataCadenceAvg.type));
  return finite(lap.getDistance?.()) === 0 && cadence === 0;
}

function getActiveSwimLengthCadenceMetrics(lengths: readonly AppSwimLength[]): { value: number; duration: number } | null {
  let total = 0;
  let duration = 0;
  lengths.filter(length => !isRestSwimLength(length)).forEach(length => {
    const rate = finite(length.avgCadence);
    const seconds = getSwimLengthDuration(length);
    if (rate !== null && seconds !== null && seconds > 0) {
      total += rate * seconds;
      duration += seconds;
    }
  });
  return duration > 0 ? { value: total / duration, duration } : null;
}

export function getActiveSwimLengthCadence(lengths: readonly AppSwimLength[]): number | null {
  return getActiveSwimLengthCadenceMetrics(lengths)?.value ?? null;
}

export function getSwimLapAnalytics(
  activity: ActivityInterface, settings?: UserUnitSettingsInterface | null,
): Map<LapInterface, SwimLapAnalytics> {
  return new Map([...getSwimLapLengths(activity)].map(([lap, lengths]) => {
    const isRest = isRestSwimLap(lap, lengths);
    const active = lengths.filter(length => !isRestSwimLength(length));
    const recordedActiveCount = finite(lap.getStat?.(DataActiveLengths.type));
    // Retain every recorded row for expansion, but never present a known partial
    // collection of lengths as the full interval's totals or average weights.
    const completeLengths = lengths.length > 0
      && (!Number.isInteger(recordedActiveCount) || recordedActiveCount === active.length);
    const nativeFallback = active.length === lengths.length;
    const lengthDuration = completeLengths ? completeSum(active, getSwimLengthDuration) : null;
    const lengthDistance = completeLengths ? completeSum(active, getSwimLengthDistance) : null;
    const duration = lengthDuration ?? (nativeFallback ? finite(lap.getDuration?.()) : null);
    const distance = lengthDistance ?? (nativeFallback ? finite(lap.getDistance?.()) : null);
    const recordedStrokes = finite(lap.getStat?.(DataTotalCycles.type));
    const strokes = (completeLengths ? completeSum(active, length => length.strokes) : null)
      ?? (nativeFallback ? recordedStrokes : null);
    const recordedPace = finite(lap.getStat?.(DataSwimPaceAvg.type));
    const pace = lengthDuration > 0 && lengthDistance > 0 ? 100 * lengthDuration / lengthDistance
      : nativeFallback ? recordedPace : null;
    const nativeCadence = finite(lap.getStat?.(DataCadenceAvg.type));
    const recordedCadence = finite(lap.getStat?.(DataStrokeRateAvg.type)) ?? nativeCadence;
    const cadenceMetrics = completeLengths ? getActiveSwimLengthCadenceMetrics(active) : null;
    const cadence = cadenceMetrics?.value
      ?? (strokes !== null && lengthDuration > 0 ? 60 * strokes / lengthDuration : null)
      ?? (nativeFallback ? recordedCadence : null);
    const swolf = getNormalizedSwolf(duration, distance, strokes, settings)
      ?? (nativeFallback && pace > 0 && cadence !== null
        ? new DataNormalizedSwolf(ActivityUtilities.computeSwimSwolf(pace, cadence, getSwolfReferenceDistance(settings))) : null);
    return [lap, {
      lengths, isRest,
      activeDuration: isRest ? null : duration,
      activeDistance: isRest ? null : distance,
      cadenceDuration: isRest || cadence === null ? null : cadenceMetrics?.duration ?? duration,
      hasRecordedCadence: nativeCadence !== null,
      strokes: isRest || strokes === null ? null : new DataTotalCycles(strokes),
      cadence: isRest || cadence === null ? null : new DataStrokeRateAvg(cadence),
      pace: isRest || pace === null ? null : new DataSwimPaceAvg(pace),
      swolf: isRest ? null : swolf,
    }];
  }));
}

export function getSwimLapDisplayMetric(
  analytics: SwimLapAnalytics | undefined, metricType: string,
): DataInterface | null | undefined {
  if (!analytics) {
    return undefined;
  }
  switch (metricType) {
    case EVENT_LAP_STROKES_COLUMN: return analytics.strokes;
    case EVENT_LAP_SWOLF_COLUMN: return analytics.swolf;
    case DataCadenceAvg.type: return analytics.isRest || !analytics.hasRecordedCadence ? undefined
      : analytics.cadence ? new DataCadenceAvg(analytics.cadence.getValue()) : null;
    case DataStrokeRateAvg.type: return analytics.isRest ? undefined : analytics.cadence;
    case DataSwimPaceAvg.type: return analytics.isRest ? undefined : analytics.pace;
    default: return undefined;
  }
}
