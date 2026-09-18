import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { normalizeDeliveryTimeZone, trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import { TrainingDeliveryTransportError, type DeliveryArtifact, type DeliveryCheckpoint, type DeliveryOperation,
  type DeliveryRecovery, type DeliveryRequestGuard, type DeliveryTransportProgress, type TrainingDeliveryTransport } from '../contracts';
import type { InspectionPolicy, RemoteInspection } from '../verification-contracts';
import { WahooTrainingHttpError, wahooId, wahooObject, type WahooTrainingClient, type WahooTrainingRequest } from './http';
import { assessWahooDelivery, WAHOO_MAPPING_VERSION, wahooIdentities, wahooPlanBody, wahooStarts, wahooWorkoutBody, wahooWorkoutDate, wahooWorkoutFields } from './mapping';

export const WAHOO_INSPECTION_POLICY: InspectionPolicy = {
  version: 'wahoo-owned-plan-workout-v1', mode: 'retained-ids', required: ['plan', 'workout', 'association'],
  confirmationDelayMs: 15 * 60_000, authoritativeAbsenceKeys: [], repairReadyKeys: [],
};
const STEPS = ['plan-create', 'plan-update', 'workout-create', 'workout-discover', 'workout-update', 'workout-remove', 'plan-remove', 'finished'] as const;
type Step = typeof STEPS[number];
type Value = Record<string, unknown>;
function uncertain(): never { throw new TrainingDeliveryTransportError('uncertain'); }
function validateArtifact(artifact: DeliveryArtifact): void {
  const ids = artifact.ids;
  if (artifact.timeZone !== undefined) {
    try { normalizeDeliveryTimeZone(artifact.timeZone); } catch { uncertain(); }
  }
  wahooId(ids.plan);
  if (!/^qs-plan-[A-Za-z0-9_-]{43}$/.test(ids.externalId) || ids.workoutToken !== `qs-workout-${ids.externalId.slice(8)}`
    || Object.keys(ids).some(key => !['plan', 'workout', 'externalId', 'workoutToken', 'association'].includes(key))) uncertain();
  if (ids.workout) wahooId(ids.workout);
  if (ids.association && ids.association !== `${ids.workout}:${ids.plan}`) uncertain();
}
function ownedPlan(raw: unknown, artifact: DeliveryArtifact): Value {
  const value = wahooObject(raw);
  if (wahooId(value.id) !== artifact.ids.plan || value.external_id !== artifact.ids.externalId || value.deleted !== false) uncertain();
  return value;
}
function ownedWorkout(raw: unknown, artifact: DeliveryArtifact): Value {
  const value = wahooObject(raw);
  if (wahooId(value.id) !== artifact.ids.workout || value.workout_token !== artifact.ids.workoutToken) uncertain();
  return value;
}
function associationMatches(value: Value, plan: string): boolean {
  if (value.plan_ids !== undefined && !Array.isArray(value.plan_ids)) return false;
  const ids = [...(value.plan_id === null || value.plan_id === undefined ? [] : [wahooId(value.plan_id)]),
    ...(Array.isArray(value.plan_ids) ? value.plan_ids.map(wahooId) : [])];
  return ids.length > 0 && ids.every(id => id === plan);
}
function isCompleted(value: Value): boolean {
  if (value.workout_summary === null) return false;
  // Missing/malformed summary is not proof of an uncompleted workout.
  wahooId(wahooObject(value.workout_summary).id);
  return true;
}
function numeric(value: unknown): number {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) ? Number(value) : NaN;
}

/** One QS scheduled workout owns one library Plan and one dated Workout. Never
 * share the Plan between copies: changing one copy must not rewrite another. */
