import { isAutomaticPushOrigin } from './web-push';

/** A read-only entry point. Opening it must never preview or execute provider work. */
export const TRAINING_SYNC_NOTIFICATION_PATH = '/training/plans?sync=attention';

export function trainingSyncNotificationPayload(origin: string) {
  if (!isAutomaticPushOrigin(origin)) throw new Error('Invalid training notification origin.');
  return { web_push: 8030, notification: {
    title: 'Quantified Self', body: 'Training sync needs attention. Open Quantified Self to review your upcoming workouts.',
    tag: 'qs-training-sync', renotify: false, icon: `${origin}/assets/favicons/android-chrome-192x192.png`,
    navigate: origin + TRAINING_SYNC_NOTIFICATION_PATH,
    data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: TRAINING_SYNC_NOTIFICATION_PATH } } },
  } };
}
