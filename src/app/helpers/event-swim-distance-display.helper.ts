import {
  ActivityInterface, ActivityTypes, ActivityTypesHelper, DataActiveLengths, DataInterface, DataPoolLength, LapInterface,
} from '@sports-alliance/sports-lib';
import { AppSwimLength, getActivitySwimLengths, getRecordedLapActive, isRestSwimLength } from './event-swim-length.helper';
import { sumSwimValues } from './event-swim-analytics.helper';

interface DistanceBounds { lower: number; upper: number; }
interface LengthEvidence { length: AppSwimLength; bounds: DistanceBounds; }

export interface NominalSwimDistanceDisplayContext {
  readonly poolMeters: number;
  readonly lengths: ReadonlyMap<number, AppSwimLength>;
  readonly lapMeters: ReadonlyMap<LapInterface, number>;
}

// FIT length fields 3 (elapsed seconds) and 6 (speed m/s) both have scale 1000.
// Use their half-quantum uncertainty, never the coarsely rounded Suunto timer.
const LENGTH_HALF_QUANTUM = 0.0005;
// Sports Lib retains FIT lap duration to centiseconds; FIT summary distance has scale 100.
const SUMMARY_HALF_QUANTUM = 0.005;
const NOMINAL_YARD_POOLS_METERS = [25 * 0.9144, 50 * 0.9144] as const;

