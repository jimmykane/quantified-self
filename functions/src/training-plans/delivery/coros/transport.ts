import { trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { serializeCorosTrainingPlanV1, type CorosTrainingPlanPushDataV1,
  type CorosTrainingWorkoutV1 } from '../../providers/coros-training-plan.serializer';
import { assessTrainingDeliveryMapping } from '../mapping';
import { TrainingDeliveryTransportError, type DeliveryArtifact, type DeliveryBatchOutcome,
  type DeliveryCheckpoint, type DeliveryOperation, type DeliveryRecovery, type DeliveryRequestGuard,
  type TrainingDeliveryBatchTransport, type TrainingDeliveryTransport } from '../contracts';
import { CorosTrainingHttpError, type CorosTrainingClient } from './http';

export const COROS_TRAINING_MAPPING_VERSION = 'coros-training-plan-v1';
const COROS_SUCCESS = '0000';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CorosTrainingHttpError('uncertain', false);
  return value as Record<string, unknown>;
}

function resultCode(value: unknown): string {
  const code = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!/^\d{4,5}$/.test(code)) throw new CorosTrainingHttpError('uncertain', false);
  return code;
}

function throwForProviderResult(value: unknown): never {
  const code = resultCode(object(value).result);
  if (code === '30009') throw new CorosTrainingHttpError('provider_access', true);
  if (code === '5006') throw new CorosTrainingHttpError('auth', true);
  if (code === '5001') throw new CorosTrainingHttpError('terminal', true);
  throw new CorosTrainingHttpError('terminal', true);
}

function acceptedDate(value: unknown): string {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value)
    : typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw);
  if (!match) throw new CorosTrainingHttpError('uncertain', false);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== date) throw new CorosTrainingHttpError('uncertain', false);
  return date;
}

function integerId(value: unknown): number | null {
  const normalized = typeof value === 'string' && /^[1-9]\d*$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(normalized) && Number(normalized) > 0 && Number(normalized) <= 2_147_483_647
    ? Number(normalized) : null;
}

function lastModifiedDate(workout: ScheduledWorkoutV1): string {
  if (!Number.isSafeInteger(workout.updatedAtMs) || workout.updatedAtMs < 0) throw new TrainingDeliveryTransportError('terminal');
  return new Date(workout.updatedAtMs).toISOString().slice(0, -1);
}

function corosIdentity(operation: DeliveryOperation): { athleteId: number; workoutId: number } {
  const athleteId = operation.providerIdentity?.athleteId;
  const workoutId = operation.providerIdentity?.workoutId;
  if (!Number.isSafeInteger(athleteId) || Number(athleteId) <= 0 || Number(athleteId) > 2_147_483_647
    || !Number.isSafeInteger(workoutId) || Number(workoutId) <= 0 || Number(workoutId) > 2_147_483_647) {
    throw new TrainingDeliveryTransportError('terminal');
  }
  return { athleteId: Number(athleteId), workoutId: Number(workoutId) };
}

function assertRetainedIdentity(operation: DeliveryOperation, identity: { athleteId: number; workoutId: number }): void {
  if (!operation.artifact) return;
  const retainedWorkoutId = integerId(operation.artifact.ids.workout);
  const retainedAthleteId = integerId(operation.artifact.ids.athlete);
  if (retainedWorkoutId !== identity.workoutId || retainedAthleteId !== identity.athleteId) {
    // Never update or withdraw a different provider object when retained
    // acceptance evidence and the stable identity mapping disagree.
    throw new TrainingDeliveryTransportError('terminal');
  }
}

function artifact(operation: DeliveryOperation): DeliveryArtifact {
  if (!operation.workout) throw new TrainingDeliveryTransportError('terminal');
  const identity = corosIdentity(operation);
  return { ids: { workout: String(identity.workoutId), athlete: String(identity.athleteId) },
    localDate: operation.workout.localDate, completed: false };
}

export class CorosTrainingTransport implements TrainingDeliveryTransport {
  readonly mappingVersion = COROS_TRAINING_MAPPING_VERSION;
  readonly horizonDays = 365;
  readonly batch: TrainingDeliveryBatchTransport;

  constructor(private readonly client: CorosTrainingClient, private readonly now = Date.now,
    reserveIdentities: TrainingDeliveryBatchTransport['reserveIdentities'] = async () => {
      throw new TrainingDeliveryTransportError('terminal');
    }) {
    this.batch = { maxSize: 30, reserveIdentities, execute: this.executeBatch.bind(this) };
  }

  assess(workout: ScheduledWorkoutV1, destinationKey: string, timeZone: string) {
    return assessTrainingDeliveryMapping('coros', workout, destinationKey, timeZone);
  }

  canRemove(remote: DeliveryArtifact, today: string): boolean {
    return !remote.completed && remote.localDate >= today;
  }

