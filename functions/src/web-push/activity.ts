import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import { FUNCTION_SECRET_BINDINGS, SECRET_PARAMS } from '../secrets';
import { automaticPushConfiguration } from './history-consent';
import { ACTIVITY_PUSH } from './activity-policy';
import { sendActivityNotification, type ActivityPushDependencies } from './activity-service';
import { parseVapidKeyPair } from './vapid';

export const sendActivitySyncNotifications = onSchedule({
  schedule: '* * * * *', timeZone: 'UTC', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 120, minInstances: 0, maxInstances: 1, concurrency: 1, retryCount: 0,
  secrets: FUNCTION_SECRET_BINDINGS.sendActivitySyncNotifications,
}, async () => {
  try {
    const db = getFirestore(); const now = Date.now();
    const config = await automaticPushConfiguration('web_push_activity_sync_enabled');
    const pair = config.enabled ? parseVapidKeyPair(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR.value()) : null;
    if (pair && pair.publicKey !== config.publicKey) throw new Error('Notification key mismatch.');
    const due = await db.collectionGroup('pushState').where('dueAt', '<=', now).orderBy('dueAt')
      .limit(ACTIVITY_PUSH.sweepLimit).select('dueAt').get();
    const deps: ActivityPushDependencies = { db, now: Date.now, configuration: async () => config,
      send: (registration, payload) => webpush.sendNotification(registration, payload, {
        vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair! }, TTL: 600, timeout: 5000,
        urgency: 'low', topic: 'qs-activity-sync',
        ...(new URL(registration.endpoint).hostname.endsWith('.notify.windows.com')
          ? { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '600' } } : {}),
      }),
      outcome: outcome => logger[outcome === 'failed' ? 'error' : 'info']('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'send', outcome }),
    };
    let failed = false;
    for (let offset = 0; offset < due.docs.length; offset += 5) {
      const results = await Promise.allSettled(due.docs.slice(offset, offset + 5).map(doc => {
        const match = /^users\/([^/]+)\/pushState\/activitySync$/.exec(doc.ref.path);
        return match ? sendActivityNotification(match[1], deps) : Promise.resolve();
      }));
      if (results.some(result => result.status === 'rejected')) failed = true;
    }
    if (failed) throw new Error('Activity notification preparation failed.');
    // Probe only the oldest due field after this bounded sweep; no global account scan.
    const remaining = await db.collectionGroup('pushState').where('dueAt', '<=', now).orderBy('dueAt').limit(1).select('dueAt').get();
    logger.info('[ActivitySyncPushSweep]', { telemetryVersion: 1, enabled: config.enabled,
      oldestDueAgeSeconds: remaining.empty ? 0 : Math.max(0, Math.floor((now - Number(remaining.docs[0].data().dueAt)) / 1000)) });
  } catch {
    logger.error('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'sweep', outcome: 'failed' });
    throw new Error('Activity sync notification sweep failed.');
  }
});
