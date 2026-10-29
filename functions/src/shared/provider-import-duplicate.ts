import { ActivityTypeGroups, ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { readActivitySourceIdentity } from '../../../shared/activity-source-identity';
import { getActivitySourceWindow, type ActivityIdentityLike } from './activity-identity-matcher';

/** Aborts source preparation before any event, original-file or load write. */
export class ProviderImportDuplicateError extends Error {
  readonly name = 'ProviderImportDuplicateError';
  constructor(readonly eventID: string) {
    super('The provider copy is already retained as a saved recording.');
  }
}

function finiteStat(activity: ActivityIdentityLike, type: string): number | null {
  const value = activity.getStat?.(type)?.getValue?.();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Candidate only: callers must verify a single completed, owner-scoped FIT from another provider. */
export function isCrossProviderRunCopy(saved: ActivityIdentityLike, incoming: ActivityIdentityLike): boolean {
  const source = readActivitySourceIdentity(saved.sourceIdentity, saved.getID?.());
  const outdoorRun = (value: unknown) => {
    const type = typeof value === 'string' ? ActivityTypesHelper.resolveActivityType(value) : null;
    if (!type || type === ActivityTypes.VirtualRunning || ActivityTypesHelper.isIndoorActivityType(type)) return false;
    const group = ActivityTypesHelper.getActivityGroupForActivityType(type);
    return group === ActivityTypeGroups.RunningGroup || group === ActivityTypeGroups.TrailRunningGroup;
  };
  if (!source || !outdoorRun(source.importedType) || !outdoorRun(incoming.type)) return false;
  const window = getActivitySourceWindow(incoming);
  if (!window || window.startMs !== source.startMs || window.endMs !== source.endMs
    || window.endMs <= window.startMs) return false;
  const duration = finiteStat(saved, 'Duration'), incomingDuration = finiteStat(incoming, 'Duration');
  const distance = finiteStat(saved, 'Distance'), incomingDistance = finiteStat(incoming, 'Distance');
  if (duration === null || incomingDuration === null || distance === null || incomingDistance === null
    || duration <= 0 || incomingDuration <= 0 || distance <= 0 || incomingDistance <= 0) return false;
  // Independent watches can round timers and calculate slightly different distances.
  const elapsedSeconds = (window.endMs - window.startMs) / 1000;
  return Math.abs(duration - incomingDuration) <= 1
    && Math.max(duration, incomingDuration) <= elapsedSeconds + 1
    && Math.abs(distance - incomingDistance) <= Math.max(distance, incomingDistance) * 0.02;
}

/** Candidate only: the caller must also verify owner-scoped Garmin FIT provenance. */
export function isGarminActivityCopy(saved: ActivityIdentityLike, incoming: ActivityIdentityLike): boolean {
  const source = readActivitySourceIdentity(saved.sourceIdentity, saved.getID?.());
  if (!source) return false;
  const indoor = (source.importedType === 'Treadmill' && incoming.type === 'Running')
    || (source.importedType === 'Indoor Rowing' && incoming.type === 'Rowing');
  const trail = source.importedType === 'Running' && incoming.type === 'Trail Running';
  const virtual = source.importedType === 'Virtual Running' && incoming.type === 'Running';
  if (!indoor && !trail && !virtual) return false;
  const duration = finiteStat(saved, 'Duration'), distance = finiteStat(saved, 'Distance');
  const incomingDuration = finiteStat(incoming, 'Duration');
  const window = getActivitySourceWindow(incoming);
  if (duration === null || duration <= 0 || incomingDuration === null || incomingDuration <= 0
    || distance === null || distance < 0 || finiteStat(incoming, 'Distance') !== distance
    || !window || window.startMs !== source.startMs || window.endMs > source.endMs) return false;
  if (indoor) {
    // Keep the existing exact-stat rule for paused treadmill/indoor-rowing copies.
    return incomingDuration === duration
      && Math.abs(window.endMs - window.startMs - duration * 1000) <= 1000;
  }
  // These two evidenced sport pairs can lose subsecond timer precision in Suunto.
  if (window.endMs <= window.startMs || Math.abs(incomingDuration - duration) > 1) return false;
  if (trail) return window.endMs === source.endMs;
  return source.endMs - window.endMs <= 1000
    && Math.abs(window.endMs - window.startMs - incomingDuration * 1000) <= 1000;
}
