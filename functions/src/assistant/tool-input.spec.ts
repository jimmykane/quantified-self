import { describe, expect, it } from 'vitest';
import {
  applyAssistantToolDefaults,
  assistantToolUsesDefaultTimeZone,
} from './tool-input';

describe('Assistant tool input boundary', () => {
  it('defaults only the MCP tools whose local ranges require a timezone', () => {
    expect(assistantToolUsesDefaultTimeZone('get_daily_report')).toBe(true);
    expect(assistantToolUsesDefaultTimeZone('query_measurements')).toBe(true);
    expect(assistantToolUsesDefaultTimeZone('query_activities')).toBe(false);
  });

  it('normalizes body-measurement aliases and DST-aware local date ranges', () => {
    expect(applyAssistantToolDefaults('query_measurements', {
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
    expect(applyAssistantToolDefaults('query_measurements', {
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
    expect(applyAssistantToolDefaults('rank_activities_by_metric', {
      metric: 'maximum jump distance',
      activityGroup: 'Mountain Biking',
    }, 'Europe/Helsinki')).toEqual({
      metric: 'Maximum Jump Distance',
      activityGroup: 'mountain_biking_group',
    });
    expect(applyAssistantToolDefaults('rank_activities_by_metric', {
      metric: 'future custom metric',
      activityGroup: 'future custom group',
    }, 'Europe/Helsinki')).toEqual({
      metric: 'future custom metric',
      activityGroup: 'future custom group',
    });
  });
});
