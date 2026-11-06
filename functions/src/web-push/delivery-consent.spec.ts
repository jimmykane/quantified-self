import { describe, it, expect } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readDeliveryNotificationRequest, validateDeliveryNotificationConsent } from './delivery-consent';
import { deliveryNotificationPayload } from '../../../shared/activity-delivery-notifications';

const target = { installationId: '00000000-0000-4000-8000-000000000001', generation: '00000000-0000-4000-8000-000000000002' };
const origin = 'https://quantified-self.io', publicKey = 'B' + 'A'.repeat(86);
describe('activity delivery consent', () => {
  it('accepts beta consent and binds it to a beta registration', async () => {
    const beta = 'https://beta.quantified-self.io';
    const request = readDeliveryNotificationRequest(target, beta)!;
    expect(request).toEqual({ ...target, origin: beta });
    const registration = { schemaVersion: 1, generation: target.generation, origin: beta, vapidPublicKey: publicKey,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } };
    const db = { doc: (path: string) => ({ path }) } as unknown as Firestore;
    const tx = { get: async ({ path }: { path: string }) => ({ data: () => path.includes('/meta/')
      ? { providerUserId: 'account', connectionState: 'connected', connectionStateGeneration: 'connection' }
      : path.includes('/notificationPreferences/') ? undefined : registration }) } as unknown as Transaction;
    expect(await validateDeliveryNotificationConsent(db, tx, 'owner', 'provider', 'account', request, publicKey)).toMatchObject({ origin: beta });
    const payload = deliveryNotificationPayload(beta, '/services', true);
    expect(payload.notification.navigate).toBe(beta + '/services');
  });
  it('leaves ordinary sends independent of notification configuration and permission', () => {
    expect(readDeliveryNotificationRequest(undefined)).toBeUndefined();
  });
  it.each([undefined, 'http://localhost:4200', 'https://evil.example'])('rejects opt-in from %s', source => {
    expect(() => readDeliveryNotificationRequest(target, source)).toThrow('your own account');
  });
  it('rejects impersonation and extra target fields', () => {
    expect(() => readDeliveryNotificationRequest(target, origin, 'admin')).toThrow('your own account');
    expect(() => readDeliveryNotificationRequest({ ...target, origin }, origin)).toThrow('registered');
  });
  it.each(['valid', 'off', 'malformed', 'wrong generation', 'wrong key', 'mismatched site', 'disconnected', 'wrong account', 'no connection generation'])('validates %s against authoritative records', async reason => {
    const registration = { schemaVersion: 1, generation: target.generation, origin, vapidPublicKey: publicKey,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } };
    const meta = { providerUserId: 'account', connectionState: 'connected', connectionStateGeneration: 'connection' };
    let preference: unknown;
    if (reason === 'off') preference = { schemaVersion: 1, enabled: false, revision: 1 };
    if (reason === 'malformed') preference = {};
    if (reason === 'wrong generation') registration.generation = '00000000-0000-4000-8000-000000000003';
    if (reason === 'wrong key') registration.vapidPublicKey = 'B' + 'B'.repeat(86);
    if (reason === 'mismatched site') registration.origin = 'https://beta.quantified-self.io';
    if (reason === 'disconnected') meta.connectionState = 'disconnect_pending';
    if (reason === 'wrong account') meta.providerUserId = 'other';
    if (reason === 'no connection generation') meta.connectionStateGeneration = '';
    const db = { doc: (path: string) => ({ path }) } as unknown as Firestore;
    const tx = { get: async ({ path }: { path: string }) => ({ data: () => path.includes('/meta/') ? meta : path.includes('/notificationPreferences/') ? preference : registration }) } as unknown as Transaction;
    const result = validateDeliveryNotificationConsent(db, tx, 'owner', 'provider', 'account', { ...target, origin }, publicKey);
    if (reason === 'valid') expect(await result).toEqual({ ...target, origin, categoryRevision: 0, connectionGeneration: 'connection' });
    else await expect(result).rejects.toThrow('settings');
  });
  it('uses generic truthful text and the same destination for declarative and worker clicks', () => {
    const payload = deliveryNotificationPayload(origin, '/send-activities/suunto?batch=batch', false);
    expect(payload.web_push).toBe(8030); expect(payload.notification.body).toContain('has finished');
    expect(payload.notification.navigate).toBe(origin + payload.notification.data.onActionClick.default.url);
    expect(deliveryNotificationPayload(origin, '/services', true).notification.body).toContain('needs attention');
    expect(() => deliveryNotificationPayload(origin, '//evil.example', true)).toThrow();
  });
});
