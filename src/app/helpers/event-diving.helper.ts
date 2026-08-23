import {
  ActivityInterface,
  ActivityTypeGroups,
  ActivityTypesHelper,
} from '@sports-alliance/sports-lib';

export function isDivingActivity(activity: ActivityInterface | null | undefined): boolean {
  if (!activity) {
    return false;
  }

  return ActivityTypesHelper.getActivityGroupForActivityType(activity.type) === ActivityTypeGroups.DivingGroup;
}
