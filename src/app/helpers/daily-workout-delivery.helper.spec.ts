import { dailyWorkoutDeliveryPreferences, parseDailyWorkoutDeliveryPreferences } from './daily-workout-delivery.helper';

describe('Daily workout delivery preferences', () => {
  it('defaults missing and malformed saved settings to off without selecting services', () => {
    for (const value of [undefined, null, true, {}, { enabled: true, providers: [] },
      { enabled: true, providers: ['unknown'] }, { enabled: true, providers: ['garmin'], allConnected: true }]) {
      expect(dailyWorkoutDeliveryPreferences(value)).toEqual({ enabled: false, providers: [] });
    }
  });
  it('keeps an explicit selection while disabled and normalizes its order', () => {
    expect(parseDailyWorkoutDeliveryPreferences({ enabled: false, providers: ['suunto', 'garmin'] }))
      .toEqual({ enabled: false, providers: ['garmin', 'suunto'] });
    expect(parseDailyWorkoutDeliveryPreferences({ enabled: true, providers: ['garmin'] }))
      .toEqual({ enabled: true, providers: ['garmin'] });
  });
  it.each([
    { enabled: true, providers: [] }, { enabled: true, providers: ['garmin', 'garmin'] },
    { enabled: true, providers: ['all_connected'] }, { enabled: 'yes', providers: ['garmin'] },
    { enabled: true, providers: ['garmin'], timeZone: 'UTC' },
  ])('rejects invalid writes: %j', value => {
    expect(() => parseDailyWorkoutDeliveryPreferences(value)).toThrow();
  });
});
