import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { ACTIVITY_SEND_PROVIDERS, isActivitySendProvider } from '../../../shared/activity-send';
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import { type DeliveryNotificationConsent, isDeliveryNotificationTarget } from '../../../shared/activity-delivery-notifications';

export const DELIVERY_PUSH = { groupMs: 120000, cooldownMs: 15 * 60000, dayMs: 86400000,
  receiptMs: 30 * 86400000, dailyLimit: 4, batchLimit: 50, seenLimit: 256, deviceLimit: 10,
  batchExpiryMs: 10 * 60000, sweepLimit: 25 } as const;
export interface DeliveryCandidate { kind: 'manual' | 'automatic'; id: string; createdAt: number; completedAt: number; }
export interface DeliveryEntry extends DeliveryCandidate {
  path: string; attention: boolean; connectionGeneration: string;
  categoryRevision?: number; target?: { installationId: string; generation: string };
  targets: { id: string; generation: string }[];
}
export function completedSend(data: Record<string, unknown> | undefined): boolean {
  return !!data && data.state === 'complete' && data.stopped !== true && data.notificationRequested === true
    && Number.isSafeInteger(data.total) && Number(data.total) > 0 && data.finished === data.total;
}
export function automaticDeliveryFailure(data: Record<string, unknown> | undefined): boolean {
  return !!data && data.originalCollection === 'activitySyncQueue' && data.manual === false
    && (!data.deliveryMode || data.deliveryMode === 'automatic') && !data.sendBatchID && data.fromHistory !== true;
}
/** Read only current committed outcomes. A retry, new connection, Stop or deletion cancels queued alerts. */
export async function currentDeliveryEntry(db: Firestore, tx: Transaction, uid: string, candidate: DeliveryCandidate,
  now: number): Promise<DeliveryEntry | null> {
  if (![candidate.createdAt, candidate.completedAt].every(Number.isFinite) || candidate.createdAt <= 0
    || candidate.completedAt < candidate.createdAt || candidate.completedAt > now || now - candidate.completedAt > DELIVERY_PUSH.dayMs) return null;
  let path: string, attention: boolean, service: string, account: string | undefined, consent: DeliveryNotificationConsent | undefined;
  if (candidate.kind === 'manual') {
    const [batchSnapshot, operationSnapshot, issues] = await Promise.all([
      tx.get(db.doc(`users/${uid}/activitySends/${candidate.id}`)),
      tx.get(db.doc(`users/${uid}/activitySendOperations/${candidate.id}`)),
      tx.get(db.collection(`users/${uid}/activitySends/${candidate.id}/rows`).where('status', 'in', ['needs_action', 'stopped']).limit(1).select('status')),
    ]);
    const batch = batchSnapshot.data(), operation = operationSnapshot.data();
    consent = operation?.deliveryNotification;
    if (!completedSend(batch) || operation?.state !== 'confirmed' || operation.stopped === true
      || !isActivitySendProvider(batch!.provider) || operation.provider !== batch!.provider
      || batch!.createdAt !== candidate.createdAt || operation.createdAt !== candidate.createdAt
      || batch!.updatedAt !== candidate.completedAt || !consent || !isAutomaticPushOrigin(consent.origin)
      || !isDeliveryNotificationTarget({ installationId: consent.installationId, generation: consent.generation })
      || !Number.isSafeInteger(consent.categoryRevision) || consent.categoryRevision < 0) return null;
    path = `/send-activities/${batch!.provider}?batch=${encodeURIComponent(candidate.id)}&source=${batch!.source === 'saved' ? 'saved' : 'files'}`;
    attention = !issues.empty; service = ACTIVITY_SEND_PROVIDERS[batch!.provider]; account = operation.providerAccount;
  } else {
    const [failedSnapshot, queueSnapshot] = await Promise.all([
      tx.get(db.doc(`failed_jobs/${candidate.id}`)), tx.get(db.doc(`activitySyncQueue/${candidate.id}`)),
    ]);
    const failed = failedSnapshot.data(), queue = queueSnapshot.data();
    if (!automaticDeliveryFailure(failed) || failed!.userID !== uid || failed!.id !== candidate.id
      || failed!.dateCreated !== candidate.createdAt || failed!.failedAt !== candidate.completedAt
      || !Object.values(ACTIVITY_SEND_PROVIDERS).includes(failed!.destinationServiceName)
      || queue && (queue.dateCreated !== candidate.createdAt || queue.processed !== true || queue.resultStatus !== 'manual_reconciliation_required')
      || typeof failed!.eventID !== 'string' || !failed!.eventID || failed!.eventID.includes('/')) return null;
    const [event] = await tx.getAll(db.doc(`users/${uid}/events/${failed!.eventID}`), { fieldMask: ['startDate'] });
    if (!event.exists) return null;
    service = failed!.destinationServiceName; account = failed!.destinationProviderUserID;
    path = `/services?serviceName=${encodeURIComponent(service)}`; attention = true;
  }
  const meta = (await tx.get(db.doc(`users/${uid}/meta/${service}`))).data();
  if (!meta || !['connected', 'reconnect_required'].includes(meta.connectionState)
    || typeof meta.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration
    || typeof meta.providerUserId !== 'string' || !meta.providerUserId || account && account !== meta.providerUserId
    || candidate.kind === 'automatic' && (Number(meta.lastDisconnectedAt) >= candidate.createdAt
      || Number(meta.activityNotificationConnectedAtMs) >= candidate.createdAt)) return null;
  const previous = candidate as Partial<DeliveryEntry>;
  if (consent && consent.connectionGeneration !== meta.connectionStateGeneration
    || previous.connectionGeneration && previous.connectionGeneration !== meta.connectionStateGeneration) return null;
  return { ...candidate, path, attention, connectionGeneration: meta.connectionStateGeneration,
    targets: previous.targets ?? [], ...(consent ? { categoryRevision: consent.categoryRevision,
      target: { installationId: consent.installationId, generation: consent.generation } } : {}) };
}
