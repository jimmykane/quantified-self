import { TimeIntervals, type EventInterface } from '@sports-alliance/sports-lib';

const CTL_TIME_CONSTANT_DAYS = 42;
const ATL_TIME_CONSTANT_DAYS = 7;
const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE = 'Training Stress Score';
export const DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE = 'Power Training Stress Score';

export type DashboardFormMode = 'same-day' | 'prior-day';

export interface DashboardFormPoint {
  time: number;
  trainingStressScore: number;
  ctl: number;
  atl: number;
  formSameDay: number;
  formPriorDay: number | null;
}

export type DashboardFormStatusKey =
  | 'high-fatigue'
  | 'building-fitness'
  | 'maintaining-fitness'
  | 'fresh';

export interface DashboardFormStatus {
  key: DashboardFormStatusKey;
  title: string;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function resolveDayStartLocalTime(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function buildDashboardFormPointsFromDailyLoadMap(
  dailyTrainingStressScores: Map<number, number>,
  daySequenceBuilder: (startDay: number, endDay: number) => number[],
): DashboardFormPoint[] {
  if (!dailyTrainingStressScores.size) {
    return [];
  }

  const sortedDays = [...dailyTrainingStressScores.keys()].sort((left, right) => left - right);
  const startDay = sortedDays[0];
  const endDay = sortedDays[sortedDays.length - 1];
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) {
    return [];
  }

  const daySequence = daySequenceBuilder(startDay, endDay);
  if (!daySequence.length) {
    return [];
  }

  const points: DashboardFormPoint[] = [];
  let previousCtl = 0;
  let previousAtl = 0;

  daySequence.forEach((dayTime) => {
    const trainingStressScore = dailyTrainingStressScores.get(dayTime) || 0;
    const ctl = previousCtl + ((trainingStressScore - previousCtl) / CTL_TIME_CONSTANT_DAYS);
    const atl = previousAtl + ((trainingStressScore - previousAtl) / ATL_TIME_CONSTANT_DAYS);

    points.push({
      time: dayTime,
      trainingStressScore,
      ctl,
      atl,
      formSameDay: ctl - atl,
      formPriorDay: points.length ? previousCtl - previousAtl : null,
    });

    previousCtl = ctl;
    previousAtl = atl;
  });

  return points;
}

export function resolveDashboardFormTrainingStressScore(event: EventInterface): number | null {
  const statTypes = [
    DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE,
  ];

  for (const statType of statTypes) {
    const stat = event?.getStat?.(statType) as
      { getValue?: () => unknown } | null | undefined;
    const value = toFiniteNumber(stat?.getValue?.());
    if (value !== null && value >= 0) {
      return value;
    }
  }

  return null;
}

export function buildDashboardFormPoints(events: readonly EventInterface[] | null | undefined): DashboardFormPoint[] {
  const normalizedEvents = Array.isArray(events) ? [...events] : [];
  if (!normalizedEvents.length) {
    return [];
  }

  const dailyTrainingStressScores = new Map<number, number>();
  normalizedEvents.forEach((event) => {
    const startDate = event?.startDate;
    if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime())) {
      return;
    }

    const stressScore = resolveDashboardFormTrainingStressScore(event);
    if (stressScore === null) {
      return;
    }

    const dayStart = resolveDayStartLocalTime(startDate);
    dailyTrainingStressScores.set(
      dayStart,
      (dailyTrainingStressScores.get(dayStart) || 0) + stressScore,
    );
  });

  return buildDashboardFormPointsFromDailyLoadMap(
    dailyTrainingStressScores,
    (startDay, endDay) => {
      const daySequence: number[] = [];
      for (
        let currentDay = new Date(startDay);
        currentDay.getTime() <= endDay;
        currentDay = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate() + 1)
      ) {
        daySequence.push(currentDay.getTime());
      }
      return daySequence;
    },
  );
}

