import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { HttpsError } from 'firebase-functions/v2/https';
import { isAutomaticPushOrigin, isPushRegistration } from '../../../shared/web-push';
import { isHistoryNotificationTarget, supportsHistoryNotification, type HistoryNotificationConsent, type HistoryNotificationRequest } from '../../../shared/history-import-notifications';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';

export function readHistoryNotificationConsent(value: unknown, origin: string | undefined, impersonatedBy: unknown): HistoryNotificationRequest | undefined {
  if (value === undefined) return undefined;
  if (impersonatedBy || !origin || !isAutomaticPushOrigin(origin)) {
    throw new HttpsError('permission-denied', 'Import notifications are available on production for your own account.');
  }
  if (!isHistoryNotificationTarget(value)) throw new HttpsError('invalid-argument', 'Choose a registered notification device.');
  return { ...value, origin };
}
export async function historyPushConfiguration(): Promise<{ enabled: boolean; publicKey: string }> {
  return automaticPushConfiguration('web_push_history_import_enabled');
}
export async function automaticPushConfiguration(sender: 'web_push_history_import_enabled' | 'web_push_activity_sync_enabled'): Promise<{ enabled: boolean; publicKey: string }> {
  const template = await getRemoteConfig().getTemplate();
  const value = (name: string) => {
    const parameter = template.parameters[name];
    // These are shared, unconditional operational switches, never client targeting.
    if (parameter?.conditionalValues && Object.keys(parameter.conditionalValues).length) return '';
    const setting = parameter?.defaultValue;
    return setting && 'value' in setting ? setting.value : '';
  };
  return { enabled: value('web_push_enabled') === 'true' && value(sender) === 'true',
    publicKey: value('web_push_vapid_public_key') };
}
export async function validateHistoryNotificationConsent(db: Firestore, tx: Transaction, uid: string, service: string,
  consent: HistoryNotificationRequest, publicKey: string): Promise<HistoryNotificationConsent> {
  const { origin, ...target } = consent;
  if (!supportsHistoryNotification(service) || !isAutomaticPushOrigin(origin) || !isHistoryNotificationTarget(target)) {
    throw new HttpsError('invalid-argument', 'Unsupported import notification.');
  }
  const [registrationSnapshot, preferenceSnapshot] = await Promise.all([
    tx.get(db.doc(`users/${uid}/pushSubscriptions/${target.installationId}`)),
    tx.get(db.doc(notificationPreferencePath(uid, 'history_import'))),
  ]);
  const preference = readNotificationCategoryPreference(preferenceSnapshot.data());
  if (!preference?.enabled) {
    throw new HttpsError('failed-precondition', 'History-import notifications are off. Enable the category in Settings or import without a notification.');
  }
  const registration = registrationSnapshot.data();
  if (!isPushRegistration(registration) || registration.origin !== origin || registration.generation !== target.generation
    || registration.vapidPublicKey !== publicKey) {
    throw new HttpsError('failed-precondition', 'Enable notifications on this device again, or import without a notification.');
  }
  return { ...consent, categoryRevision: preference.revision };
}
