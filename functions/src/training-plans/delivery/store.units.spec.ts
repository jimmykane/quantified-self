import type { Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, PaceUnits, SpeedUnits, SwimPaceUnits, VerticalSpeedUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { readSuuntoGuideUnitSettings } from './store';
import { suuntoGuideDescription } from '../providers/suunto-guide-description';

describe('Suunto private owner-unit snapshots', () => {
  const workout = { id: 'fixture' } as ScheduledWorkoutV1;
  const user = { path: 'users/fixture' } as FirebaseFirestore.DocumentReference;
  const transaction = (value: unknown) => {
    const read = vi.fn().mockResolvedValue({ get: () => value });
    return { tx: { get: read } as unknown as Transaction, read };
  };
  it('bounds duplicate preferences without changing owner settings or display priority', async () => {
    const raw = { paceUnits: Array(20_000).fill(PaceUnits.MinutesPerMile),
      speedUnits: [SpeedUnits.MilesPerHour, SpeedUnits.KilometersPerHour, SpeedUnits.MilesPerHour],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard, SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond, VerticalSpeedUnits.MetersPerSecond] };
    const original = structuredClone(raw);
    const { tx, read } = transaction(raw);
    const result = await readSuuntoGuideUnitSettings(tx, user, 'suunto', [workout]);
    const expected = normalizeUserUnitSettings({ ...raw, paceUnits: [PaceUnits.MinutesPerMile],
      speedUnits: raw.speedUnits.slice(0, 2), swimPaceUnits: raw.swimPaceUnits.slice(0, 2),
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond] });
    expect(JSON.stringify(result).length).toBeLessThan(1_500);
    expect(result).toEqual(expected);
    expect(raw).toEqual(original);
    expect(read).toHaveBeenCalledExactlyOnceWith(user);
  });
  it.each([null, 'invalid', { paceUnits: ['invalid'] }])('preserves default normalization for malformed settings (%j)', async raw => {
    const { tx } = transaction(raw);
    expect(await readSuuntoGuideUnitSettings(tx, user, 'suunto', [workout])).toEqual(normalizeUserUnitSettings(raw));
  });
  it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Swimming])(
    'preserves the exact %s description after compacting mixed ordered preferences', async sport => {
      const raw = { paceUnits: [PaceUnits.MinutesPerMile, PaceUnits.MinutesPerKilometer, PaceUnits.MinutesPerMile],
        speedUnits: [SpeedUnits.MilesPerHour, SpeedUnits.KilometersPerHour, SpeedUnits.MilesPerHour],
        swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard, SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard] };
      const { tx } = transaction(raw);
      const compact = await readSuuntoGuideUnitSettings(tx, user, 'suunto', [workout]);
      const structure = { version: 1, sport, nodes: [{ kind: 'step', id: 'work', purpose: 'work',
        ending: { kind: 'distance', meters: 100 }, targets: [{ kind: 'speed', mode: 'absolute',
          presentation: sport === ActivityTypes.Cycling ? 'speed' : 'pace', minimumMetersPerSecond: 2, maximumMetersPerSecond: 3 }] }] };
      expect(suuntoGuideDescription(structure, 'Fixture', compact))
        .toEqual(suuntoGuideDescription(structure, 'Fixture', normalizeUserUnitSettings(raw)));
    });
  it('does not read or retain units for another provider or an empty workload', async () => {
    const { tx, read } = transaction({});
    expect(await readSuuntoGuideUnitSettings(tx, user, 'garmin', [workout])).toBeUndefined();
    expect(await readSuuntoGuideUnitSettings(tx, user, 'suunto', [])).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
