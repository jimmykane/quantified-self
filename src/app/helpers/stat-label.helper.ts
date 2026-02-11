import { DataInterface, DynamicDataLoader } from '@sports-alliance/sports-lib';

type StatQualifierKey = 'average' | 'minimum' | 'maximum';

const STAT_QUALIFIER_REGEX = /^(average|minimum|maximum)\s+/i;
const STAT_QUALIFIER_LABELS: Record<StatQualifierKey, string> = {
  average: 'Average',
  minimum: 'Minimum',
  maximum: 'Maximum',
};

const UNIT_DERIVED_PARENT_BY_VARIANT = new Map<string, string>();
const UNIT_GROUPS = DynamicDataLoader.dataTypeUnitGroups || {};

Object.entries(UNIT_GROUPS).forEach(([parentType, variants]) => {
  Object.keys(variants || {}).forEach((variantType) => {
    const normalizedVariantType = variantType.trim().toLowerCase();
    if (!normalizedVariantType.length) {
      return;
    }
    if (!UNIT_DERIVED_PARENT_BY_VARIANT.has(normalizedVariantType)) {
      UNIT_DERIVED_PARENT_BY_VARIANT.set(normalizedVariantType, parentType);
    }
  });
});

const parseTypeQualifier = (type: string): { qualifier: StatQualifierKey | null; baseType: string } => {
  const trimmedType = type.trim();
  const qualifierMatch = trimmedType.match(STAT_QUALIFIER_REGEX);
  if (!qualifierMatch) {
    return {
      qualifier: null,
      baseType: trimmedType,
    };
  }

  const qualifier = qualifierMatch[1].toLowerCase() as StatQualifierKey;
  const baseType = trimmedType.slice(qualifierMatch[0].length).trim();
  return {
    qualifier,
    baseType,
  };
};

export const normalizeUnitDerivedTypeLabel = (type: string, fallbackLabel?: string): string => {
  if (!type) {
    return fallbackLabel ?? '';
  }

  const trimmedType = type.trim();
  if (!trimmedType.length) {
    return fallbackLabel ?? '';
  }

  const { qualifier, baseType } = parseTypeQualifier(trimmedType);
  const parentType = UNIT_DERIVED_PARENT_BY_VARIANT.get(baseType.toLowerCase());
  if (!parentType) {
    return fallbackLabel ?? trimmedType;
  }

  if (!qualifier) {
    return parentType;
  }

  const qualifierLabel = STAT_QUALIFIER_LABELS[qualifier];
  return `${qualifierLabel} ${parentType}`;
};

export const normalizeUnitDerivedStatLabel = (stat: DataInterface): string => {
  if (!stat || typeof stat.getType !== 'function') {
    return '';
  }

  const type = stat.getType();
  const fallbackLabel = typeof stat.getDisplayType === 'function' ? stat.getDisplayType() : type;
  return normalizeUnitDerivedTypeLabel(type, fallbackLabel);
};
