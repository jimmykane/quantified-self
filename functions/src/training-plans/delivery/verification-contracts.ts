import type { TrainingVerificationState } from '../../../../shared/training-provider-verification';
import type { DeliveryArtifact, DeliveryRequestGuard } from './contracts';

export const VERIFICATION_DAY_MS = 86_400_000;
export const VERIFICATION_COALESCE_MS = 15 * 60_000;
export interface InspectionPolicy {
  version: string;
  mode: 'retained-ids' | 'inventory' | 'unavailable';
  required: string[];
  confirmationDelayMs: number;
  /** Artifact keys whose provider-specific negative semantics are proved. */
  authoritativeAbsenceKeys: string[];
  /** Artifact keys whose provider-specific repair lifecycle is proved. */
  repairReadyKeys: string[];
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

function hasUniqueRequiredKeys(policy: InspectionPolicy, keys: string[]): boolean {
  return Array.isArray(keys) && keys.length === new Set(keys).size && keys.every(key => policy.required.includes(key));
}

export function isInspectionPolicyValid(policy: InspectionPolicy): boolean {
  return !!policy && typeof policy.version === 'string' && policy.version.length > 0 && policy.version.length <= 128
    && ['retained-ids', 'inventory', 'unavailable'].includes(policy.mode)
    && Array.isArray(policy.required) && policy.required.length > 0 && policy.required.length <= 16
    && policy.required.length === new Set(policy.required).size
    && policy.required.every(key => /^[a-z][a-z0-9_-]{0,63}$/.test(key))
    && Number.isSafeInteger(policy.confirmationDelayMs) && policy.confirmationDelayMs >= 0
    && hasUniqueRequiredKeys(policy, policy.authoritativeAbsenceKeys)
    && hasUniqueRequiredKeys(policy, policy.repairReadyKeys)
    && policy.repairReadyKeys.every(key => policy.authoritativeAbsenceKeys.includes(key));
}

export function isAuthoritativeAbsenceKey(policy: InspectionPolicy, key: string): boolean {
  return isInspectionPolicyValid(policy) && policy.authoritativeAbsenceKeys.includes(key);
}

export function canRepairMissingArtifacts(policy: InspectionPolicy, missingKeys: string[]): boolean {
  return isInspectionPolicyValid(policy) && policy.mode !== 'unavailable' && Array.isArray(missingKeys) && missingKeys.length > 0
    && missingKeys.length === new Set(missingKeys).size
    && missingKeys.every(key => typeof key === 'string' && policy.repairReadyKeys.includes(key));
}
