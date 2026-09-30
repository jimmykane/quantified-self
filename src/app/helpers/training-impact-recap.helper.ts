import {
  buildTrainingLoadContribution,
  resolveTrainingLoadDayImpact,
  TRAINING_LOAD_DAY_MS,
  type TrainingLoadDayImpact,
  type TrainingLoadDayOutcome,
  type TrainingLoadPoint,
} from '@shared/training-load';
import {
  extendDashboardFormPointsWithZeroLoadUntil,
  type DashboardFormPoint,
} from './dashboard-form.helper';

export type TrainingImpactRecapPeriodDays = 7 | 28;

export interface TrainingImpactRecapOutcomeCounts {
  raised: number;
  held: number;
  declined: number;
}

export interface TrainingImpactRecapBar {
  startDayMs: number;
  endDayMs: number;
  ctlChange: number;
}

export interface TrainingImpactRecap {
  periodDays: TrainingImpactRecapPeriodDays;
  startDayMs: number;
  endDayMs: number;
  outcome: TrainingLoadDayOutcome;
  totalTrainingStressScore: number;
  completedActivityCount: number;
  trainingCtlContribution: number;
  normalCtlDecay: number;
  actualCtlChange: number;
  startingCtl: number;
  endingCtl: number;
  outcomeCounts: TrainingImpactRecapOutcomeCounts;
  dailyImpacts: TrainingLoadDayImpact[];
  bars: TrainingImpactRecapBar[];
}

const FLOATING_POINT_TOLERANCE = 1e-10;

function resolveUtcDayStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function normalizeSignedZero(value: number): number {
  return Math.abs(value) <= FLOATING_POINT_TOLERANCE ? 0 : value;
}

function resolveOutcome(value: number): TrainingLoadDayOutcome {
  const normalized = normalizeSignedZero(value);
  return normalized > 0 ? 'raised' : normalized < 0 ? 'declined' : 'held';
}

function toTrainingLoadPoint(point: DashboardFormPoint): TrainingLoadPoint {
  return {
    dayMs: point.time,
    load: point.trainingStressScore,
    ctl: point.ctl,
    atl: point.atl,
    formSameDay: point.formSameDay,
    formPriorDay: point.formPriorDay,
  };
}

export function buildTrainingImpactRecap(
  points: readonly DashboardFormPoint[] | null | undefined,
  periodDays: TrainingImpactRecapPeriodDays,
  nowMs = Date.now(),
): TrainingImpactRecap | null {
  if (!Array.isArray(points) || !points.length || !Number.isFinite(nowMs)) {
    return null;
  }

  const todayUtcDayMs = resolveUtcDayStartMs(nowMs);
  const endDayMs = todayUtcDayMs - TRAINING_LOAD_DAY_MS;
  const startDayMs = endDayMs - ((periodDays - 1) * TRAINING_LOAD_DAY_MS);
  const completedPoints = [...points]
    .filter(point => Number.isSafeInteger(point.time) && point.time <= endDayMs)
    .sort((left, right) => left.time - right.time);

  const extendedPoints = completedPoints.length
    ? extendDashboardFormPointsWithZeroLoadUntil(completedPoints, endDayMs)
    : [];
  const pointByDayMs = new Map(extendedPoints.map(point => [point.time, point]));
  const baselineDayMs = startDayMs - TRAINING_LOAD_DAY_MS;
  const baselinePoint = pointByDayMs.get(baselineDayMs);
  const modelPoints: TrainingLoadPoint[] = [{
    dayMs: baselineDayMs,
    load: baselinePoint?.trainingStressScore || 0,
    ctl: baselinePoint?.ctl || 0,
    atl: baselinePoint?.atl || 0,
    formSameDay: baselinePoint?.formSameDay || 0,
    formPriorDay: baselinePoint?.formPriorDay ?? null,
  }];

  let completedActivityCount = 0;
  for (let dayMs = startDayMs; dayMs <= endDayMs; dayMs += TRAINING_LOAD_DAY_MS) {
    const point = pointByDayMs.get(dayMs);
    if (point) {
      if (!Number.isSafeInteger(point.activityCount) || point.activityCount < 0) {
        return null;
      }
      modelPoints.push(toTrainingLoadPoint(point));
      completedActivityCount += point.activityCount;
      continue;
    }
    modelPoints.push({
      dayMs,
      load: 0,
      ctl: 0,
      atl: 0,
      formSameDay: 0,
      formPriorDay: 0,
    });
  }

  const dailyImpacts = modelPoints
    .slice(1)
    .map(point => resolveTrainingLoadDayImpact(modelPoints, point.dayMs))
    .filter((impact): impact is TrainingLoadDayImpact => !!impact);
  if (dailyImpacts.length !== periodDays) {
    return null;
  }

  const totalTrainingStressScore = dailyImpacts.reduce(
    (total, impact) => total + impact.trainingStressScore,
    0,
  );
  const contribution = buildTrainingLoadContribution(totalTrainingStressScore);
  if (!contribution) {
    return null;
  }
  const startingCtl = modelPoints[0].ctl;
  const endingCtl = modelPoints[modelPoints.length - 1].ctl;
  const actualCtlChange = normalizeSignedZero(endingCtl - startingCtl);
  const trainingCtlContribution = normalizeSignedZero(contribution.ctlContribution);
  const normalCtlDecay = normalizeSignedZero(actualCtlChange - trainingCtlContribution);
  const outcomeCounts = dailyImpacts.reduce<TrainingImpactRecapOutcomeCounts>((counts, impact) => {
    const outcome = resolveOutcome(impact.ctlChange);
    counts[outcome] += 1;
    return counts;
  }, { raised: 0, held: 0, declined: 0 });
  const bucketDays = periodDays === 7 ? 1 : 7;
  const bars: TrainingImpactRecapBar[] = [];
  for (let index = 0; index < dailyImpacts.length; index += bucketDays) {
    const bucket = dailyImpacts.slice(index, index + bucketDays);
    bars.push({
      startDayMs: bucket[0].dayMs,
      endDayMs: bucket[bucket.length - 1].dayMs,
      ctlChange: normalizeSignedZero(bucket.reduce((total, impact) => total + impact.ctlChange, 0)),
    });
  }

  return {
    periodDays,
    startDayMs,
    endDayMs,
    outcome: resolveOutcome(actualCtlChange),
    totalTrainingStressScore,
    completedActivityCount,
    trainingCtlContribution,
    normalCtlDecay,
    actualCtlChange,
    startingCtl,
    endingCtl,
    outcomeCounts,
    dailyImpacts,
    bars,
  };
}
