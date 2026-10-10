import { AppActivityTypeGroupColors } from '../services/color/app.activity-type-group.colors';
import { AppActivityTypeGroupGradients } from '../services/color/app.activity-type-group.gradients';
import { AppActivityTypeGroupIcons } from '../services/color/app.activity-type-group.icons';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypeGroups, ActivityTypes, ActivityTypesHelper, type ActivityTypeGroup } from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupLabel,
  getActivityTypeGroupMetadata,
  getActivityTypeGroupCatalog,
  getActivityTypesForGroup,
  isIndoorActivityType,
  isAmbiguousActivityTypeGroup,
  resolveActivityTypeGroup,
} from '@shared/activity-type-group.metadata';

describe('activity-type-group.metadata', () => {
  it('prepares Walking metadata and visuals while listing only installed catalog groups', () => {
    const group = 'walking_group' as ActivityTypeGroup;
    expect(getActivityTypeGroupMetadata(group)).toMatchObject({ label: 'Walking', ambiguous: true });
    expect(AppActivityTypeGroupColors[group]).toMatch(/^#[0-9A-F]{6}$/i);
    expect(AppActivityTypeGroupGradients[group]).toMatchObject({ start: '#55D781', end: '#2E7D32' });
    expect(AppActivityTypeGroupIcons[group]).toBe('directions_walk');
    expect(getActivityTypeGroupCatalog().some(entry => entry.id === group))
      .toBe(Object.values(ActivityTypeGroups).some(value => String(value) === group));
  });

  it('uses Sports Lib indoor semantics for every catalog type', () => {
    ActivityTypesHelper.getActivityTypesAsUniqueArray().forEach(type => {
      expect(isIndoorActivityType(type as ActivityTypes))
        .toBe(ActivityTypesHelper.isIndoorActivityType(type as ActivityTypes));
    });
  });

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

    expect(catalog).toHaveLength(new Set(Object.values(ActivityTypeGroups)).size);
    expect(catalogTypes).toHaveLength(canonicalTypes.length);
    expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
    expect([...catalogTypes].sort()).toEqual([...canonicalTypes].sort());
    expect(unspecified?.activityTypes).toEqual(expect.arrayContaining([
      ActivityTypes.Generic,
      ActivityTypes.Match,
      ActivityTypes.Other,
      ActivityTypes.Route,
      ActivityTypes.Tactical,
      ActivityTypes.Transition,
      ActivityTypes.unknown,
      ActivityTypes.Workout,
    ].sort()));
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
