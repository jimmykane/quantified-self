import { createHash } from 'node:crypto';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { DeliveryArtifact, DeliveryAssessment, DeliveryOperation, DeliveryRecovery, TrainingDeliveryTransport } from '../contracts';

/** Test-only deterministic transport. Explicitly excluded from the Functions build. */
export class FakeTrainingTransport implements TrainingDeliveryTransport {
  mappingVersion = 'test-v1';
  horizonDays = 365;
  level: DeliveryAssessment['level'] = 'exact';
  calls: DeliveryOperation[] = [];
  accepted = new Map<string, DeliveryArtifact | null>();
  artifacts = new Map<string, DeliveryArtifact>();
  beforeAccept: (() => Promise<void>) | null = null;
  afterAccept: (() => Promise<void>) | null = null;
  unknownRecovery = false;
  assess(workout: ScheduledWorkoutV1, destinationKey: string, timeZone: string): DeliveryAssessment {
    return { level: this.level, issues: this.level === 'exact' ? [] : ['Test target mapping warning'], mappingVersion: this.mappingVersion,
      digest: createHash('sha256').update(JSON.stringify([workout.title, workout.localDate, workout.structure, destinationKey, timeZone, this.mappingVersion])).digest('hex') };
  }
  canRemove(artifact: DeliveryArtifact, today: string): boolean { return !artifact.completed && artifact.localDate >= today; }
  async execute(operation: DeliveryOperation, checkpoint: (artifact: DeliveryArtifact | null) => Promise<void>): Promise<DeliveryArtifact | null> {
    this.calls.push(operation);
    await this.beforeAccept?.();
    if (this.accepted.has(operation.id)) return this.accepted.get(operation.id)!;
    const artifact: DeliveryArtifact | null = operation.kind === 'remove' ? null : {
      ids: { workout: `fake-${operation.deliveryId}`, schedule: `date-${operation.deliveryId}` },
      localDate: operation.workout!.localDate, completed: false,
    };
    this.accepted.set(operation.id, artifact);
    if (artifact) this.artifacts.set(operation.deliveryId, artifact);
    else this.artifacts.delete(operation.deliveryId);
    await this.afterAccept?.();
    await checkpoint(artifact);
    return artifact;
  }
  async recover(operation: DeliveryOperation): Promise<DeliveryRecovery> {
    if (this.unknownRecovery) return { kind: 'uncertain' };
    return this.accepted.has(operation.id) ? { kind: 'accepted', artifact: this.accepted.get(operation.id)! } : { kind: 'not-accepted' };
  }
}
