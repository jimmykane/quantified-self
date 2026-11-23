import { describe, expect, it } from 'vitest';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import { parseMutateTrainingScheduleRequestV1 } from '@shared/training-plans';
import { TRAINING_PLAN_CATALOG, scheduleTemplate } from '@shared/training-plan-templates';
import { PUBLIC_TRAINING_PLANS } from '../components/public-seo/public-training-catalog.content';

describe('published training plans', () => {
  it('publishes the same editions, starting requirements, sport, duration and source credit as the library', () => {
    expect(PUBLIC_TRAINING_PLANS.map(({ id, name, description, sport, weeks, attribution }) =>
      ({ id, name, description, sport, weeks, attribution }))).toEqual(
      TRAINING_PLAN_CATALOG.map(({ id, name, description, sport, days, attribution }) =>
        ({ id, name, description, sport, weeks: days / 7, attribution })));
  });

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
  it('preserves all published run days, fixed durations, repeats and manual endings', () => {
    const plan = TRAINING_PLAN_CATALOG.find(t => t.id === 'tredict-running-base')!;
    expect(plan.sessions.map(s => s.day)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 27]);
    // Open cooldowns on days 11 and 23 have a ten-minute estimate in the source.
    const fixedSeconds = plan.sessions.map(s => s.structure.nodes.reduce((sum, n) => {
      const steps = n.kind === 'repeat' ? n.steps : [n];
      return sum + steps.reduce((duration, step) => duration + (step.ending.kind === 'time' ? step.ending.seconds : 0), 0)
        * (n.kind === 'repeat' ? n.count : 1);
    }, 0));
    expect(fixedSeconds).toEqual([1200, 1800, 1800, 3000, 1800, 1520, 3000, 3320, 3000, 3920, 1800, 1620, 3300, 5400]);
    const notes = plan.sessions.map(s => s.structure.nodes.flatMap(n => n.kind === 'repeat' ? n.steps : [n]).map(step => step.note).join(' '));
    expect(notes.map(n => Array.from(n.matchAll(/(\d+)% of your maximum heart rate/g), m => Number(m[1]))))
      .toEqual([[68], [68], [75], [72], [67], [70], [68], [70], [68], [70], [74], [66], [67,67,72], []]);
    expect(notes[12]).toContain('threshold pace (100%)');
    expect(notes[5]).toContain('10 minutes');
    expect(notes[11]).toContain('10 minutes');
    expect(plan.rest).toEqual([]);
    const start = { anchor: 'start' as const, date: '2027-02-02', longDay: 6, pattern: 'early' as const };
    const fixed = scheduleTemplate(plan, start);
    expect(fixed.start).toBe(start.date);
    expect(fixed.sessions).toEqual(scheduleTemplate(plan, { ...start, longDay: 1, pattern: 'standard' }).sessions);
    expect(scheduleTemplate(plan, { ...start, anchor: 'finish', date: fixed.end }).sessions).toEqual(fixed.sessions);
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
