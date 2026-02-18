import { DataInterface, DynamicDataLoader, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

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
