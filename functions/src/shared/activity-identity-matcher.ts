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
