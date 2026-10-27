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
export function isGarminIndoorActivityCopy(saved: ActivityIdentityLike, incoming: ActivityIdentityLike): boolean {
  const source = readActivitySourceIdentity(saved.sourceIdentity, saved.getID?.());
  if (!source || !((source.importedType === 'Treadmill' && incoming.type === 'Running')
    || (source.importedType === 'Indoor Rowing' && incoming.type === 'Rowing'))) return false;
  const duration = finiteStat(saved, 'Duration'), distance = finiteStat(saved, 'Distance');
  const window = getActivitySourceWindow(incoming);
  return duration !== null && duration > 0 && distance !== null && distance >= 0
    && finiteStat(incoming, 'Duration') === duration && finiteStat(incoming, 'Distance') === distance
    && window !== null && window.startMs === source.startMs && window.endMs <= source.endMs
    // Suunto's generic copy ends at active time, rounded to whole seconds;
    // Garmin's retained elapsed window can additionally include pauses.
    && Math.abs(window.endMs - window.startMs - duration * 1000) <= 1000;
}
