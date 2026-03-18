import { describe, expect, it } from 'vitest';
import { ActivityTypeGroups } from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupLabel,
  isAmbiguousActivityTypeGroup,
  resolveActivityTypeGroup,
} from '@shared/activity-type-group.metadata';

describe('activity-type-group.metadata', () => {
  it('resolves group labels from quantified metadata', () => {
    expect(getActivityTypeGroupLabel(ActivityTypeGroups.WaterSportsGroup)).toBe('Water Sports');
    expect(getActivityTypeGroupLabel(ActivityTypeGroups.RunningGroup)).toBe('Running');
  });

  it('resolves canonical ids and aliases via quantified metadata', () => {
    expect(resolveActivityTypeGroup('water_sports_group')).toBe(ActivityTypeGroups.WaterSportsGroup);
    expect(resolveActivityTypeGroup('Water Sports')).toBe(ActivityTypeGroups.WaterSportsGroup);
    expect(resolveActivityTypeGroup('running group')).toBe(ActivityTypeGroups.RunningGroup);
  });

  it('tracks ambiguous groups via quantified metadata', () => {
    expect(isAmbiguousActivityTypeGroup(ActivityTypeGroups.RunningGroup)).toBe(true);
    expect(isAmbiguousActivityTypeGroup(ActivityTypeGroups.WaterSportsGroup)).toBe(false);
  });
});
