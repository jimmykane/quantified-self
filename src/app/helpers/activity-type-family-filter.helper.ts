import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
  type ActivityTypeFilterFamily,
  getCanonicalActivityTypesForFilterFamily,
} from '@shared/activity-type-family';
import { resolveCompatibleActivityType } from '@shared/activity-type-compatibility';

export interface ActivityTypeFamilyFilterOption {
  id: ActivityTypeFilterFamily;
  label: string;
  activityTypes: ActivityTypes[];
  selected: boolean;
  partial: boolean;
}

const FAMILIES: ReadonlyArray<{ id: ActivityTypeFilterFamily; label: string }> = [
  { id: 'running', label: 'All Running / Trail' },
  { id: 'cycling', label: 'All Cycling / MTB' },
  { id: 'walking-hiking', label: 'All Walking / Hiking' },
];

export function normalizeActivityTypeSelection(values: readonly unknown[]): ActivityTypes[] {
  return [...new Set(values.map(resolveCompatibleActivityType).filter((type): type is ActivityTypes => Boolean(type)))];
}

export function getActivityTypeFamilyFilterOptions(
  selected: readonly unknown[],
  available?: readonly unknown[] | null,
): ActivityTypeFamilyFilterOption[] {
  const selectedTypes = new Set(normalizeActivityTypeSelection(selected));
  const availableTypes = Array.isArray(available) ? new Set(normalizeActivityTypeSelection(available)) : null;
  return FAMILIES.map(family => {
    const activityTypes = getCanonicalActivityTypesForFilterFamily(family.id)
      .filter(type => !availableTypes || availableTypes.has(type));
    const count = activityTypes.filter(type => selectedTypes.has(type)).length;
    return {
      ...family,
      activityTypes,
      selected: activityTypes.length > 0 && count === activityTypes.length,
      partial: count > 0 && count < activityTypes.length,
    };
  }).filter(family => family.activityTypes.length > 0);
}

/** Family actions change only that family; stored exact selections hydrate unchanged. */
export function toggleActivityTypeFamilySelection(
  selected: readonly unknown[],
  option: ActivityTypeFamilyFilterOption,
  checked: boolean,
): ActivityTypes[] {
  const current = normalizeActivityTypeSelection(selected);
  return checked
    ? [...new Set([...current, ...option.activityTypes])]
    : current.filter(type => !option.activityTypes.includes(type));
}

export function isSameActivityTypeSelection(left: readonly ActivityTypes[], right: readonly ActivityTypes[]): boolean {
  return left.length === right.length && left.every(type => right.includes(type));
}
