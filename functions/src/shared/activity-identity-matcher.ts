import { DataDistance, DataDuration } from '@sports-alliance/sports-lib';

export interface ActivityIdentityLike {
  getID?: () => string | null | undefined;
  setID?: (id: string) => unknown;
  toJSON?: () => unknown;
  startDate?: unknown;
  endDate?: unknown;
  type?: unknown;
  creator?: { name?: string };
  sourceActivityKey?: string;
  fingerprintPayload?: unknown;
  getStat?: (
    statType: string,
  ) => { getValue?: () => unknown } | null;
}

export interface ActivityIdentityAssignmentResult {
  assignments: Map<number, number>;
  unmatchedParsedIndexes: number[];
  unmatchedExistingIndexes: number[];
}

export interface ActivityIdentityAssignmentOptions {
  /**
   * Preserves the legacy reparse carry-over behavior when exactly one parsed
   * and persisted activity remain. Read-only consumers must leave this false
   * so a mismatched identity fails closed.
   */
  allowSingleRemainingFallback?: boolean;
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const time = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(time) ? time : null;
  }
  const time = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function normalizedType(value: unknown): string {
  return `${value || ''}`.trim().toLowerCase() || 'unknown';
}

function sourceKey(activity: ActivityIdentityLike): string | null {
  const value = `${activity.sourceActivityKey || ''}`.trim();
  return value || null;
}

