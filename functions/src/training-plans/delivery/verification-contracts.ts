import type { TrainingVerificationState } from '../../../../shared/training-provider-verification';
import type { DeliveryArtifact, DeliveryRequestGuard } from './contracts';

export const VERIFICATION_DAY_MS = 86_400_000;
export const VERIFICATION_COALESCE_MS = 15 * 60_000;
export interface InspectionPolicy {
  version: string;
  mode: 'retained-ids' | 'inventory' | 'unavailable';
  required: string[];
  confirmationDelayMs: number;
  /** Requires documented/provider-proved negative semantics, not fixture success. */
  authoritativeAbsence: boolean;
  repairReady: boolean;
}
export interface InspectionRequest {
  destinationKey: string;
  connectionGeneration: string;
  artifact: DeliveryArtifact;
  timeZone: string;
  cursor: string | null;
}
export interface InspectionObservation {
  /** Only an adapter's documented provider-confirmed completion evidence may set this. */
  completed?: boolean;
  artifacts: { key: string; state: 'present' | 'absent' | 'unknown'; authoritative: boolean }[];
  conflict: boolean;
  /** A listing must explicitly establish complete, stable, unfiltered coverage to prove absence. */
  coverage?: { complete: boolean; stable: boolean; filtered: boolean; nextCursor: string | null };
}
export interface RemoteInspection {
  policy: InspectionPolicy;
  inspect(request: InspectionRequest, guard: DeliveryRequestGuard): Promise<InspectionObservation>;
}
export interface DeliveryRepair {
  policyVersion: string;
  binding: string;
  missing: string[];
  original: DeliveryArtifact;
  /** A proven partial acceptance may finish against current authored intent using
   * retained IDs. It is not permission to repeat a replacement root POST. */
  continuation?: boolean;
}
export interface VerificationEvidence {
  binding: string;
  state: TrainingVerificationState;
  missing: boolean;
  missingKeys: string[];
  suspectedAtMs: number | null;
  checkedAtMs: number | null;
  nextCheckAtMs: number;
  requestedAtMs: number;
  manualPending: boolean;
  cursor: string | null;
  repairTimes: number[];
}