export function buildDashboardFormPointsFromDailyLoads(
  dailyLoads: readonly (readonly [number, number])[] | null | undefined,
): DashboardFormPoint[] {
  const normalizedDailyLoads = Array.isArray(dailyLoads) ? dailyLoads : [];
  if (!normalizedDailyLoads.length) {
    return [];
  }

  const dailyTrainingStressScores = normalizedDailyLoads.reduce((scores, pair) => {
    const dayTime = toFiniteNumber(pair?.[0]);
    const trainingStressScore = toFiniteNumber(pair?.[1]);
    if (dayTime === null || trainingStressScore === null || trainingStressScore < 0) {
      return scores;
    }
    scores.set(dayTime, (scores.get(dayTime) || 0) + trainingStressScore);
    return scores;
  }, new Map<number, number>());

  return buildDashboardFormPointsFromDailyLoadMap(
    dailyTrainingStressScores,
    (startDay, endDay) => {
      const daySequence: number[] = [];
      for (let dayMs = startDay; dayMs <= endDay; dayMs += UTC_DAY_MS) {
        daySequence.push(dayMs);
      }
      return daySequence;
    },
  );
}

export function resolveDashboardFormValue(
  point: DashboardFormPoint | null | undefined,
  mode: DashboardFormMode,
): number | null {
  if (!point) {
    return null;
  }

  const value = mode === 'prior-day' ? point.formPriorDay : point.formSameDay;
  return Number.isFinite(value as number) ? Number(value) : null;
}

export function resolveDashboardFormLatestPoint(
  points: readonly DashboardFormPoint[] | null | undefined,
): DashboardFormPoint | null {
  if (!Array.isArray(points) || !points.length) {
    return null;
  }
  return points[points.length - 1] || null;
}

function resolveFormBucketTime(time: number, timeInterval: TimeIntervals): number {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) {
    return time;
  }

  switch (timeInterval) {
    case TimeIntervals.Yearly:
      return new Date(date.getFullYear(), 0, 1).getTime();
    case TimeIntervals.Monthly:
      return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    default:
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
}

export function resolveDashboardFormRenderTimeInterval(
  points: readonly DashboardFormPoint[] | null | undefined,
): TimeIntervals {
  if (!Array.isArray(points) || points.length < 2) {
    return TimeIntervals.Daily;
  }

  const startTime = points[0]?.time;
  const endTime = points[points.length - 1]?.time;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return TimeIntervals.Daily;
  }

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return TimeIntervals.Daily;
  }

  if (endDate.getFullYear() !== startDate.getFullYear()) {
    return TimeIntervals.Yearly;
  }

  if (endDate.getMonth() !== startDate.getMonth()) {
    if (endDate.getTime() <= startDate.getTime() + THIRTY_ONE_DAYS_MS) {
      return TimeIntervals.Daily;
    }
    return TimeIntervals.Monthly;
  }

  return TimeIntervals.Daily;
}

export function buildDashboardFormRenderPoints(
  points: readonly DashboardFormPoint[] | null | undefined,
  timeInterval: TimeIntervals,
): DashboardFormPoint[] {
  const normalizedPoints = Array.isArray(points) ? [...points] : [];
  if (!normalizedPoints.length) {
    return [];
  }

  if (timeInterval !== TimeIntervals.Monthly && timeInterval !== TimeIntervals.Yearly) {
    return normalizedPoints;
  }

  const bucketedPoints = new Map<number, {
    trainingStressScore: number;
    lastPoint: DashboardFormPoint;
  }>();

  normalizedPoints.forEach((point) => {
    const bucketTime = resolveFormBucketTime(point.time, timeInterval);
    const existingBucket = bucketedPoints.get(bucketTime);
    if (!existingBucket) {
      bucketedPoints.set(bucketTime, {
        trainingStressScore: point.trainingStressScore,
        lastPoint: point,
      });
      return;
    }

    existingBucket.trainingStressScore += point.trainingStressScore;
    existingBucket.lastPoint = point;
  });

  return [...bucketedPoints.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([time, bucket]) => ({
      ...bucket.lastPoint,
      time,
      trainingStressScore: bucket.trainingStressScore,
    }));
}

export function resolveDashboardFormStatus(formValue: number | null | undefined): DashboardFormStatus {
  const value = toFiniteNumber(formValue);

  if (value !== null && value <= -20) {
    return {
      key: 'high-fatigue',
      title: 'High fatigue',
    };
  }

  if (value !== null && value < -5) {
    return {
      key: 'building-fitness',
      title: 'Building fitness',
    };
  }

  if (value !== null && value <= 5) {
    return {
      key: 'maintaining-fitness',
      title: 'Maintaining fitness',
    };
  }

  return {
    key: 'fresh',
    title: 'Fresh',
  };
}
