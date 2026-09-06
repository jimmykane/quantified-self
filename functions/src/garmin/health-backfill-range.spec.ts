import { describe, expect, it } from 'vitest';
import { GARMIN_HEALTH_SUMMARY_TYPES } from './health-summary-types';
import {
  advanceGarminHealthBackfillCursor,
  clipGarminHealthBackfillCursorToMinimum,
  countGarminHealthBackfillRequests,
  getGarminHealthBackfillWindow,
} from './health-backfill-range';

const DAY_MS = 24 * 60 * 60 * 1_000;

describe('Garmin Health backfill ranges', () => {
  it('creates inclusive windows of at most 90 days', () => {
    const window = getGarminHealthBackfillWindow({ summaryIndex: 0, nextStartMs: 0 }, 100 * DAY_MS);

    expect(window).toEqual({
      summaryType: 'dailies',
      summaryIndex: 0,
      startMs: 0,
      endMs: 90 * DAY_MS - 1_000,
    });
  });

  it('advances from the last window of one family to the next family', () => {
    const cursor = advanceGarminHealthBackfillCursor({
      summaryIndex: 0,
      nextStartMs: 90 * DAY_MS,
      windowsCompleted: 1,
    }, 0, 100 * DAY_MS);

    expect(cursor).toEqual({ summaryIndex: 1, nextStartMs: 0, windowsCompleted: 2 });
  });

  it('counts all ten family requests', () => {
    expect(countGarminHealthBackfillRequests(0, 100 * DAY_MS))
      .toBe(2 * GARMIN_HEALTH_SUMMARY_TYPES.length);
  });

  it('clips a family cursor and credits windows that can no longer be requested', () => {
    const cursor = clipGarminHealthBackfillCursorToMinimum({
      summaryIndex: 2,
      nextStartMs: 0,
      windowsCompleted: 4,
    }, 0, 200 * DAY_MS, 95 * DAY_MS + 1);

    expect(cursor).toEqual({
      summaryIndex: 2,
      nextStartMs: 95 * DAY_MS + 31_000,
      windowsCompleted: 5,
    });
  });

  it('moves to the next family when the minimum is after the requested range', () => {
    const cursor = clipGarminHealthBackfillCursorToMinimum({
      summaryIndex: 2,
      nextStartMs: 0,
      windowsCompleted: 4,
    }, 0, 100 * DAY_MS, 101 * DAY_MS);

    expect(cursor).toEqual({ summaryIndex: 3, nextStartMs: 0, windowsCompleted: 6 });
  });

  it('always advances when Garmin repeats the attempted start as its minimum', () => {
    const cursor = clipGarminHealthBackfillCursorToMinimum({
      summaryIndex: 0,
      nextStartMs: 0,
      windowsCompleted: 0,
    }, 0, 10 * DAY_MS, 0);

    expect(cursor.nextStartMs).toBe(31_000);
  });

  it('adds latency headroom beyond a moving minimum', () => {
    const cursor = clipGarminHealthBackfillCursorToMinimum({
      summaryIndex: 0, nextStartMs: 0, windowsCompleted: 0,
    }, 0, DAY_MS, 10_250);

    expect(cursor.nextStartMs).toBe(41_000);
    expect(cursor.windowsCompleted).toBe(0);
  });

  it.each([8_250, 10_000])('caps headroom at the inclusive range end for minimum %i', (minimumStartMs) => {
    const cursor = clipGarminHealthBackfillCursorToMinimum({
      summaryIndex: 0, nextStartMs: 0, windowsCompleted: 0,
    }, 0, 10_000, minimumStartMs);

    expect(cursor).toEqual({ summaryIndex: 0, nextStartMs: 10_000, windowsCompleted: 0 });
    expect(getGarminHealthBackfillWindow(cursor, 10_000)).toMatchObject({ startMs: 10_000, endMs: 10_000 });
  });
});
