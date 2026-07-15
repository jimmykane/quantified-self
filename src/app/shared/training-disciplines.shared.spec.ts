import { ActivityTypeGroups, ActivityTypes } from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from '@shared/activity-type-group.metadata';
import {
  resolveTrainingDisciplineFromActivityType,
  TRAINING_DISCIPLINE_ACTIVITY_GROUPS,
} from '@shared/training-disciplines';

describe('shared Training discipline registry', () => {
  const expectedGroups = {
    running: [ActivityTypeGroups.RunningGroup, ActivityTypeGroups.TrailRunningGroup],
    cycling: [ActivityTypeGroups.CyclingGroup, ActivityTypeGroups.MountainBikingGroup],
    swimming: [ActivityTypeGroups.SwimmingGroup],
  } as const;

  it('classifies every sports-lib member of the five curated groups', () => {
    Object.entries(expectedGroups).forEach(([discipline, groups]) => {
      groups.forEach((group) => {
        getActivityTypesForGroup(group).forEach((activityType) => {
          expect(resolveTrainingDisciplineFromActivityType(activityType)).toBe(discipline);
        });
      });
    });
  });

  it('keeps Mountain Biking in Cycling and resolves sports-lib aliases', () => {
    expect(TRAINING_DISCIPLINE_ACTIVITY_GROUPS.cycling).toContain(ActivityTypeGroups.MountainBikingGroup);
    expect(resolveTrainingDisciplineFromActivityType('cycling_mountain')).toBe('cycling');
    expect(resolveTrainingDisciplineFromActivityType('swimming_open_water')).toBe('swimming');
  });

  it('does not classify aggregate or unsupported activity types', () => {
    expect(resolveTrainingDisciplineFromActivityType(ActivityTypes.Triathlon)).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType(ActivityTypes.Multisport)).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType(ActivityTypes.Walking)).toBeNull();
    expect(resolveTrainingDisciplineFromActivityType('not-a-sport')).toBeNull();
  });
});
