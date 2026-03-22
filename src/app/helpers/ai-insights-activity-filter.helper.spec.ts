import { describe, expect, it } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
} from '@sports-alliance/sports-lib';
import {
  resolveAiInsightsActivityFilterLabel,
  resolveAiInsightsActivityFilterSummary,
} from '@shared/ai-insights-activity-filter';

describe('ai-insights-activity-filter', () => {
  it('formats exact activity filters without group context', () => {
    expect(resolveAiInsightsActivityFilterLabel({
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
    })).toBe('Cycling');

    expect(resolveAiInsightsActivityFilterSummary({
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running],
    })).toBe('2 activity types');
  });

  it('formats a single activity group with compact member details', () => {
    expect(resolveAiInsightsActivityFilterLabel({
      activityTypeGroups: [ActivityTypeGroups.WaterSportsGroup],
      activityTypes: [ActivityTypes.Rowing, ActivityTypes.Kayaking, ActivityTypes.Sailing],
    })).toBe('Water Sports');

    expect(resolveAiInsightsActivityFilterSummary({
      activityTypeGroups: [ActivityTypeGroups.WaterSportsGroup],
      activityTypes: [ActivityTypes.Rowing, ActivityTypes.Kayaking, ActivityTypes.Sailing],
    }, 2)).toBe('Water Sports • Rowing, Surfing +7 more');
  });

  it('collapses redundant single-member groups to their label', () => {
    expect(resolveAiInsightsActivityFilterSummary({
      activityTypeGroups: [ActivityTypeGroups.TrailRunningGroup],
      activityTypes: [ActivityTypes.TrailRunning],
    })).toBe('Trail Running');
  });

  it('formats multiple groups as a compact group summary', () => {
    expect(resolveAiInsightsActivityFilterLabel({
      activityTypeGroups: [ActivityTypeGroups.WaterSportsGroup, ActivityTypeGroups.WinterSportsGroup],
      activityTypes: [],
    })).toBe('2 activity groups');
  });
});
