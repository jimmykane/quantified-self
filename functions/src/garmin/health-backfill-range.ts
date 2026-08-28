import {
  GARMIN_HEALTH_SUMMARY_TYPES,
  type GarminHealthSummaryType,
} from './health-summary-types';

export const GARMIN_HEALTH_BACKFILL_ENDPOINTS: Readonly<Record<GarminHealthSummaryType, string>> = {
  dailies: 'dailies',
  stressDetails: 'stressDetails',
  hrv: 'hrv',
  userMetrics: 'userMetrics',
  bodyComps: 'bodyComps',
  pulseox: 'pulseOx',
  allDayRespiration: 'respiration',
  bloodPressures: 'bloodPressures',
  skinTemp: 'skinTemp',
  healthSnapshot: 'healthSnapshot',
};

export const GARMIN_HEALTH_BACKFILL_SECOND_MS = 1_000;
export const GARMIN_HEALTH_BACKFILL_MAX_INCLUSIVE_DAYS = 90;
const GARMIN_HEALTH_BACKFILL_WINDOW_MS = GARMIN_HEALTH_BACKFILL_MAX_INCLUSIVE_DAYS
  * 24 * 60 * 60 * 1_000;

export interface GarminHealthBackfillCursor {
  summaryIndex: number;
  nextStartMs: number;
  windowsCompleted: number;
}

export interface GarminHealthBackfillWindow {
  summaryType: GarminHealthSummaryType;
  summaryIndex: number;
  startMs: number;
  endMs: number;
}

function assertSecondAlignedTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value % GARMIN_HEALTH_BACKFILL_SECOND_MS !== 0) {
    throw new Error(`${field} must be a non-negative, whole-second timestamp.`);
  }
}

export function floorToGarminBackfillSecond(timestampMs: number): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error('Garmin Health backfill timestamp is invalid.');
  }
  return Math.floor(timestampMs / GARMIN_HEALTH_BACKFILL_SECOND_MS)
    * GARMIN_HEALTH_BACKFILL_SECOND_MS;
}

export function ceilToGarminBackfillSecond(timestampMs: number): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error('Garmin Health backfill timestamp is invalid.');
  }
  return Math.ceil(timestampMs / GARMIN_HEALTH_BACKFILL_SECOND_MS)
    * GARMIN_HEALTH_BACKFILL_SECOND_MS;
}

export function countGarminHealthBackfillWindows(startMs: number, endMs: number): number {
  assertSecondAlignedTimestamp(startMs, 'startMs');
  assertSecondAlignedTimestamp(endMs, 'endMs');
  if (endMs < startMs) return 0;
  return Math.ceil((endMs - startMs + GARMIN_HEALTH_BACKFILL_SECOND_MS)
    / GARMIN_HEALTH_BACKFILL_WINDOW_MS);
}

export function countGarminHealthBackfillRequests(startMs: number, endMs: number): number {
  return countGarminHealthBackfillWindows(startMs, endMs) * GARMIN_HEALTH_SUMMARY_TYPES.length;
}

export function getGarminHealthBackfillWindow(
  cursor: Pick<GarminHealthBackfillCursor, 'summaryIndex' | 'nextStartMs'>,
  rangeEndMs: number,
): GarminHealthBackfillWindow | null {
  assertSecondAlignedTimestamp(cursor.nextStartMs, 'nextStartMs');
  assertSecondAlignedTimestamp(rangeEndMs, 'rangeEndMs');
  if (!Number.isInteger(cursor.summaryIndex)
    || cursor.summaryIndex < 0
    || cursor.summaryIndex > GARMIN_HEALTH_SUMMARY_TYPES.length) {
    throw new Error('Garmin Health backfill summary cursor is invalid.');
  }
  if (cursor.summaryIndex === GARMIN_HEALTH_SUMMARY_TYPES.length) return null;
  if (cursor.nextStartMs > rangeEndMs) {
    throw new Error('Garmin Health backfill time cursor is outside the active family.');
  }
  return {
    summaryType: GARMIN_HEALTH_SUMMARY_TYPES[cursor.summaryIndex],
    summaryIndex: cursor.summaryIndex,
    startMs: cursor.nextStartMs,
    endMs: Math.min(
      rangeEndMs,
      cursor.nextStartMs + GARMIN_HEALTH_BACKFILL_WINDOW_MS
        - GARMIN_HEALTH_BACKFILL_SECOND_MS,
    ),
  };
}

export function advanceGarminHealthBackfillCursor(
  cursor: GarminHealthBackfillCursor,
  rangeStartMs: number,
  rangeEndMs: number,
): GarminHealthBackfillCursor {
  const window = getGarminHealthBackfillWindow(cursor, rangeEndMs);
  if (!window) return cursor;
  const nextStartMs = window.endMs + GARMIN_HEALTH_BACKFILL_SECOND_MS;
  return nextStartMs > rangeEndMs
    ? {
      summaryIndex: cursor.summaryIndex + 1,
      nextStartMs: rangeStartMs,
      windowsCompleted: cursor.windowsCompleted + 1,
    }
    : {
      ...cursor,
      nextStartMs,
      windowsCompleted: cursor.windowsCompleted + 1,
    };
}

export function clipGarminHealthBackfillCursorToMinimum(
  cursor: GarminHealthBackfillCursor,
  rangeStartMs: number,
  rangeEndMs: number,
  minimumStartMs: number,
): GarminHealthBackfillCursor {
  // A provider can echo a minimum equal to (or behind) the attempted start.
  // Move at least one whole second so a malformed/repeated 400 cannot loop forever.
  const clippedStartMs = Math.max(
    cursor.nextStartMs + GARMIN_HEALTH_BACKFILL_SECOND_MS,
    ceilToGarminBackfillSecond(minimumStartMs),
  );
  const skippedWindows = countGarminHealthBackfillWindows(cursor.nextStartMs, rangeEndMs)
    - countGarminHealthBackfillWindows(clippedStartMs, rangeEndMs);
  if (clippedStartMs > rangeEndMs) {
    return {
      summaryIndex: cursor.summaryIndex + 1,
      nextStartMs: rangeStartMs,
      windowsCompleted: cursor.windowsCompleted + skippedWindows,
    };
  }
  return {
    ...cursor,
    nextStartMs: clippedStartMs,
    windowsCompleted: cursor.windowsCompleted + skippedWindows,
  };
}

export function isCompleteGarminHealthBackfillCursor(cursor: GarminHealthBackfillCursor): boolean {
  return cursor.summaryIndex >= GARMIN_HEALTH_SUMMARY_TYPES.length;
}
