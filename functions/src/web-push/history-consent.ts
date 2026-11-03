import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { HttpsError } from 'firebase-functions/v2/https';
import { isAutomaticPushOrigin, isPushRegistration } from '../../../shared/web-push';
import { isHistoryNotificationTarget, supportsHistoryNotification, type HistoryNotificationConsent } from '../../../shared/history-import-notifications';

export function readHistoryNotificationConsent(value: unknown, origin: string | undefined, impersonatedBy: unknown): HistoryNotificationConsent | undefined {
  if (value === undefined) return undefined;
  if (impersonatedBy || !origin || !isAutomaticPushOrigin(origin)) {
    throw new HttpsError('permission-denied', 'Import notifications are available on production for your own account.');
  }
  if (!isHistoryNotificationTarget(value)) throw new HttpsError('invalid-argument', 'Choose a registered notification device.');
  return { ...value, origin };
}
export async function historyPushConfiguration(): Promise<{ enabled: boolean; publicKey: string }> {
  const template = await getRemoteConfig().getTemplate();
  const value = (name: string) => {
    const parameter = template.parameters[name];
    // These are shared, unconditional operational switches, never client targeting.
    if (parameter?.conditionalValues && Object.keys(parameter.conditionalValues).length) return '';
    const setting = parameter?.defaultValue;
    return setting && 'value' in setting ? setting.value : '';
  };
  return { enabled: value('web_push_enabled') === 'true' && value('web_push_history_import_enabled') === 'true',
    publicKey: value('web_push_vapid_public_key') };
}
export async function validateHistoryNotificationConsent(db: Firestore, tx: Transaction, uid: string, service: string,
  consent: HistoryNotificationConsent, publicKey: string): Promise<void> {
  const { origin, ...target } = consent;
  if (!supportsHistoryNotification(service) || !isAutomaticPushOrigin(origin) || !isHistoryNotificationTarget(target)) {
    throw new HttpsError('invalid-argument', 'Unsupported import notification.');
  }
  const registration = (await tx.get(db.doc(`users/${uid}/pushSubscriptions/${target.installationId}`))).data();
  if (!isPushRegistration(registration) || registration.origin !== origin || registration.generation !== target.generation
    || registration.vapidPublicKey !== publicKey) {
    throw new HttpsError('failed-precondition', 'Enable notifications on this device again, or import without a notification.');
  }
}
