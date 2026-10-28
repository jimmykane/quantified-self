import { describe, expect, it, vi } from 'vitest';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  assistantToolUsesDefaultTimeZone,
  normalizeAssistantToolInput,
} from './tool-input';

describe('Assistant tool input boundary', () => {
  it('defaults only the MCP tools whose local ranges require a timezone', () => {
    expect(assistantToolUsesDefaultTimeZone('get_daily_report')).toBe(true);
    expect(assistantToolUsesDefaultTimeZone('query_measurements')).toBe(true);
    expect(assistantToolUsesDefaultTimeZone('query_activities')).toBe(false);
  });

  it('normalizes body-measurement aliases and DST-aware local date ranges', () => {
    expect(normalizeAssistantToolInput('query_measurements', {
      measurementType: 'weight',
      start: '2026-03-29',
      end: '2026-03-29',
    }, 'Europe/Helsinki')).toEqual({
      measurementType: 'body_weight',
      start: '2026-03-28T22:00:00.000Z',
      end: '2026-03-29T20:59:59.999Z',
      timeZone: 'Europe/Helsinki',
    });
  });

  it('preserves explicit ISO timestamps and an explicit timezone', () => {
    expect(normalizeAssistantToolInput('query_measurements', {
      measurementType: 'body_weight',
      start: '2026-03-29T00:00:00.000Z',
      end: '2026-03-30T00:00:00.000Z',
      timeZone: 'UTC',
    }, 'Europe/Helsinki')).toEqual({
      measurementType: 'body_weight',
      start: '2026-03-29T00:00:00.000Z',
      end: '2026-03-30T00:00:00.000Z',
      timeZone: 'UTC',
    });
  });

  it('canonicalizes Sports Lib ranking labels without changing unknown values', () => {
    expect(normalizeAssistantToolInput('rank_activities_by_metric', {
      metric: 'maximum jump distance',
      activityGroup: 'Mountain Biking',
    }, 'Europe/Helsinki')).toEqual({
      metric: 'Maximum Jump Distance',
      activityGroup: 'mountain_biking_group',
    });
    expect(normalizeAssistantToolInput('rank_activities_by_metric', {
      metric: 'future custom metric',
      activityGroup: 'future custom group',
    }, 'Europe/Helsinki')).toEqual({
      metric: 'future custom metric',
      activityGroup: 'future custom group',
    });
  });

  it('canonicalizes Sports Lib labels across aggregate and activity metric tools', () => {
    expect(normalizeAssistantToolInput('query_metric', {
      metric: 'maximum jump distance',
      start: '2026-07-01',
      end: '2026-07-31',
    }, 'Europe/Helsinki')).toEqual({
      metric: 'Maximum Jump Distance',
      start: '2026-06-30T21:00:00.000Z',
      end: '2026-07-31T20:59:59.999Z',
      timeZone: 'Europe/Helsinki',
    });
    expect(normalizeAssistantToolInput('query_metrics', {
      metrics: [{
        metric: 'maximum jump distance',
        aggregation: 'maximum',
      }, {
        metric: 'future custom metric',
        aggregation: 'average',
      }],
    }, 'UTC')).toMatchObject({
      metrics: [{
        metric: 'Maximum Jump Distance',
        aggregation: 'maximum',
      }, {
        metric: 'future custom metric',
        aggregation: 'average',
      }],
      timeZone: 'UTC',
    });
    expect(normalizeAssistantToolInput('get_activity_metrics', {
      activityRef: 'opaque-activity-reference',
      metrics: ['maximum jump distance', 'future custom metric'],
    }, 'UTC')).toEqual({
      activityRef: 'opaque-activity-reference',
      metrics: ['Maximum Jump Distance', 'future custom metric'],
    });
  });

  it('uses persisted summary families when the model requests a raw stream label', () => {
    expect(normalizeAssistantToolInput('query_metrics', {
      metrics: [{
        metric: 'temperature',
        aggregation: 'average',
      }, {
        metric: 'Temperature',
        aggregation: 'minimum',
      }, {
        metric: 'Temperature',
        aggregation: 'maximum',
      }],
    }, 'UTC')).toMatchObject({
      metrics: [{
        metric: 'Average Temperature',
        aggregation: 'average',
      }, {
        metric: 'Minimum Temperature',
        aggregation: 'minimum',
      }, {
        metric: 'Maximum Temperature',
        aggregation: 'maximum',
      }],
    });
    expect(normalizeAssistantToolInput('get_activity_metrics', {
      activityRef: 'opaque-activity-reference',
      metrics: ['Temperature'],
    }, 'UTC')).toEqual({
      activityRef: 'opaque-activity-reference',
      metrics: [
        'Average Temperature',
        'Minimum Temperature',
        'Maximum Temperature',
      ],
    });
  });

  it('canonicalizes Enduro only while the installed context has one sport', () => {
    expect(normalizeAssistantToolInput('query_metric', {
      metric: 'distance',
      activityTypes: ['Enduro'],
      start: '2026-01-01',
      end: '2026-08-07',
      aggregation: 'total',
      groupBy: 'date',
      interval: 'weekly',
    }, 'Europe/Helsinki')).toMatchObject({
      metric: 'Distance',
      activityTypes: ActivityTypesHelper.resolveActivityType('E-Enduro MTB') ? ['Enduro'] : ['Enduro MTB'],
      aggregation: 'total',
      groupBy: 'date',
      interval: 'weekly',
      timeZone: 'Europe/Helsinki',
    });
  });

  it('keeps a context alias ambiguous when the installed catalog contains both Enduro MTB types', () => {
    const resolve = ActivityTypesHelper.resolveActivityType.bind(ActivityTypesHelper);
    const resolver = vi.spyOn(ActivityTypesHelper, 'resolveActivityType').mockImplementation(value => (
      value === 'E-Enduro MTB'
        ? 'E-Enduro MTB' as ReturnType<typeof resolve>
        : resolve(value)
    ));
    try {
      expect(normalizeAssistantToolInput('query_activities', { activityTypes: ['Enduro'] }, 'UTC'))
        .toEqual({ activityTypes: ['Enduro'] });
      expect(normalizeAssistantToolInput('query_activities', {
        activityTypes: ['Enduro MTB', 'E-Enduro MTB', 'Motorcycle Enduro'],
      }, 'UTC')).toEqual({ activityTypes: ['Enduro MTB', 'E-Enduro MTB', 'Motorcycle Enduro'] });
    } finally {
      resolver.mockRestore();
    }
  });

  it('canonicalizes model-friendly sport casing across Training preview shapes', () => {
    const structure = {
      version: 1,
      sport: 'cycling',
      nodes: [{ kind: 'step', id: 'easy', purpose: 'recovery',
        ending: { kind: 'time', seconds: 1800 }, targets: [] }],
    };
    expect(normalizeAssistantToolInput('preview_create_planned_workout', {
      expectedScheduleRevision: 3,
      localDate: '2026-09-29',
      title: 'Recovery ride',
      structure,
    }, 'Europe/Helsinki')).toMatchObject({ structure: { sport: 'Cycling' } });
    expect(normalizeAssistantToolInput('preview_planned_workout_v2_change', {
      expectedScheduleRevision: 3,
      change: { kind: 'create-workout', localKey: 'swim', localDate: '2026-09-29',
        title: 'Easy swim', structure: { ...structure, sport: 'swimming' } },
    }, 'Europe/Helsinki')).toMatchObject({
      change: { structure: { sport: 'Swimming' } },
    });
    expect(normalizeAssistantToolInput('preview_training_changes', {
      expectedScheduleRevision: 3,
      changes: [{ kind: 'create-workout', localKey: 'run', localDate: '2026-09-29',
        title: 'Easy run', structure: { ...structure, sport: 'running' } }],
    }, 'Europe/Helsinki')).toMatchObject({
      changes: [{ structure: { sport: 'Running' } }],
    });
  });

  it.each(['Road Cycling', 'E-Enduro MTB', 'Obstacle Racing', 'Indoor Walking'])('canonicalizes approved %s recipe names without changing recorded-activity query filters', sport => {
      const input = { structure: { version: 1, sport: ` ${sport.toLowerCase()} `, nodes: [] } };
      expect(normalizeAssistantToolInput('preview_create_planned_workout', input, 'UTC'))
        .toMatchObject({ structure: { sport } });
      expect(input.structure.sport).toBe(` ${sport.toLowerCase()} `);
    });

  it('normalizes local date-only ranges without adding a timezone to activity tools', () => {
    expect(normalizeAssistantToolInput('query_activities', {
      start: '2026-03-29',
      end: '2026-03-29',
      limit: 10,
    }, 'Europe/Helsinki')).toEqual({
      start: '2026-03-28T22:00:00.000Z',
      end: '2026-03-29T20:59:59.999Z',
      limit: 10,
    });
    expect(normalizeAssistantToolInput('query_activities', {
      limit: 1,
    }, 'Europe/Helsinki')).toEqual({ limit: 1 });
  });
  it.each(['preview_planned_workout_v3_change', 'preview_saved_workout_v2_change'] as const)('preserves athlete intent when normalizing %s', name => {
    for (const allowEarlyLap of [undefined, false, true]) {
      const structure = { version: 1, sport: 'running', nodes: [{ kind: 'repeat', id: 'repeat', count: 2, steps: [
        { kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'distance', meters: 1609.344,
          ...(allowEarlyLap === undefined ? {} : { allowEarlyLap }) }, targets: [] },
      ] }] };
      const input = { expectedScheduleRevision: 1, change: { kind: 'create', structure } };
      expect(normalizeAssistantToolInput(name, input, 'Europe/Helsinki')).toEqual({ ...input,
        change: { ...input.change, structure: { ...structure, sport: 'Running' } } });
    }
  });
  it('normalizes only sport aliases in complete-workout bulk input without dropping Lap or HR fields', () => {
    const input = { expectedScheduleRevision: 1, changes: [{ kind: 'update-workout', workout: { ref: 'opaque' },
      plan: null, localDate: '2026-10-12', title: 'Quality run', structure: { version: 1, sport: 'running', nodes: [
        { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 1200, allowEarlyLap: true }, targets: [] },
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 180 }, note: 'Keep — exact',
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 142, maximumBpm: 150 }] },
      ] } }] };
    const copy = structuredClone(input);
    expect(normalizeAssistantToolInput('preview_planned_workout_v3_changes', input, 'Europe/Helsinki')).toEqual({ ...input,
      changes: [{ ...input.changes[0], structure: { ...input.changes[0].structure, sport: 'Running' } }] });
    expect(input).toEqual(copy);
  });

});
