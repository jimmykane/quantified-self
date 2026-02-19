import { DataDuration, DataInterface, DynamicDataLoader, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { SummaryPrimaryInfoMetric } from '../components/shared/summary-primary-info/summary-primary-info.component';

export interface UnitAwareStatDisplay {
  type: string;
  value: string;
  unit: string;
}

const toDisplayString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export const resolvePrimaryUnitAwareDisplayStat = (
  stat: DataInterface | void | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
  preferredType?: string | null
): UnitAwareStatDisplay | null => {
  if (!stat) {
    return null;
  }

  const unitBasedStats = unitSettings
    ? DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings)
    : [];

  const preferredUnitStat = preferredType
    ? unitBasedStats.find((unitStat) => unitStat.getType?.() === preferredType)
    : undefined;
  const selectedStat = preferredUnitStat || unitBasedStats[0] || stat;
  const selectedType = selectedStat?.getType?.();
  if (!selectedType) {
    return null;
  }

  return {
    type: selectedType,
    value: toDisplayString(selectedStat.getDisplayValue?.()),
    unit: toDisplayString(selectedStat.getDisplayUnit?.()),
  };
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
  unitSettings?: UserUnitSettingsInterface | null
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

  const display = resolvePrimaryUnitAwareDisplayStat(stat, unitSettings, statType);
  return display
    ? { value: display.value, label: display.unit }
    : { value: '--', label: '' };
};

