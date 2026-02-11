import { DataInterface, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { normalizeUnitDerivedStatLabel, normalizeUnitDerivedTypeLabel } from './stat-label.helper';

export type HeaderStatValueKind = 'avg' | 'min' | 'max' | 'single';

export interface HeaderStatValueItem {
  key: 'AVG' | 'MIN' | 'MAX' | 'VALUE';
  kind: HeaderStatValueKind;
  type: string;
  displayType: string;
  displayValue: string;
  displayUnit: string;
}

export interface HeaderStatCard {
  id: string;
  label: string;
  iconType: string;
  isComposite: boolean;
  valueItems: HeaderStatValueItem[];
}

interface MetricFamilyTypes {
  familyType: string;
  avgType?: string;
  minType?: string;
  maxType?: string;
}

const STAT_KIND_PREFIX_REGEX = /^(average|minimum|maximum)\s+/i;
const DATA_TYPE_KEYS = [
  ...Object.keys(DynamicDataLoader.dataTypeAvgDataType || {}),
  ...Object.keys(DynamicDataLoader.dataTypeMinDataType || {}),
  ...Object.keys(DynamicDataLoader.dataTypeMaxDataType || {}),
];
const DATA_TYPE_KEY_TO_CANONICAL = DATA_TYPE_KEYS.reduce((acc, key) => {
  const normalized = key.trim().toLowerCase();
  if (normalized.length && !acc.has(normalized)) {
    acc.set(normalized, key);
  }
  return acc;
}, new Map<string, string>());

const toDisplayText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

const normalizeFamilyKey = (type: string): string => {
  return type.replace(STAT_KIND_PREFIX_REGEX, '').trim().toLowerCase();
};

export const resolveMetricFamilyTypes = (statType: string): MetricFamilyTypes | null => {
  if (!statType) {
    return null;
  }
  const normalizedKey = normalizeFamilyKey(statType);
  const canonicalFamilyType = DATA_TYPE_KEY_TO_CANONICAL.get(normalizedKey);
  if (!canonicalFamilyType) {
    return null;
  }

  const avgType = DynamicDataLoader.dataTypeAvgDataType[canonicalFamilyType];
  const minType = DynamicDataLoader.dataTypeMinDataType[canonicalFamilyType];
  const maxType = DynamicDataLoader.dataTypeMaxDataType[canonicalFamilyType];
  if (!avgType && !minType && !maxType) {
    return null;
  }

  return {
    familyType: canonicalFamilyType,
    avgType,
    minType,
    maxType,
  };
};

const createValueItem = (
  kind: HeaderStatValueKind,
  key: HeaderStatValueItem['key'],
  stat: DataInterface
): HeaderStatValueItem => {
  return {
    kind,
    key,
    type: stat.getType(),
    displayType: normalizeUnitDerivedStatLabel(stat),
    displayValue: toDisplayText(stat.getDisplayValue()),
    displayUnit: toDisplayText(stat.getDisplayUnit()),
  };
};

const createSingleCard = (stat: DataInterface): HeaderStatCard => {
  return {
    id: `single:${stat.getType()}`,
    label: normalizeUnitDerivedStatLabel(stat),
    iconType: stat.getType(),
    isComposite: false,
    valueItems: [createValueItem('single', 'VALUE', stat)],
  };
};

export const buildHeaderStatCards = (
  displayedStats: DataInterface[],
  expandedStatsMap: Map<string, DataInterface>,
  singleValueTypes: string[] = []
): HeaderStatCard[] => {
  if (!displayedStats.length) {
    return [];
  }

  const cards: HeaderStatCard[] = [];
  const processedKeys = new Set<string>();
  const singleValueTypeSet = new Set(singleValueTypes);
  const singleValueFamilySet = new Set<string>();
  const familyMatches = (familyType: string): boolean => {
    const normalizedFamilyType = familyType.toLowerCase();
    for (const configuredFamily of singleValueFamilySet.values()) {
      const normalizedConfiguredFamily = configuredFamily.toLowerCase();
      if (normalizedFamilyType === normalizedConfiguredFamily) {
        return true;
      }
      if (normalizedFamilyType.startsWith(`${normalizedConfiguredFamily} in `)) {
        return true;
      }
    }
    return false;
  };

  singleValueTypes.forEach((type) => {
    const family = resolveMetricFamilyTypes(type);
    if (family?.familyType) {
      singleValueFamilySet.add(family.familyType);
    }
  });

  displayedStats.forEach((stat) => {
    const familyTypes = resolveMetricFamilyTypes(stat.getType());
    const shouldForceSingle = singleValueTypeSet.has(stat.getType())
      || (!!familyTypes?.familyType && familyMatches(familyTypes.familyType));

    if (shouldForceSingle) {
      const singleKey = `single:${stat.getType()}`;
      if (processedKeys.has(singleKey)) {
        return;
      }
      processedKeys.add(singleKey);
      cards.push(createSingleCard(stat));
      return;
    }

    if (!familyTypes) {
      const singleKey = `single:${stat.getType()}`;
      if (processedKeys.has(singleKey)) {
        return;
      }
      processedKeys.add(singleKey);
      cards.push(createSingleCard(stat));
      return;
    }

    const familyKey = `family:${familyTypes.familyType}`;
    if (processedKeys.has(familyKey)) {
      return;
    }
    processedKeys.add(familyKey);

    const valueItems: HeaderStatValueItem[] = [];
    const familyEntries: Array<{ kind: HeaderStatValueKind; key: HeaderStatValueItem['key']; type?: string }> = [
      { kind: 'avg', key: 'AVG', type: familyTypes.avgType },
      { kind: 'min', key: 'MIN', type: familyTypes.minType },
      { kind: 'max', key: 'MAX', type: familyTypes.maxType },
    ];

    familyEntries.forEach((entry) => {
      if (!entry.type) {
        return;
      }
      const familyStat = expandedStatsMap.get(entry.type);
      if (!familyStat) {
        return;
      }
      valueItems.push(createValueItem(entry.kind, entry.key, familyStat));
    });

    if (!valueItems.length) {
      cards.push(createSingleCard(stat));
      return;
    }

    cards.push({
      id: familyKey,
      label: normalizeUnitDerivedTypeLabel(familyTypes.familyType, familyTypes.familyType),
      iconType: valueItems[0].type,
      isComposite: true,
      valueItems,
    });
  });

  return cards;
};

export const expandStatsTypesForCompositeDiff = (statsTypes: string[]): string[] => {
  const expanded = new Set<string>();

  statsTypes.forEach((statType) => {
    expanded.add(statType);

    const familyTypes = resolveMetricFamilyTypes(statType);
    if (!familyTypes) {
      return;
    }

    if (familyTypes.avgType) {
      expanded.add(familyTypes.avgType);
    }
    if (familyTypes.minType) {
      expanded.add(familyTypes.minType);
    }
    if (familyTypes.maxType) {
      expanded.add(familyTypes.maxType);
    }
  });

  return [...expanded.values()];
};
