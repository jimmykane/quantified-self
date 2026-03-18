import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';

export const CANONICAL_ACTIVITY_TYPES = Array.from(new Set(
  ActivityTypesHelper
    .getActivityTypesAsUniqueArray()
    .map(value => ActivityTypesHelper.resolveActivityType(value))
    .filter((value): value is ActivityTypes => Boolean(value)),
));

const CANONICAL_ACTIVITY_TYPE_SET = new Set<ActivityTypes>(CANONICAL_ACTIVITY_TYPES);

export function resolveCanonicalActivityType(rawValue: string): ActivityTypes | null {
  const trimmedValue = `${rawValue || ''}`.trim();
  if (!trimmedValue) {
    return null;
  }

  const resolvedActivityType = ActivityTypesHelper.resolveActivityType(trimmedValue);
  if (resolvedActivityType && CANONICAL_ACTIVITY_TYPE_SET.has(resolvedActivityType)) {
    return resolvedActivityType;
  }

  const directMatch = trimmedValue as ActivityTypes;
  return CANONICAL_ACTIVITY_TYPE_SET.has(directMatch) ? directMatch : null;
}