function roundedStat(activity: ActivityIdentityLike, type: string): string {
  const stat = activity.getStat?.(type);
  const value = stat?.getValue?.();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}` : 'na';
}

function strictSignature(activity: ActivityIdentityLike): string | null {
  const startMs = toTimestampMs(activity.startDate);
  if (startMs === null) {
    return null;
  }
  return [
    startMs,
    toTimestampMs(activity.endDate) ?? 'na',
    normalizedType(activity.type),
    roundedStat(activity, DataDuration.type),
    roundedStat(activity, DataDistance.type),
  ].join('|');
}

function timeTypeSignature(activity: ActivityIdentityLike): string | null {
  const startMs = toTimestampMs(activity.startDate);
  if (startMs === null) {
    return null;
  }
  return [
    startMs,
    toTimestampMs(activity.endDate) ?? 'na',
    normalizedType(activity.type),
  ].join('|');
}

function startTypeSignature(activity: ActivityIdentityLike): string | null {
  const startMs = toTimestampMs(activity.startDate);
  return startMs === null
    ? null
    : [startMs, normalizedType(activity.type)].join('|');
}

function assignUniqueMatches(
  existing: readonly ActivityIdentityLike[],
  parsed: readonly ActivityIdentityLike[],
  assignments: Map<number, number>,
  usedExisting: Set<number>,
  signature: (activity: ActivityIdentityLike) => string | null,
): void {
  const existingBySignature = new Map<string, number[]>();
  existing.forEach((activity, index) => {
    if (usedExisting.has(index)) {
      return;
    }
    const key = signature(activity);
    if (key) {
      existingBySignature.set(key, [...(existingBySignature.get(key) || []), index]);
    }
  });

  const parsedBySignature = new Map<string, number[]>();
  parsed.forEach((activity, index) => {
    if (assignments.has(index)) {
      return;
    }
    const key = signature(activity);
    if (key) {
      parsedBySignature.set(key, [...(parsedBySignature.get(key) || []), index]);
    }
  });

  parsedBySignature.forEach((parsedIndexes, key) => {
    const existingIndexes = existingBySignature.get(key) || [];
    if (parsedIndexes.length === 1 && existingIndexes.length === 1) {
      assignments.set(parsedIndexes[0], existingIndexes[0]);
      usedExisting.add(existingIndexes[0]);
    }
  });
}

// Verified import-name refinements, not Training-family equivalence. In
// particular, Generic -> Chores and Generic -> Meditation are separate edges;
// they never make Chores and Meditation interchangeable.
const HISTORICAL_IMPORT_TYPE_REFINEMENTS = [
  ['Cycling', 'Road Cycling'],
  ['Running', 'Road Running'],
  ['Indoor Running', 'Indoor Track Running'],
  ['Elliptical Trainer', 'Crosstrainer'],
  ['Flexibility Training', 'Stretching'],
  ['Rock Climbing', 'Climbing'],
  ['Generic', 'Chores'],
  ['Generic', 'Meditation'],
] as const;

const compatibleImportTypes = new Set(HISTORICAL_IMPORT_TYPE_REFINEMENTS.flatMap(([oldType, newType]) => [
  `${normalizedType(oldType)}|${normalizedType(newType)}`,
  `${normalizedType(newType)}|${normalizedType(oldType)}`,
]));

function finiteRoundedStat(activity: ActivityIdentityLike, type: string): number | null {
  const value = activity.getStat?.(type)?.getValue?.();
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function refinementSignature(activity: ActivityIdentityLike): string | null {
  const startMs = toTimestampMs(activity.startDate);
  const endMs = toTimestampMs(activity.endDate);
  const duration = finiteRoundedStat(activity, DataDuration.type);
  if (startMs === null || endMs === null || endMs < startMs || duration === null) {
    return null;
  }
  return [startMs, endMs, duration, finiteRoundedStat(activity, DataDistance.type) ?? 'na'].join('|');
}

function assignUniqueImportRefinements(
  existing: readonly ActivityIdentityLike[],
  parsed: readonly ActivityIdentityLike[],
  assignments: Map<number, number>,
  usedExisting: Set<number>,
): void {
  const existingBySignature = new Map<string, number[]>();
  existing.forEach((activity, index) => {
    const key = usedExisting.has(index) ? null : refinementSignature(activity);
    if (key) {
      existingBySignature.set(key, [...(existingBySignature.get(key) || []), index]);
    }
  });
  const candidates = new Map<number, number>();
  const parsedCandidateCountsByExisting = new Map<number, number>();
  parsed.forEach((activity, parsedIndex) => {
    const key = assignments.has(parsedIndex) ? null : refinementSignature(activity);
    if (!key) {
      return;
    }
    const matches = (existingBySignature.get(key) || []).filter(existingIndex => {
      const previous = existing[existingIndex];
      const previousSourceKey = sourceKey(previous);
      const parsedSourceKey = sourceKey(activity);
      return !(previousSourceKey && parsedSourceKey && previousSourceKey !== parsedSourceKey)
        && compatibleImportTypes.has(`${normalizedType(previous.type)}|${normalizedType(activity.type)}`);
    });
    if (matches.length === 1) {
      candidates.set(parsedIndex, matches[0]);
    }
    matches.forEach(existingIndex => {
      parsedCandidateCountsByExisting.set(existingIndex,
        (parsedCandidateCountsByExisting.get(existingIndex) || 0) + 1);
    });
  });
  // Check uniqueness on both sides before assigning any edge. Iterating and
  // consuming candidates would otherwise turn an ambiguous graph into a match.
  candidates.forEach((existingIndex, parsedIndex) => {
    if (parsedCandidateCountsByExisting.get(existingIndex) === 1) {
      assignments.set(parsedIndex, existingIndex);
      usedExisting.add(existingIndex);
    }
  });
}

/**
 * Matches parsed activities to persisted identities without mutating either side.
 * Ambiguous signatures remain unmatched so callers can fail closed.
 */
export function resolveActivityIdentityAssignments(
  existing: readonly ActivityIdentityLike[],
  parsed: readonly ActivityIdentityLike[],
  options: ActivityIdentityAssignmentOptions = {},
): ActivityIdentityAssignmentResult {
  const assignments = new Map<number, number>();
  const usedExisting = new Set<number>();
  [sourceKey, strictSignature, timeTypeSignature, startTypeSignature].forEach(
    signature => assignUniqueMatches(
      existing,
      parsed,
      assignments,
      usedExisting,
      signature,
    ),
  );

  assignUniqueImportRefinements(existing, parsed, assignments, usedExisting);

  const unmatchedParsedIndexes = parsed
    .map((_activity, index) => index)
    .filter(index => !assignments.has(index));
  const unmatchedExistingIndexes = existing
    .map((_activity, index) => index)
    .filter(index => !usedExisting.has(index));
  if (
    options.allowSingleRemainingFallback === true
    && unmatchedParsedIndexes.length === 1
    && unmatchedExistingIndexes.length === 1
  ) {
    assignments.set(unmatchedParsedIndexes[0], unmatchedExistingIndexes[0]);
    return {
      assignments,
      unmatchedParsedIndexes: [],
      unmatchedExistingIndexes: [],
    };
  }
  return {
    assignments,
    unmatchedParsedIndexes,
    unmatchedExistingIndexes,
  };
}
