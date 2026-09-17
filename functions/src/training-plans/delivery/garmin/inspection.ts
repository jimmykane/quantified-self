import { isAuthoritativeAbsenceKey, type InspectionPolicy, type RemoteInspection } from '../verification-contracts';
import { garminId, type GarminTrainingClient } from './http';
import { normalizeTrainingLocalDate } from '../../../../../shared/training-plans';

/** The controlled #703 deletion check proved an exact retained Schedule 404 after
 * user deletion while the retained Workout remained present. Workout absence and
 * replacement remain unproved. This policy is not browser/config selectable. */
export const GARMIN_INSPECTION_POLICY: InspectionPolicy = {
  version: 'garmin-retained-v2-schedule-repair', mode: 'retained-ids', required: ['workout', 'schedule'],
  confirmationDelayMs: 15 * 60_000, authoritativeAbsenceKeys: ['schedule'], repairReadyKeys: ['schedule'],
};
export function createGarminInspection(client: GarminTrainingClient, policy = GARMIN_INSPECTION_POLICY): RemoteInspection {
  return { policy, async inspect(request, guard) {
    const artifacts: Awaited<ReturnType<RemoteInspection['inspect']>>['artifacts'] = [];
    let conflict = false;
    for (const key of policy.required) {
      const id = request.artifact.ids[key];
      if (!id) { artifacts.push({ key, state: 'unknown', authoritative: false }); continue; }
      await guard(false);
      const response = await client({ method: 'GET', path: key === 'workout'
        ? `/training-api/workout/v2/${garminId(id)}` : `/training-api/schedule/${garminId(id)}` }, () => guard(false));
      if (response.status === 404) {
        artifacts.push({ key, state: 'absent', authoritative: isAuthoritativeAbsenceKey(policy, key) }); continue;
      }
      const raw = response.body;
      if (response.status !== 200 || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
        artifacts.push({ key, state: 'unknown', authoritative: false }); continue;
      }
      const data = raw as Record<string, unknown>;
      try {
        if (key === 'workout') {
          garminId(data.ownerId);
          if (typeof data.workoutProvider !== 'string' || typeof data.workoutSourceId !== 'string') {
            artifacts.push({ key, state: 'unknown', authoritative: false }); continue;
          }
        } else normalizeTrainingLocalDate(data.date);
        const valid = key === 'workout' ? garminId(data.workoutId) === id
          && (!request.artifact.ids.owner || garminId(data.ownerId) === request.artifact.ids.owner)
          && data.workoutProvider === 'Quantified Self' && data.workoutSourceId === 'Quantified Self'
          : garminId(data.scheduleId) === id && garminId(data.workoutId) === request.artifact.ids.workout
            && data.date === request.artifact.localDate;
        conflict ||= !valid;
        artifacts.push({ key, state: valid ? 'present' : 'unknown', authoritative: valid });
      } catch {
        // Missing/malformed identity fields are not a proven conflicting identity.
        artifacts.push({ key, state: 'unknown', authoritative: false });
      }
    }
    return { artifacts, conflict };
  } };
}
