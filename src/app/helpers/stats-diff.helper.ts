import { ActivityInterface, DataInterface, DynamicDataLoader, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUnitDerivedTypeLabel } from './stat-label.helper';

export interface StatDiffResult {
  display: string;
  percent: number;
}

export interface StatDisplayDescriptor {
  type: string;
  label: string;
}

const getStatValueForDisplayType = (
  activity: ActivityInterface,
  baseStatType: string,
  displayStatType: string,
  unitSettings: UserUnitSettingsInterface
): number | null => {
  if (!activity || typeof (activity as any).getStat !== 'function') {
    return null;
  }
  const direct = activity.getStat(displayStatType as any);
  if (direct && typeof (direct as any).getValue === 'function') {
    const value = direct.getValue();
    return typeof value === 'number' ? value : null;
  }
  const base = activity.getStat(baseStatType as any);
  if (!base) {
    return null;
  }
  const unitStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(base as any, unitSettings);
  const match = unitStats.find(stat => stat.getType() === displayStatType);
  if (match && typeof (match as any).getValue === 'function') {
    const value = match.getValue();
    return typeof value === 'number' ? value : null;
  }
  return null;
};

export const computeStatDiff = (
  activityA: ActivityInterface,
  activityB: ActivityInterface,
  baseStatType: string,
  displayStatType: string,
  unitSettings: UserUnitSettingsInterface
): StatDiffResult | null => {
  if (!activityA || !activityB || !unitSettings) {
    return null;
  }

  const valueA = getStatValueForDisplayType(activityA, baseStatType, displayStatType, unitSettings);
  const valueB = getStatValueForDisplayType(activityB, baseStatType, displayStatType, unitSettings);
  if (valueA === null || valueB === null) {
    return null;
  }
  if (typeof valueA !== 'number' || typeof valueB !== 'number') {
    return null;
  }

  const diffValue = Math.abs(valueA - valueB);
  const denom = (valueA + valueB) / 2;
  const percent = denom === 0 ? 0 : 100 * Math.abs((valueA - valueB) / denom);
  const diffStat = DynamicDataLoader.getDataInstanceFromDataType(displayStatType, diffValue);
  const display = `${diffStat.getDisplayValue()} ${diffStat.getDisplayUnit()}`.trim();

  return { display, percent };
};

export const buildStatDisplayList = (
  stats: DataInterface[],
  displayedStatsToShow: string[],
  unitSettings: UserUnitSettingsInterface
): StatDisplayDescriptor[] => {
  if (!stats?.length || !unitSettings) {
    return [];
  }

  const statsMap = new Map<string, DataInterface>();
  stats.forEach(stat => statsMap.set(stat.getType(), stat));

  const seen = new Set<string>();
  const displayList: StatDisplayDescriptor[] = [];

  displayedStatsToShow.forEach((statType) => {
    const stat = statsMap.get(statType);
    if (!stat) {
      return;
    }
    const unitStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings);
    unitStats.forEach((unitStat) => {
      const displayType = unitStat.getType();
      if (seen.has(displayType)) {
        return;
      }
      seen.add(displayType);
      displayList.push({
        type: displayType,
        label: normalizeUnitDerivedTypeLabel(displayType, unitStat.getDisplayType()),
      });
    });
  });

  return displayList;
};

export const buildDiffMapForStats = (
  stats: DataInterface[],
  displayedStatsToShow: string[],
  activities: ActivityInterface[],
  unitSettings: UserUnitSettingsInterface
): Map<string, StatDiffResult> => {
  if (!stats?.length || !unitSettings || !activities?.length || activities.length < 2) {
    return new Map();
  }

  const activityA = activities[0];
  const activityB = activities[1];
  const diffMap = new Map<string, StatDiffResult>();

  const statsMap = new Map<string, DataInterface>();
  stats.forEach(stat => statsMap.set(stat.getType(), stat));

  displayedStatsToShow.forEach((statType) => {
    const stat = statsMap.get(statType);
    if (!stat) {
      return;
    }
    const unitStats = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings);
    unitStats.forEach((unitStat) => {
      const displayType = unitStat.getType();
      const diff = computeStatDiff(activityA, activityB, stat.getType(), displayType, unitSettings);
      if (!diff) {
        return;
      }
      diffMap.set(displayType, diff);
    });
  });

  return diffMap;
};
