import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';
import type { RouteSendNotificationRequest } from '../../../shared/saved-route-send';
import { isAutomaticPushOrigin } from '../../../shared/web-push';

export const ROUTE_PUSH_SERVICES = { [ServiceNames.GarminAPI]: 'Garmin', [ServiceNames.SuuntoApp]: 'Suunto',
  [ServiceNames.COROSAPI]: 'COROS', [ServiceNames.WahooAPI]: 'Wahoo' } as const;
export type RoutePushService = keyof typeof ROUTE_PUSH_SERVICES;
export const isRoutePushService = (value: string): value is RoutePushService => Object.prototype.hasOwnProperty.call(ROUTE_PUSH_SERVICES, value);
// The existing manual callable can run for an hour. Never declare its in-flight request failed earlier.
export const ROUTE_PUSH = { idleMs: 70 * 60000, lifetimeMs: 86400000, expiryMs: 600000,
  pendingLimit: 8, seenLimit: 512, deviceLimit: 10, clockSkewMs: 300000 } as const;
export interface RouteSendChunk { hash: string; count: number; finished: boolean; sent: number; attention: number; }
export interface RouteSendResult {
  id: string; clientCreatedAt: number; createdAt: number; touchedAt: number; total: number; service: RoutePushService;
  forceCopy: boolean; categoryRevision: number; account: string | null; connectedAt: number; generation: string | null;
  epoch: number; episode?: string;
  targets: { id: string; generation: string; origin: string }[];
  chunks: Record<string, RouteSendChunk>; closed?: boolean; readyAt?: number;
}
export interface RouteSendTicket { uid: string; id: string; index: number; hash: string; }
export const routeSendHash = (routeIds: readonly string[], forceCopy: boolean) =>
  createHash('sha256').update(JSON.stringify([routeIds, forceCopy])).digest('hex');
export const routeSendStatePath = (uid: string) => `users/${uid}/pushState/routeDelivery`;
export const routeSendCounts = (request: RouteSendResult) => {
  const chunks = Object.values(request.chunks).filter(chunk => chunk.finished);
  return { completed: chunks.reduce((count, chunk) => count + chunk.count, 0),
    sent: chunks.reduce((count, chunk) => count + chunk.sent, 0),
    attention: chunks.reduce((count, chunk) => count + chunk.attention, 0) };
};
export function sameRouteSend(request: RouteSendResult, notification: RouteSendNotificationRequest, service: string, forceCopy: boolean) {
  return request.clientCreatedAt === notification.createdAtMs && request.total === notification.totalRoutes
    && request.service === service && request.forceCopy === forceCopy;
}
export function routeDeliveryPayload(origin: string, request: Pick<RouteSendResult, 'id' | 'service'>, sent: number, attention: number) {
  if (!isAutomaticPushOrigin(origin) || !isRoutePushService(request.service) || sent + attention < 1) throw new Error('Invalid route notification.');
  const provider = ROUTE_PUSH_SERVICES[request.service], path = '/routes';
  const body = attention === 0 ? `${sent} route${sent === 1 ? '' : 's'} sent to ${provider}.`
    : sent > 0 ? `${sent} route${sent === 1 ? '' : 's'} sent to ${provider}. ${attention} ${attention === 1 ? 'needs' : 'need'} attention.`
      : `Your route send to ${provider} needs attention. Open Routes to review.`;
  return { web_push: 8030, notification: { title: 'Quantified Self', body,
    tag: `qs-route-send-${createHash('sha256').update(request.id).digest('hex').slice(0, 24)}`, renotify: true,
    icon: `${origin}/assets/favicons/android-chrome-192x192.png`, navigate: origin + path,
    data: { onActionClick: { default: { operation: 'openWindow', url: path } } } } };
}
