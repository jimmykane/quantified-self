import * as logger from 'firebase-functions/logger';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { DeliveryOperation, DeliveryTransportProgress, TrainingDeliveryTransport } from './contracts';

export type DeliveryDiagnosticPhase = 'execute' | 'recover';
type SuuntoDiagnosticMapping = 'suunto-guides-v2' | 'suunto-guides-v3' | 'suunto-guides-v4' | 'unknown' | 'not_applicable';

/** Resolve once per claimed operation. Diagnostics must never cause transport
 * failure or fall back to the adapter's current version for an old journal. */
export function deliveryDiagnosticMapping(provider: PlannedWorkoutProviderId, transport: TrainingDeliveryTransport,
  operation: DeliveryOperation): SuuntoDiagnosticMapping | undefined {
  if (provider !== 'suunto') return undefined;
  if (operation.kind === 'remove') return 'not_applicable';
  try {
    const version = transport.diagnosticMappingVersion?.(operation);
    return version === 'suunto-guides-v2' || version === 'suunto-guides-v3' || version === 'suunto-guides-v4' ? version : 'unknown';
  } catch { return 'unknown'; } // Never log an exception or private prescription.
}

export function deliveryDiagnosticLabels(mapping: SuuntoDiagnosticMapping | undefined, phase: DeliveryDiagnosticPhase) {
  if (mapping === undefined) return {};
  // Allowlist again at the log boundary, including malformed runtime values.
  return {
    guideMappingVersion: ['suunto-guides-v2', 'suunto-guides-v3', 'suunto-guides-v4', 'not_applicable'].includes(mapping) ? mapping : 'unknown',
    deliveryPhase: phase === 'recover' || phase === 'execute' ? phase : 'unknown',
  };
}

/** Log persistence failure before the worker attempts to save its retry state. Never log the error itself. */
export async function observeDeliveryCheckpoint<T>(provider: PlannedWorkoutProviderId, complete: boolean,
  progress: DeliveryTransportProgress | null | undefined, persist: () => Promise<T>,
  context?: { mapping: SuuntoDiagnosticMapping | undefined; phase: DeliveryDiagnosticPhase }): Promise<T> {
  try { return await persist(); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const codes: Record<string, string> = { '4': 'deadline-exceeded', '7': 'permission-denied', '8': 'resource-exhausted',
      '10': 'aborted', '13': 'internal', '14': 'unavailable' };
    const category = typeof code === 'number' ? codes[String(code)]
      : typeof code === 'string' && Object.values(codes).includes(code) ? code : undefined;
    logger.warn('[TrainingDelivery]', { event: 'checkpoint_failed', provider, complete,
      checkpointState: ['ready', 'started', 'rejected', 'accepted'].includes(progress?.state ?? '') ? progress!.state : 'artifact',
      persistenceCode: category ?? 'unknown', ...(provider === 'suunto' && context ? deliveryDiagnosticLabels(context.mapping, context.phase) : {}) });
    throw error; // Preserve retry classification and the original acceptance journal.
  }
}
