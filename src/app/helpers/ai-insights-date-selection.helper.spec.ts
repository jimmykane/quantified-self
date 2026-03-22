import { describe, expect, it } from 'vitest';
import { formatAiInsightsDateRange } from '@shared/ai-insights-date-selection';

describe('formatAiInsightsDateRange', () => {
  it('formats calendar month labels correctly for west-of-UTC timezones', () => {
    const dateRange = {
      kind: 'bounded',
      source: 'explicit',
      startDate: '2025-01-01T12:00:00.000Z',
      endDate: '2025-01-31T12:00:00.000Z',
      timezone: 'America/Los_Angeles',
    } as const;

    expect(formatAiInsightsDateRange(dateRange, 'en-US')).toBe('Jan 2025');
  });
});
