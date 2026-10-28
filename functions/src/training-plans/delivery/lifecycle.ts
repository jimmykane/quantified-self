import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { stageTrainingDeliveryReconciliation } from './marker';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from './runtime';
import { DELIVERY_STATE } from './contracts';
import { normalizeSuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';

type LifecycleEvent = { id: string; trigger: 'connection' | 'entitlement' | 'guide-settings' };
type LifecycleStage = 'runtime' | 'transaction' | 'deletion_guard' | 'delivery_state' | 'commit';
type LifecycleOutcome = 'reconciliation_staged' | 'deletion_guard_skipped' | 'no_delivery_state';

export async function reconcileTrainingDeliveryLifecycle(uid: string, event?: LifecycleEvent): Promise<void> {
  const startedAtMs = Date.now();
  const eventHash = event?.id ? createHash('sha256').update(event.id).digest('hex') : undefined;
  let stage: LifecycleStage = 'runtime';
  let stageStartedAtMs = startedAtMs;
  let attempt = 0;
  // Fixed labels only: never include the uid, event payload, document path or raw exception.
  const observe = (level: 'debug' | 'info' | 'warn', fields: Record<string, unknown>) => {
    try {
      const nowMs = Date.now();
      logger[level]('[TrainingDeliveryLifecycle]', { trigger: event?.trigger ?? 'unspecified',
        ...(eventHash ? { eventHash } : {}), stage, attempt,
        elapsedMs: Math.max(0, nowMs - startedAtMs), stageElapsedMs: Math.max(0, nowMs - stageStartedAtMs), ...fields });
    } catch { /* Diagnostics must not affect transaction or retry behavior. */ }
  };
  const enter = (nextStage: LifecycleStage) => {
    const previousStage = stage;
    const previousStageMs = Math.max(0, Date.now() - stageStartedAtMs);
    stage = nextStage;
    stageStartedAtMs = Date.now();
    observe('debug', { event: 'stage_started', previousStage, previousStageMs });
  };
  observe('debug', { event: 'stage_started' });
  try {
    const runtime = productionDeliveryRuntime();
    enter('transaction');
    const outcome = await runtime.db.runTransaction(async (tx): Promise<LifecycleOutcome> => {
      attempt += 1; // Firestore may invoke this callback again after contention.
      enter('deletion_guard');
      if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) {
        enter('commit');
        return 'deletion_guard_skipped';
      }
      enter('delivery_state');
      const state = await tx.get(runtime.db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current'));
      if (!(state.data()?.revision > 0)) {
        enter('commit');
        return 'no_delivery_state';
      }
      stageTrainingDeliveryReconciliation(tx, runtime.db, uid);
      enter('commit');
      return 'reconciliation_staged';
    });
    // Callback completion is not commit success. Only report completion after runTransaction resolves.
    observe('info', { event: 'completed', outcome });
  } catch (error) {
    // Bound Firestore/gRPC codes; error messages and arbitrary code strings may contain private data.
    let persistenceCode = 'unknown';
    try {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const codes: Record<string, string> = { '4': 'deadline-exceeded', '7': 'permission-denied',
        '8': 'resource-exhausted', '10': 'aborted', '13': 'internal', '14': 'unavailable' };
      persistenceCode = (typeof code === 'number' ? codes[String(code)]
        : typeof code === 'string' && Object.values(codes).includes(code) ? code : undefined) ?? 'unknown';
    } catch { /* A malformed exception must not replace the original error. */ }
    observe('warn', { event: 'failed', persistenceCode });
    throw error;
  }
}
// Existing connection and entitlement lifecycle paths remain authoritative. Events only wake current-state scans.
export const onTrainingDeliveryConnectionChanged = onDocumentWritten({
  document: 'users/{uid}/meta/{service}', region: 'europe-west2', memory: '512MiB', retry: true,
}, async event => {
  if (!Object.values(DELIVERY_SERVICES).some(service => service.name === event.params.service)) return;
  await reconcileTrainingDeliveryLifecycle(event.params.uid, { id: event.id, trigger: 'connection' });
});
export const onTrainingDeliveryEntitlementChanged = onDocumentWritten({
  document: 'users/{uid}/system/status', region: 'europe-west2', memory: '512MiB', retry: true,
}, async event => { await reconcileTrainingDeliveryLifecycle(event.params.uid, { id: event.id, trigger: 'entitlement' }); });

// Only wake existing delivery consent; the worker rereads current settings and retains Guide identities.
// Never process deletion or use the event's preference snapshot to upload a stale Guide.
export const onTrainingDeliveryGuideSettingsChanged = onDocumentWritten({
  document: 'users/{uid}/config/settings', region: 'europe-west2', memory: '512MiB', retry: true,
}, async event => {
  if (!event.data?.after.exists) return;
  const before = normalizeSuuntoSwimmingGuideSettings(event.data.before.data()?.suuntoSwimmingGuide);
  const after = normalizeSuuntoSwimmingGuideSettings(event.data.after.data()?.suuntoSwimmingGuide);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await reconcileTrainingDeliveryLifecycle(event.params.uid, { id: event.id, trigger: 'guide-settings' });
});
