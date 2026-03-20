const PROMPT_CANONICAL_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bheartrate\b/g, 'heart rate'],
  [/\bheart[-_\s]*rate\b/g, 'heart rate'],
  [/\bactivity[-_\s]*types?\b/g, 'activity type'],
];

export function canonicalizeInsightPrompt(
  value: string,
): string {
  let normalized = `${value || ''}`.trim().toLowerCase();
  for (const [pattern, replacement] of PROMPT_CANONICAL_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

export function normalizePromptSearchText(
  value: string,
): string {
  return canonicalizeInsightPrompt(value)
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
