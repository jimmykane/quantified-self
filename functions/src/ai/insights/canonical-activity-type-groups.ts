import {
  type ActivityTypeGroup,
  ActivityTypesHelper,
} from '@sports-alliance/sports-lib';
import {
  getActivityTypeGroupMetadata,
  getActivityTypeGroupMetadataList,
  resolveActivityTypeGroup,
} from '../../../../shared/activity-type-group.metadata';

export const CANONICAL_ACTIVITY_TYPE_GROUPS = getActivityTypeGroupMetadataList().map(metadata => metadata.id);

const CANONICAL_ACTIVITY_TYPE_GROUP_SET = new Set<ActivityTypeGroup>(CANONICAL_ACTIVITY_TYPE_GROUPS);

export function resolveCanonicalActivityTypeGroup(rawValue: string): ActivityTypeGroup | null {
  const trimmedValue = `${rawValue || ''}`.trim();
  if (!trimmedValue) {
    return null;
  }

  const resolvedActivityTypeGroup = resolveActivityTypeGroup(trimmedValue);
  if (resolvedActivityTypeGroup && CANONICAL_ACTIVITY_TYPE_GROUP_SET.has(resolvedActivityTypeGroup)) {
    return resolvedActivityTypeGroup;
  }

  const directMatch = trimmedValue as ActivityTypeGroup;
  return CANONICAL_ACTIVITY_TYPE_GROUP_SET.has(directMatch) ? directMatch : null;
}

export function buildSupportedActivityTypeGroupsPromptText(): string {
  return CANONICAL_ACTIVITY_TYPE_GROUPS.map((activityTypeGroup) => {
    const metadata = getActivityTypeGroupMetadata(activityTypeGroup);
    const aliases = metadata.aliases.join(', ') || 'none';
    const members = ActivityTypesHelper.getActivityTypesForActivityGroup(activityTypeGroup).join(', ') || 'none';
    return `- ${metadata.id}: label=${metadata.label}; aliases=${aliases}; members=${members}`;
  }).join('\n');
}
