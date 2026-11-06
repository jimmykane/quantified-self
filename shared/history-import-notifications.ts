import { ServiceNames } from '@sports-alliance/sports-lib';
import { isPushId, isAutomaticPushOrigin } from './web-push';

/** An explicit choice for one manual activity import on one registered device. */
export interface HistoryNotificationTarget { installationId: string; generation: string; }
export interface HistoryNotificationRequest extends HistoryNotificationTarget { origin: string; }
export interface HistoryNotificationConsent extends HistoryNotificationRequest { categoryRevision: number; }
export type HistoryNotificationResult = 'finished' | 'issues' | 'attention';
export function supportsHistoryNotification(service: string): boolean {
  return [ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI].includes(service as ServiceNames);
}
export function isHistoryNotificationTarget(value: unknown): value is HistoryNotificationTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as HistoryNotificationTarget;
  return Object.keys(value).length === 2 && isPushId(target.installationId) && isPushId(target.generation);
}
export function historyNotificationPath(service: string): string {
  if (!supportsHistoryNotification(service)) throw new Error('Unsupported history notification.');
  return `/services?serviceName=${encodeURIComponent(service)}&tool=history`;
}
export function buildHistoryNotificationPayload(origin: string, service: string, result: HistoryNotificationResult) {
  if (!isAutomaticPushOrigin(origin)) throw new Error('Unsupported notification origin.');
  const path = historyNotificationPath(service);
  const body = result === 'finished' ? 'Your history import has finished. Open Connections to view the results.'
    : result === 'issues' ? 'Your history import finished with issues. Open Connections to review the results.'
      : 'Your history import needs attention. Open Connections to review the results.';
  return { web_push: 8030, notification: {
    title: 'Quantified Self', body, tag: 'qs-history-import', renotify: false,
    icon: `${origin}/assets/favicons/android-chrome-192x192.png`, navigate: origin + path,
    data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: path } } },
  } };
}
