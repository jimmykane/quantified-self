import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { certificationAuthority } from './authority';
import { configSchema } from './model';
import { DELIVERY_SERVICES } from '../../training-plans/delivery/connection';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('certification read-only authority / real Firestore', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  const now = Date.parse('2026-12-20T10:00:00Z');
  let uid: string;
  let claims: Record<string, unknown>;
  let disabled: boolean;
  const user = () => db.collection('users').doc(uid);
  const root = () => db.collection('garminAPITokens').doc(uid);
  const token = () => root().collection('tokens').doc('current');
  const meta = () => user().collection('meta').doc(DELIVERY_SERVICES.garmin.name);
  const auth = () => ({ app: { options: { projectId: 'demo-training-delivery' } },
    getUser: async () => ({ uid, disabled, customClaims: claims }) }) as unknown as Pick<Auth, 'getUser' | 'app'>;
  const read = () => certificationAuthority(db, auth(), configSchema.parse({ project: 'demo-training-delivery', uid,
    date: '2026-12-31', timeZone: 'Europe/Helsinki', sport: 'running' }), () => now)();
  beforeEach(async () => {
    uid = `certification-test-${randomUUID()}`; users.push(uid); claims = { stripeRole: 'pro' }; disabled = false;
    await user().set({ fixture: true });
    await meta().set({ connectionState: 'connected', connectionStateGeneration: 'g1', providerUserId: 'synthetic-garmin-account' });
    await root().set({ activeOAuthCredentialGeneration: 'credential-1' });
    await token().set({ serviceName: DELIVERY_SERVICES.garmin.name, userID: 'synthetic-garmin-account', permissions: ['WORKOUT_IMPORT'],
      tokenCredentialGeneration: 'credential-1', accessToken: 'synthetic-never-sent', expiresAt: now + 86400000 });
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id));
      await db.recursiveDelete(db.collection('garminAPITokens').doc(id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
    }
    await db.terminate();
  });
  it('resolves authoritative metadata without changing any source document', async () => {
    const refs = [user(), meta(), root(), token()];
    const before = await db.getAll(...refs);
    const transactions = vi.spyOn(db, 'runTransaction');
    const result = await read();
    expect(transactions.mock.lastCall?.[1]).toEqual({ maxAttempts: 3 }); transactions.mockRestore();
    expect(result.binding.generation).toBe('g1:credential-1'); expect(result.binding.destinationKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.accessToken).toBe('synthetic-never-sent'); expect(result.pro).toBe(true);
    const after = await db.getAll(...refs);
    expect(after.map(doc => doc.updateTime!.toMillis())).toEqual(before.map(doc => doc.updateTime!.toMillis()));
    expect((await user().listCollections()).map(collection => collection.id)).toEqual(['meta']);
  });
  it('reads free/Pro/grace correctly without blocking cleanup authority', async () => {
    claims = {}; expect((await read()).pro).toBe(false);
    claims = { gracePeriodUntil: now + 1 }; expect((await read()).pro).toBe(true);
    claims = { gracePeriodUntil: now }; expect((await read()).pro).toBe(false);
    claims = { gracePeriodUntil: String(now + 1) }; expect((await read()).pro).toBe(false);
  });
  it.each(['missing-user', 'tombstone', 'disabled'] as const)('fences %s accounts', async mode => {
    if (mode === 'missing-user') await user().delete();
    if (mode === 'tombstone') await db.collection('userDeletionTombstones').doc(uid).set({ expireAt: now + 86400000 });
    if (mode === 'disabled') disabled = true;
    await expect(read()).rejects.toMatchObject({ kind: 'auth' });
  });
  it.each(['permission', 'ambiguity', 'generation', 'disconnect', 'expiry'] as const)('blocks %s without refreshing/deauthorizing credentials', async mode => {
    if (mode === 'permission') await token().update({ permissions: ['ACTIVITY_EXPORT'] });
    if (mode === 'ambiguity') await root().collection('tokens').doc('other').set({ ...(await token().get()).data(), userID: 'different-account' });
    if (mode === 'generation') await root().update({ activeOAuthCredentialGeneration: 'other-generation' });
    if (mode === 'disconnect') await root().update({ disconnectOperationGeneration: 'disconnect-1' });
    if (mode === 'expiry') await token().update({ expiresAt: now + 10_000 });
    const before = await token().get();
    await expect(read()).rejects.toMatchObject({ kind: mode === 'permission' ? 'permission' : 'auth' });
    expect((await token().get()).updateTime).toEqual(before.updateTime);
  });
  it('exposes changed account/generation/epoch to the runner fence instead of accepting the old binding', async () => {
    const original = (await read()).binding;
    await meta().update({ connectionStateGeneration: 'g2' });
    expect((await read()).binding.generation).not.toBe(original.generation);
    await meta().update({ providerUserId: 'new-account' }); await token().update({ userID: 'new-account' });
    expect((await read()).binding.destinationKey).not.toBe(original.destinationKey);
    await user().collection('trainingDeliveryState').doc('current').set({ connectionEpochs: { garmin: 1 } });
    expect((await read()).binding.epoch).toBe(1);
  });
  it('rejects a mismatched Firebase app project', async () => {
    await expect(certificationAuthority(db, auth(), { project: 'different-project', uid, date: '2026-12-31', timeZone: 'Europe/Helsinki', sport: 'running' }, () => now)()).rejects.toMatchObject({ kind: 'auth' });
  });
});
