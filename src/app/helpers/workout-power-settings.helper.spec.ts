import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, SpeedUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { parseWorkoutPowerReferenceV1, sharedWorkoutFtpReference } from '@shared/workout-power-settings';
import { workoutPowerSummary, workoutPowerZones, parsePowerZoneInput } from './workout-power-settings.helper';
import { getAppLocale } from '../shared/adapters/app-locale';
vi.mock('../shared/adapters/app-locale', () => ({ getAppLocale: vi.fn(() => 'en-GB') }));
const profile = { sport: ActivityTypes.Running, provider: 'suunto' as const, source: 'Watch power', reference: { kind: 'critical-power' as const, watts: 250 },
  referenceDate: '2026-11-01', zoneUpperBoundsWatts: [150, 200] };
describe('workout power presentation', () => {
  it.each([undefined, { speedUnits: [SpeedUnits.MilesPerHour] } as Partial<UserUnitSettingsInterface>])('uses canonical power display with unit settings %j', units => {
    expect(workoutPowerSummary(profile, units as UserUnitSettingsInterface | undefined)).toContain('Running · Suunto · Watch power · Critical power 250 watt · Reference date 2026-11-01');
    expect(workoutPowerZones(profile, units as UserUnitSettingsInterface | undefined)).toEqual(['Z1: 0 watt to below 150 watt', 'Z2: 150 watt to below 200 watt', 'Z3: 200 watt and above']);
  });
  it.each([
    ['Date', new Date('2026-11-01T12:00Z')],
    ['Firestore timestamp', { toMillis: () => Date.parse('2026-11-01T12:00Z') }],
    ['Firestore timestamp with microseconds', { toMillis: () => Date.parse('2026-11-01T12:00Z') + 0.456 }],
  ])('normalizes a native %s policy head into a numeric replay snapshot', (_label, effectiveAt) => {
    const snapshot = sharedWorkoutFtpReference(ActivityTypes.Running, { method: 'AUTOMATIC', included: true,
      functionalThresholdPower: 280, revision: 2, effectiveAt }, Date.now())!;
    expect(snapshot).toMatchObject({ effectiveAtMs: Date.parse('2026-11-01T12:00Z') });
    expect(parseWorkoutPowerReferenceV1(snapshot)).toEqual(snapshot);
  });
  it.each([
    ['ISO string', '2026-11-01T12:00:00.000Z'],
    ['fractional milliseconds', Date.parse('2026-11-01T12:00Z') + 0.456],
    ['Date', new Date('2026-11-01T12:00:00Z')],
    ['timestamp-like object', { toMillis: () => Date.parse('2026-11-01T12:00Z') }],
  ])('rejects a %s in the numeric effectiveAtMs snapshot field', (_label, effectiveAtMs) => {
    const snapshot = sharedWorkoutFtpReference(ActivityTypes.Running, { method: 'AUTOMATIC', included: true,
      functionalThresholdPower: 280, revision: 2, effectiveAt: Date.parse('2026-11-01T12:00Z') }, Date.now())!;
    expect(() => parseWorkoutPowerReferenceV1({ ...snapshot, effectiveAtMs })).toThrow('Invalid shared FTP reference');
  });
  it('does not invent zones and distinguishes FTP from CP', () => {
    expect(workoutPowerZones({ ...profile, zoneUpperBoundsWatts: [] })).toEqual([]);
    expect(workoutPowerSummary({ ...profile, reference: { kind: 'functional-threshold-power', watts: 200 } })).toContain('FTP 200 watt');
  });
  it.each([undefined, { speedUnits: [SpeedUnits.MilesPerHour] } as Partial<UserUnitSettingsInterface>])(
    'displays a shared FTP snapshot without invented source metadata or zone boundaries for units %j', units => {
      const snapshot = sharedWorkoutFtpReference(ActivityTypes.Cycling, { method: 'AUTOMATIC', included: true,
        functionalThresholdPower: 280, revision: 3, effectiveAt: Date.parse('2026-11-01T12:00:00Z') }, Date.now())!;
      expect(workoutPowerSummary(snapshot, units as UserUnitSettingsInterface)).toBe('Cycling · Shared Cycling FTP 280 watt · Effective since 2026-11-01T12:00:00.000Z');
      expect(workoutPowerZones(snapshot)).toEqual([]);
    });
  it.each([['en-GB', '2 Nov 2026'], ['en-US', 'Nov 2, 2026']])('formats imported FTP with the saved %s locale', (locale, date) => {
    vi.mocked(getAppLocale).mockReturnValue(locale);
    try {
      const reference = { kind: 'imported-ftp' as const, sport: ActivityTypes.Cycling, family: 'cycling' as const,
        source: 'garmin enduro 3', lastSeenAtMs: Date.parse('2026-11-02T12:00Z'), reference: { kind: 'functional-threshold-power' as const, watts: 205 } };
      for (const units of [undefined, { speedUnits: [SpeedUnits.MilesPerHour] } as UserUnitSettingsInterface]) {
        expect(workoutPowerSummary(reference, units)).toBe(`Cycling · Imported FTP 205 watt · Garmin Enduro 3 · Last seen ${date}`);
        expect(workoutPowerZones(reference, units)).toEqual([]);
      }
      expect(workoutPowerSummary({ ...reference, source: null })).toContain('Imported workout data');
    } finally { vi.mocked(getAppLocale).mockReturnValue('en-GB'); }
  });
  it.each([['Europe/Athens', '3 Nov 2026'], ['America/Los_Angeles', '2 Nov 2026']])(
    'uses the workout timezone %s for imported observation dates', (timeZone, date) => {
      const reference = { kind: 'imported-ftp' as const, sport: ActivityTypes.Cycling, family: 'cycling' as const,
        source: 'Bike computer', lastSeenAtMs: Date.parse('2026-11-02T23:30Z'), reference: { kind: 'functional-threshold-power' as const, watts: 205 } };
      expect(workoutPowerSummary(reference, undefined, timeZone)).toContain(`Last seen ${date}`);
      expect(reference.lastSeenAtMs).toBe(Date.parse('2026-11-02T23:30Z'));
    });
  it('parses explicit ordered boundary input without coercing blank tokens', () => {
    expect(parsePowerZoneInput('150, 200.5, 250')).toEqual([150, 200.5, 250]);
    expect(parsePowerZoneInput('  ')).toEqual([]);
    for (const value of ['1,,2', '1,', 'power', '-1', '1e3', 'Infinity']) expect(() => parsePowerZoneInput(value)).toThrow();
  });
});