export class WahooTrainingTransport implements TrainingDeliveryTransport {
  readonly mappingVersion = WAHOO_MAPPING_VERSION;
  readonly horizonDays = 6;
  readonly withdrawOutsideHorizon = true;
  readonly inspection: RemoteInspection;
  constructor(private readonly client: WahooTrainingClient, private readonly now: () => number = Date.now) {
    this.inspection = { policy: WAHOO_INSPECTION_POLICY, inspect: async (request, guard) => {
      const artifact = request.artifact; validateArtifact(artifact);
      const plan = await this.read(`/v1/plans/${artifact.ids.plan}`, guard);
      const workout = artifact.ids.workout ? await this.read(`/v1/workouts/${artifact.ids.workout}`, guard) : null;
      let conflict = false; let completed = false;
      let planPresent = false; let workoutPresent = false; let associated = false;
      if (plan) { ownedPlan(plan, artifact); planPresent = true; }
      if (workout) {
        const value = ownedWorkout(workout, artifact);
        completed = isCompleted(value);
        workoutPresent = wahooWorkoutDate(value.starts, artifact.timeZone ?? request.timeZone) === artifact.localDate;
        conflict = !workoutPresent || !associationMatches(value, artifact.ids.plan);
        if (!conflict) associated = await this.association(artifact, guard);
        conflict ||= !associated;
      }
      return { completed, conflict, artifacts: [
        { key: 'plan', state: planPresent ? 'present' : 'unknown', authoritative: planPresent },
        { key: 'workout', state: workoutPresent ? 'present' : 'unknown', authoritative: workoutPresent },
        { key: 'association', state: associated ? 'present' : 'unknown', authoritative: associated },
      ] };
    } };
  }
  assess(workout: ScheduledWorkoutV1, destination: string, zone: string) { return assessWahooDelivery(workout, destination, zone); }
  canRemove(artifact: DeliveryArtifact, today: string): boolean {
    return !artifact.completed && artifact.localDate >= (artifact.timeZone ? trainingDeliveryLocalDate(this.now(), artifact.timeZone) : today);
  }
  private validate(operation: DeliveryOperation): void {
    if (operation.repair || operation.recoveryBlocked) uncertain();
    if (operation.progress && (operation.progress.version !== 1 || !STEPS.includes(operation.progress.step as Step)
      || !['ready', 'started', 'accepted', 'rejected'].includes(operation.progress.state))) uncertain();
    if (operation.artifact) {
      validateArtifact(operation.artifact);
      if (operation.workout && operation.artifact.ids.externalId !== wahooIdentities(operation.destinationKey, operation.workout.id).externalId) uncertain();
    }
  }
  private assertFuture(operation: DeliveryOperation): void {
    const today = trainingDeliveryLocalDate(this.now(), operation.timeZone);
    if (operation.artifact && !this.canRemove(operation.artifact, today)) uncertain();
    if (operation.kind === 'upsert') {
      const last = new Date(Date.parse(`${today}T00:00:00Z`) + this.horizonDays * 86_400_000).toISOString().slice(0, 10);
      if (!operation.workout || operation.workout.localDate < today || operation.workout.localDate > last) uncertain();
    }
  }
  private async save(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, artifact: DeliveryArtifact | null,
    step: Step, state: DeliveryTransportProgress['state']): Promise<void> {
    const progress: DeliveryTransportProgress = { version: 1, step, state };
    await checkpoint(artifact, progress); operation.artifact = artifact; operation.progress = progress;
  }
  private async read(path: string, guard: DeliveryRequestGuard): Promise<unknown | null> {
    await guard(false);
    const response = await this.client({ method: 'GET', path }, () => guard(false));
    if (response.status === 404) return null;
    if (response.status !== 200 || response.body === null || response.body === undefined) uncertain();
    return response.body;
  }
  private async write(operation: DeliveryOperation, step: Step, request: WahooTrainingRequest,
    checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard) {
    await this.save(operation, checkpoint, operation.artifact, step, 'ready');
    await guard(true);
    try {
      return await this.client(request, async () => {
        this.assertFuture(operation); await guard(true);
        await this.save(operation, checkpoint, operation.artifact, step, 'started');
        try { this.assertFuture(operation); await guard(true); }
        catch (error) { await this.save(operation, checkpoint, operation.artifact, step, 'rejected'); throw error; }
      });
    } catch (error) {
      if (error instanceof WahooTrainingHttpError && error.rejected) await this.save(operation, checkpoint, operation.artifact, step, 'rejected');
      throw error;
    }
  }
  private async association(artifact: DeliveryArtifact, guard: DeliveryRequestGuard): Promise<boolean> {
    const rows = await this.read(`/v1/workouts/${artifact.ids.workout}/plans`, guard);
    if (!Array.isArray(rows) || rows.length !== 1) return false;
    ownedPlan(rows[0], artifact);
    return true;
  }
  private async inspectWorkout(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard,
    recovering = false): Promise<Value> {
    const artifact = operation.artifact!;
    const raw = await this.read(`/v1/workouts/${artifact.ids.workout}`, guard);
    if (!raw) uncertain();
    const value = ownedWorkout(raw, artifact);
    const retainedZone = artifact.timeZone ?? operation.timeZone;
    const retainedDate = wahooWorkoutDate(value.starts, retainedZone);
    // A time-zone edit can move the old instant onto a different calendar date.
    // Compare the retained copy in its own zone until readback matches our exact
    // desired starts instant (including an accepted PUT whose response was lost).
    const desiredStarts = operation.kind === 'upsert'
      && Date.parse(String(value.starts)) === Date.parse(wahooStarts(operation.workout!.localDate, operation.timeZone));
    const timeZone = desiredStarts ? operation.timeZone : retainedZone;
    const date = wahooWorkoutDate(value.starts, timeZone);
    const completed = isCompleted(value);
    if (completed || date < trainingDeliveryLocalDate(this.now(), timeZone)) {
      const protectedArtifact = { ...artifact, completed: artifact.completed || completed, localDate: date, timeZone };
      await checkpoint(protectedArtifact); operation.artifact = protectedArtifact;
      // Recovery can now retire the superseded operation against protected
      // evidence. It must not report delivery success or retry another write.
      if (recovering) return value;
      uncertain();
    }
    // Only the retained calendar date or this operation's exact new instant is admissible.
    // Manual provider moves must not be silently overwritten or removed.
    if ((retainedDate !== artifact.localDate && !desiredStarts)
      || !associationMatches(value, artifact.ids.plan)) uncertain();
    if (date !== artifact.localDate || timeZone !== artifact.timeZone) {
      const observed = { ...artifact, localDate: date, timeZone };
      await checkpoint(observed); operation.artifact = observed;
    }
    return value;
  }
  private confirmPlan(raw: unknown, operation: DeliveryOperation): void {
    const value = ownedPlan(raw, operation.artifact!);
    const workout = operation.workout!;
    const expected = wahooWorkoutFields(workout, operation.destinationKey, operation.timeZone, operation.artifact!.ids.plan);
    const providerUpdatedAt = typeof value.provider_updated_at === 'string' ? Date.parse(value.provider_updated_at) : NaN;
    // Production readback truncates the submitted ISO timestamp to whole seconds.
    // Compare at the provider's precision while still rejecting another revision.
    if (value.name !== workout.title || numeric(value.workout_type_family_id) !== expected.workout_type_id
      || numeric(value.workout_type_location_id) !== 1 || typeof value.provider_updated_at !== 'string'
      || Math.trunc(providerUpdatedAt / 1000) !== Math.trunc(workout.updatedAtMs / 1000)) uncertain();
  }
  private matchesWorkout(value: Value, operation: DeliveryOperation): boolean {
    const expected = wahooWorkoutFields(operation.workout!, operation.destinationKey, operation.timeZone, operation.artifact!.ids.plan);
    return value.name === expected.name && value.workout_token === expected.workout_token
      && numeric(value.workout_type_id) === expected.workout_type_id && numeric(value.minutes) === expected.minutes
      && Date.parse(String(value.starts)) === Date.parse(expected.starts)
      && associationMatches(value, expected.plan_id);
  }
  private async lookupPlan(operation: DeliveryOperation, guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null> {
    const ids = wahooIdentities(operation.destinationKey, operation.workout!.id);
    const rows = await this.read(`/v1/plans?external_id=${ids.externalId}`, guard);
    if (!Array.isArray(rows) || rows.length > 1) uncertain();
    if (!rows.length) return null;
    const value = wahooObject(rows[0]);
    const artifact = { ids: { ...ids, plan: wahooId(value.id) }, localDate: operation.workout!.localDate, completed: false, timeZone: operation.timeZone };
    ownedPlan(value, artifact);
    return artifact;
  }
  async execute(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null> {
    this.validate(operation); this.assertFuture(operation);
    if (operation.progress === undefined || operation.progress?.state === 'started') uncertain();
    if (operation.kind === 'remove') return this.remove(operation, checkpoint, guard);
    const workout = operation.workout!;
    const assessment = this.assess(workout, operation.destinationKey, operation.timeZone);
    if (assessment.level === 'unsupported' || assessment.digest !== operation.digest) throw new TrainingDeliveryTransportError('terminal');
    if (operation.artifact?.ids.workout) {
      await this.inspectWorkout(operation, checkpoint, guard);
      if (!await this.association(operation.artifact, guard)) uncertain();
    }
    if (!operation.artifact) {
      const found = await this.lookupPlan(operation, guard);
      if (found) {
        // A pre-existing Plan with no local receipt could already have a Workout.
        // Do not infer its absence from a new local journal or issue a blind POST.
        await this.save(operation, checkpoint, found, 'workout-discover', 'started');
        uncertain();
      }
    }
    if (!operation.artifact) {
      const response = await this.write(operation, 'plan-create', { method: 'POST', path: '/v1/plans',
        body: wahooPlanBody(workout, operation.destinationKey, true) }, checkpoint, guard);
      const value = wahooObject(response.body);
      const artifact: DeliveryArtifact = { ids: { ...wahooIdentities(operation.destinationKey, workout.id), plan: wahooId(value.id) },
        localDate: workout.localDate, completed: false, timeZone: operation.timeZone };
      // Retain receipt before further validation; malformed metadata must never cause
      // a second create or erase the only known provider identity.
      await checkpoint(artifact); operation.artifact = artifact;
      this.confirmPlan(value, operation);
      await this.save(operation, checkpoint, artifact, 'plan-create', 'accepted');
    } else {
      const existing = await this.read(`/v1/plans/${operation.artifact.ids.plan}`, guard);
      if (!existing) uncertain();
      ownedPlan(existing, operation.artifact);
      await this.write(operation, 'plan-update', { method: 'PUT', path: `/v1/plans/${operation.artifact.ids.plan}`,
        body: wahooPlanBody(workout, operation.destinationKey, false) }, checkpoint, guard);
      // An acknowledged PUT is safe to repeat. Metadata alone is not proof of recipe
      // content after an uncertain PUT; recovery resumes a guarded in-place write.
      await this.save(operation, checkpoint, operation.artifact, 'plan-update', 'accepted');
    }
    const artifact = operation.artifact!;
    if (artifact.ids.workout) await this.inspectWorkout(operation, checkpoint, guard);
    const step = artifact.ids.workout ? 'workout-update' : 'workout-create';
    const response = await this.write(operation, step, { method: artifact.ids.workout ? 'PUT' : 'POST',
      path: artifact.ids.workout ? `/v1/workouts/${artifact.ids.workout}` : '/v1/workouts',
      body: wahooWorkoutBody(workout, operation.destinationKey, operation.timeZone, artifact.ids.plan) }, checkpoint, guard);
    if (!artifact.ids.workout) {
      const retained = { ...artifact, ids: { ...artifact.ids, workout: wahooId(wahooObject(response.body).id) } };
      await checkpoint(retained); operation.artifact = retained;
    } else if (response.body && wahooId(wahooObject(response.body).id) !== artifact.ids.workout) uncertain();
    const value = await this.inspectWorkout(operation, checkpoint, guard);
    if (!this.matchesWorkout(value, operation) || !await this.association(operation.artifact!, guard)) uncertain();
    // Read Plan independently; a dated Workout is not proof that its recipe exists.
    const plan = await this.read(`/v1/plans/${artifact.ids.plan}`, guard);
    if (!plan) uncertain();
    this.confirmPlan(plan, operation);
    const accepted = { ...operation.artifact!, localDate: workout.localDate, timeZone: operation.timeZone,
      ids: { ...operation.artifact!.ids, association: `${operation.artifact!.ids.workout}:${artifact.ids.plan}` } };
    await this.save(operation, checkpoint, accepted, 'finished', 'accepted');
    return accepted;
  }
  private async remove(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<null> {
    if (!operation.artifact) { await this.save(operation, checkpoint, null, 'finished', 'accepted'); return null; }
    const plan = await this.read(`/v1/plans/${operation.artifact.ids.plan}`, guard);
    if (!plan) uncertain();
    ownedPlan(plan, operation.artifact);
    if (operation.artifact.ids.workout) {
      await this.inspectWorkout(operation, checkpoint, guard);
      if (!await this.association(operation.artifact, guard)) uncertain();
      const response = await this.write(operation, 'workout-remove', { method: 'DELETE', path: `/v1/workouts/${operation.artifact.ids.workout}` }, checkpoint, guard);
      if (response.status === 404) uncertain(); // Ambiguous ownership/absence is not deletion evidence.
      const ids = { ...operation.artifact.ids }; delete ids.workout; delete ids.association;
      await this.save(operation, checkpoint, { ...operation.artifact, ids }, 'workout-remove', 'accepted');
    }
    const response = await this.write(operation, 'plan-remove', { method: 'DELETE', path: `/v1/plans/${operation.artifact.ids.plan}` }, checkpoint, guard);
    if (response.status === 404) uncertain();
    await this.save(operation, checkpoint, null, 'finished', 'accepted');
    return null;
  }
  /** Two identical, complete bounded enumerations detect common paging shifts and
   * duplicate tokens. They permit positive adoption only, NEVER absence or repair.
   * Larger/unstable inventories remain needs_attention instead of another POST. */
  private async discoverWorkout(operation: DeliveryOperation, guard: DeliveryRequestGuard): Promise<string | null> {
    const scan = async () => {
      const rows: { id: string; token: unknown }[] = []; let total: number | null = null;
      for (let page = 1; page <= 5; page++) {
        const data = wahooObject(await this.read(`/v1/workouts?page=${page}&per_page=100`, guard));
        if (!Array.isArray(data.workouts) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || Number(data.total) > 500
          || data.page !== page || data.per_page !== 100 || data.order !== 'descending' || data.sort !== 'starts'
          || (total !== null && total !== data.total)) uncertain();
        total = Number(data.total);
        if (data.workouts.length !== Math.min(100, total - rows.length)) uncertain();
        rows.push(...data.workouts.map(raw => { const value = wahooObject(raw); return { id: wahooId(value.id), token: value.workout_token }; }));
        if (rows.length === total) break;
      }
      if (rows.length !== total || new Set(rows.map(row => row.id)).size !== rows.length) uncertain();
      return rows;
    };
    const first = await scan(); const second = await scan();
    if (JSON.stringify(first) !== JSON.stringify(second)) return null;
    const candidates = first.filter(row => row.token === operation.artifact!.ids.workoutToken);
    return candidates.length === 1 ? candidates[0].id : null;
  }
  async recover(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryRecovery> {
    this.validate(operation);
    const progress = operation.progress;
    if (progress === undefined) return { kind: 'uncertain' };
    if (progress === null) return { kind: operation.artifact ? 'resume' : 'not-accepted' };
    if (progress.step === 'finished' && progress.state === 'accepted') return { kind: 'accepted', artifact: operation.artifact };
    if (progress.state !== 'started') return { kind: operation.artifact ? 'resume' : 'not-accepted' };
    if (progress.step === 'plan-create' && operation.kind === 'upsert') {
      const artifact = operation.artifact ?? await this.lookupPlan(operation, guard);
      if (!artifact) return { kind: 'uncertain' };
      const raw = await this.read(`/v1/plans/${artifact.ids.plan}`, guard);
      if (!raw) return { kind: 'uncertain' };
      ownedPlan(raw, artifact);
      await this.save(operation, checkpoint, artifact, 'plan-create', 'accepted');
      return { kind: 'resume' };
    }
    if (!operation.artifact) return { kind: 'uncertain' };
    if ((progress.step === 'workout-create' || progress.step === 'workout-discover') && operation.kind === 'upsert') {
      const id = operation.artifact.ids.workout ?? await this.discoverWorkout(operation, guard);
      if (!id) return { kind: 'uncertain' };
      const artifact: DeliveryArtifact = { ...operation.artifact, ids: { ...operation.artifact.ids, workout: id } };
      await checkpoint(artifact); operation.artifact = artifact;
      const value = await this.inspectWorkout(operation, checkpoint, guard, true);
      if (!this.canRemove(operation.artifact!, trainingDeliveryLocalDate(this.now(), operation.timeZone))) return { kind: 'resume' };
      const plan = await this.read(`/v1/plans/${artifact.ids.plan}`, guard);
      if (!plan || !this.matchesWorkout(value, operation) || !await this.association(artifact, guard)) return { kind: 'uncertain' };
      this.confirmPlan(plan, operation);
      const accepted = { ...operation.artifact!, localDate: operation.workout!.localDate, timeZone: operation.timeZone,
        ids: { ...artifact.ids, association: `${id}:${artifact.ids.plan}` } };
      await this.save(operation, checkpoint, accepted, 'finished', 'accepted');
      return { kind: 'accepted', artifact: accepted };
    }
    if (progress.step === 'plan-update' || progress.step === 'workout-update') {
      const raw = await this.read(`/v1/plans/${operation.artifact.ids.plan}`, guard);
      if (!raw) return { kind: 'uncertain' };
      ownedPlan(raw, operation.artifact);
      if (operation.artifact.ids.workout) await this.inspectWorkout(operation, checkpoint, guard, true);
      await this.save(operation, checkpoint, operation.artifact, progress.step, 'ready');
      return { kind: 'resume' };
    }
    // A lost DELETE acknowledgement and a 404 cannot distinguish inaccessible
    // ownership from absence. Keep both identities; no speculative Plan cleanup.
    return { kind: 'uncertain' };
  }
}
