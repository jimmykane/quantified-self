import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import { parseMutateTrainingScheduleRequestV1 } from '@shared/training-plans';
import { TRAINING_PLAN_CATALOG, scheduleTemplate } from '@shared/training-plan-templates';

describe('published training plans', () => {
  for (const template of TRAINING_PLAN_CATALOG) it('materializes every week of ' + template.name, () => {
    const options = { anchor: 'finish' as const, date: '2027-02-07', longDay: 0, pattern: 'standard' as const };
    const result = scheduleTemplate(template, options);
    expect(result.end).toBe(options.date);
    expect(result.sessions.at(-1)?.localDate).toBe(result.end);
    for (const workout of result.sessions) {
      expect(result.restDays).not.toContain(workout.localDate);
      expect(parseWorkoutStructureV1(workout.structure)).toEqual(workout.structure);
    }
    expect(new Set(template.sessions.map(session => Math.floor(session.day / 7))).size).toBe(template.days / 7);
    expect(result.phases.items.at(-1)?.endLocalDate).toBe(result.end);
  });
  it('reserves complete-template materialization for the confirmed server operation', () => {
    expect(() => parseMutateTrainingScheduleRequestV1({ mutationId: 'forged', expectedRevisions: [{scope: 'state', id: 'current', revision: 0}],
      operation: { kind: 'create-plan', planId: 'local', name: 'Example', activate: false, startLocalDate: '2027-01-01',
        endLocalDate: '2027-01-07', enrollment: { sessions: [], restDays: [], phases: { version: 1, items: [] } } } })).toThrow();
  });
  it('binds event weekday and preserves the approved date across year boundaries', () => {
    const plan = TRAINING_PLAN_CATALOG.find(p => p.id === '10k')!;
    expect(scheduleTemplate(plan, { anchor: 'finish', date: '2027-02-07', longDay: 0, pattern: 'standard' }).start).toBe('2026-11-30');
    expect(() => scheduleTemplate(plan, { anchor: 'finish', date: '2027-02-07', longDay: 6, pattern: 'standard' })).toThrow();
  });
});
