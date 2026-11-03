import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { createECDH } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import { FUNCTION_SECRET_BINDINGS, SECRET_PARAMS } from '../secrets';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, isFunctionsEmulator } from '../shared/callable-policy';
import { isVapidPublicKey } from '../../../shared/web-push';
import { sendPushTest } from './service';

export function parseVapidKeyPair(value: string): { publicKey: string; privateKey: string } {
  try {
    const pair = JSON.parse(value) as { publicKey: string; privateKey: string };
    if (!isVapidPublicKey(pair.publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(pair.privateKey)) throw new Error();
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(pair.privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== pair.publicKey) throw new Error();
    return { publicKey: pair.publicKey, privateKey: pair.privateKey };
  } catch { throw new HttpsError('failed-precondition', 'Notification signing configuration is unavailable.'); }
}

export const sendTestPushNotification = onCall({
  region: 'europe-west2', cors: ALLOWED_CORS_ORIGINS, memory: '256MiB', timeoutSeconds: 15,
  minInstances: 0, maxInstances: 2, concurrency: 20,
  secrets: FUNCTION_SECRET_BINDINGS.sendTestPushNotification,
}, async request => {
  enforceAppCheck(request);
  let pair: ReturnType<typeof parseVapidKeyPair> | undefined;
  try {
    return await sendPushTest({ uid: request.auth?.uid, impersonatedBy: request.auth?.token.impersonatedBy,
      origin: request.rawRequest.get('origin'), data: request.data }, {
      db: getFirestore(), now: Date.now, emulator: isFunctionsEmulator(),
      configuration: async () => {
        const template = await getRemoteConfig().getTemplate();
        // Shared flags deliberately use unconditional defaults, never client-targeting conditions.
        const enabled = template.parameters.web_push_enabled?.defaultValue;
        const key = template.parameters.web_push_vapid_public_key?.defaultValue;
        pair = parseVapidKeyPair(SECRET_PARAMS.WEB_PUSH_VAPID_KEYPAIR.value());
        const publicKey = key && 'value' in key ? key.value : '';
        return { enabled: !!enabled && 'value' in enabled && enabled.value === 'true' && publicKey === pair.publicKey, publicKey };
      },
      send: (subscription, payload) => webpush.sendNotification(subscription, payload, {
        vapidDetails: { subject: 'mailto:support@quantified-self.io', ...pair! },
        TTL: 60, timeout: 5000, urgency: 'normal',
      }),
      outcome: outcome => logger[outcome === 'failed' ? 'error' : 'info']('[WebPush]', { telemetryVersion: 1, outcome }),
    });
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    // SDK errors can contain endpoints, response bodies and signing material. Never forward/log them.
    logger.error('[WebPush]', { telemetryVersion: 1, outcome: 'failed' });
    throw new HttpsError('unavailable', 'Notifications are temporarily unavailable.');
  }
});
