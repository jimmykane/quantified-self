import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { activityHistoryRange } from './activity-history-range.helper';
import dayjs from 'dayjs';

describe('manual activity history ranges', () => {
  it.each([
    [ServiceNames.GarminAPI, 'maximum', '2019-02-28'],
    [ServiceNames.GarminAPI, '2_years', '2022-02-28'],
    [ServiceNames.SuuntoApp, 'maximum', '2000-01-01'],
    [ServiceNames.COROSAPI, 'maximum', '2023-11-29'],
    [ServiceNames.COROSAPI, '60_days', '2024-01-01'],
    [ServiceNames.WahooAPI, 'maximum', '1970-01-01'],
    [ServiceNames.WahooAPI, '2_years', '2022-02-28'],
  ] as const)('resolves %s %s using provider calendar limits', (service, preset, start) => {
    const result = activityHistoryRange(service, preset, new Date(2024, 1, 29, 12));
    expect(dayjs(result.startDate).format('YYYY-MM-DD HH:mm:ss.SSS')).toBe(`${start} 00:00:00.000`);
    expect(dayjs(result.endDate).format('YYYY-MM-DD HH:mm:ss.SSS')).toBe('2024-02-29 23:59:59.999');
  });
  it('clamps a preset to a narrower provider minimum without changing the end date', () => {
    const result = activityHistoryRange(ServiceNames.WahooAPI, 'maximum', new Date(2026, 9, 28), new Date(2026, 8, 15, 12));
    expect(result.startDate).toEqual(new Date(2026, 8, 15));
    expect(dayjs(result.endDate).format('YYYY-MM-DD')).toBe('2026-10-28');
  });
  it.each(['Europe/Helsinki', 'America/Los_Angeles', 'Pacific/Kiritimati'])('preserves inclusive local days around DST in %s', zone => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      for (const now of [new Date(2026, 2, 29, 0, 30), new Date(2026, 9, 25, 23, 30)]) {
        const result = activityHistoryRange(ServiceNames.SuuntoApp, '30_days', now);
        expect(dayjs(result.startDate).format('YYYY-MM-DD')).toBe(dayjs(now).subtract(29, 'day').format('YYYY-MM-DD'));
        expect(result.startDate.getHours()).toBe(0);
        expect(dayjs(result.endDate).format('YYYY-MM-DD')).toBe(dayjs(now).format('YYYY-MM-DD'));
        expect(result.endDate.getHours()).toBe(23);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('rejects a range the provider does not support', () => {
    expect(() => activityHistoryRange(ServiceNames.COROSAPI, '2_years', new Date())).toThrow('Invalid activity history range');
  });
});
