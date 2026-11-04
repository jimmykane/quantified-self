import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import { FUNCTION_SECRET_BINDINGS, SECRET_PARAMS } from '../secrets';
import { isConnectionHistoryRunId, type ConnectionHistoryRun } from '../connection-history/model';
import { historyNotificationResult, sendHistoryCompletion } from './history-service';
import { historyPushConfiguration } from './history-consent';
import { parseVapidKeyPair } from './vapid';

export const sendHistoryImportNotification = onDocumentWritten({
  document: 'connectionHistoryImports/{runId}', region: 'europe-west2', memory: '256MiB',
  timeoutSeconds: 30, minInstances: 0, maxInstances: 2, concurrency: 20, retry: true,
  secrets: FUNCTION_SECRET_BINDINGS.sendHistoryImportNotification,
}, async event => {
  const run = event.data?.after.data() as ConnectionHistoryRun | undefined;
  const before = event.data?.before.data() as ConnectionHistoryRun | undefined;
  // Filter unrelated checkpoint writes without configuration, credential or database reads.
  if (!run || before?.processed !== false || before.userID !== run.userID || run.id !== event.params.runId
    || !isConnectionHistoryRunId(run.id) || !historyNotificationResult(run)) return;
  let pair: ReturnType<typeof parseVapidKeyPair> | undefined;
  try {
    await sendHistoryCompletion(run.id, run, {
      db: getFirestore(), now: Date.now,
      configuration: async () => {
        const config = await historyPushConfiguration();
        if (!config.enabled) return config;
        pair = parseVapidKeyPair(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR.value());
        if (pair.publicKey !== config.publicKey) throw new Error('Notification key mismatch.');
        return config;
      },
      send: (registration, payload) => webpush.sendNotification(registration, payload, {
        vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair! },
        TTL: 3600, timeout: 5000, urgency: 'low', topic: 'qs-history-import',
        ...(new URL(registration.endpoint).hostname.endsWith('.notify.windows.com')
          ? { headers: { 'X-WNS-Type': 'wns/raw', 'X-WNS-TTL': '3600' } } : {}),
      }),
      outcome: outcome => logger[outcome === 'failed' ? 'error' : 'info']('[HistoryImportPush]', { telemetryVersion: 1, outcome }),
    });
  } catch {
    // Platform retry can recover preparation failures; a committed claim always prevents another send.
    logger.error('[HistoryImportPush]', { telemetryVersion: 1, outcome: 'failed' });
    throw new Error('History import notification preparation or bookkeeping failed.');
  }
});
