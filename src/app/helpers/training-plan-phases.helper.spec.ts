import type { TrainingPlanV1 } from '@shared/training-plans';
import { buildCalendarPlanPhases, trainingPlanPhaseOnDate } from './training-plan-phases.helper';
import { buildPlanScheduleMonth } from './plan-schedule-calendar.helper';

describe('Training phase presentation', () => {
  const plan: TrainingPlanV1 = { schemaVersion: 1, id: 'p', name: 'Plan', lifecycle: 'active', startLocalDate: '2026-10-01',
    endLocalDate: '2026-11-01', revision: 1, lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1,
    phases: { version: 1, items: [{ id: 'base', name: 'Base', startLocalDate: '2026-10-24', endLocalDate: '2026-10-26', color: 'green' }] } };
  it('shows inclusive phase dates across DST and leaves gaps empty without creating workouts', () => {
    const dates = buildCalendarPlanPhases([plan], plan.id);
    expect(Object.keys(dates)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(dates['2026-10-24'].boundary).toBe('Starts');
    expect(dates['2026-10-26'].boundary).toBe('Ends');
    expect(trainingPlanPhaseOnDate(plan, '2026-10-23')).toBeNull();
    const day = buildPlanScheduleMonth(plan, [], '2026-10-25', { today: '2026-10-25', locale: 'en-US' }).days.find(item => item.selected)!;
    expect(day.phase?.name).toBe('Base'); expect(day.entries).toEqual([]); expect(day.ariaLabel).toContain('0 workouts. Phase: Base');
  });
  it('excludes paused, archived, nonactive and absent phases from the Calendar overlay', () => {
    expect(buildCalendarPlanPhases([plan], null)).toEqual({});
    expect(buildCalendarPlanPhases([{ ...plan, lifecycle: 'paused' }], plan.id)).toEqual({});
    expect(buildCalendarPlanPhases([{ ...plan, lifecycle: 'archived' }], plan.id)).toEqual({});
    expect(buildCalendarPlanPhases([{ ...plan, phases: undefined }], plan.id)).toEqual({});
    expect(trainingPlanPhaseOnDate({ ...plan, lifecycle: 'paused' }, '2026-10-25')?.id).toBe('base');
  });
  it.each(['9999-12-30', '9999-12-31'])('stops at the last supported date for a phase starting %s', startLocalDate => {
    const final = { ...plan, startLocalDate, endLocalDate: '9999-12-31', phases: { version: 1 as const,
      items: [{ id: 'last', name: 'Last', startLocalDate, endLocalDate: '9999-12-31' }] } };
    const dates = buildCalendarPlanPhases([final], final.id);
    expect(Object.keys(dates)).toEqual(startLocalDate === '9999-12-31' ? ['9999-12-31'] : ['9999-12-30', '9999-12-31']);
    expect(dates['9999-12-31'].boundary).toBe(startLocalDate === '9999-12-31' ? 'Starts and ends' : 'Ends');
  });
});
