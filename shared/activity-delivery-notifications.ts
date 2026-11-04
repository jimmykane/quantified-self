import { isAutomaticPushOrigin, isPushId } from './web-push';

export interface DeliveryNotificationTarget { installationId: string; generation: string; }
export interface DeliveryNotificationConsent extends DeliveryNotificationTarget {
  origin: string; categoryRevision: number; connectionGeneration: string;
}
export function isDeliveryNotificationTarget(value: unknown): value is DeliveryNotificationTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as DeliveryNotificationTarget;
  return Object.keys(value).length === 2 && isPushId(target.installationId) && isPushId(target.generation);
}
export function deliveryNotificationPayload(origin: string, path: string, attention: boolean) {
  if (!isAutomaticPushOrigin(origin) || !/^\/(send-activities(?:[/?]|$)|services(?:\?|$))/.test(path)) throw new Error('Invalid delivery notification.');
  return { web_push: 8030, notification: {
    title: 'Quantified Self', body: attention ? 'Activity delivery needs attention. Open Quantified Self to review the results.'
      : 'Your activity send has finished. Open Quantified Self to review the results.',
    tag: 'qs-activity-delivery', renotify: false, icon: `${origin}/assets/favicons/android-chrome-192x192.png`, navigate: origin + path,
    data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: path } } },
  } };
}
