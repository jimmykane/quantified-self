import { DataDistance, DataDuration } from '@sports-alliance/sports-lib';
import { readActivitySourceIdentity } from './activity-source-identity';

export interface ActivityIdentityLike {
  getID?: () => string | null | undefined;
  setID?: (id: string) => unknown;
  toJSON?: () => unknown;
  startDate?: unknown;
  endDate?: unknown;
  type?: unknown;
  creator?: { name?: string };
  sourceActivityKey?: string;
  sourceIdentity?: unknown;
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
  /** Server-only: the caller verified the parent recording/provider before permitting mutable sport/stat fields. */
  allowSourceWindowMatch?: boolean;
  /** IDs certified by the current guarded source-write reservation; never inferred from incoming JSON. */
  verifiedActivityIds?: ReadonlySet<string>;
  /** Require complete matching times/duration/distance, compatible source keys and exact/verified sport types. */
  requireStrictMatch?: boolean;

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

function sourceView(activity: ActivityIdentityLike): ActivityIdentityLike {
  const source = readActivitySourceIdentity(activity.sourceIdentity, activity.getID?.());
  return source ? { ...activity, getID: activity.getID?.bind(activity), getStat: activity.getStat?.bind(activity),
    startDate: source.startMs, endDate: source.endMs, type: source.importedType } : activity;
}

export function getActivitySourceWindow(activity: ActivityIdentityLike): { startMs: number; endMs: number } | null {
  const view = sourceView(activity);
  const start = toTimestampMs(view.startDate), end = toTimestampMs(view.endDate);
  return start !== null && end !== null && end >= start ? { startMs: start, endMs: end } : null;
}

function sourceWindow(activity: ActivityIdentityLike): string | null {
  const window = getActivitySourceWindow(activity);
  return window ? `${window.startMs}|${window.endMs}` : null;
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
export const HISTORICAL_IMPORT_TYPE_REFINEMENTS = [
  ['Hiking', 'Trekking'],
  ['Cycling', 'Road Cycling'],
  ['Backcountry Skiing', 'Ski Touring'],
  ['Flexibility Training', 'Stretching'],
  ['Cycling', 'Gravel Cycling'],
  ['Running', 'Track Running'],
  ['Hang Gliding', 'Paragliding'],
  ['Racquet Ball', 'Padel'],
  ['Rock Climbing', 'Climbing'],
  ['Generic', 'Meditation'],
  ['Training', 'Breathwork'],
  ['Generic', 'Chores'],
  ['Cardio Training', 'Aerobics'],
  ['Training', 'Meditation'],
  ['Racquet Ball', 'Racket Sport'],
  ['Unknown Sport', 'Dancing'],
  ['Cycling', 'E-Biking'],
  ['Elliptical Trainer', 'Crosstrainer'],
  ['E-Biking', 'E-Mountain Biking'],
  ['Cycling', 'E-Mountain Biking'],
  ['Driving', 'Motorsports'],
  ['Strength Training', 'Calisthenics'],
  ['Generic', 'Calisthenics'],
  ['Mountain Biking', 'Cyclocross'],
  ['Sailing', 'Sail Racing'],
  ['Unknown Sport', 'E-Mountain Biking'],
  ['Generic', 'Mobility'],
  ['Generic', 'Sailing'],
  ['Crosscountry Skiing', 'Classic Crosscountry Skiing'],
  ['Running', 'Ultra Running'],
  ['Backcountry Skiing', 'Ski Mountaineering'],
  ['Walking', 'Speed Walking'],
  ['Crosscountry Skiing', 'Skate Skiing'],
  ['Walking', 'Indoor Walking'],
  ['Generic', 'Jump Rope'],
  ['Unknown Sport', 'Jump Rope'],
  ['Running', 'Road Running'],
  ['Motorcycling', 'ATV'],
  ['Generic', 'Rowing'],
  ['Generic', 'Mixed Martial Arts'],
  ['Backcountry Skiing', 'Backcountry Snowboarding'],
  ['Running', 'Obstacle Racing'],
  ['Cycling', 'Indoor Cycling'],
  ['Hiking', 'Rucking'],
  ['Rafting', 'Whitewater Rafting'],
  ['Cycling', 'Mountain Biking'],
  ['Generic', 'Water Tubing'],
  ['Indoor Running', 'Indoor Track Running'],
  ['Unknown Sport', 'Ultra Running'],
  ['Unknown Sport', 'Gravel Cycling'],
  ['Unknown Sport', 'Sailing'],
  ['Unknown Sport', 'Trail Running'],
  ['Unknown Sport', 'Track Running'],
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

function compatibleRefinementSourceKeys(previous: ActivityIdentityLike, parsed: ActivityIdentityLike): boolean {
  const previousKey = sourceKey(previous);
  const parsedKey = sourceKey(parsed);
  if (!previousKey || !parsedKey || previousKey === parsedKey) {
    return true;
  }
  // Generated keys contain source-content SHA : activity-fingerprint SHA : occurrence.
  // Renaming a sport changes its fingerprint without changing the source bytes.
  const generatedKey = /^([a-f0-9]{64}):[a-f0-9]{64}:[0-9]+$/i;
  const previousSourceHash = generatedKey.exec(previousKey)?.[1];
  const parsedSourceHash = generatedKey.exec(parsedKey)?.[1];
  return Boolean(previousSourceHash && parsedSourceHash
    && previousSourceHash.toLowerCase() === parsedSourceHash.toLowerCase());
}

function assignUniqueImportRefinements(
  existing: readonly ActivityIdentityLike[],
  parsed: readonly ActivityIdentityLike[],
  assignments: Map<number, number>,
  usedExisting: Set<number>,
  allowUnchangedType = false,
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
      return compatibleRefinementSourceKeys(previous, activity)
        && ((allowUnchangedType && normalizedType(previous.type) === normalizedType(activity.type))
          || compatibleImportTypes.has(`${normalizedType(previous.type)}|${normalizedType(activity.type)}`));
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
  if (options.verifiedActivityIds) {
    assignUniqueMatches(existing, parsed, assignments, usedExisting, activity => {
      const id = activity.getID?.();
      return id && options.verifiedActivityIds?.has(id) ? id : null;
    });
  }
  const sourceExisting = existing.map(sourceView), sourceParsed = parsed.map(sourceView);
  (options.requireStrictMatch ? [] : [sourceKey, strictSignature, timeTypeSignature, startTypeSignature]).forEach(
    signature => assignUniqueMatches(
      sourceExisting,
      sourceParsed,
      assignments,
      usedExisting,
      signature,
    ),
  );

  assignUniqueImportRefinements(sourceExisting, sourceParsed, assignments, usedExisting, options.requireStrictMatch);
  if (options.allowSourceWindowMatch) {
    // Count the whole recording: consuming one duplicate must not make another ambiguous window look unique.
    const count = (values: readonly ActivityIdentityLike[]) => values.reduce((map, activity) => {
      const key = sourceWindow(activity);
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const before = count(existing), after = count(parsed);
    assignUniqueMatches(existing, parsed, assignments, usedExisting, activity => {
      const key = sourceWindow(activity);
      return key && before.get(key) === 1 && after.get(key) === 1 ? key : null;
    });
  }

  const unmatchedParsedIndexes = parsed
    .map((_activity, index) => index)
    .filter(index => !assignments.has(index));
  const unmatchedExistingIndexes = existing
    .map((_activity, index) => index)
    .filter(index => !usedExisting.has(index));
  return {
    assignments,
    unmatchedParsedIndexes,
    unmatchedExistingIndexes,
  };
}
