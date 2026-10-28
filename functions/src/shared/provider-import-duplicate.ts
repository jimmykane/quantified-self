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
