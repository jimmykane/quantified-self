import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import { normalizeTrainingLocalDate } from '../../../../../shared/training-plans';
import { trainingDeliveryLocalDate } from '../../../../../shared/training-provider-delivery';
import { hashTrainingScheduleRequestPayload } from '../../persistence';
import { TrainingDeliveryTransportError, type TrainingDeliveryTransport, type DeliveryOperation, type DeliveryArtifact,
  type DeliveryCheckpoint, type DeliveryRequestGuard, type DeliveryTransportProgress, type DeliveryRecovery } from '../contracts';
import type { InspectionPolicy, RemoteInspection } from '../verification-contracts';
import { type SuuntoGuideClient, type SuuntoGuideRequest, guideId, object, SuuntoGuideHttpError } from './http';
import { packageGuide, readGuideArchive } from './archive';
import { assessSuuntoGuide, guideExternalId, guideMapping, SUUNTO_MAPPING_VERSION, validateGuideOwner } from './mapping';

export const SUUNTO_INSPECTION_POLICY: InspectionPolicy = {
  version: 'suunto-owned-guide-v1', mode: 'retained-ids', required: ['guide'], confirmationDelayMs: 15 * 60_000,
  // #710 / #645: 404 conflates ownership and absence; offset inventory has no snapshot guarantee.
  authoritativeAbsenceKeys: [], repairReadyKeys: [],
};
function equal(a: unknown, b: unknown): boolean { return hashTrainingScheduleRequestPayload(a) === hashTrainingScheduleRequestPayload(b); }

