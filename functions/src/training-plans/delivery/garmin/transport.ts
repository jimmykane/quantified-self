import { trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import { normalizeTrainingLocalDate, type ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { serializeGarminWorkoutV1 } from '../../providers/garmin-workout.serializer';
import { assessTrainingDeliveryMapping } from '../mapping';
import { TrainingDeliveryTransportError, type DeliveryArtifact, type DeliveryCheckpoint, type DeliveryOperation,
  type DeliveryRecovery, type DeliveryRequestGuard, type DeliveryTransportProgress, type TrainingDeliveryTransport } from '../contracts';
import { GarminTrainingHttpError, garminBody, garminId, type GarminTrainingClient, type GarminTrainingRequest, type GarminTrainingResponse } from './http';
import { createGarminInspection, GARMIN_INSPECTION_POLICY } from './inspection';
import { canRepairMissingArtifacts, type InspectionPolicy, type RemoteInspection } from '../verification-contracts';
import { garminContractFailure, logGarminScheduleConfirmation, logGarminScheduleLookup, logGarminTrainingRequestFailure, logGarminTrainingResponse } from './diagnostics';

const STEPS = ['repair-prepare', 'workout-create', 'workout-update', 'schedule-create', 'schedule-update', 'schedule-delete', 'workout-delete',
  'retired-schedule-delete', 'retired-workout-delete', 'finished'] as const;
type Step = typeof STEPS[number];
type ObjectValue = Record<string, unknown>;
type ScheduleValue = { id: string; workoutId: string; date: string };
type ScheduleLookup = { state: 'matched'; value: ScheduleValue } | { state: 'none' | 'inconclusive' };
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw garminContractFailure('expected_object');
  return value as ObjectValue;
}
function schedule(value: unknown): ScheduleValue {
  const data = object(value);
  try { return { id: garminId(data.scheduleId), workoutId: garminId(data.workoutId), date: normalizeTrainingLocalDate(data.date) }; }
  catch { throw garminContractFailure('invalid_schedule'); }
}
function matches(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, i) => matches(value, actual[i]));
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => matches(value, (actual as ObjectValue)[key]));
  return expected === actual;
}

/** Training API V2 adapter. Production availability is restricted by the pilot gate.
 * No external create key or workout-list endpoint is invented: a lost first-create ID
 * is deliberately unrecoverable automatically. QS identity lives in the private ledger. */
export class GarminTrainingTransport implements TrainingDeliveryTransport {
  readonly mappingVersion = 'fixtures-v1';
  /** QS delivery policy, not an asserted Garmin API maximum. Confirm under #645. */
  readonly horizonDays = 365;
  readonly inspection: RemoteInspection;
  constructor(private readonly client: GarminTrainingClient, private readonly now: () => number = Date.now,
    inspectionPolicy: InspectionPolicy = GARMIN_INSPECTION_POLICY) {
    this.inspection = createGarminInspection(client, inspectionPolicy);
  }
  assess(workout: ScheduledWorkoutV1, destinationKey: string, timeZone: string) {
    return assessTrainingDeliveryMapping('garmin', workout, destinationKey, timeZone);
  }
  canRemove(artifact: DeliveryArtifact, today: string): boolean { return !artifact.completed && artifact.localDate >= today; }

