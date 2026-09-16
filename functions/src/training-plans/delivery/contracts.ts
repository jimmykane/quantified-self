import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { TrainingDeliveryStatus, TrainingDeliverySettingsV1 } from '../../../../shared/training-provider-delivery';
import type { DeliveryRepair, RemoteInspection, VerificationEvidence } from './verification-contracts';

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
  issues?: string[];
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
  /** Internal transport journal. null proves a new operation has made no request;
   * absence is a legacy/unknown journal and must not authorize a non-idempotent retry. */
  progress?: DeliveryTransportProgress | null;
  /** Conflicting late acceptance is retained separately and needs operator inspection.
   * Retry must not execute from a journal that may have been overtaken by another lease. */
  recoveryBlocked?: boolean;
  repair?: DeliveryRepair;
}
export interface DeliveryTransportProgress {
  version: 1;
  step: string;
  state: 'ready' | 'started' | 'rejected' | 'accepted';
  /** Adapter-proved no-op repairs must not consume the successful-repair limit. */
  repairApplied?: boolean;
}
export type DeliveryCheckpoint = (artifact: DeliveryArtifact | null, progress?: DeliveryTransportProgress | null) => Promise<void>;
/** Recheck the exact attempt, lease, current intent and authority before EVERY request.
 * Reads may inspect an obsolete operation; writes must still match current intent. */
export type DeliveryRequestGuard = (mutating: boolean) => Promise<void>;
export type DeliveryRecovery = { kind: 'accepted'; artifact: DeliveryArtifact | null }
  | { kind: 'not-accepted' } | { kind: 'resume' } | { kind: 'uncertain' };

/** Adapters must checkpoint every accepted artifact (e.g. workout, then schedule).
 * Final upsert acceptance requires a nonempty artifact identity; final removal requires null.
 * Recovery must inspect or prove the SAME operation id idempotent before repeating it. */
export interface TrainingDeliveryTransport {
  inspection?: RemoteInspection;
  mappingVersion: string;
  horizonDays: number;
  /** Provider/product policy: withdraw an existing upcoming copy when moved beyond its window. */
  withdrawOutsideHorizon?: boolean;
  assess(workout: ScheduledWorkoutV1, destinationKey: string, timeZone: string): DeliveryAssessment;
  canRemove(artifact: DeliveryArtifact, today: string): boolean;
  execute(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryArtifact | null>;
  recover(operation: DeliveryOperation, checkpoint: DeliveryCheckpoint, guard: DeliveryRequestGuard): Promise<DeliveryRecovery>;
}
export class TrainingDeliveryTransportError extends Error {
  readonly diagnostics: { httpStatus?: number; failurePhase?: 'request' | 'response' | 'decode' | 'contract' };
  constructor(public readonly kind: 'retryable' | 'auth' | 'permission' | 'terminal' | 'uncertain' | 'deferred',
    public readonly retryAfterMs = 0,
    diagnostics: { httpStatus?: number; failurePhase?: 'request' | 'response' | 'decode' | 'contract' } = {}) {
    super(kind);
    // Allowlisted diagnostics only: never forward HTTP bodies, URLs, IDs or error messages.
    this.diagnostics = {
      ...(Number.isInteger(diagnostics.httpStatus) && diagnostics.httpStatus! >= 100 && diagnostics.httpStatus! <= 599
        ? { httpStatus: diagnostics.httpStatus } : {}),
      ...(['request', 'response', 'decode', 'contract'].includes(diagnostics.failurePhase ?? '')
        ? { failurePhase: diagnostics.failurePhase } : {}),
    };
  }
}
export interface DeliveryRuntime {
  requestNotBefore?(tx: Transaction, uid: string, provider: PlannedWorkoutProviderId, destination: string): Promise<number>;
  db: Firestore;
  now(): number;
  hasPro(uid: string): Promise<boolean>;
  connection(tx: Transaction, uid: string, provider: PlannedWorkoutProviderId): Promise<DeliveryConnection>;
  /** Bind a future real adapter to the authenticated owner on the server, never in browser configuration. */
  transport(provider: PlannedWorkoutProviderId, uid: string): TrainingDeliveryTransport | null;
}
export interface DeliveryLedgerV1 {
  verification?: VerificationEvidence;
  repair?: DeliveryRepair | null;
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
  /** Adapter-imposed minimum delay survives authored edits and explicit Retry.
   * Optional only for older ledgers; this is not an account-wide quota scheduler. */
  providerNotBeforeMs?: number;
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
