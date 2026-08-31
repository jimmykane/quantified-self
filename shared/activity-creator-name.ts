const PARSER_PLACEHOLDER_CREATOR_NAMES = new Set([
  'unknown',
  'unknown device',
]);

/**
 * Returns an existing creator name only when it is meaningful enough to carry
 * across source-file parsing. Parser placeholders must yield to newly recovered
 * device metadata.
 */
export function getPreservableActivityCreatorName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const creatorName = value.trim();
  if (!creatorName) {
    return null;
  }

  const normalizedName = creatorName.toLowerCase().replace(/\s+/g, ' ');
  return PARSER_PLACEHOLDER_CREATOR_NAMES.has(normalizedName) ? null : creatorName;
}
