import { notificationExpiry } from './retention';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isAutomaticPushOrigin, isPushId } from '../../../shared/web-push';

export const CONNECTION_SERVICES = {
  [ServiceNames.GarminAPI]: 'Garmin', [ServiceNames.SuuntoApp]: 'Suunto',
  [ServiceNames.COROSAPI]: 'COROS', [ServiceNames.WahooAPI]: 'Wahoo',
} as const;
export type ConnectionService = keyof typeof CONNECTION_SERVICES;
export const isConnectionService = (service: string): service is ConnectionService => Object.prototype.hasOwnProperty.call(CONNECTION_SERVICES, service);
export const CONNECTION_PUSH = { groupMs: 120000, cooldownMs: 3600000, dayMs: 86400000,
  dailyLimit: 2, expiryMs: 600000, deviceLimit: 10 } as const;
export interface ConnectionIncident { service: ConnectionService; id: string; observedAt: number; providerUserId: string; }
export interface ConnectionReceipt { id: string; observedAt: number; owner: 'connection' | 'training'; }
export const connectionStatePath = (uid: string) => `users/${uid}/pushState/connectionAttention`;

export function connectionIncident(service: string, meta: Record<string, unknown> | undefined): ConnectionIncident | null {
  if (!isConnectionService(service) || meta?.connectionState !== 'reconnect_required'
    || !isPushId(meta.reconnectNotificationId) || typeof meta.reconnectNotificationStartedAtMs !== 'number' || !Number.isSafeInteger(meta.reconnectNotificationStartedAtMs)
    || meta.reconnectNotificationStartedAtMs <= 0 || typeof meta.providerUserId !== 'string' || !meta.providerUserId) return null;
  return { service: service as ConnectionService, id: meta.reconnectNotificationId,
    observedAt: meta.reconnectNotificationStartedAtMs, providerUserId: meta.providerUserId };
}

export async function connectionIncidentOwner(db: Firestore, tx: Transaction, uid: string, incident: ConnectionIncident) {
  const state = (await tx.get(db.doc(connectionStatePath(uid)))).data();
  const receipt = state?.incidents?.[incident.service] as ConnectionReceipt | undefined;
  if (receipt?.id !== incident.id || receipt.observedAt !== incident.observedAt) return undefined;
  if (!['connection', 'training'].includes(receipt.owner)) throw new Error('Invalid connection notification receipt.');
  return receipt.owner;
}

/** The caller has read the shared receipt in this transaction. Reserve only after all reads finish. */
export function reserveTrainingConnectionIncident(db: Firestore, tx: Transaction, uid: string, incident: ConnectionIncident | undefined, now: number) {
  if (incident) tx.set(db.doc(connectionStatePath(uid)), { expireAt: notificationExpiry(now), incidents: { [incident.service]: {
    id: incident.id, observedAt: incident.observedAt, owner: 'training',
  } satisfies ConnectionReceipt } }, { merge: true });
}

export function connectionNotificationPayload(origin: string, services: readonly ConnectionService[]) {
  if (!isAutomaticPushOrigin(origin) || !services.length || services.some(service => !isConnectionService(service))) {
    throw new Error('Invalid connection notification.');
  }
  const path = services.length === 1 ? `/services?serviceName=${encodeURIComponent(services[0])}` : '/services';
  return { web_push: 8030, notification: { title: 'Quantified Self',
    body: services.length === 1 ? `Reconnect ${CONNECTION_SERVICES[services[0]]} to resume syncing.`
      : 'Some connected services need reconnecting. Open Connections to resume syncing.',
    tag: 'qs-connection-attention', renotify: true, icon: `${origin}/assets/favicons/android-chrome-192x192.png`, navigate: origin + path,
    data: { onActionClick: { default: { operation: 'openWindow', url: path } } },
  } };
}
