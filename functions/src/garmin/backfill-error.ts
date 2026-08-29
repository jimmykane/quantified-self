function valueToEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1_000);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numericValue = Number(trimmed);
    return numericValue > 10_000_000_000 ? Math.floor(numericValue) : Math.floor(numericValue * 1_000);
  }
  const parsedMs = Date.parse(trimmed);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

function findNestedValue(
  record: unknown,
  fieldNames: readonly string[],
  visited = new Set<object>(),
  depth = 0,
): unknown {
  if (!record || typeof record !== 'object' || depth > 8 || visited.has(record)) return undefined;
  visited.add(record);
  const objectRecord = record as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    if (objectRecord[fieldName] !== undefined) return objectRecord[fieldName];
  }
  for (const value of Object.values(objectRecord)) {
    const nestedValue = findNestedValue(value, fieldNames, visited, depth + 1);
    if (nestedValue !== undefined) return nestedValue;
  }
  return undefined;
}

export function getGarminBackfillErrorText(error: unknown): string {
  let serializedError = '';
  try {
    serializedError = JSON.stringify(error) || '';
  } catch {
    serializedError = '';
  }
  return [
    error instanceof Error ? error.message : '',
    `${(error as { error?: { error?: { errorMessage?: unknown } } } | null)?.error?.error?.errorMessage || ''}`,
    serializedError,
  ].filter(Boolean).join(' ');
}

export function extractGarminBackfillMinimumStartMs(error: unknown): number | null {
  const structuredValue = findNestedValue(error, [
    'minStartTimeInSeconds',
    'minimumStartTimeInSeconds',
    'earliestStartTimeInSeconds',
    'minStartTime',
    'minimumStartTime',
    'earliestStartTime',
  ]);
  const structuredMs = valueToEpochMs(structuredValue);
  if (structuredMs !== null) return structuredMs;

  const message = getGarminBackfillErrorText(error);
  const numericMatch = message.match(/(?:min(?:imum)? start time|earliest start time)[^\d]*(\d{10,13}(?:\.\d+)?)/i);
  const numericMs = valueToEpochMs(numericMatch?.[1]);
  if (numericMs !== null) return numericMs;

  const isoMatch = message.match(/(?:min(?:imum)? start time|earliest start time)\D*(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}:?\d{2})?)?)/i);
  return valueToEpochMs(isoMatch?.[1]);
}

export function getGarminBackfillStatusCode(error: unknown): number | null {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : null;
}

export function isGarminBackfillMinimumStartError(error: unknown): boolean {
  return getGarminBackfillStatusCode(error) === 400
    && (/(?:before|earlier than)[^.!?]*(?:min(?:imum)?|earliest) start time/i
      .test(getGarminBackfillErrorText(error))
      || extractGarminBackfillMinimumStartMs(error) !== null);
}
