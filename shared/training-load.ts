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

function resolveUtcDayStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}
