import { DataInterface, DynamicDataLoader } from '@sports-alliance/sports-lib';

type StatQualifierKey = 'average' | 'minimum' | 'maximum';

const STAT_QUALIFIER_REGEX = /^(average|minimum|maximum)\s+/i;
const STAT_QUALIFIER_LABELS: Record<StatQualifierKey, string> = {
  average: 'Average',
  minimum: 'Minimum',
  maximum: 'Maximum',
};

const parseTypeQualifier = (type: string): { qualifier: StatQualifierKey | null; baseType: string } => {
  const trimmedType = type.trim();
  const qualifierMatch = trimmedType.match(STAT_QUALIFIER_REGEX);
  if (!qualifierMatch) {
    return { qualifier: null, baseType: trimmedType };
  }

  const qualifier = qualifierMatch[1].toLowerCase() as StatQualifierKey;
  const baseType = trimmedType.slice(qualifierMatch[0].length).trim();
  return { qualifier, baseType };
};

const UNIT_DERIVED_PARENTS_BY_VARIANT = new Map<string, Set<string>>();

const addParentCandidate = (variantType: string, parentType: string): void => {
  const normalizedVariantType = variantType.trim().toLowerCase();
  const normalizedParentType = parentType.trim();
  if (!normalizedVariantType.length || !normalizedParentType.length) {
    return;
  }

  const existingParents = UNIT_DERIVED_PARENTS_BY_VARIANT.get(normalizedVariantType) ?? new Set<string>();
  existingParents.add(normalizedParentType);
  UNIT_DERIVED_PARENTS_BY_VARIANT.set(normalizedVariantType, existingParents);
};

const addCandidatesFromUnitGroups = (): void => {
  const unitGroups = DynamicDataLoader.dataTypeUnitGroups || {};
  Object.entries(unitGroups).forEach(([parentType, variants]) => {
    const parentBaseType = parseTypeQualifier(parentType).baseType.trim();
    Object.keys(variants || {}).forEach((variantType) => {
      const variantBaseType = parseTypeQualifier(variantType).baseType.trim();
      addParentCandidate(variantType, parentBaseType);
      addParentCandidate(variantBaseType, parentBaseType);
    });
  });
};

const addCandidatesFromFamilyMaps = (familyMap?: Record<string, string>): void => {
  if (!familyMap) {
    return;
  }

  Object.entries(familyMap).forEach(([baseType, qualifiedType]) => {
    const qualifiedBaseType = parseTypeQualifier(qualifiedType || '').baseType.trim().toLowerCase();
    const candidateParents = UNIT_DERIVED_PARENTS_BY_VARIANT.get(qualifiedBaseType);
    if (!candidateParents?.size) {
      return;
    }

    candidateParents.forEach((candidateParent) => addParentCandidate(baseType, candidateParent));
  });
};

const selectParentCandidate = (candidates: Set<string>, fallbackLabel?: string): string => {
  if (candidates.size <= 1) {
    return [...candidates.values()][0];
  }

  const fallbackBaseType = parseTypeQualifier(fallbackLabel || '').baseType.trim().toLowerCase();
  if (fallbackBaseType.length) {
    const exactFallbackMatch = [...candidates.values()]
      .find((candidate) => candidate.toLowerCase() === fallbackBaseType);
    if (exactFallbackMatch) {
      return exactFallbackMatch;
    }
  }

  return [...candidates.values()]
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
};

addCandidatesFromUnitGroups();
addCandidatesFromFamilyMaps(DynamicDataLoader.dataTypeAvgDataType || {});
addCandidatesFromFamilyMaps(DynamicDataLoader.dataTypeMinDataType || {});
addCandidatesFromFamilyMaps(DynamicDataLoader.dataTypeMaxDataType || {});

export const normalizeUnitDerivedTypeLabel = (type: string, fallbackLabel?: string): string => {
  if (!type) {
    return fallbackLabel ?? '';
  }

  const trimmedType = type.trim();
  if (!trimmedType.length) {
    return fallbackLabel ?? '';
  }

  const { qualifier, baseType } = parseTypeQualifier(trimmedType);
  const parentCandidates = UNIT_DERIVED_PARENTS_BY_VARIANT.get(baseType.toLowerCase());
  if (!parentCandidates?.size) {
    return fallbackLabel ?? trimmedType;
  }

  const parentType = selectParentCandidate(parentCandidates, fallbackLabel);
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
