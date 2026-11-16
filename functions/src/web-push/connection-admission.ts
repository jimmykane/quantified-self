import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { automaticPushConfiguration } from './history-consent';
import { admitConnectionNotification } from './connection-service';
import type { ConnectionIncident } from './connection-policy';

async function connectionConfiguration() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound only this read. Racing the whole admission could leave writes running after auth cleanup resumes.
    return await Promise.race([
      automaticPushConfiguration('web_push_connection_attention_enabled'),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Connection notification configuration timed out.')), 5000);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Authentication/lifecycle recovery must never depend on notification preparation. */
export async function notifyConnectionAfterTransition(uid: string, incident: ConnectionIncident): Promise<void> {
  try { await admitConnectionNotification(uid, incident, { db: getFirestore(), now: Date.now,
    configuration: connectionConfiguration }); }
  catch { logger.error('[ConnectionAttentionPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); }
}
