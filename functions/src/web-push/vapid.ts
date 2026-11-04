import { createECDH } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { isVapidPublicKey } from '../../../shared/web-push';

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
