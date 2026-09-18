import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { hasWahooTrainingScopes } from '../../../../../shared/wahoo-training';
import { WAHOO_API_SCOPES } from '../../../wahoo/constants';
import { assessWahooDelivery, wahooDurationSeconds, wahooIdentities, wahooPlanBody, wahooStarts, wahooWorkoutBody, wahooWorkoutDate } from './mapping';

export function wahooFixtureWorkout(): ScheduledWorkoutV1 {
  return { schemaVersion: 1, id: 'workout', planId: 'plan', title: 'Intervals', localDate: '2026-10-25', lifecycle: 'planned',
    revision: 1, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 90 }, targets: [] },
      { kind: 'repeat', id: 'repeat', count: 3, steps: [
        { kind: 'step', id: 'interval', purpose: 'work', ending: { kind: 'time', seconds: 31 }, targets: [] },
      ] },
    ] } };
}
describe('Wahoo delivery mapping (no editor changes)', () => {
  it('derives exact fractional minutes and encodes the existing recipe', () => {
    const workout = wahooFixtureWorkout();
    expect(wahooDurationSeconds(workout.structure)).toBe(183);
    const body = new URLSearchParams(wahooWorkoutBody(workout, 'destination', 'Europe/Helsinki', '123'));
    expect(body.get('workout[minutes]')).toBe('3.05');
    expect(body.get('workout[plan_id]')).toBe('123');
    expect(body.get('workout[workout_type_id]')).toBe('1');
    expect(body.has('workout[day_code]')).toBe(false);
    const encoded = new URLSearchParams(wahooPlanBody(workout, 'destination', true)).get('plan[file]')!;
    const plan = JSON.parse(Buffer.from(encoded.split(',')[1], 'base64').toString());
    expect(plan.header).toMatchObject({ name: workout.title, description: workout.title });
    expect(plan.intervals[0].targets).toEqual([]);
    expect(plan.intervals[1].intervals[0].targets).toEqual([]);
    expect(plan.intervals[1]).toMatchObject({ exit_trigger_type: 'repeat', exit_trigger_value: 2 });
  });
  it.each(['distance', 'kilojoules'] as const)('does not estimate duration from %s endings', ending => {
    const workout = wahooFixtureWorkout();
    workout.structure.nodes[0] = { kind: 'step', id: 'run', purpose: 'work', targets: [],
      ending: ending === 'distance' ? { kind: ending, meters: 1000 } : { kind: ending, kilojoules: 50 } };
    expect(wahooDurationSeconds(workout.structure)).toBeNull();
    expect(assessWahooDelivery(workout, 'destination', 'UTC')).toMatchObject({ level: 'unsupported' });
    expect(() => wahooWorkoutBody(workout, 'destination', 'UTC', '1')).toThrow();
    // Fixture-format capability is intentionally independent from live delivery.
    expect(wahooPlanBody(workout, 'destination', true)).toBeTruthy();
  });
  it.each([
    ['2026-10-25', 'Europe/Helsinki', '2026-10-25T10:00:00.000Z'],
    ['2026-03-29', 'Europe/Helsinki', '2026-03-29T09:00:00.000Z'],
    ['2026-12-31', 'Pacific/Kiritimati', '2026-12-30T22:00:00.000Z'],
    ['2027-01-01', 'Pacific/Pago_Pago', '2027-01-01T23:00:00.000Z'],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-04T01:00:00.000Z'],
  ])('retains local calendar date %s in %s', (date, zone, expected) => {
    expect(wahooStarts(date, zone)).toBe(expected);
    expect(wahooWorkoutDate(expected, zone)).toBe(date);
  });
  it('isolates accounts and copied workouts while surviving edits and rescheduling', () => {
    const identity = wahooIdentities('a', 'workout');
    expect(wahooIdentities('a', 'workout')).toEqual(identity);
    expect(wahooIdentities('b', 'workout')).not.toEqual(identity);
    expect(wahooIdentities('a', 'copy')).not.toEqual(identity);
    expect(identity.externalId.length).toBeLessThan(64);
    expect(identity.workoutToken.length).toBeLessThan(64);
  });
  it('retains old OAuth scopes and requires explicit new grants', () => {
    expect(hasWahooTrainingScopes(WAHOO_API_SCOPES)).toBe(true);
    for (const scope of ['routes_read', 'routes_write', 'offline_data']) expect(WAHOO_API_SCOPES.split(' ')).toContain(scope);
    for (const scope of [undefined, '', 'user_read workouts_read workouts_write routes_read routes_write offline_data', ['plans_read']]) {
      expect(hasWahooTrainingScopes(scope)).toBe(false);
    }
  });
});
