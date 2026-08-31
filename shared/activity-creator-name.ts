const PARSER_PLACEHOLDER_CREATOR_NAMES = new Set([
  'unknown',
  'unknown device',
]);

function getMeaningfulActivityCreatorName(value: unknown): string | null {
  const creatorName = normalizeActivityCreatorName(value);
  if (!creatorName) {
    return null;
  }

  return isParserPlaceholderCreatorName(creatorName) ? null : creatorName;
}

/**
 * Preserves the existing creator unless it is a parser placeholder and the new
 * parse recovered a meaningful replacement.
 */
export function getActivityCreatorNameCarryover(existingValue: unknown, parsedValue: unknown): string | null {
  const existingCreatorName = normalizeActivityCreatorName(existingValue);
  if (!existingCreatorName) {
    return null;
  }

  if (!isParserPlaceholderCreatorName(existingCreatorName)) {
    return existingCreatorName;
  }

  return getMeaningfulActivityCreatorName(parsedValue) ? null : existingCreatorName;
}

function normalizeActivityCreatorName(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function isParserPlaceholderCreatorName(value: string): boolean {
  const normalizedName = value.toLowerCase().replace(/\s+/g, ' ');
  return PARSER_PLACEHOLDER_CREATOR_NAMES.has(normalizedName);
}