export class SuuntoGuideTransport implements TrainingDeliveryTransport {
  readonly mappingVersion = SUUNTO_MAPPING_VERSION;
  readonly horizonDays = 6; // QS product window: today through today + 6, not an API restriction.
  readonly withdrawOutsideHorizon = true;
  readonly inspection: RemoteInspection;
  constructor(private readonly client: SuuntoGuideClient, private readonly owner: string, private readonly now = Date.now) {
    validateGuideOwner(owner);
    this.inspection = { policy: SUUNTO_INSPECTION_POLICY, inspect: async (request, guard) => {
      const artifact = request.artifact;
      const raw = await this.read(artifact, guard);
      if (raw) return { artifacts: [{ key: 'guide', state: raw.localDate === artifact.localDate ? 'present' : 'unknown', authoritative: raw.localDate === artifact.localDate }],
        conflict: raw.localDate !== artifact.localDate };
      // An inventory page can establish presence, never absence. Keep fair resumable coverage.
      const offset = this.offset(request.cursor ?? '0');
      const rows = await this.inventory(offset, guard);
      const matching = rows.filter(row => row.externalId === artifact.ids.externalId);
      const found = matching.length === 1 && matching[0].id === artifact.ids.guide;
      const conflict = matching.length > 1 || (matching.length === 1 && (!found || matching[0].localDate !== artifact.localDate));
      return { artifacts: [{ key: 'guide', state: found && !conflict ? 'present' : 'unknown', authoritative: found && !conflict }], conflict,
        coverage: { complete: rows.length < 50, stable: false, filtered: false,
          nextCursor: !matching.length && rows.length === 50 ? String(offset + 50) : null } };
    } };
  }
  assess(workout: ScheduledWorkoutV1, destination: string, zone: string) { return assessSuuntoGuide(workout, destination, zone, this.owner); }
  canRemove(artifact: DeliveryArtifact, today: string): boolean { return !artifact.completed && artifact.localDate >= today; }
  private offset(value: string): number {
    if (!/^(0|[1-9]\d{0,6})$/.test(value)) throw new TrainingDeliveryTransportError('uncertain');
    return Number(value);
  }
  private async save(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, artifact: DeliveryArtifact | null,
    step: string, state: DeliveryTransportProgress['state']): Promise<void> {
    const progress: DeliveryTransportProgress = { version: 1, step, state };
    await checkpoint(artifact, progress); operation.artifact = artifact; operation.progress = progress;
  }
  private validate(operation: DeliveryOperation): void {
    if (operation.recoveryBlocked || operation.repair) throw new TrainingDeliveryTransportError('uncertain');
    if (operation.progress && (operation.progress.version !== 1
      || !/^(create|update|remove|finished|discover-(0|[1-9]\d{0,6}))$/.test(operation.progress.step)
      || !['ready', 'started', 'accepted', 'rejected'].includes(operation.progress.state))) throw new TrainingDeliveryTransportError('uncertain');
    if (operation.artifact) {
      guideId(operation.artifact.ids.guide);
      if (operation.artifact.ids.owner !== this.owner || !/^qs-suunto-[A-Za-z0-9_-]{43}$/.test(operation.artifact.ids.externalId)) throw new TrainingDeliveryTransportError('uncertain');
      if (operation.workout && operation.artifact.ids.externalId !== guideExternalId(operation.destinationKey, operation.workout.id)) throw new TrainingDeliveryTransportError('uncertain');
    }
  }
  private async read(artifact: DeliveryArtifact, guard: DeliveryRequestGuard): Promise<Record<string, unknown> | null> {
    await guard(false);
    const response = await this.client({ method: 'GET', path: `/v2/guides/files/${guideId(artifact.ids.guide)}` }, () => guard(false));
    if (response.status === 404) return null;
    if (response.status !== 200) throw new TrainingDeliveryTransportError('uncertain');
    const guide = await readGuideArchive(response.body);
    if (guide.owner !== this.owner || guide.externalId !== artifact.ids.externalId) throw new TrainingDeliveryTransportError('uncertain');
    normalizeTrainingLocalDate(guide.localDate);
    return guide;
  }
  private metadata(value: unknown, inventory = false): Record<string, unknown> {
    const data = object(value); guideId(data.id);
    // Other Guides owned by this application need not be dated or carry an external ID.
    // They may be traversed, but can never match our dated, external-ID-bound delivery.
    if (!inventory || data.localDate != null) normalizeTrainingLocalDate(data.localDate);
    if (data.owner !== this.owner || typeof data.username !== 'string' || !data.username
      || (!(inventory && data.externalId == null) && (typeof data.externalId !== 'string' || data.externalId.length > 64))
      || typeof data.pinned !== 'boolean') throw new TrainingDeliveryTransportError('uncertain');
    return data;
  }
  private async inventory(offset: number, guard: DeliveryRequestGuard): Promise<Record<string, unknown>[]> {
    await guard(false);
    const response = await this.client({ method: 'GET', path: `/v2/guides/items?offset=${offset}&limit=50` }, () => guard(false));
    if (response.status !== 200 || !Array.isArray(response.body) || response.body.length > 50) throw new TrainingDeliveryTransportError('uncertain');
    return response.body.map(row => this.metadata(row, true));
  }
  private async write(operation: DeliveryOperation, step: string, request: SuuntoGuideRequest,
    checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard) {
    await this.save(operation, checkpoint, operation.artifact, step, 'ready');
    await guard(true);
    try {
      return await this.client(request, async () => {
        await guard(true); await this.save(operation, checkpoint, operation.artifact, step, 'started');
        try { await guard(true); } catch (error) {
          await this.save(operation, checkpoint, operation.artifact, step, 'rejected'); throw error;
        }
      });
    } catch (error) {
      if (error instanceof SuuntoGuideHttpError && error.rejected) await this.save(operation, checkpoint, operation.artifact, step, 'rejected');
      throw error;
    }
  }
  private future(operation: DeliveryOperation): void {
    const today = trainingDeliveryLocalDate(this.now(), operation.timeZone);
    if (operation.artifact && !this.canRemove(operation.artifact, today)) throw new TrainingDeliveryTransportError('uncertain');
    if (operation.kind === 'upsert' && (!operation.workout || operation.workout.localDate < today
      || Date.parse(operation.workout.localDate) - Date.parse(today) > this.horizonDays * 86_400_000)) throw new TrainingDeliveryTransportError('uncertain');
  }
  async execute(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null> {
    this.validate(operation); this.future(operation);
    if (operation.progress === undefined || operation.progress?.state === 'started') throw new TrainingDeliveryTransportError('uncertain');
    if (operation.kind === 'remove') {
      if (operation.artifact) {
        const raw = await this.read(operation.artifact, guard);
        if (!raw || raw.localDate !== operation.artifact.localDate) throw new TrainingDeliveryTransportError('uncertain');
        const response = await this.write(operation, 'remove', { method: 'DELETE', path: `/v2/guides/files/${guideId(operation.artifact.ids.guide)}` }, checkpoint, guard);
        if (response.status !== 200) throw new TrainingDeliveryTransportError('uncertain');
      }
      await this.save(operation, checkpoint, null, 'finished', 'accepted'); return null;
    }
    const assessment = this.assess(operation.workout!, operation.destinationKey, operation.timeZone);
    if (assessment.digest !== operation.digest || assessment.level === 'unsupported') throw new TrainingDeliveryTransportError('terminal');
    const payload = guideMapping(operation.workout!, operation.destinationKey, this.owner).artifact;
    if (operation.artifact) {
      const raw = await this.read(operation.artifact, guard);
      if (!raw || (raw.localDate !== operation.artifact.localDate && raw.localDate !== payload.localDate)) throw new TrainingDeliveryTransportError('uncertain');
      if (equal(raw, payload)) {
        await this.save(operation, checkpoint, { ...operation.artifact, localDate: payload.localDate }, 'finished', 'accepted'); return operation.artifact;
      }
    }
    const previous = operation.artifact;
    const response = await this.write(operation, previous ? 'update' : 'create', {
      method: previous ? 'PUT' : 'POST', path: previous ? `/v2/guides/files/${guideId(previous.ids.guide)}` : '/v2/guides/files',
      body: await packageGuide(payload),
    }, checkpoint, guard);
    if (response.status === 409 && !previous) {
      const recovery = await this.discover(operation, checkpoint, guard, 0);
      if (recovery.kind === 'accepted') return recovery.artifact;
      throw new TrainingDeliveryTransportError('uncertain');
    }
    if (response.status !== (previous ? 200 : 201)) throw new TrainingDeliveryTransportError('uncertain');
    const data = this.metadata(response.body);
    if (data.externalId !== payload.externalId || data.localDate !== payload.localDate || (previous && data.id !== previous.ids.guide)) throw new TrainingDeliveryTransportError('uncertain');
    const artifact: DeliveryArtifact = { ids: { guide: guideId(data.id), externalId: payload.externalId, owner: this.owner }, localDate: payload.localDate, completed: false };
    await this.save(operation, checkpoint, artifact, 'finished', 'accepted'); return artifact;
  }
  private async discover(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard, offset: number): Promise<DeliveryRecovery> {
    if (!operation.workout) return { kind: 'uncertain' };
    const expected = guideMapping(operation.workout, operation.destinationKey, this.owner).artifact;
    // Resume after three pages, retaining an uncertain-create journal. Empty/unstable
    // coverage NEVER changes it to not-accepted and never authorizes another POST.
    for (let page = 0; page < 3; page++, offset += 50) {
      const rows = await this.inventory(offset, guard);
      const candidates = rows.filter(row => row.externalId === expected.externalId);
      if (candidates.length > 1) return { kind: 'uncertain' };
      if (candidates.length === 1) {
        const found = candidates[0];
        if (found.localDate !== expected.localDate) return { kind: 'uncertain' };
        const artifact: DeliveryArtifact = { ids: { guide: guideId(found.id), externalId: expected.externalId, owner: this.owner },
          localDate: String(found.localDate), completed: false };
        const raw = await this.read(artifact, guard);
        if (!raw || !equal(raw, expected)) return { kind: 'uncertain' };
        await this.save(operation, checkpoint, artifact, 'finished', 'accepted'); return { kind: 'accepted', artifact };
      }
      if (rows.length < 50) return { kind: 'uncertain' };
      await this.save(operation, checkpoint, operation.artifact, `discover-${offset + 50}`, 'started');
    }
    throw new TrainingDeliveryTransportError('retryable');
  }
  async recover(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryRecovery> {
    this.validate(operation);
    const progress = operation.progress;
    if (progress === undefined) return { kind: 'uncertain' };
    if (progress === null) return { kind: 'not-accepted' };
    if (progress.step === 'finished' && progress.state === 'accepted') return { kind: 'accepted', artifact: operation.artifact };
    if (progress.state !== 'started') return { kind: operation.artifact ? 'resume' : 'not-accepted' };
    if (progress.step === 'create' || progress.step.startsWith('discover-')) return this.discover(operation, checkpoint, guard,
      progress.step === 'create' ? 0 : this.offset(progress.step.slice('discover-'.length)));
    if (!operation.artifact) return { kind: 'uncertain' };
    const raw = await this.read(operation.artifact, guard);
    if (!raw) return { kind: 'uncertain' }; // Even DELETE 404 does not prove owned absence.
    if (progress.step === 'update' && operation.workout && equal(raw, guideMapping(operation.workout, operation.destinationKey, this.owner).artifact)) {
      const artifact = { ...operation.artifact, localDate: operation.workout.localDate };
      await this.save(operation, checkpoint, artifact, 'finished', 'accepted'); return { kind: 'accepted', artifact };
    }
    if (raw.localDate !== operation.artifact.localDate) return { kind: 'uncertain' };
    await this.save(operation, checkpoint, operation.artifact, progress.step, 'ready'); return { kind: 'resume' };
  }
}
