import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { isAutomaticPushOrigin, isPushRegistration } from '../../../shared/web-push';
import { isDeliveryNotificationTarget, type DeliveryNotificationConsent, type DeliveryNotificationTarget } from '../../../shared/activity-delivery-notifications';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';

export function readDeliveryNotificationRequest(value: unknown, origin?: string, impersonatedBy?: unknown): (DeliveryNotificationTarget & { origin: string }) | undefined {
  if (value === undefined) return undefined;
  if (impersonatedBy || !origin || !isAutomaticPushOrigin(origin)) throw new HttpsError('permission-denied', 'Delivery notifications require your own account on a supported QS site.');
  if (!isDeliveryNotificationTarget(value)) throw new HttpsError('invalid-argument', 'Choose a registered notification device.');
  return { ...value, origin };
}
export async function validateDeliveryNotificationConsent(db: Firestore, tx: Transaction, uid: string, service: string,
  providerAccount: string, request: DeliveryNotificationTarget & { origin: string }, publicKey: string): Promise<DeliveryNotificationConsent> {
  const [registrationSnapshot, preferenceSnapshot, metaSnapshot] = await Promise.all([
    tx.get(db.doc(`users/${uid}/pushSubscriptions/${request.installationId}`)),
    tx.get(db.doc(notificationPreferencePath(uid, 'activity_delivery'))), tx.get(db.doc(`users/${uid}/meta/${service}`)),
  ]);
  const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
  const registration = registrationSnapshot.data(), meta = metaSnapshot.data();
  if (!preference?.enabled || !isPushRegistration(registration) || registration.origin !== request.origin
    || registration.generation !== request.generation || registration.vapidPublicKey !== publicKey
    || meta?.connectionState !== 'connected' || meta.providerUserId !== providerAccount
    || typeof meta.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration) {
    throw new HttpsError('failed-precondition', 'Check the destination and notification settings, or send without a notification.');
  }
  return { ...request, categoryRevision: preference.revision, connectionGeneration: meta.connectionStateGeneration };
}
