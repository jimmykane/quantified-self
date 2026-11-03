import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { buildPushTestPayload, isPushId, isPushOrigin, isPushRegistration, type PushRegistration, type PushTestResponse } from '../../../shared/web-push';

export interface PushServiceDependencies {
  db: Firestore;
  now: () => number;
  emulator: boolean;
  configuration: () => Promise<{ enabled: boolean; publicKey: string }>;
  send: (registration: PushRegistration, payload: string) => Promise<unknown>;
  outcome: (outcome: 'accepted' | 'expired' | 'failed') => void;
}
export async function sendPushTest(
  input: { uid?: string; impersonatedBy?: unknown; origin?: string; data: unknown },
  deps: PushServiceDependencies,
): Promise<PushTestResponse> {
  if (!input.uid) throw new HttpsError('unauthenticated', 'Sign in to test notifications.');
  if (input.impersonatedBy) throw new HttpsError('permission-denied', 'Notifications are unavailable during impersonation.');
  if (!isPushOrigin(input.origin, deps.emulator)) throw new HttpsError('permission-denied', 'Unsupported notification origin.');
  const data = input.data as { installationId?: unknown } | null;
  if (!data || Object.keys(data).length !== 1 || !isPushId(data.installationId)) {
    throw new HttpsError('invalid-argument', 'Choose a registered installation.');
  }
  const origin = input.origin;
  const ref = deps.db.doc(`users/${input.uid}/pushSubscriptions/${data.installationId}`);
  const rate = deps.db.doc(`users/${input.uid}/pushState/testRateLimit`);
  const uid = input.uid;
  const registration = await deps.db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(deps.db, tx, uid);
    const [snapshot, rateSnapshot] = await Promise.all([tx.get(ref), tx.get(rate)]);
    if (guard.shouldSkip) throw new HttpsError('failed-precondition', 'Account unavailable.');
    const registration = snapshot.data();
    if (!isPushRegistration(registration, deps.emulator) || registration.origin !== origin) {
      throw new HttpsError('failed-precondition', 'Enable notifications on this device first.');
    }
    const now = deps.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const saved = rateSnapshot.data();
    const count = saved?.day === day ? Number(saved.count) : 0;
    if ((saved && now - Number(saved.lastAttemptAt) < 60_000) || count >= 10 || !Number.isFinite(count)) {
      throw new HttpsError('resource-exhausted', 'Please wait before sending another test notification.');
    }
    tx.set(rate, { day, count: count + 1, lastAttemptAt: now });
    return registration;
  });
  const config = await deps.configuration();
  if (!config.enabled || !config.publicKey || registration.vapidPublicKey !== config.publicKey) {
    throw new HttpsError('failed-precondition', 'Notifications are unavailable or the device key needs updating.');
  }
  // Re-read the registration and deletion fence immediately before the external side effect.
  await deps.db.runTransaction(async tx => {
    const guard = await getUserDeletionGuardStateInTransaction(deps.db, tx, uid);
    const current = await tx.get(ref);
    if (guard.shouldSkip || !current.exists || current.get('generation') !== registration.generation) {
      throw new HttpsError('failed-precondition', 'Notification registration changed.');
    }
  });
  try {
    await deps.send(registration, JSON.stringify(buildPushTestPayload(origin)));
    deps.outcome('accepted');
    return { status: 'accepted' };
  } catch (error: unknown) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (status === 404 || status === 410) {
      await deps.db.runTransaction(async tx => {
        const current = await tx.get(ref);
        // Registration records are leaves; Rules prohibit all descendants.
        if (current.get('generation') === registration.generation) tx.delete(ref);
      });
      deps.outcome('expired');
      return { status: 'subscription_expired' };
    }
    deps.outcome('failed');
    throw new HttpsError('unavailable', 'The test could not be sent. Please try again later.');
  }
}
