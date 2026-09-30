export const TRAINING_LOAD_DAY_MS = 24 * 60 * 60 * 1000;
export const TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS = 42;
export const TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS = 7;

export interface TrainingDailyLoad {
  dayMs: number;
  load: number;
}

export interface TrainingLoadPoint {
  dayMs: number;
  load: number;
  ctl: number;
  atl: number;
  formSameDay: number;
  formPriorDay: number | null;
}

export type TrainingLoadDayOutcome = 'raised' | 'held' | 'declined';

export type TrainingSessionLoadRole =
  | 'pushed-above-maintenance'
  | 'added-to-building-day'
  | 'offset-fitness-decay'
  | 'no-load';

export interface TrainingLoadContribution {
  trainingStressScore: number;
  ctlContribution: number;
  atlContribution: number;
  formContribution: number;
}

export interface TrainingLoadDayImpact {
  dayMs: number;
  trainingStressScore: number;
  previousCtl: number;
  previousAtl: number;
  ctl: number;
  atl: number;
  formPriorDay: number;
  formSameDay: number;
  ctlChange: number;
  atlChange: number;
  formChange: number;
  outcome: TrainingLoadDayOutcome;
}

export interface TrainingSessionLoadImpact extends TrainingLoadContribution {
  role: TrainingSessionLoadRole;
  day: TrainingLoadDayImpact;
}

/**
 * Builds the canonical UTC TSS load series used by current Training surfaces.
 * Empty days through the optional end time are explicit zero-load decay days.
 */
export function buildTrainingLoadPoints(
  dailyLoads: readonly TrainingDailyLoad[] | null | undefined,
  endTimeMs?: number | null,
): TrainingLoadPoint[] {
  const loadByDay = new Map<number, number>();
  for (const candidate of dailyLoads || []) {
    if (
      !Number.isSafeInteger(candidate.dayMs)
      || candidate.dayMs < 0
      || candidate.dayMs % TRAINING_LOAD_DAY_MS !== 0
      || !Number.isFinite(candidate.load)
      || candidate.load < 0
    ) {
      continue;
    }
    loadByDay.set(
      candidate.dayMs,
      (loadByDay.get(candidate.dayMs) || 0) + candidate.load,
    );
  }
  if (!loadByDay.size) {
    return [];
  }

  const sortedDays = [...loadByDay.keys()].sort((left, right) => left - right);
  const startDayMs = sortedDays[0];
  const latestLoadDayMs = sortedDays[sortedDays.length - 1];
  const requestedEndDayMs = Number.isFinite(endTimeMs)
    ? resolveUtcDayStartMs(Number(endTimeMs))
    : latestLoadDayMs;
  const endDayMs = Math.max(latestLoadDayMs, requestedEndDayMs);
  const points: TrainingLoadPoint[] = [];
  let previousCtl = 0;
  let previousAtl = 0;

  for (
    let dayMs = startDayMs;
    dayMs <= endDayMs;
    dayMs += TRAINING_LOAD_DAY_MS
  ) {
    const load = loadByDay.get(dayMs) || 0;
    const ctl = previousCtl
      + ((load - previousCtl) / TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS);
    const atl = previousAtl
      + ((load - previousAtl) / TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS);
    points.push({
      dayMs,
      load,
      ctl,
      atl,
      formSameDay: ctl - atl,
      formPriorDay: points.length ? previousCtl - previousAtl : null,
    });
    previousCtl = ctl;
    previousAtl = atl;
  }

  return points;
}

/**
 * Resolves the linear contribution one TSS load makes to the canonical CTL/ATL model.
 * This is a model contribution, not a direct measurement of physiological adaptation.
 */
export function buildTrainingLoadContribution(
  trainingStressScore: number,
): TrainingLoadContribution | null {
  if (!Number.isFinite(trainingStressScore) || trainingStressScore < 0) {
    return null;
  }
  const ctlContribution = trainingStressScore / TRAINING_LOAD_CTL_TIME_CONSTANT_DAYS;
  const atlContribution = trainingStressScore / TRAINING_LOAD_ATL_TIME_CONSTANT_DAYS;
  return {
    trainingStressScore,
    ctlContribution,
    atlContribution,
    formContribution: ctlContribution - atlContribution,
  };
}

/** Resolves the actual model movement for one UTC Training day, including normal decay. */
export function resolveTrainingLoadDayImpact(
  points: readonly TrainingLoadPoint[] | null | undefined,
  dayMs: number,
): TrainingLoadDayImpact | null {
  if (!Number.isSafeInteger(dayMs) || dayMs < 0 || dayMs % TRAINING_LOAD_DAY_MS !== 0) {
    return null;
  }
  const normalizedPoints = Array.isArray(points) ? points : [];
  const index = normalizedPoints.findIndex(point => point.dayMs === dayMs);
  if (index < 0) {
    return null;
  }
  const point = normalizedPoints[index];
  const previousPoint = index > 0 ? normalizedPoints[index - 1] : null;
  const previousCtl = previousPoint?.ctl ?? 0;
  const previousAtl = previousPoint?.atl ?? 0;
  const formPriorDay = previousCtl - previousAtl;
  const ctlChange = point.ctl - previousCtl;
  const atlChange = point.atl - previousAtl;
  const formChange = point.formSameDay - formPriorDay;
  const outcome: TrainingLoadDayOutcome = ctlChange > Number.EPSILON
    ? 'raised'
    : ctlChange < -Number.EPSILON
      ? 'declined'
      : 'held';
  return {
    dayMs: point.dayMs,
    trainingStressScore: point.load,
    previousCtl,
    previousAtl,
    ctl: point.ctl,
    atl: point.atl,
    formPriorDay,
    formSameDay: point.formSameDay,
    ctlChange,
    atlChange,
    formChange,
    outcome,
  };
}

/**
 * Places one completed session inside its UTC Training day without assigning an
 * order to same-day sessions. Contributions are linear; the day outcome includes decay.
 */
export function buildTrainingSessionLoadImpact(
  trainingStressScore: number,
  day: TrainingLoadDayImpact,
): TrainingSessionLoadImpact | null {
  const contribution = buildTrainingLoadContribution(trainingStressScore);
  if (!contribution || trainingStressScore > day.trainingStressScore + Number.EPSILON) {
    return null;
  }
  let role: TrainingSessionLoadRole;
  if (trainingStressScore === 0) {
    role = 'no-load';
  } else if (day.trainingStressScore > day.previousCtl) {
    role = day.trainingStressScore - trainingStressScore <= day.previousCtl
      ? 'pushed-above-maintenance'
      : 'added-to-building-day';
  } else {
    role = 'offset-fitness-decay';
  }
  return { ...contribution, role, day };
}

function resolveUtcDayStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}
