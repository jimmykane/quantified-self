import * as logger from 'firebase-functions/logger';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { DeliveryTransportProgress } from './contracts';

/** Log persistence failure before the worker attempts to save its retry state. Never log the error itself. */
export async function observeDeliveryCheckpoint<T>(provider: PlannedWorkoutProviderId, complete: boolean,
  progress: DeliveryTransportProgress | null | undefined, persist: () => Promise<T>): Promise<T> {
  try { return await persist(); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const codes: Record<string, string> = { '4': 'deadline-exceeded', '7': 'permission-denied', '8': 'resource-exhausted',
      '10': 'aborted', '13': 'internal', '14': 'unavailable' };
    const category = typeof code === 'number' ? codes[String(code)]
      : typeof code === 'string' && Object.values(codes).includes(code) ? code : undefined;
    logger.warn('[TrainingDelivery]', { event: 'checkpoint_failed', provider, complete,
      checkpointState: ['ready', 'started', 'rejected', 'accepted'].includes(progress?.state ?? '') ? progress!.state : 'artifact',
      persistenceCode: category ?? 'unknown' });
    throw error; // Preserve retry classification and the original acceptance journal.
  }
}
