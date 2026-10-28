import { readFITWorkoutReferences, type FITWahooWorkoutReference } from '@sports-alliance/sports-lib';
import type { FITActivityReference } from '../suunto/guide-completion';

/** File-scoped identity only. Sports Lib owns decoding; QS proves that the
 * single recorded session is the single activity persisted by this import. */
export function readWahooFITTrainingReference(
  input: ArrayBuffer | Uint8Array,
  activities: readonly FITActivityReference[],
): FITWahooWorkoutReference | null {
  if (activities.length !== 1) return null;
  const activity = activities[0];
  if (!activity.id || activity.id.length > 1500 || activity.id.includes('/')
    || !Number.isSafeInteger(activity.startTimeMs) || activity.startTimeMs! < 0) return null;
  try {
    const evidence = readFITWorkoutReferences(input);
    if (evidence.status !== 'ok' || evidence.wahooWorkouts.length !== 1 || evidence.sessions.length !== 1) return null;
    const reference = evidence.wahooWorkouts[0];
    return reference.startTimeUnixMs === evidence.sessions[0].startTimeUnixMs
      && reference.startTimeUnixMs === activity.startTimeMs ? reference : null;
  } catch {
    // Optional source metadata must not prevent the recorded activity import.
    return null;
  }
}