  private validate(operation: DeliveryOperation): void {
    const progress = operation.progress;
    if (progress && (progress.version !== 1 || !STEPS.includes(progress.step as Step)
      || !['ready', 'started', 'rejected', 'accepted'].includes(progress.state))) throw new TrainingDeliveryTransportError('uncertain');
    if (operation.artifact) {
      const keys = Object.keys(operation.artifact.ids);
      if (!keys.includes('workout') || keys.some(key => !['workout', 'schedule', 'owner'].includes(key))) throw new TrainingDeliveryTransportError('uncertain');
      keys.forEach(key => garminId(operation.artifact!.ids[key]));
    }
  }
  private async save(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, artifact: DeliveryArtifact | null,
    step: Step, state: DeliveryTransportProgress['state'], repairApplied?: boolean): Promise<void> {
    const progress: DeliveryTransportProgress = { version: 1, step, state, ...(repairApplied === undefined ? {} : { repairApplied }) };
    await checkpoint(artifact, progress);
    // Mutate in-memory state only after the journal is durable. This also makes the
    // adapter usable with a checkpoint implementation that does not mutate its argument.
    operation.artifact = artifact;
    operation.progress = progress;
  }
  private async read(request: GarminTrainingRequest, guard: DeliveryRequestGuard): Promise<unknown | null> {
    await guard(false);
    const result = await this.request(request, () => guard(false));
    if (result.status === 404) return null;
    if (result.status !== 200 || result.body === null || result.body === undefined) throw garminContractFailure('empty_lookup');
    return result.body;
  }
  private async request(request: GarminTrainingRequest, beforeSend: () => Promise<void>): Promise<GarminTrainingResponse> {
    try {
      const response = await this.client(request, beforeSend);
      logGarminTrainingResponse(request, response);
      return response;
    } catch (error) { logGarminTrainingRequestFailure(request, error); throw error; }
  }
  private async write(operation: DeliveryOperation, step: Step, request: GarminTrainingRequest,
    checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<GarminTrainingResponse> {
    await this.save(operation, checkpoint, operation.artifact, step, 'ready');
    await guard(true);
    try {
      const result = await this.request(request, async () => {
        await guard(true);
        await this.save(operation, checkpoint, operation.artifact, step, 'started');
        // Token refresh and the journal transaction may take time. Recheck immediately
        // before fetch, including Stop, Pro loss, deletion, date rollover and lease expiry.
        try { await guard(true); }
        catch (error) {
          // No request has started: if this journal succeeds, a later recovery may
          // safely retire or retry the operation instead of guessing about a POST.
          await this.save(operation, checkpoint, operation.artifact, step, 'rejected');
          throw error;
        }
      });
      return result;
    } catch (error) {
      if (error instanceof GarminTrainingHttpError && error.rejected) {
        await this.save(operation, checkpoint, operation.artifact, step, 'rejected');
      }
      throw error;
    }
  }
  private assertFuture(operation: DeliveryOperation): void {
    const today = trainingDeliveryLocalDate(this.now(), operation.timeZone);
    if ((operation.artifact && !this.canRemove(operation.artifact, today))
      || (operation.repair && !this.canRemove(operation.repair.original, today))
      || (operation.kind === 'upsert' && (!operation.workout || operation.workout.localDate < today))) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
  }
  private async ownedWorkout(operation: DeliveryOperation, guard: DeliveryRequestGuard): Promise<ObjectValue | null> {
    const artifact = operation.artifact!;
    const raw = await this.read({ method: 'GET', path: `/training-api/workout/v2/${garminId(artifact.ids.workout)}` }, guard);
    if (raw === null) return null;
    const value = object(raw);
    if (garminId(value.workoutId) !== artifact.ids.workout || (artifact.ids.owner && garminId(value.ownerId) !== artifact.ids.owner)
      || value.workoutProvider !== 'Quantified Self' || value.workoutSourceId !== 'Quantified Self') throw garminContractFailure('workout_identity_mismatch');
    garminId(value.ownerId);
    return value;
  }
  private async ownedSchedule(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint,
    guard: DeliveryRequestGuard): Promise<ReturnType<typeof schedule> | null> {
    const artifact = operation.artifact!;
    const raw = await this.read({ method: 'GET', path: `/training-api/schedule/${garminId(artifact.ids.schedule)}` }, guard);
    if (raw === null) return null;
    const value = schedule(raw);
    const relinking = operation.repair && operation.repair.original.ids.schedule === value.id
      && operation.repair.original.ids.workout === value.workoutId && operation.repair.original.localDate === value.date;
    if (value.id !== artifact.ids.schedule || (value.workoutId !== artifact.ids.workout && !relinking)) throw garminContractFailure('schedule_identity_mismatch');
    if (value.date < trainingDeliveryLocalDate(this.now(), operation.timeZone)) {
      // Retain the provider-observed past date so reconciliation cannot remove or
      // rewrite a copy that was moved into the past outside QS.
      await checkpoint({ ...artifact, localDate: value.date });
      throw new TrainingDeliveryTransportError('uncertain');
    }
    return value;
  }

  private async confirmRetainedSchedule(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint,
    guard: DeliveryRequestGuard): Promise<ReturnType<typeof schedule>> {
    const found = await this.ownedSchedule(operation, checkpoint, guard);
    if (!found) throw garminContractFailure('empty_lookup');
    if (found.workoutId !== operation.artifact!.ids.workout || found.date !== operation.workout?.localDate) {
      throw garminContractFailure('schedule_identity_mismatch');
    }
    logGarminScheduleConfirmation('verified');
    return found;
  }

  private async lookupScheduleForWorkoutDate(operation: DeliveryOperation, guard: DeliveryRequestGuard): Promise<ScheduleLookup> {
    if (!operation.workout || !operation.artifact) return { state: 'inconclusive' };
    const date = normalizeTrainingLocalDate(operation.workout.localDate);
    const rows = await this.read({ method: 'GET', path: `/training-api/schedule?startDate=${date}&endDate=${date}` }, guard);
    if (!Array.isArray(rows) || rows.length > 1000) {
      logGarminScheduleLookup(Array.isArray(rows) ? 'too_many_results' : 'invalid_response');
      return { state: 'inconclusive' };
    }
    const candidates = rows.map(schedule).filter(row => row.workoutId === operation.artifact!.ids.workout && row.date === date);
    const state = candidates.length === 1 ? 'matched' : candidates.length === 0 ? 'none' : 'inconclusive';
    logGarminScheduleLookup(candidates.length === 1 ? 'matched' : candidates.length === 0 ? 'no_match' : 'multiple_matches');
    return state === 'matched' ? { state, value: candidates[0] } : { state };
  }

  async execute(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null> {
    this.validate(operation);
    this.assertFuture(operation);
    if (operation.progress === undefined || operation.progress?.state === 'started') throw new TrainingDeliveryTransportError('uncertain');
    if (operation.kind === 'remove') return this.remove(operation, checkpoint, guard);
    if (operation.repair?.continuation && (!operation.artifact?.ids.workout
      || !canRepairMissingArtifacts(this.inspection.policy, operation.repair.missing))) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    if (operation.repair && !operation.repair.continuation && (operation.progress === null || !operation.artifact)) {
      const repair = operation.repair;
      if (!canRepairMissingArtifacts(this.inspection.policy, repair.missing)
        || repair.policyVersion !== this.inspection.policy.version) throw new TrainingDeliveryTransportError('uncertain');
      const original = operation.artifact ?? repair.original;
      const observation = await this.inspection.inspect({ destinationKey: operation.destinationKey,
        connectionGeneration: operation.connectionGeneration, artifact: original,
        timeZone: operation.timeZone, cursor: null }, guard);
      if (observation.conflict || observation.artifacts.some(item => item.state === 'unknown')) throw new TrainingDeliveryTransportError('uncertain');
      if (observation.artifacts.every(item => item.state === 'present')) {
        await guard(true);
        await this.save(operation, checkpoint, original, 'finished', 'accepted', false);
        return original;
      }
      const missing = observation.artifacts.filter(item => item.state === 'absent' && item.authoritative).map(item => item.key).sort();
      if (JSON.stringify(missing) !== JSON.stringify([...repair.missing].sort())) throw new TrainingDeliveryTransportError('uncertain');
      const ids = { ...original.ids };
      delete ids.schedule;
      await this.save(operation, checkpoint, missing.includes('workout') ? null : { ...original, ids }, 'repair-prepare', 'ready');
    }
    const workout = operation.workout!;
    // The shared worker binds approval to the exact assessment digest. Rechecking here
    // prevents an adapter/serializer version mismatch from silently changing the payload.
    const assessment = this.assess(workout, operation.destinationKey, operation.timeZone);
    if (assessment.digest !== operation.digest || assessment.level === 'unsupported') throw new TrainingDeliveryTransportError('terminal');
    const payload = serializeGarminWorkoutV1(workout.structure, { name: workout.title, allowDegraded: true }).artifact;
    let currentSchedule: ReturnType<typeof schedule> | null = null;
    if (operation.artifact?.ids.schedule) currentSchedule = await this.ownedSchedule(operation, checkpoint, guard);
    if (operation.artifact) {
      const existing = await this.ownedWorkout(operation, guard);
      // A removed/replaced remote workout requires explicit reconciliation, not a
      // replacement POST that could duplicate an eventually-consistent provider copy.
      if (!existing) throw new TrainingDeliveryTransportError('uncertain');
      const owner = garminId(existing.ownerId);
      const artifact: DeliveryArtifact = { ...operation.artifact, ids: { ...operation.artifact.ids, owner } };
      await checkpoint(artifact); operation.artifact = artifact;
      if ((!operation.repair || operation.repair.continuation) && !matches(payload, existing)) {
        await this.write(operation, 'workout-update', { method: 'PUT', path: `/training-api/workout/v2/${artifact.ids.workout}`,
          body: garminBody(payload as unknown as ObjectValue, { workoutId: artifact.ids.workout, ownerId: owner }) }, checkpoint, guard);
      }
      await this.save(operation, checkpoint, artifact, 'workout-update', 'accepted');
    } else {
      const raw = await this.write(operation, 'workout-create', { method: 'POST', path: '/workoutportal/workout/v2',
        body: garminBody(payload as unknown as ObjectValue) }, checkpoint, guard);
      const created = object(raw.body);
      let ids: Record<string, string>;
      try { ids = { workout: garminId(created.workoutId) }; }
      catch { throw garminContractFailure('invalid_workout_identity'); }
      // Save an accepted workout ID even when the response omitted the owner needed
      // by future PUTs; GET can recover the owner without ever repeating this POST.
      await this.save(operation, checkpoint, { ids, localDate: workout.localDate, completed: false }, 'workout-create', 'accepted');
      if (created.ownerId !== undefined) {
        const artifact = { ...operation.artifact!, ids: { ...ids, owner: garminId(created.ownerId) } };
        await checkpoint(artifact); operation.artifact = artifact;
      }
    }
    this.assertFuture(operation);
    // A surviving calendar entry can be relinked to the replacement workout only
    // after rechecking its retained identity, old association and unchanged date.
    if (operation.repair && !operation.artifact!.ids.schedule) {
      const previous = operation.repair.original;
      const raw = await this.read({ method: 'GET', path: `/training-api/schedule/${garminId(previous.ids.schedule)}` }, guard);
      if (!raw) {
        if (!operation.repair.missing.includes('schedule')) throw new TrainingDeliveryTransportError('uncertain');
        // The user may have recreated the same association in Garmin under a new
        // Schedule ID. Positive discovery is safe to adopt and prevents a duplicate;
        // an empty or ambiguous listing never proves anything about a prior POST.
        const replacement = await this.lookupScheduleForWorkoutDate(operation, guard);
        if (replacement.state === 'inconclusive') throw new TrainingDeliveryTransportError('uncertain');
        if (replacement.state === 'matched') {
          const relink = { ...operation.artifact!, ids: { ...operation.artifact!.ids, schedule: replacement.value.id },
            localDate: replacement.value.date };
          await guard(true);
          await this.save(operation, checkpoint, relink, 'finished', 'accepted', false);
          return relink;
        }
      } else {
        const found = schedule(raw);
        if (found.id !== previous.ids.schedule || found.workoutId !== previous.ids.workout || found.date !== previous.localDate) {
          throw new TrainingDeliveryTransportError('uncertain');
        }
        // A previously missing schedule may reappear before a rejected POST is retried.
        // Reuse that exact association instead of creating a duplicate calendar entry.
        const relink = { ...operation.artifact!, ids: { ...operation.artifact!.ids, schedule: found.id } };
        await checkpoint(relink); operation.artifact = relink; currentSchedule = found;
      }
    }
    const artifact = operation.artifact!;
    if (artifact.ids.schedule && !currentSchedule) throw new TrainingDeliveryTransportError('uncertain');
    if (currentSchedule?.date !== workout.localDate || currentSchedule?.workoutId !== artifact.ids.workout) {
      const step = artifact.ids.schedule ? 'schedule-update' : 'schedule-create';
      const result = await this.write(operation, step, {
        method: artifact.ids.schedule ? 'PUT' : 'POST',
        path: artifact.ids.schedule ? `/training-api/schedule/${artifact.ids.schedule}` : '/training-api/schedule/',
        body: garminBody({ date: workout.localDate }, { workoutId: artifact.ids.workout,
          ...(artifact.ids.schedule ? { scheduleId: artifact.ids.schedule } : {}) }),
      }, checkpoint, guard);
      if (result.status === 200 && (typeof result.body === 'number' || typeof result.body === 'string')) {
        // Production Garmin also returns the schedule ID alone. Retain this receipt
        // before inspecting its association, without advancing the started journal.
        // An interrupted GET must never cause another POST or lose the accepted ID.
        let id: string;
        try { id = garminId(result.body); }
        catch { throw garminContractFailure('invalid_schedule'); }
        if (artifact.ids.schedule && id !== artifact.ids.schedule) throw garminContractFailure('schedule_identity_mismatch');
        const retained = { ...artifact, ids: { ...artifact.ids, schedule: id } };
        await checkpoint(retained); operation.artifact = retained;
        logGarminScheduleConfirmation('id_retained');
        const found = await this.confirmRetainedSchedule(operation, checkpoint, guard);
        await this.save(operation, checkpoint, { ...retained, localDate: found.date }, step, 'accepted');
      } else if (result.status === 204 && !artifact.ids.schedule) {
        // Garmin documents empty successful schedule creates. Inspect immediately,
        // never repeat this POST or mark delivery complete without an exact identity.
        if (!await this.recoverCreatedSchedule(operation, checkpoint, guard)) throw new TrainingDeliveryTransportError('uncertain');
      } else {
        // Update permits an empty 204; its known schedule ID remains authoritative.
        const saved = result.status === 204 && artifact.ids.schedule
          ? { id: artifact.ids.schedule, workoutId: artifact.ids.workout, date: workout.localDate } : schedule(result.body);
        if (saved.workoutId !== artifact.ids.workout || saved.date !== workout.localDate
          || (artifact.ids.schedule && saved.id !== artifact.ids.schedule)) throw garminContractFailure('schedule_identity_mismatch');
        await this.save(operation, checkpoint, { ...artifact, ids: { ...artifact.ids, schedule: saved.id }, localDate: saved.date }, step, 'accepted');
      }
    }
    const repairApplied = operation.repair ? operation.artifact!.ids.workout !== operation.repair.original.ids.workout
      || operation.artifact!.ids.schedule !== operation.repair.original.ids.schedule : undefined;
    if (repairApplied === false) await guard(true);
    await this.save(operation, checkpoint, operation.artifact, 'finished', 'accepted', repairApplied);
    return operation.artifact;
  }

  private async recoverCreatedSchedule(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint,
    guard: DeliveryRequestGuard): Promise<boolean> {
    if (!operation.workout || !operation.artifact) return false;
    if (operation.artifact.ids.schedule) {
      // A scalar acknowledgement already supplied the identity. Never replace it
      // with an inventory candidate when its exact lookup is missing or conflicting.
      const found = await this.confirmRetainedSchedule(operation, checkpoint, guard);
      await this.save(operation, checkpoint, { ...operation.artifact, localDate: found.date }, 'schedule-create', 'accepted');
      return true;
    }
    const lookup = await this.lookupScheduleForWorkoutDate(operation, guard);
    // An empty eventually-consistent read is not proof a POST failed.
    if (lookup.state !== 'matched') return false;
    await this.save(operation, checkpoint, { ...operation.artifact,
      ids: { ...operation.artifact.ids, schedule: lookup.value.id }, localDate: lookup.value.date }, 'schedule-create', 'accepted');
    return true;
  }

  private async retiredArtifactExists(operation: DeliveryOperation, step: 'retired-schedule-delete' | 'retired-workout-delete',
    guard: DeliveryRequestGuard): Promise<boolean> {
    if (operation.kind !== 'remove' || !operation.repair) throw new TrainingDeliveryTransportError('uncertain');
    this.assertFuture(operation);
    const original = operation.repair.original;
    if (step === 'retired-workout-delete') return !!await this.ownedWorkout({ ...operation, artifact: original }, guard);
    const raw = await this.read({ method: 'GET', path: `/training-api/schedule/${garminId(original.ids.schedule)}` }, guard);
    if (raw === null) return false;
    const found = schedule(raw);
    if (found.id !== original.ids.schedule || found.workoutId !== original.ids.workout || found.date !== original.localDate) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    return true;
  }

  private async remove(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<null> {
    // An interrupted repair can own both the replacement and surviving original
    // artifacts. Withdraw the original-only IDs too, retaining them across retries.
    if (operation.repair) {
      for (const key of ['schedule', 'workout'] as const) {
        const id = operation.repair.original.ids[key];
        if (!id || id === operation.artifact?.ids[key]) continue;
        const step = key === 'schedule' ? 'retired-schedule-delete' : 'retired-workout-delete';
        if (await this.retiredArtifactExists(operation, step, guard)) {
          await this.write(operation, step, { method: 'DELETE', path: key === 'schedule'
            ? `/training-api/schedule/${garminId(id)}` : `/training-api/workout/v2/${garminId(id)}` }, checkpoint, guard);
        }
        await this.save(operation, checkpoint, operation.artifact, step, 'accepted');
      }
    }
    if (!operation.artifact) { await this.save(operation, checkpoint, null, 'finished', 'accepted'); return null; }
    if (operation.artifact.ids.schedule) {
      const existing = await this.ownedSchedule(operation, checkpoint, guard);
      if (existing) await this.write(operation, 'schedule-delete', { method: 'DELETE', path: `/training-api/schedule/${existing.id}` }, checkpoint, guard);
      const ids = { ...operation.artifact.ids };
      delete ids.schedule;
      await this.save(operation, checkpoint, { ...operation.artifact, ids }, 'schedule-delete', 'accepted');
    }
    const existing = await this.ownedWorkout(operation, guard);
    if (existing) await this.write(operation, 'workout-delete', { method: 'DELETE', path: `/training-api/workout/v2/${operation.artifact!.ids.workout}` }, checkpoint, guard);
    await this.save(operation, checkpoint, null, 'finished', 'accepted');
    return null;
  }

  async recover(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryRecovery> {
    this.validate(operation);
    const progress = operation.progress;
    if (progress === undefined) return { kind: 'uncertain' };
    if (progress === null) return { kind: 'not-accepted' };
    if (progress.step === 'finished' && progress.state === 'accepted') return { kind: 'accepted', artifact: operation.artifact };
    if (progress.state !== 'started') return { kind: operation.artifact ? 'resume' : 'not-accepted' };
    if (progress.step === 'retired-schedule-delete' || progress.step === 'retired-workout-delete') {
      // Only repeat a retained-ID DELETE after an ownership/date-checked read.
      await this.retiredArtifactExists(operation, progress.step, guard);
      await this.save(operation, checkpoint, operation.artifact, progress.step, 'ready');
      return { kind: 'resume' };
    }
    // The contract has no lookup by stable external workout key. Never search by title
    // or guess IDs, and never repeat a POST whose acceptance is unknown.
    if (progress.step === 'workout-create') return { kind: 'uncertain' };
    if (!operation.artifact) return { kind: 'uncertain' };
    if (progress.step === 'schedule-create') {
      if (!await this.recoverCreatedSchedule(operation, checkpoint, guard)) return { kind: 'uncertain' };
      return { kind: 'resume' };
    }
    if (progress.step === 'schedule-delete' || progress.step === 'schedule-update') {
      if (!operation.artifact.ids.schedule) return { kind: 'uncertain' };
      const found = await this.ownedSchedule(operation, checkpoint, guard);
      if (!found && progress.step === 'schedule-update') return { kind: 'uncertain' };
      if (!found) {
        const ids = { ...operation.artifact.ids };
        delete ids.schedule;
        await this.save(operation, checkpoint, { ...operation.artifact, ids }, 'schedule-delete', 'accepted');
      } else {
        // PUT/DELETE operate on an inspected, retained ID, never on a new create key.
        await this.save(operation, checkpoint, { ...operation.artifact, localDate: found.date }, progress.step as Step, 'ready');
      }
      return { kind: 'resume' };
    }
    const found = await this.ownedWorkout(operation, guard);
    if (!found && progress.step !== 'workout-delete') return { kind: 'uncertain' };
    if (!found) {
      await this.save(operation, checkpoint, null, 'finished', 'accepted');
      return { kind: 'accepted', artifact: null };
    }
    await this.save(operation, checkpoint, operation.artifact, progress.step as Step, 'ready');
    return { kind: 'resume' };
  }
}
