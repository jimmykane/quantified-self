import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { stageTrainingDeliveryReconciliation } from './marker';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from './runtime';
import { DELIVERY_STATE } from './contracts';

export async function reconcileTrainingDeliveryLifecycle(uid: string): Promise<void> {
  const runtime = productionDeliveryRuntime();
  await runtime.db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) return;
    const state = await tx.get(runtime.db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current'));
    if (!(state.data()?.revision > 0)) return;
    stageTrainingDeliveryReconciliation(tx, runtime.db, uid);
  });
}
// Existing connection and entitlement lifecycle paths remain authoritative. Events only wake current-state scans.
export const onTrainingDeliveryConnectionChanged = onDocumentWritten({
  document: 'users/{uid}/meta/{service}', region: 'europe-west2', retry: true,
}, async event => {
  if (!Object.values(DELIVERY_SERVICES).some(service => service.name === event.params.service)) return;
  await reconcileTrainingDeliveryLifecycle(event.params.uid);
});
export const onTrainingDeliveryEntitlementChanged = onDocumentWritten({
  document: 'users/{uid}/system/status', region: 'europe-west2', retry: true,
}, async event => { await reconcileTrainingDeliveryLifecycle(event.params.uid); });
