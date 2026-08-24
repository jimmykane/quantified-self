import { describe, expect, it, vi } from 'vitest';
import { ActivityTypeGroups, ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupLabel,
  getActivityTypeGroupCatalog,
  getActivityTypesForGroup,
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

  it('resolves labels, aliases, and members for newly classified Sports Lib groups', () => {
    const cases = [
      {
        group: ActivityTypeGroups.SkatingGroup,
        label: 'Skating',
        alias: 'inline skating',
        activityType: ActivityTypes.InlineSkating,
      },
      {
        group: ActivityTypeGroups.AerialSportsGroup,
        label: 'Aerial Sports',
        alias: 'flying sports',
        activityType: ActivityTypes.Flying,
      },
      {
        group: ActivityTypeGroups.MotorizedGroup,
        label: 'Motorized',
        alias: 'motor sports',
        activityType: ActivityTypes.Motorsports,
      },
      {
        group: ActivityTypeGroups.AdaptiveMobilityGroup,
        label: 'Adaptive Mobility',
        alias: 'adaptive mobility',
        activityType: ActivityTypes.Wheelchair,
      },
    ];

    cases.forEach(({ group, label, alias, activityType }) => {
      expect(getActivityTypeGroupLabel(group)).toBe(label);
      expect(resolveActivityTypeGroup(alias)).toBe(group);
      expect(getActivityTypesForGroup(group)).toContain(activityType);
    });
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

  it('creates a complete, deduplicated canonical catalog from Sports Lib group lookups', () => {
    const catalog = getActivityTypeGroupCatalog();
    const catalogTypes = catalog.flatMap(entry => entry.activityTypes);
    const canonicalTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();
    const unspecified = catalog.find(entry => entry.id === ActivityTypeGroups.UnspecifiedGroup);

    expect(catalog).toHaveLength(17);
    expect(catalogTypes).toHaveLength(131);
    expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
    expect([...catalogTypes].sort()).toEqual([...canonicalTypes].sort());
    expect(unspecified?.activityTypes).toEqual([
      ActivityTypes.Generic,
      ActivityTypes.Match,
      ActivityTypes.Other,
      ActivityTypes.Route,
      ActivityTypes.Tactical,
      ActivityTypes.Transition,
      ActivityTypes.unknown,
      ActivityTypes.Workout,
    ].sort());
    expect(getActivityTypesForGroup(ActivityTypeGroups.IndoorSportsGroup)).toContain(ActivityTypes.Yoga);
  });

  it('ignores malformed values from Sports Lib canonical activity lookup results', () => {
    const canonicalTypesSpy = vi.spyOn(ActivityTypesHelper, 'getActivityTypesAsUniqueArray')
      .mockReturnValue([ActivityTypes.Cycling, 'Not a canonical activity type']);

    try {
      expect(getActivityTypesForGroup(ActivityTypeGroups.CyclingGroup)).toEqual([ActivityTypes.Cycling]);
    } finally {
      canonicalTypesSpy.mockRestore();
    }
  });
});
