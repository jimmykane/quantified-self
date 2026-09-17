import { createHash } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { WorkoutStructureV1 } from '../../../../../shared/planned-workout';
import { trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import { serializeWahooPlanJsonV1 } from '../../providers/wahoo-plan.serializer';
import { assessTrainingDeliveryMapping } from '../mapping';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import { TrainingDeliveryTransportError, type DeliveryAssessment } from '../contracts';

export const WAHOO_MAPPING_VERSION = 'wahoo-plans-v1';
export const WAHOO_DURATION_ISSUE = 'Wahoo delivery currently requires time-based steps throughout the workout. Distance-based steps cannot provide its required total duration.';
export function wahooIdentities(destination: string, workoutId: string) {
  const hash = createHash('sha256').update(JSON.stringify([destination, workoutId])).digest('base64url');
  return { externalId: `qs-plan-${hash}`, workoutToken: `qs-workout-${hash}` };
}
/** No estimates and no editor fields: repeats count total passes in the canonical recipe. */
export function wahooDurationSeconds(structure: WorkoutStructureV1): number | null {
  let total = 0;
  for (const node of structure.nodes) {
    for (const step of node.kind === 'step' ? [node] : node.steps) {
      if (step.ending.kind !== 'time') return null;
      total += step.ending.seconds * (node.kind === 'step' ? 1 : node.count);
    }
  }
  return Number.isFinite(total) && total > 0 ? total : null;
}
/** Date-only QS scheduling is represented at local noon (not UTC midnight).
 * day_code is optional and deliberately omitted: the public epoch statement and
 * examples disagree. Device/date semantics remain an explicit private-pilot check. */
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
export function assessWahooDelivery(workout: ScheduledWorkoutV1, destination: string, zone: string): DeliveryAssessment {
  const assessment = assessTrainingDeliveryMapping('wahoo', workout, destination, zone);
  const duration = wahooDurationSeconds(workout.structure);
  return { ...assessment, ...(duration === null ? { level: 'unsupported' as const, issues: [WAHOO_DURATION_ISSUE, ...assessment.issues].slice(0, 20) } : {}),
    mappingVersion: WAHOO_MAPPING_VERSION, digest: hashTrainingScheduleRequestPayload({ version: WAHOO_MAPPING_VERSION, digest: assessment.digest, duration }) };
}
export function wahooPlanBody(workout: ScheduledWorkoutV1, destination: string, create: boolean): string {
  const plan = serializeWahooPlanJsonV1(workout.structure, { name: workout.title, location: 'outdoor', allowDegraded: true }).artifact;
  return new URLSearchParams({ 'plan[file]': `data:application/json;base64,${Buffer.from(JSON.stringify(plan)).toString('base64')}`,
    'plan[filename]': 'plan.json', 'plan[provider_updated_at]': new Date(workout.updatedAtMs).toISOString(),
    ...(create ? { 'plan[external_id]': wahooIdentities(destination, workout.id).externalId } : {}) }).toString();
}
export function wahooWorkoutFields(workout: ScheduledWorkoutV1, destination: string, zone: string, planId: string) {
  const seconds = wahooDurationSeconds(workout.structure);
  if (seconds === null) throw new TrainingDeliveryTransportError('terminal');
  return { name: workout.title, workout_token: wahooIdentities(destination, workout.id).workoutToken,
    workout_type_id: workout.structure.sport === ActivityTypes.Cycling ? 0 : 1, starts: wahooStarts(workout.localDate, zone), minutes: seconds / 60, plan_id: planId };
}
export function wahooWorkoutBody(workout: ScheduledWorkoutV1, destination: string, zone: string, planId: string): string {
  return new URLSearchParams(Object.entries(wahooWorkoutFields(workout, destination, zone, planId))
    .map(([key, value]) => [`workout[${key}]`, String(value)])).toString();
}
