import {
  ActivityTypeGroups,
  type ActivityTypeGroup,
  ActivityTypes,
} from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupLabel,
  getActivityTypesForGroup,
} from './activity-type-group.metadata';

export interface AiInsightsActivityFilterLike {
  activityTypeGroups: ActivityTypeGroup[];
  activityTypes: ActivityTypes[];
}

function getUniqueGroupMembers(activityTypeGroups: ActivityTypeGroup[]): ActivityTypes[] {
  const members: ActivityTypes[] = [];
  for (const activityTypeGroup of activityTypeGroups) {
    for (const activityType of getActivityTypesForGroup(activityTypeGroup)) {
      if (!members.includes(activityType)) {
        members.push(activityType);
      }
    }
  }

  return members;
}

const CYCLING_FAMILY_ACTIVITY_TYPES = new Set<ActivityTypes>([
  ...getActivityTypesForGroup(ActivityTypeGroups.CyclingGroup),
  ...getActivityTypesForGroup(ActivityTypeGroups.MountainBikingGroup),
]);

function isCyclingFamilySelection(activityTypes: ActivityTypes[]): boolean {
  if (!activityTypes.length) {
    return false;
  }

  const uniqueActivityTypes = [...new Set(activityTypes)];
  if (!uniqueActivityTypes.includes(ActivityTypes.Cycling)) {
    return false;
  }

  return uniqueActivityTypes.every(activityType => CYCLING_FAMILY_ACTIVITY_TYPES.has(activityType));
}

export function resolveAiInsightsActivityFilterLabel(
  filter: AiInsightsActivityFilterLike,
): string {
  if (filter.activityTypeGroups.length === 1) {
    return getActivityTypeGroupLabel(filter.activityTypeGroups[0]);
  }

  if (filter.activityTypeGroups.length > 1) {
    return `${filter.activityTypeGroups.length} activity groups`;
  }

  if (!filter.activityTypes.length) {
    return 'All activities';
  }

  if (filter.activityTypes.length === 1) {
    return filter.activityTypes[0];
  }

  if (isCyclingFamilySelection(filter.activityTypes)) {
    return 'Cycling';
  }

  return `${filter.activityTypes.length} activity types`;
}

export function resolveAiInsightsActivityFilterSummary(
  filter: AiInsightsActivityFilterLike,
  maxPreviewMembers = 3,
): string {
  if (!filter.activityTypeGroups.length) {
    return resolveAiInsightsActivityFilterLabel(filter);
  }

  const groupLabels = filter.activityTypeGroups.map(activityTypeGroup =>
    getActivityTypeGroupLabel(activityTypeGroup)
  );
  const labelSummary = groupLabels.join(', ');
  const members = getUniqueGroupMembers(filter.activityTypeGroups);

  if (
    filter.activityTypeGroups.length === 1
    && members.length === 1
    && members[0] === groupLabels[0]
  ) {
    return groupLabels[0];
  }

  if (!members.length) {
    return labelSummary;
  }

  const previewMembers = members.slice(0, maxPreviewMembers);
  const remainingCount = Math.max(0, members.length - previewMembers.length);
  return `${labelSummary} • ${previewMembers.join(', ')}${remainingCount > 0 ? ` +${remainingCount} more` : ''}`;
}
