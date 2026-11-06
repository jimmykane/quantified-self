import { describe, expect, it } from 'vitest';
import { ActivityTypes, SpeedUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { parseWorkoutPowerReferenceV1, sharedWorkoutFtpReference } from '@shared/workout-power-settings';
import { workoutPowerSummary, workoutPowerZones, parsePowerZoneInput } from './workout-power-settings.helper';
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
  it('parses explicit ordered boundary input without coercing blank tokens', () => {
    expect(parsePowerZoneInput('150, 200.5, 250')).toEqual([150, 200.5, 250]);
    expect(parsePowerZoneInput('  ')).toEqual([]);
    for (const value of ['1,,2', '1,', 'power', '-1', '1e3', 'Infinity']) expect(() => parsePowerZoneInput(value)).toThrow();
  });
});
