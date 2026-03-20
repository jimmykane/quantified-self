import { describe, expect, it } from 'vitest';
import { ActivityTypeGroups, ActivityTypes } from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupLabel,
  isIndoorActivityType,
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

  it('treats indoor-prefixed and indoor-group activities as indoor', () => {
    expect(isIndoorActivityType(ActivityTypes.IndoorCycling)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.IndoorRunning)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.IndoorTraining)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.IndoorClimbing)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.Yoga)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.Treadmill)).toBe(true);
    expect(isIndoorActivityType(ActivityTypes.Cycling)).toBe(false);
  });
});
