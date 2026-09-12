import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { TrainingDeliveryStatus, TrainingDeliverySettingsV1 } from '../../../../shared/training-provider-delivery';

export const DELIVERY_QUEUE = 'trainingDeliveryQueue';
export const DELIVERY_LEDGER = 'trainingDeliveryLedger';
export const DELIVERY_STATE = 'trainingDeliveryState';
export const DELIVERY_SCOPES = 'trainingDeliveryScopes';
export const DELIVERY_RECEIPTS = 'receipts';
export const DELIVERY_LEASE_MS = 180_000;
export interface DeliveryConnection {
  state: 'connected' | 'reconnect_required' | 'connection_repair';
  destinationKey: string;
  generation: string;
  epoch: number;
}
export interface DeliveryAssessment {
  level: 'exact' | 'degraded' | 'unsupported';
  issues: string[];
  digest: string;
  mappingVersion: string;
}
export interface DeliveryArtifact {
  ids: Record<string, string>;
  localDate: string;
  completed: boolean;
}
export interface DeliveryOperation {
  id: string;
  kind: 'upsert' | 'remove';
  deliveryId: string;
  generation: number;
  connectionGeneration: string;
  destinationKey: string;
  timeZone: string;
  digest: string;
  contentDigest: string | null;
  workout: ScheduledWorkoutV1 | null;
  artifact: DeliveryArtifact | null;
}
export type DeliveryRecovery = { kind: 'accepted'; artifact: DeliveryArtifact | null }
  | { kind: 'not-accepted' } | { kind: 'uncertain' };

/** Adapters must checkpoint every accepted artifact (e.g. workout, then schedule).
 * Final upsert acceptance requires a nonempty artifact identity; final removal requires null.
 * Recovery must inspect or prove the SAME operation id idempotent before repeating it. */
export interface TrainingDeliveryTransport {
  mappingVersion: string;
  horizonDays: number;
  assess(workout: ScheduledWorkoutV1, destinationKey: string, timeZone: string): DeliveryAssessment;
  canRemove(artifact: DeliveryArtifact, today: string): boolean;
  execute(operation: DeliveryOperation, checkpoint: (artifact: DeliveryArtifact | null) => Promise<void>): Promise<DeliveryArtifact | null>;
  recover(operation: DeliveryOperation): Promise<DeliveryRecovery>;
}
export class TrainingDeliveryTransportError extends Error {
  constructor(public readonly kind: 'retryable' | 'auth' | 'permission' | 'terminal' | 'uncertain',
    public readonly retryAfterMs = 0) { super(kind); }
}
export interface DeliveryRuntime {
  db: Firestore;
  now(): number;
  hasPro(uid: string): Promise<boolean>;
  connection(tx: Transaction, uid: string, provider: PlannedWorkoutProviderId): Promise<DeliveryConnection>;
  /** Bind a future real adapter to the authenticated owner on the server, never in browser configuration. */
  transport(provider: PlannedWorkoutProviderId, uid: string): TrainingDeliveryTransport | null;
}
export interface DeliveryLedgerV1 {
  schemaVersion: 1;
  id: string;
  workoutId: string;
  planId: string | null;
  provider: PlannedWorkoutProviderId;
  destinationKey: string;
  desiredGeneration: number;
  connectionEpoch: number;
  settingsRevision: number;
  desiredDigest: string;
  desired: 'present' | 'absent' | 'preserve';
  status: TrainingDeliveryStatus;
  timeZone: string;
  issues: string[];
  approvalDigest: string | null;
  actual: DeliveryArtifact | null;
  acceptedDigest: string | null;
  contentDigest: string | null;
  acceptedContentDigest: string | null;
  attempt: DeliveryOperation | null;
  lease: { id: string; expiresAtMs: number } | null;
  retries: number;
  retryAtMs: number;
  blockedConnectionGeneration: string | null;
  lastAttemptAtMs: number | null;
  lastAcceptedAtMs: number | null;
  updatedAtMs: number;
}
export interface DeliveryIntent {
  desired: DeliveryLedgerV1['desired'];
  status: TrainingDeliveryStatus;
  timeZone: string;
  digest: string;
  issues: string[];
  approvalDigest: string | null;
}
export interface DeliveryContext {
  workout: ScheduledWorkoutV1 | null;
  planActive: boolean;
  setting: TrainingDeliverySettingsV1 | null;
  override: TrainingDeliverySettingsV1 | null;
  scopeGeneration: number;
  connection: DeliveryConnection;
  hasPro: boolean;
  transport: TrainingDeliveryTransport | null;
  nowMs: number;
}
