import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import { SECRET_PARAMS } from '../secrets';
import { automaticPushConfiguration } from './history-consent';
import { parseVapidKeyPair } from './vapid';
import { notificationConfigurationFailureDetails, notificationSweepErrorCode } from './sweep-diagnostics';
import type { ActivityPushDependencies } from './activity-service';

const TYPES = {
  activity: ['web_push_activity_sync_enabled', 'ActivitySyncPush', 'qs-activity-sync'],
  delivery: ['web_push_activity_delivery_enabled', 'ActivityDeliveryPush', 'qs-activity-delivery'],
  training: ['web_push_training_sync_enabled', 'TrainingSyncPush', 'qs-training-sync'],
  trainingSend: ['web_push_training_sync_enabled', 'TrainingSendPush', undefined],
  sleep: ['web_push_sleep_sync_enabled', 'SleepSyncPush', 'qs-sleep-sync'],
  connection: ['web_push_connection_attention_enabled', 'ConnectionAttentionPush', 'qs-connection-attention'],
} as const;
export type PushType = keyof typeof TYPES;

/** One lazy configuration/key lookup per category and invocation, shared by direct and grouped sends. */
export function pushDependencies(type: PushType, db = getFirestore()): ActivityPushDependencies {
  const [flag, marker, topic] = TYPES[type];
  let config: ReturnType<typeof automaticPushConfiguration> | undefined;
  let pair: ReturnType<typeof parseVapidKeyPair> | undefined;
  const configuration = () => config ??= (async () => {
    const started = Date.now();
    const setting = await automaticPushConfiguration(flag).catch(error => {
      logger.warn('[WebPushConfiguration]', { category: type, errorCode: notificationSweepErrorCode(error),
        ...notificationConfigurationFailureDetails(error, Date.now() - started) });
      throw error;
    });
    if (setting.enabled) {
      pair = parseVapidKeyPair(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR.value());
      if (pair.publicKey !== setting.publicKey) throw new Error('Notification key mismatch.');
    }
    return setting;
  })();
  return { db, now: Date.now, configuration,
    send: async (registration, payload) => {
      if (!(await configuration()).enabled || !pair) throw new Error('Notifications unavailable.');
      return webpush.sendNotification(registration, payload, {
        vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair }, TTL: 600, timeout: 5000,
        urgency: 'low', ...(topic ? { topic } : {}),
        ...(new URL(registration.endpoint).hostname.endsWith('.notify.windows.com')
          ? { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '600' } } : {}),
      });
    },
    outcome: outcome => logger[outcome === 'failed' ? 'error' : 'info'](`[${marker}]`, { telemetryVersion: 1, phase: 'send', outcome }),
  };
}
