import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { getTrainingDeliveryQueueStats } from './training-delivery-queue.stats';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training delivery admin counts with Firestore', () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
    const db = new Firestore({ projectId: 'demo-admin-training-delivery-stats' });
    afterAll(async () => { await db.terminate(); });

    it('counts due jobs and current statuses without reading private ledger documents', async () => {
        const now = Date.now();
        const before = await getTrainingDeliveryQueueStats(db, now);
        const uid = `synthetic-${randomUUID()}`;
        const queue = db.collection('trainingDeliveryQueue');
        const user = db.collection('users').doc(uid);
        await Promise.all([
            queue.doc(randomUUID()).set({ uid, kind: 'delivery', provider: 'garmin', dueAtMs: now - 1000 }),
            queue.doc(randomUUID()).set({ uid, kind: 'verification', provider: 'suunto', dueAtMs: now + 60_000 }),
            user.collection('trainingDeliveryStatuses').doc('garmin').set({ provider: 'garmin', status: 'retrying' }),
            user.collection('trainingDeliveryStatuses').doc('suunto').set({ provider: 'suunto', status: 'needs_attention' }),
            user.collection('trainingDeliveryStatuses').doc('retained').set({ provider: 'garmin', status: 'delivered', hasRemoteCopy: true }),
            user.collection('trainingDeliveryStatuses').doc('missing').set({ provider: 'garmin', status: 'delivered', hasRemoteCopy: false }),
            user.collection('trainingDeliveryLedger').doc('private').set({ provider: 'garmin', status: 'failed' }),
        ]);
        const after = await getTrainingDeliveryQueueStats(db, now);
        expect(after.jobsAvailable).toBe(true);
        expect(after.statusCountsAvailable).toBe(true);
        expect(after.jobs.total).toBe(before.jobs.total + 2);
        expect(after.jobs.due).toBe(before.jobs.due + 1);
        expect(after.jobs.delivery).toBe(before.jobs.delivery + 1);
        expect(after.outcomes.retrying).toBe(before.outcomes.retrying + 1);
        expect(after.outcomes.delivered).toBe(before.outcomes.delivered + 1);
        expect(after.outcomes.needsAttention).toBe(before.outcomes.needsAttention + 1);
        expect(after.outcomes.failed).toBe(before.outcomes.failed);
        expect(JSON.stringify(after)).not.toContain(uid);
    });
});
