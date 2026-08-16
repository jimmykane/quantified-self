import { describe, expect, it } from 'vitest';
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

  it('canonicalizes a user-friendly Enduro context for aggregate metric queries', () => {
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
      activityTypes: ['Enduro MTB'],
      aggregation: 'total',
      groupBy: 'date',
      interval: 'weekly',
      timeZone: 'Europe/Helsinki',
    });
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
});
