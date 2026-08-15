import { describe, expect, it } from 'vitest';
import {
  expandAssistantSummaryMetricTypes,
  findAssistantMetricTrendIntent,
  resolveAssistantSummaryMetricType,
} from './metric-intent';

describe('Assistant summary metric intent', () => {
  it('maps raw stream labels to the persisted summary selected by aggregation', () => {
    expect(resolveAssistantSummaryMetricType('temperature', 'average'))
      .toBe('Average Temperature');
    expect(resolveAssistantSummaryMetricType('Temperature', 'minimum'))
      .toBe('Minimum Temperature');
    expect(resolveAssistantSummaryMetricType('Temperature', 'maximum'))
      .toBe('Maximum Temperature');
    expect(resolveAssistantSummaryMetricType('Distance', 'maximum'))
      .toBe('Distance');
  });

  it('expands a raw activity stream into available persisted summary metrics', () => {
    expect(expandAssistantSummaryMetricTypes([
      'temperature',
      'Average Temperature',
      'Distance',
    ])).toEqual([
      'Average Temperature',
      'Minimum Temperature',
      'Maximum Temperature',
      'Distance',
    ]);
  });

  it('builds a canonical all-history yearly temperature policy', () => {
    expect(findAssistantMetricTrendIntent({
      prompt: 'Find all my open water and snorkeling activities over all years and plot avg/min/max temperatures per year.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'Europe/Helsinki',
    })).toMatchObject({
      workflow: {
        id: 'activity-summary-metric-history',
        toolWorkflow: ['query_metrics'],
      },
      toolInput: {
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
        start: '2000-01-01T00:00:00.000Z',
        end: '2026-08-15T12:30:00.000Z',
        groupBy: 'date',
        interval: 'yearly',
        timeZone: 'Europe/Helsinki',
        activityTypes: ['Open Water Swimming', 'Snorkeling'],
      },
    });
  });

  it('caps an explicit year range at the current time', () => {
    expect(findAssistantMetricTrendIntent({
      prompt: 'Chart average and maximum heart rate per year from 2021 to 2026.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })?.toolInput).toMatchObject({
      start: '2021-01-01T00:00:00.000Z',
      end: '2026-08-15T12:30:00.000Z',
      metrics: [{
        metric: 'Average Heart Rate',
        aggregation: 'average',
      }, {
        metric: 'Maximum Heart Rate',
        aggregation: 'maximum',
      }],
    });
    expect(findAssistantMetricTrendIntent({
      prompt: 'Visualize average heart rate per year from 2030 to 2035.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })).toBeNull();
  });

  it('recognizes an explicit visualization noun', () => {
    expect(findAssistantMetricTrendIntent({
      prompt: 'Create a visualization of average temperature by year for all time.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })?.workflow.id).toBe('activity-summary-metric-history');
  });

  it('does not seize ambiguous or ordinary Assistant questions', () => {
    expect(findAssistantMetricTrendIntent({
      prompt: 'Show my power curve.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })).toBeNull();
    expect(findAssistantMetricTrendIntent({
      prompt: 'What was the temperature on my latest swim?',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })).toBeNull();
    expect(findAssistantMetricTrendIntent({
      prompt: 'Plot average power and average heart rate per year for all years.',
      currentTime: new Date('2026-08-15T12:30:00.000Z'),
      timeZone: 'UTC',
    })).toBeNull();
  });
});
