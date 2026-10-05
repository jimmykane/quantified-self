import { wahooDurationSeconds, wahooWorkoutSportProfileV1 } from '../../../../../shared/wahoo-workout-sports';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { StrengthWorkoutDetailsV1 } from '../../../../../shared/strength-workout';
import { trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import { assessTrainingDeliveryMapping, wahooWorkoutMapping } from '../mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import { TrainingDeliveryTransportError, type DeliveryAssessment } from '../contracts';
import { wahooIdentities } from './identity';
export { wahooIdentities } from './identity';

export const WAHOO_MAPPING_VERSION = 'wahoo-plans-v4';
export { wahooDurationSeconds };
export const WAHOO_DURATION_ISSUE = 'Wahoo delivery requires time-based steps throughout. QS does not estimate the required duration from distance, work, repetitions or manual transitions.';
/** Date-only QS scheduling is represented at local noon (not UTC midnight).
 * day_code is optional and deliberately omitted: the public epoch statement and
 * examples disagree. Post-release observation must keep checking the resulting
 * saved-time-zone calendar date without claiming a device receipt. */
export function wahooStarts(localDate: string, zone: string): string {
  const nominal = Date.parse(`${localDate}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let candidate = nominal;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const adjustment = nominal - wall;
    if (!adjustment) return new Date(candidate).toISOString();
    candidate += adjustment;
  }
  throw new TrainingDeliveryTransportError('terminal');
}
export function wahooWorkoutDate(starts: unknown, zone: string): string {
  if (typeof starts !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(starts) || !Number.isFinite(Date.parse(starts))) {
    throw new TrainingDeliveryTransportError('uncertain');
  }
  return trainingDeliveryLocalDate(Date.parse(starts), zone);
}
export function assessWahooDelivery(workout: ScheduledWorkoutV1, destination: string, zone: string,
  strength?: StrengthWorkoutDetailsV1 | null): DeliveryAssessment {
  const assessment = assessTrainingDeliveryMapping('wahoo', workout, destination, zone, strength);
  const duration = wahooDurationSeconds(workout.structure);
  return { ...assessment, ...(duration === null ? { level: 'unsupported' as const, issues: [WAHOO_DURATION_ISSUE, ...assessment.issues].slice(0, 20) } : {}),
    mappingVersion: WAHOO_MAPPING_VERSION, digest: hashTrainingScheduleRequestPayload({ version: WAHOO_MAPPING_VERSION, digest: assessment.digest, duration }) };
}
export function wahooPlanBody(workout: ScheduledWorkoutV1, destination: string, create: boolean,
  strength?: StrengthWorkoutDetailsV1 | null, generation = 0): string {
  // Wahoo's published plan.json schema marks description optional, but its
  // production Plan validator rejects files without it. Scheduled workouts do
  // not have a separate description: interval sports use the bounded title,
  // while Gym uses the explicit instruction-only limitation.
  const plan = wahooWorkoutMapping(workout, strength).artifact;
  return new URLSearchParams({ 'plan[file]': `data:application/json;base64,${Buffer.from(JSON.stringify(plan)).toString('base64')}`,
    'plan[filename]': 'plan.json', 'plan[provider_updated_at]': new Date(workout.updatedAtMs).toISOString(),
    ...(create ? { 'plan[external_id]': wahooIdentities(destination, workout.id, generation).externalId } : {}) }).toString();
}
export function wahooWorkoutFields(workout: ScheduledWorkoutV1, destination: string, zone: string, planId: string) {
  const seconds = wahooDurationSeconds(workout.structure);
  if (seconds === null) throw new TrainingDeliveryTransportError('terminal');
  const profile = wahooWorkoutSportProfileV1(workout.structure.sport);
  if (!profile) throw new TrainingDeliveryTransportError('terminal');
  return { name: workout.title, workout_token: wahooIdentities(destination, workout.id).workoutToken,
    workout_type_id: profile.workoutType, starts: wahooStarts(workout.localDate, zone), minutes: seconds / 60, plan_id: planId };
}
export function wahooWorkoutBody(workout: ScheduledWorkoutV1, destination: string, zone: string, planId: string): string {
  return new URLSearchParams(Object.entries(wahooWorkoutFields(workout, destination, zone, planId))
    .map(([key, value]) => [`workout[${key}]`, String(value)])).toString();
}
