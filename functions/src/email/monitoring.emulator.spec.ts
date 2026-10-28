import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { randomUUID } from 'crypto';
import { EMAIL_PROBE_LIMIT } from './monitoring';
import { observeEmailOutbox } from './monitoring-probe';
import { newEmailDeliveryFields } from './queue-metadata';

vi.unmock('firebase-admin');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
describe.skipIf(!enabled)('email monitoring (isolated demo Firestore, no SMTP/extension)', () => {
  let db: admin.firestore.Firestore;
  beforeAll(() => {
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw new Error('Loopback emulators required');
    }
    admin.initializeApp({ projectId: 'demo-email-monitoring' }); db = admin.firestore();
  });
  afterAll(async () => { await admin.app().delete(); });
  beforeEach(async () => { await db.recursiveDelete(db.collection('mail')); vi.clearAllMocks(); });
  const ref = () => db.collection('mail').doc(`synthetic-${randomUUID()}`);
  const samples = () => vi.mocked(logger.info).mock.calls.filter(call => (call[1] as Record<string, unknown>)?.event === 'outbox_sample')
    .map(call => call[1] as Record<string, unknown>);
  it('uses one original mail write with complete pending metadata and preserves payload/TTL', async () => {
    const mail = ref();
    await mail.create({ ...newEmailDeliveryFields(), to: 'private-canary@example.invalid', message: { text: 'private-body-canary' },
      expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 90 * 86_400_000) });
    const original = (await mail.get()).data()!;
    expect(original.delivery).toMatchObject({ state: 'PENDING', attempts: 0, error: null });
    expect(original.queuedAt.toMillis()).toBe(original.delivery.startTime.toMillis());
    await observeEmailOutbox(db, Date.now() + 20 * 60_000);
    expect(samples().find(sample => sample.source === 'transactional')).toMatchObject({ dueSample: 1 });
    expect((await mail.get()).data()).toEqual(original);
    expect(JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls])).not.toContain('private-');
  });
  it('idle mail, completed/error history and deleted mail are not backlog', async () => {
    const success = ref(); const error = ref(); const deleted = ref();
    await success.set({ delivery: { state: 'SUCCESS' } }); await error.set({ delivery: { state: 'ERROR' } });
    await deleted.set(newEmailDeliveryFields()); await deleted.delete();
    await observeEmailOutbox(db);
    expect(samples()).toHaveLength(2); expect(samples().every(sample => sample.dueSample === 0 && sample.unknownSample === 0)).toBe(true);
  });
  it('excludes live processing leases, observes expired leases and retains unknown metadata', async () => {
    const mail = ref(); await mail.set({ delivery: { state: 'PROCESSING', leaseExpireTime: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000) } });
    await observeEmailOutbox(db); expect(samples().every(sample => sample.dueSample === 0)).toBe(true);
    vi.clearAllMocks(); await observeEmailOutbox(db, Date.now() + 20 * 60_000);
    expect(samples().find(sample => sample.source === 'transactional')).toMatchObject({ dueSample: 1 });
    await mail.update({ delivery: { state: 'PROCESSING' } }); vi.clearAllMocks(); await observeEmailOutbox(db);
    expect(samples().find(sample => sample.source === 'transactional')).toMatchObject({ unknownSample: 1 });
    expect(samples().find(sample => sample.source === 'transactional').dueSample).toBeUndefined();
  });
  it('legacy pending mail uses document creation and explicit retry uses its latest write', async () => {
    const legacy = ref(); await legacy.set({ delivery: { state: 'PENDING' } }); await observeEmailOutbox(db, Date.now() + 20 * 60_000);
    expect(samples().find(sample => sample.source === 'transactional').ageLowerBoundMs).toBeGreaterThanOrEqual(20 * 60_000);
    await legacy.update({ delivery: { state: 'RETRY', attempts: 1 } }); vi.clearAllMocks(); await observeEmailOutbox(db);
    expect(samples().find(sample => sample.source === 'transactional').ageLowerBoundMs).toBeLessThan(1000);
    await legacy.update({ delivery: { state: 'PENDING', attempts: 2 } }); vi.clearAllMocks(); await observeEmailOutbox(db);
    expect(samples().find(sample => sample.source === 'transactional').ageLowerBoundMs).toBeLessThan(1000);
  });
  it('stress: 100 pending mails yield bounded lower bounds, never totals or private data', async () => {
    const batch = db.batch();
    for (let i = 0; i < 100; i++) batch.set(ref(), { ...newEmailDeliveryFields(), marketing: { campaignId: null }, message: { text: 'private-body-canary' } });
    await batch.commit(); await observeEmailOutbox(db, Date.now() + 20 * 60_000);
    expect(samples().find(sample => sample.source === 'marketing')).toMatchObject({ sampled: EMAIL_PROBE_LIMIT, dueSample: EMAIL_PROBE_LIMIT, truncated: true });
    expect(samples().find(sample => sample.source === 'transactional').dueSample).toBeUndefined();
    expect((await db.collection('mail').count().get()).data().count).toBe(100);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private-');
  });
});
