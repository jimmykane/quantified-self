import { describe, expect, it } from 'vitest';
import { COROS_DAILY_MAX_HRV_POINTS } from './constants';
import {
  COROSDailyValidationError,
  hasValidCOROSSleep,
  getCOROSDailySleepStartTimeMs,
  normalizeCOROSHappenDay,
  parseCOROSDailyRecord,
} from './daily';

describe('COROS daily response parsing', () => {
  it('normalizes daily metrics, local sleep times, and detailed HRV points', () => {
    const firstTimestampSeconds = Date.parse('2026-05-17T01:00:00.000Z') / 1000;
    const secondTimestampSeconds = Date.parse('2026-05-17T02:00:00.000Z') / 1000;
    const parsed = parseCOROSDailyRecord({
      happenDay: 20260517,
      sleepStartTime: '2026-05-16 23:00:00',
      sleepEndTime: '2026-05-17 07:00:00',
      startTimezone: 12,
      endTimezone: 12,
      step: '12345',
      calorie: 2478.5,
      rhr: '47',
      ppgHrv: 62,
      sleepAvgHr: 51,
      hrvList: [
        { timestamp: secondTimestampSeconds, hrv: 65, hr: 49 },
        { timestamp: firstTimestampSeconds, hrv: 60 },
        { timestamp: secondTimestampSeconds, hrv: 66, hr: 50 },
      ],
    });

    expect(parsed).toMatchObject({
      happenDay: '20260517',
      calendarDate: '2026-05-17',
      timezoneOffsetSeconds: 3 * 60 * 60,
      sleepStartTimeMs: Date.parse('2026-05-16T20:00:00.000Z'),
      sleepEndTimeMs: Date.parse('2026-05-17T04:00:00.000Z'),
      step: 12345,
      calorie: 2478.5,
      restingHeartRateBpm: 47,
      overnightHrvMs: 62,
      averageSleepHeartRateBpm: 51,
    });
    expect(hasValidCOROSSleep(parsed)).toBe(true);
    expect(parsed.hrvPoints).toEqual([
      {
        timestampMs: firstTimestampSeconds * 1000,
        hrvMs: 60,
        meanHeartRateBpm: null,
      },
      {
        timestampMs: secondTimestampSeconds * 1000,
        hrvMs: 66,
        meanHeartRateBpm: 50,
      },
    ]);
  });

  it('rejects invalid calendar values and omits invalid metric values', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260230',
      sleepStartTime: '2026-02-29 23:00:00',
      sleepEndTime: 'not-a-time',
      startTimezone: 100,
      step: -1,
      calorie: 'NaN',
      rhr: 0,
      ppgHrv: -2,
      sleepAvgHr: '',
      hrvList: [
        { timestamp: -1, hrv: 50 },
        { timestamp: 1_800_000_000, hrv: 0, hr: 45 },
      ],
    });

    expect(parsed).toMatchObject({
      happenDay: null,
      calendarDate: null,
      timezoneOffsetSeconds: null,
      sleepStartTimeMs: null,
      sleepEndTimeMs: null,
      step: null,
      calorie: null,
      restingHeartRateBpm: null,
      overnightHrvMs: null,
      averageSleepHeartRateBpm: null,
    });
    expect(hasValidCOROSSleep(parsed)).toBe(false);
    expect(parsed.hrvPoints).toEqual([{
      timestampMs: 1_800_000_000_000,
      hrvMs: null,
      meanHeartRateBpm: 45,
    }]);
  });

  it('strictly normalizes leap-day happenDay values', () => {
    expect(normalizeCOROSHappenDay('20240229')).toEqual({
      happenDay: '20240229',
      calendarDate: '2024-02-29',
    });
    expect(normalizeCOROSHappenDay('20230229')).toBeNull();
  });

  it('bounds identity strings and accepts only whole COROS timezone units', () => {
    const oversizedTime = `2026-05-16 23:00:00${'x'.repeat(64)}`;
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: oversizedTime,
      sleepEndTime: '2026-05-17 07:00:00',
      startTimezone: 12.5,
      endTimezone: 12.5,
    });

    expect(parsed.rawSleepStartTime).toBeNull();
    expect(parsed.sleepStartTimeMs).toBeNull();
    expect(parsed.startTimezoneOffsetSeconds).toBeNull();
    expect(parsed.endTimezoneOffsetSeconds).toBeNull();
    expect(parsed.timezoneOffsetSeconds).toBeNull();
    expect(hasValidCOROSSleep(parsed)).toBe(false);
  });

  it('rejects explicit timestamp offsets outside the supported timezone bound', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-16T23:00:00+19:00',
      sleepEndTime: '2026-05-17T07:00:00+19:00',
    });

    expect(parsed.sleepStartTimeMs).toBeNull();
    expect(parsed.sleepEndTimeMs).toBeNull();
    expect(hasValidCOROSSleep(parsed)).toBe(false);
  });

  it('preserves the offset embedded in explicit sleep timestamps', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-16T23:00:00+03:00',
      sleepEndTime: '2026-05-17T07:00:00+03:00',
    });

    expect(parsed.startTimezoneOffsetSeconds).toBe(3 * 60 * 60);
    expect(parsed.endTimezoneOffsetSeconds).toBe(3 * 60 * 60);
    expect(parsed.timezoneOffsetSeconds).toBe(3 * 60 * 60);
    expect(parsed.sleepStartTimeMs).toBe(Date.parse('2026-05-16T20:00:00.000Z'));
    expect(parsed.sleepEndTimeMs).toBe(Date.parse('2026-05-17T04:00:00.000Z'));
  });

  it('rejects an HRV list beyond the bounded daily point count', () => {
    expect(() => parseCOROSDailyRecord({
      happenDay: '20260517',
      hrvList: Array.from(
        { length: COROS_DAILY_MAX_HRV_POINTS + 1 },
        (_, index) => ({ timestamp: index + 1, hrv: 50 }),
      ),
    })).toThrowError(COROSDailyValidationError);
  });

  it('rejects a sleep interval that cannot fit in one daily record', () => {
    expect(hasValidCOROSSleep(parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-15 20:00:00',
      sleepEndTime: '2026-05-17 07:00:00',
    }))).toBe(false);
  });

  it('rejects an otherwise valid Sleep interval outside the provider daily window', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2025-05-16 23:00:00',
      sleepEndTime: '2025-05-17 07:00:00',
    });

    expect(hasValidCOROSSleep(parsed)).toBe(true);
    expect(getCOROSDailySleepStartTimeMs(parsed)).toBeNull();
  });
});
