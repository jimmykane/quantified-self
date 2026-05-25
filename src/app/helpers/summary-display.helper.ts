import {
  ActivityTypeGroups,
  ActivityTypes,
  ActivityTypesHelper,
  DataDistance,
  DataDuration,
  DataInterface,
  DataSwimDistance,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  type UnitAwareStatDisplay,
  resolveUnitAwareDisplayStat as resolveSharedUnitAwareDisplayStat,
} from '@shared/unit-aware-display';
import { SummaryPrimaryInfoMetric } from '../components/shared/summary-primary-info/summary-primary-info.component';

export const isSwimmingActivityType = (activityType: unknown): boolean => {
  const resolvedActivityType = ActivityTypesHelper.resolveActivityType(activityType) as ActivityTypes | null;
  if (!resolvedActivityType) {
    return false;
  }

  return ActivityTypesHelper.getActivityGroupForActivityType(resolvedActivityType) === ActivityTypeGroups.SwimmingGroup;
};

export const shouldDisplayDistanceAsSwimMeters = (activityTypes?: readonly unknown[] | null): boolean => {
  if (!activityTypes?.length) {
    return false;
  }

  return activityTypes.every(isSwimmingActivityType);
};

export const resolveSummaryDisplayStat = (
  stat: DataInterface | void | null | undefined,
  preferredType?: string | null,
  activityTypes?: readonly unknown[] | null,
): DataInterface | null => {
  if (!stat) {
    return null;
  }

  const statType = stat.getType?.();
  if (
    (preferredType === DataDistance.type || statType === DataDistance.type)
    && shouldDisplayDistanceAsSwimMeters(activityTypes)
  ) {
    const distance = stat.getValue?.();
    if (typeof distance === 'number' && Number.isFinite(distance)) {
      return new DataSwimDistance(distance);
    }
  }

  return stat;
};

export const resolvePrimaryUnitAwareDisplayStat = (
  stat: DataInterface | void | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
  preferredType?: string | null,
  activityTypes?: readonly unknown[] | null,
): UnitAwareStatDisplay | null => {
  const displayStat = resolveSummaryDisplayStat(stat, preferredType, activityTypes);

  return resolveSharedUnitAwareDisplayStat(displayStat, unitSettings, {
    preferredType,
  });
};

/**
 * Single factory that converts a raw sports-lib stat into a SummaryPrimaryInfoMetric.
 * All consumers (event-summary, map popup, etc.) MUST use this — never construct
 * SummaryPrimaryInfoMetric objects inline — so display decisions stay in one place.
 *
 * Special cases:
 *  - Duration: colon format (1:04:32) with ms fraction as subValue (.5)
 *  - All others: unit-aware display via resolvePrimaryUnitAwareDisplayStat
 */
export const buildHeroMetric = (
  statType: string,
  stat: DataInterface | void | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
  activityTypes?: readonly unknown[] | null,
): SummaryPrimaryInfoMetric => {
  if (!stat) {
    return { value: '--', label: '' };
  }

  if (statType === DataDuration.type) {
    const mainValue = (stat as any).getDisplayValue(false, true, false, true); // colon, no ms
    const withMs = (stat as any).getDisplayValue(false, true, true, true);    // colon + ms
    const subValue = withMs.slice(mainValue.length) || undefined;
    return { value: mainValue, label: 'Duration', subValue };
  }

  const display = resolvePrimaryUnitAwareDisplayStat(stat, unitSettings, statType, activityTypes);
  return display
    ? { value: display.value, label: display.unit }
    : { value: '--', label: '' };
};
