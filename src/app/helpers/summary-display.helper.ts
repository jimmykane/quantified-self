import { DataDuration, DataInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  type UnitAwareStatDisplay,
  resolveUnitAwareDisplayStat as resolveSharedUnitAwareDisplayStat,
} from '@shared/unit-aware-display';
import { SummaryPrimaryInfoMetric } from '../components/shared/summary-primary-info/summary-primary-info.component';

export const resolvePrimaryUnitAwareDisplayStat = (
  stat: DataInterface | void | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
  preferredType?: string | null
): UnitAwareStatDisplay | null => {
  return resolveSharedUnitAwareDisplayStat(stat, unitSettings, {
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