function numeric(stat: DataInterface | void | null | undefined): number | null {
  const value = stat ? stat.getValue?.() : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numericSlack(value: number): number {
  return Number.EPSILON * Math.max(1, Math.abs(value)) * 16;
}

function quantized(value: number): boolean {
  const scaled = value * 1000;
  return Math.abs(scaled - Math.round(scaled)) <= numericSlack(scaled);
}

function contains(bounds: DistanceBounds, value: number, halfQuantum = 0): boolean {
  const slack = numericSlack(value);
  return value + halfQuantum >= bounds.lower - slack && value - halfQuantum <= bounds.upper + slack;
}

function lengthBounds(length: AppSwimLength): DistanceBounds | null {
  const speed = numeric(length.avgSpeed);
  const elapsed = numeric(length.elapsedTime);
  if (speed === null || elapsed === null || speed <= LENGTH_HALF_QUANTUM || elapsed <= LENGTH_HALF_QUANTUM
    || !quantized(speed) || !quantized(elapsed)) {
    return null;
  }
  return {
    lower: (speed - LENGTH_HALF_QUANTUM) * (elapsed - LENGTH_HALF_QUANTUM),
    upper: (speed + LENGTH_HALF_QUANTUM) * (elapsed + LENGTH_HALF_QUANTUM),
  };
}

function totalBounds(evidence: readonly LengthEvidence[]): DistanceBounds {
  return {
    lower: sumSwimValues(evidence.map(item => item.bounds.lower)),
    upper: sumSwimValues(evidence.map(item => item.bounds.upper)),
  };
}

/**
 * Corroboration for a presentation choice, not a physical pool measurement or parser correction.
 * Only complete Suunto pool recordings whose separate FIT speed/elapsed fields support exactly
 * one nominal pool and exclude the recorded pool qualify. No proximity-to-25 test is used.
 */
export function getNominalSwimDistanceDisplayContext(
  activity: ActivityInterface | null | undefined,
): NominalSwimDistanceDisplayContext | null {
  const creatorName = activity?.creator?.name;
  if (!activity || ActivityTypesHelper.resolveActivityType(activity.type) !== ActivityTypes.Swimming
    || typeof creatorName !== 'string' || !/^suunto\b/i.test(creatorName.trim())) {
    return null;
  }
  const recordedPool = numeric(activity.getStat?.(DataPoolLength.type));
  const recordedCount = numeric(activity.getStat?.(DataActiveLengths.type));
  const recordedTotal = numeric(activity.getDistance?.());
  const lengths = getActivitySwimLengths(activity);
  const active = lengths.filter(length => length.type.trim().toLowerCase() === 'active');
  if (recordedPool === null || recordedPool <= 0 || recordedTotal === null || recordedTotal <= 0
    || !Number.isInteger(recordedCount) || recordedCount !== active.length || active.length < 2
    || lengths.some((length, index) => length.index !== index + 1
      || (length.type.trim().toLowerCase() !== 'active' && !isRestSwimLength(length))
      || (index > 0 && length.startDate.getTime() <= lengths[index - 1].startDate.getTime())
      || length.endDate < length.startDate
      || (isRestSwimLength(length) && numeric(length.distance) !== null && numeric(length.distance) !== 0))) {
    return null;
  }
  const evidence: LengthEvidence[] = [];
  for (const length of active) {
    const bounds = lengthBounds(length);
    // An explicit zero, missing distance, differing pool, or partial/custom length is not repaired.
    if (!bounds || numeric(length.distance) !== recordedPool || numeric(length.poolLength) !== recordedPool) {
      return null;
    }
    evidence.push({ length, bounds });
  }
  const intersection = evidence.reduce((bounds, item) => ({
    lower: Math.max(bounds.lower, item.bounds.lower), upper: Math.min(bounds.upper, item.bounds.upper),
  }), { lower: Number.NEGATIVE_INFINITY, upper: Number.POSITIVE_INFINITY });
  const candidates = NOMINAL_YARD_POOLS_METERS.filter(pool => contains(intersection, pool));
  if (candidates.length !== 1 || contains(intersection, recordedPool)
    || !contains(totalBounds(evidence), recordedTotal, SUMMARY_HALF_QUANTUM)) {
    return null;
  }
  const poolMeters = candidates[0];
  const byIndex = new Map(lengths.map(length => [length.index, length]));
  return { poolMeters, lengths: byIndex, lapMeters: corroboratedLapDistances(activity, lengths, evidence, poolMeters) };
}

function corroboratedLapDistances(
  activity: ActivityInterface, lengths: readonly AppSwimLength[], evidence: readonly LengthEvidence[], poolMeters: number,
): Map<LapInterface, number> {
  const groups: AppSwimLength[][] = [];
  let group: AppSwimLength[] = [];
  lengths.forEach(length => {
    if (!isRestSwimLength(length)) {
      group.push(length);
      return;
    }
    if (group.length) groups.push(group);
    group = [];
  });
  if (group.length) groups.push(group);
  const laps = (activity.getLaps?.() || []).filter(lap => (numeric(lap.getDistance?.()) ?? 0) > 0);
  const result = new Map<LapInterface, number>();
  // Do not use lapIndex counts: older rounded windows can assign a neighboring set's length.
  if (groups.length !== laps.length) return result;
  const byIndex = new Map(evidence.map(item => [item.length.index, item]));
  groups.forEach((lengthsInSet, index) => {
    const lap = laps[index];
    if (getRecordedLapActive(lap) === false) return;
    const timerTimes = lengthsInSet.map(length => numeric(length.timerTime));
    const lapDuration = numeric(lap.getDuration?.());
    const lapDistance = numeric(lap.getDistance?.());
    const count = numeric(lap.getStat?.(DataActiveLengths.type));
    if (timerTimes.some(value => value === null || value <= 0) || lapDuration === null || lapDistance === null
      || (count !== null && count !== lengthsInSet.length)
      || Math.abs(sumSwimValues(timerTimes) - lapDuration) > SUMMARY_HALF_QUANTUM + numericSlack(lapDuration)
      || !contains(totalBounds(lengthsInSet.map(length => byIndex.get(length.index))), lapDistance, SUMMARY_HALF_QUANTUM)) {
      return;
    }
    result.set(lap, lengthsInSet.length * poolMeters);
  });
  return result;
}

/** Amount for the display delegate only; never feed this into pace, SWOLF, totals, or persistence. */
export function getNominalSwimLengthsDisplayMeters(
  context: NominalSwimDistanceDisplayContext | null | undefined, lengths: readonly AppSwimLength[],
): number | undefined {
  if (!context || !lengths.length) return undefined;
  let count = 0;
  for (const length of lengths) {
    const recorded = context.lengths.get(length.index);
    if (!recorded || recorded.startDate.getTime() !== length.startDate.getTime()
      || recorded.type !== length.type || numeric(recorded.distance) !== numeric(length.distance)) return undefined;
    if (!isRestSwimLength(length)) count++;
  }
  return count > 0 ? count * context.poolMeters : undefined;
}
