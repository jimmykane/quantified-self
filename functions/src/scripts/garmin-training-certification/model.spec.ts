import { describe, expect, it } from 'vitest';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { GarminTrainingTransport } from '../../training-plans/delivery/garmin/transport';
import { approval, configSchema, fixture, initialState, nextDate, report, stateSchema, title } from './model';

export const config = { project: 'demo-training-delivery', uid: 'synthetic-test-user', date: '2026-12-31', timeZone: 'Europe/Helsinki', sport: 'running' as const };
describe('Garmin certification contract', () => {
  it.each(['running', 'cycling'] as const)('keeps %s fixtures exact and codec-safe without changing workout v1', sport => {
    const state = initialState({ ...config, sport });
    const transport = new GarminTrainingTransport(async () => { throw new Error('No HTTP'); });
    for (const action of ['create', 'update', 'reschedule'] as const) {
      const workout = fixture(state, action);
      expect(parseScheduledWorkoutV1(JSON.parse(JSON.stringify(workout)))).toEqual(workout);
      expect(transport.assess(workout, 'a'.repeat(64), config.timeZone).level).toBe('exact');
    }
    expect(title(state).length).toBeLessThanOrEqual(32);
    expect(fixture(state, 'reschedule').localDate).toBe('2027-01-01');
  });
  it('uses civil dates across DST and leap/year boundaries', () => {
    expect(nextDate('2026-03-28')).toBe('2026-03-29');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
    expect(() => nextDate('9999-12-31')).toThrow();
  });
  it('rejects unknown fields, invalid dates, zones, credentials and provider IDs', () => {
    for (const change of [{ date: '2026-02-30' }, { timeZone: 'bad-zone' }, { sport: 'swimming' },
      { token: 'secret' }, { uid: '../user' }, { remoteId: '12' }]) expect(configSchema.safeParse({ ...config, ...change }).success).toBe(false);
    expect(stateSchema.safeParse({ ...initialState(config), token: 'secret' }).success).toBe(false);
  });
  it('binds approvals to the complete state, action and resolved account', () => {
    const state = initialState(config);
    const digest = approval(state, 'create');
    expect(approval(state, 'remove')).not.toBe(digest);
    expect(approval({ ...state, revision: 1 }, 'create')).not.toBe(digest);
    expect(approval(state, 'create', { destinationKey: 'a'.repeat(64), generation: 'g1', epoch: 0 })).not.toBe(digest);
  });
  it('reports only allowlisted evidence, never local account or remote identifiers', () => {
    const state = initialState(config);
    state.artifact = { ids: { workout: '9223372036854775000', owner: '9007199254740993' }, localDate: config.date, completed: false };
    const output = JSON.stringify(report(state));
    for (const value of [config.uid, config.project, state.runId, ...Object.values(state.artifact.ids)]) expect(output).not.toContain(value);
  });
});