  async execute(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint,
    guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null> {
    void operation;
    void checkpoint;
    void guard;
    throw new TrainingDeliveryTransportError('terminal');
  }

  async recover(operation: DeliveryOperation): Promise<DeliveryRecovery> {
    return operation.progress === null ? { kind: 'not-accepted' } : { kind: 'uncertain' };
  }

  private validate(operations: readonly DeliveryOperation[]): 'upsert' | 'remove' {
    if (operations.length < 1 || operations.length > this.batch.maxSize) throw new TrainingDeliveryTransportError('terminal');
    const kind = operations[0].kind;
    const destination = operations[0].destinationKey;
    const connection = operations[0].connectionGeneration;
    const athlete = corosIdentity(operations[0]).athleteId;
    if (operations.some(operation => operation.kind !== kind || operation.destinationKey !== destination
      || operation.connectionGeneration !== connection
      || corosIdentity(operation).athleteId !== athlete)) throw new TrainingDeliveryTransportError('terminal');
    for (const operation of operations) assertRetainedIdentity(operation, corosIdentity(operation));
    if (new Set(operations.map(operation => corosIdentity(operation).workoutId)).size !== operations.length) {
      throw new TrainingDeliveryTransportError('terminal');
    }
    const today = trainingDeliveryLocalDate(this.now(), operations[0].timeZone);
    if (operations.some(operation => operation.timeZone !== operations[0].timeZone
      || (kind === 'upsert' && (!operation.workout || operation.workout.localDate < today
        || Date.parse(`${operation.workout.localDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > this.horizonDays * 86_400_000))
      || (kind === 'remove' && (!operation.artifact || !this.canRemove(operation.artifact, today))))) {
      throw new TrainingDeliveryTransportError('terminal');
    }
    return kind;
  }

  private pushPayload(operations: readonly DeliveryOperation[]): CorosTrainingPlanPushDataV1 {
    const workouts: CorosTrainingWorkoutV1[] = operations.map(operation => {
      const assessment = this.assess(operation.workout!, operation.destinationKey, operation.timeZone);
      if (assessment.level === 'unsupported' || assessment.digest !== operation.digest) throw new TrainingDeliveryTransportError('terminal');
      return serializeCorosTrainingPlanV1(operation.workout!.structure, {
        athleteId: corosIdentity(operation).athleteId,
        workoutId: corosIdentity(operation).workoutId,
        title: operation.workout!.title,
        localDate: operation.workout!.localDate,
        lastModifiedDate: lastModifiedDate(operation.workout!),
        allowDegraded: true,
      }).artifact.Workouts[0];
    });
    workouts.sort((left, right) => left.WorkoutDay.localeCompare(right.WorkoutDay) || left.Id - right.Id);
    const start = workouts[0].WorkoutDay;
    const end = workouts[workouts.length - 1].WorkoutDay;
    if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 > 365) {
      throw new TrainingDeliveryTransportError('terminal');
    }
    return { AthleteId: corosIdentity(operations[0]).athleteId, StartDate: start, EndDate: end, Workouts: workouts };
  }

  private async executeBatch(operations: readonly DeliveryOperation[], beforeSend: () => Promise<void>,
    guard: DeliveryRequestGuard): Promise<readonly DeliveryBatchOutcome[]> {
    let kind: 'upsert' | 'remove';
    try { kind = this.validate(operations); }
    catch { throw new CorosTrainingHttpError('terminal', true); }
    await guard(true);
    if (kind === 'upsert') {
      let payload: CorosTrainingPlanPushDataV1;
      try { payload = this.pushPayload(operations); }
      catch { throw new CorosTrainingHttpError('terminal', true); }
      const response = await this.client({ path: '/coros/tp/list/push', data: JSON.stringify(payload) }, beforeSend);
      const envelope = object(response.body);
      if (resultCode(envelope.result) !== COROS_SUCCESS) throwForProviderResult(envelope);
      const data = object(envelope.data);
      const start = acceptedDate(data.StartDate ?? data.startDate);
      const end = acceptedDate(data.EndDate ?? data.endDate);
      if (start > payload.StartDate || end < payload.EndDate) throw new CorosTrainingHttpError('uncertain', false);
      return operations.map(operation => ({ operationId: operation.id, state: 'accepted' as const, artifact: artifact(operation) }));
    }

    const submitted = new Map(operations.map(operation => [corosIdentity(operation).workoutId, operation]));
    const response = await this.client({ path: '/coros/tp/workout/deleteById',
      workoutIds: JSON.stringify([...submitted.keys()]) }, beforeSend);
    const envelope = object(response.body);
    if (resultCode(envelope.result) !== COROS_SUCCESS) throwForProviderResult(envelope);
    const data = object(envelope.data);
    if (!Array.isArray(data.successIdList) || !Array.isArray(data.failIdList)
      || data.successIdList.length > 30 || data.failIdList.length > 30) throw new CorosTrainingHttpError('uncertain', false);
    const successes = data.successIdList.map(integerId);
    const failures = data.failIdList.map(integerId);
    if (successes.some(value => value === null) || failures.some(value => value === null)) {
      throw new CorosTrainingHttpError('uncertain', false);
    }
    if ([...successes, ...failures].some(value => !submitted.has(value!))) {
      throw new CorosTrainingHttpError('uncertain', false);
    }
    return operations.map(operation => {
      const id = corosIdentity(operation).workoutId;
      const successCount = successes.filter(value => value === id).length;
      const failureCount = failures.filter(value => value === id).length;
      return { operationId: operation.id,
        state: successCount === 1 && failureCount === 0 ? 'accepted' as const
          : failureCount === 1 && successCount === 0 ? 'rejected' as const : 'unresolved' as const,
        artifact: successCount === 1 && failureCount === 0 ? null : operation.artifact };
    });
  }
}
