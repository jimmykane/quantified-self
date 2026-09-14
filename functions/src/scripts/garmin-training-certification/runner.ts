import { randomUUID } from 'node:crypto';
import { trainingDeliveryLocalDate } from '../../../../shared/training-provider-delivery';
import { serializeGarminWorkoutV1 } from '../../training-plans/providers/garmin-workout.serializer';
import { TrainingDeliveryTransportError, type DeliveryCheckpoint, type DeliveryOperation } from '../../training-plans/delivery/contracts';
import { GarminTrainingTransport } from '../../training-plans/delivery/garmin/transport';
import { garminId, type GarminTrainingClient, type GarminTrainingRequest } from '../../training-plans/delivery/garmin/http';
import { approval, fixture, nextDate, report, title, stateSchema, type Action, type Binding, type RunState } from './model';
import type { Journal } from './journal';
import type { ReadAuthority } from './authority';

const phases = { create: 'created', update: 'updated', reschedule: 'rescheduled', remove: 'removed' } as const;
function error(kind: 'auth' | 'terminal' | 'uncertain' = 'terminal'): never { throw new TrainingDeliveryTransportError(kind); }
function same(a: Binding, b: Binding): boolean {
  return a.destinationKey === b.destinationKey && a.generation === b.generation && a.epoch === b.epoch;
}
function subset(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, i) => subset(value, actual[i]));
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => subset(value, (actual as Record<string, unknown>)[key]));
  return expected === actual;
}
function identities(expected: Record<string, string>, actual: unknown): boolean {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  try { return Object.entries(expected).every(([key, value]) => garminId((actual as Record<string, unknown>)[key]) === value); }
  catch { return false; }
}
export interface RunnerDependencies {
  authority: ReadAuthority;
  client: GarminTrainingClient;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class CertificationRunner {
  private evidence: RunState['requests'] | null = null;
  private requestNotBefore = 0;
  constructor(private readonly journal: Journal, private readonly deps: RunnerDependencies) {}
  private get state() { return this.journal.state; }
  private async save(change: Partial<RunState>) {
    await this.journal.save(stateSchema.parse({ ...this.state, ...change, requests: this.evidence ?? this.state.requests,
      nextRequestAtMs: Math.max(change.nextRequestAtMs ?? this.state.nextRequestAtMs, this.requestNotBefore), revision: this.state.revision + 1 }));
  }
  async preflight(approved?: string) {
    const { binding, pro } = await this.deps.authority();
    const existing = this.state.binding;
    // Explicit disconnect invalidates the epoch; a different account needs a NEW run.
    if (existing && (existing.destinationKey !== binding.destinationKey || existing.epoch !== binding.epoch)) error('auth');
    const digest = approval(this.state, 'preflight', binding);
    if (approved !== undefined) {
      if (approved !== digest) error();
      await this.save({ binding, failure: null });
    }
    return { action: 'preflight', approved: approved !== undefined, approval: digest, pro, destinationFingerprint: binding.destinationKey.slice(0, 12),
      checks: ['Auth user enabled', 'Deletion fence clear', 'Unambiguous same-account destination', 'Stored WORKOUT_IMPORT permission', 'Unexpired stored token'],
      note: 'Read-only Firebase checks; no Garmin request, token refresh, or live entitlement proof.' };
  }
  preview(action: Action) {
    const state = this.state;
    return { action, approval: approval(state, action), ...report(state),
      dates: { initial: state.config.date, rescheduled: nextDate(state.config.date), timeZone: state.config.timeZone },
      cleanupScope: action === 'remove' ? 'Only this run’s retained synthetic workout and schedule; uncertain creates are never guessed.' : null,
      note: 'Approval authorizes real Garmin requests for this single evaluation run, not production enablement. Inspect also calls Garmin. Keep the private journal.' };
  }
  private operation(): DeliveryOperation {
    const state = this.state;
    const pending = state.pending!;
    const workout = pending.action === 'remove' ? null : fixture(state, pending.action);
    const adapter = new GarminTrainingTransport(this.deps.client, this.deps.now);
    const assessment = workout ? adapter.assess(workout, state.binding!.destinationKey, state.config.timeZone) : null;
    if (assessment && assessment.level !== 'exact') error();
    return { id: pending.id, deliveryId: state.runId, kind: pending.action === 'remove' ? 'remove' : 'upsert',
      generation: 1, connectionGeneration: state.binding!.generation, destinationKey: state.binding!.destinationKey,
      timeZone: state.config.timeZone, digest: assessment?.digest ?? 'remove', contentDigest: null, workout,
      artifact: state.artifact, progress: pending.progress };
  }
  async execute(action: Action, approved: string) {
    if (approved !== approval(this.state, action) || !this.state.binding) error();
    if (action !== 'inspect' && this.state.phase === phases[action] && !this.state.pending) return report(this.state);
    if (this.deps.now() < this.state.retryAtMs) throw new TrainingDeliveryTransportError('retryable', this.state.retryAtMs - this.deps.now());
    if (action !== 'inspect' && action !== 'remove') {
      if (this.state.pending ? this.state.pending.action !== action : this.state.phase !== ({ create: 'prepared', update: 'created', reschedule: 'updated' } as const)[action]) error();
    }
    const started = this.deps.now();
    this.evidence = structuredClone(this.state.requests);
    let requests = 0;
    const guard = async (mutating: boolean) => {
      if (this.deps.now() - started > 120_000) error();
      const authority = await this.deps.authority();
      if (!same(authority.binding, this.state.binding!)) error('auth');
      if (mutating) {
        if (action !== 'remove' && !authority.pro) error('auth');
        const today = trainingDeliveryLocalDate(this.deps.now(), this.state.config.timeZone);
        const artifact = this.state.artifact;
        if (artifact && (artifact.completed || artifact.localDate < today)) error('uncertain');
        if (action !== 'remove') {
          const latest = nextDate(this.state.config.date);
          if (this.state.config.date < today || Date.parse(`${latest}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) > 365 * 86400000) error();
        }
      }
    };
    const client: GarminTrainingClient = async (request, beforeSend) => {
      if (requests >= 12 || this.state.requestCount >= (action === 'remove' || action === 'inspect' ? 64 : 48)) error();
      const delay = Math.max(0, this.state.nextRequestAtMs - this.deps.now());
      if (delay > 60_000) error();
      if (delay) await this.deps.sleep(delay);
      // Flush request accounting BEFORE the adapter's final started checkpoint/guard.
      const observation: RunState['requests'][number] = { method: request.method,
        resource: request.path.includes('workout') ? 'workout' : request.path.includes('?') ? 'schedule-list' : 'schedule', status: null, latencyMs: null };
      this.evidence!.push(observation);
      await this.save({ requestCount: this.state.requestCount + 1, nextRequestAtMs: this.deps.now() + 2000 }); requests++;
      const requestStarted = this.deps.now();
      try {
        const response = await this.deps.client(request, async () => { await beforeSend(); await guard(request.method !== 'GET'); });
        // Merge safe evidence into the NEXT artifact checkpoint, never introduce a
        // telemetry write between provider acceptance and retaining its artifact IDs.
        observation.status = response.status; observation.latencyMs = Math.max(0, this.deps.now() - requestStarted);
        return response;
      } finally {
        // Pace from completion, not an early admission before slow authorization.
        this.requestNotBefore = this.deps.now() + 2000;
      }
    };
    const adapter = new GarminTrainingTransport(client, this.deps.now);
    const checkpoint: DeliveryCheckpoint = async (artifact, progress) => {
      const retained = artifact ? { ...artifact, ids: { ...this.state.retained?.ids, ...artifact.ids } } : this.state.retained;
      await this.save({ artifact: artifact as RunState['artifact'], retained: retained as RunState['retained'],
        pending: { ...this.state.pending!, progress: (progress === undefined ? this.state.pending!.progress : progress) as NonNullable<RunState['pending']>['progress'] } });
    };
    const read = async (request: GarminTrainingRequest) => {
      await guard(false); return client(request, () => guard(false));
    };
    try {
      await guard(false);
      // Extra operator boundary: even a retained QS-owned ID must belong to THIS
      // synthetic run before any write (including schedule-first deletion) is allowed.
      if (this.state.artifact) {
        const found = await read({ method: 'GET', path: `/training-api/workout/v2/${this.state.artifact.ids.workout}` });
        if (found.status === 200 && (!subset({ workoutName: title(this.state), workoutProvider: 'Quantified Self', workoutSourceId: 'Quantified Self' }, found.body)
          || !identities({ workoutId: this.state.artifact.ids.workout,
            ...(this.state.artifact.ids.owner ? { ownerId: this.state.artifact.ids.owner } : {}) }, found.body))) error('uncertain');
        if (found.status !== 200 && !(found.status === 404 && action === 'remove')) error('uncertain');
      }
      if (action === 'inspect') {
        if (this.state.pending || !this.state.retained || this.state.observations.length >= 24) error('uncertain');
        const ids = this.state.retained.ids;
        const workout = await read({ method: 'GET', path: `/training-api/workout/v2/${ids.workout}` });
        const schedule = ids.schedule ? await read({ method: 'GET', path: `/training-api/schedule/${ids.schedule}` }) : null;
        let passed: boolean;
        if (this.state.phase === 'removed') passed = workout.status === 404 && (!schedule || schedule.status === 404);
        else {
          const authored = fixture(this.state, this.state.phase === 'created' ? 'create' : this.state.phase === 'updated' ? 'update' : 'reschedule');
          const payload = serializeGarminWorkoutV1(authored.structure, { name: authored.title, allowDegraded: false }).artifact;
          passed = workout.status === 200 && subset(payload, workout.body) && identities({ workoutId: ids.workout }, workout.body) && schedule?.status === 200
            && identities({ scheduleId: ids.schedule!, workoutId: ids.workout }, schedule.body) && subset({ date: authored.localDate }, schedule.body);
        }
        await this.save({ observations: [...this.state.observations, { phase: this.state.phase, passed, atMs: this.deps.now() }], failure: passed ? null : 'uncertain' });
        if (!passed) error('uncertain');
        return report(this.state);
      }
      if (this.state.pending) {
        const recovering = this.operation();
        const outcome = await adapter.recover(recovering, checkpoint, guard);
        if (outcome.kind === 'uncertain') error('uncertain');
        if (action !== this.state.pending.action && action !== 'remove') error();
        if (action !== 'remove' && outcome.kind === 'accepted') {
          await this.save({ phase: phases[action], pending: null, failure: null }); return report(this.state);
        }
      }
      if (!this.state.pending || this.state.pending.action !== action) {
        await this.save({ pending: { id: randomUUID(), action, progress: null }, failure: null });
      }
      await adapter.execute(this.operation(), checkpoint, guard);
      await this.save({ phase: phases[action], pending: null, failure: null });
      return report(this.state);
    } catch (cause) {
      // Never persist/log provider bodies, credentials, raw SDK errors or stack traces.
      const failure = cause instanceof TrainingDeliveryTransportError ? cause.kind : 'local_failure';
      await this.save({ failure, retryAtMs: cause instanceof TrainingDeliveryTransportError && cause.retryAfterMs > 0
        ? Math.max(this.state.retryAtMs, this.deps.now() + cause.retryAfterMs) : this.state.retryAtMs });
      throw new TrainingDeliveryTransportError(failure === 'local_failure' ? 'uncertain' : failure);
    }
  }
}
