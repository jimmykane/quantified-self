import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {
    assertAccountCleanupQueryEmpty, assertAccountFirestoreRootAbsent, beginAccountDataCleanup,
    checkpointAccountDeletionIdentifiers, completeAccountDataCleanup, deleteAccountFirestoreRoot,
} from './data-cleanup';
import { getUserDeletionGuardStateInTransaction, isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';

// Full owner-handler cases use real Firestore and cleanup guards; external I/O
// is replaced before imports so no provider, Storage or Extension can be invoked.
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-functions/v1', () => ({ region: () => ({ runWith: () => ({
    auth: { user: () => ({ onDelete: (handler: unknown) => handler }) },
}) }) }));
vi.mock('../OAuth2', () => ({ getServiceConfig: (service: string) => ({ tokenCollectionName: `${service}TestTokens` }) }));
vi.mock('../service-auth-lifecycle', () => ({
    SERVICE_AUTH_CLEANUP_REASONS: { AccountDeletion: 'account_deletion' },
    cleanupServiceConnectionForUser: vi.fn(async () => undefined),
}));
vi.mock('../mcp/oauth.service', () => ({ cleanupMcpOAuthStateForUser: vi.fn(async () => undefined) }));
vi.mock('../admin/marketing/cleanup', () => ({ cleanupMarketingCampaignRecipients: vi.fn(async () => 0) }));
vi.mock('../routes/rejected-original-cleanup', () => ({
    REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME: 'routeOriginalFileCleanup',
    cleanupRejectedRouteOriginalFilesForUser: vi.fn(async () => undefined),
}));
vi.mock('../service-disconnect-cleanup', () => ({
    SERVICE_DISCONNECT_CLEANUP_COLLECTION: 'serviceDisconnectCleanup',
    cleanupServiceDisconnectTasksForUser: vi.fn(async () => undefined),
}));
vi.mock('./data-cleanup', async importOriginal => ({
    ...await importOriginal<typeof import('./data-cleanup')>(),
    deleteAccountStorageFiles: vi.fn(async () => undefined),
    assertAccountStorageAbsent: vi.fn(async () => undefined),
}));
import { cleanupUserAccounts } from './cleanup';
vi.unmock('firebase-admin');
vi.unmock('firebase-admin/firestore');
const host = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!host)('native account deletion (loopback Firestore emulator)', () => {
    let db: admin.firestore.Firestore;
    const owners: string[] = [];
    const owner = () => {
        const uid = `deletion-test-${randomUUID()}`;
        owners.push(uid);
        return uid;
    };
    const emptyIdentifiers = { suuntoUserNames: [], corosOpenIds: [], garminUserIDs: [], wahooUserIDs: [] };
    beforeAll(() => {
        if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
        admin.initializeApp({ projectId: 'demo-account-deletion' });
        db = admin.firestore();
    });
    afterAll(async () => {
        for (const uid of owners) {
            await db.recursiveDelete(db.doc(`users/${uid}`));
            await db.recursiveDelete(db.doc(`customers/${uid}`));
            await db.doc(`userDeletionTombstones/${uid}`).delete(); // Server-only leaf checkpoint.
        }
        await admin.app().delete();
    });

    it('retries full-handler partial queue deletion with retained identifiers, recursive roots and account isolation', async () => {
        const uid = owner();
        const other = owner();
        const provider = `synthetic-provider-${uid}`;
        const queue = db.collection('suuntoAppWorkoutQueue');
        const uidRow = queue.doc(`${uid}-uid`);
        const legacyRow = queue.doc(`${uid}-provider-only`);
        const otherRow = queue.doc(`${uid}-other`);
        await db.doc(`users/${uid}`).set({ synthetic: true });
        await db.doc(`users/${uid}/healthSampleChunks/retained-until-cleanup`).set({ synthetic: true });
        await uidRow.set({ firebaseUserID: uid, userName: provider });
        await legacyRow.set({ userName: provider });
        await legacyRow.collection('attempts').doc('nested').set({ synthetic: true });
        await otherRow.set({ firebaseUserID: other, userName: provider });
        const remove = db.recursiveDelete.bind(db);
        let fail = true;
        const interruption = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            if (ref.path === legacyRow.path && fail) throw new Error('synthetic queue interruption');
            return remove(ref);
        });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('interruption');
            fail = false;
            expect((await legacyRow.get()).exists).toBe(true);
            expect((await uidRow.get()).exists).toBe(false);
            expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('pending');
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await legacyRow.get()).exists).toBe(false);
            expect((await legacyRow.collection('attempts').get()).empty).toBe(true);
            expect((await otherRow.get()).exists).toBe(true);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('complete');
        } finally {
            interruption.mockRestore();
            await remove(otherRow);
        }
    }, 30_000);

    it('refuses full-handler completion while an acknowledged reconciler retains a deferred lease', async () => {
        const uid = owner();
        const intent = db.doc(`routeOriginalFileCleanup/${uid}`);
        await intent.set({ userID: uid, syntheticLease: true });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('remains');
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.expireAt).toBeUndefined();
            await db.recursiveDelete(intent);
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('complete');
        } finally { await db.recursiveDelete(intent); }
    }, 30_000);

    it('removes 4,955 deep Health/Sleep/reservation descendants, including absent parents, without crossing owners', async () => {
        const uid = owner();
        const other = owner();
        await db.doc(`users/${other}/healthSourceRecords/retained`).set({ synthetic: true });
        await db.doc(`customers/${other}/subscriptions/retained`).set({ synthetic: true });
        await db.doc(`users/${uid}`).set({ synthetic: true });
        await db.doc(`customers/${uid}/subscriptions/one/invoices/missing/lines/one`).set({ synthetic: true });
        for (let offset = 0; offset < 4955; offset += 400) {
            const batch = db.batch();
            for (let index = offset; index < Math.min(offset + 400, 4955); index++) {
                const domain = ['healthSourceRecords', 'healthSampleChunks', 'sleepSessions', 'importReservations'][index % 4];
                // Both intermediate documents intentionally absent.
                batch.set(db.doc(`users/${uid}/${domain}/missing/revisions/missing/samples/${index}`), { synthetic: index });
            }
            await batch.commit();
        }
        await beginAccountDataCleanup(db, uid);
        await expect(assertAccountFirestoreRootAbsent(db, uid, 'customers')).rejects.toThrow('descendants remain');
        await deleteAccountFirestoreRoot(db, uid, 'users');
        await deleteAccountFirestoreRoot(db, uid, 'customers');
        await assertAccountFirestoreRootAbsent(db, uid, 'users');
        await assertAccountFirestoreRootAbsent(db, uid, 'customers');
        expect((await db.doc(`users/${other}/healthSourceRecords/retained`).get()).exists).toBe(true);
        expect((await db.doc(`customers/${other}/subscriptions/retained`).get()).exists).toBe(true);
        // Repeated/overlapping extension cleanup sees the same idempotent native targets.
        await Promise.all([deleteAccountFirestoreRoot(db, uid, 'users'), deleteAccountFirestoreRoot(db, uid, 'users')]);
    }, 120_000);

    it('keeps an unfinished fence and identifiers through interruption, repeated reads and concurrent checkpoints', async () => {
        const uid = owner();
        await db.doc(`users/${uid}`).set({ synthetic: true });
        const marker = db.doc(`userDeletionTombstones/${uid}`);
        await marker.set({ expireAt: Timestamp.fromMillis(Date.now() - 1) });
        await beginAccountDataCleanup(db, uid);
        await checkpointAccountDeletionIdentifiers(db, uid, emptyIdentifiers);
        await Promise.all(['synthetic-provider-one', 'synthetic-provider-two'].map(id =>
            checkpointAccountDeletionIdentifiers(db, uid, { ...emptyIdentifiers, suuntoUserNames: [id] })));
        await db.doc(`users/${uid}/sleepSessions/one`).set({ synthetic: true });
        await db.doc(`users/${uid}/healthSourceRecords/two`).set({ synthetic: true });
        const remove = db.recursiveDelete.bind(db);
        const interrupted = vi.spyOn(db, 'recursiveDelete').mockImplementationOnce(async () => {
            await remove(db.doc(`users/${uid}/sleepSessions/one`));
            throw new Error('synthetic interruption');
        });
        await expect(deleteAccountFirestoreRoot(db, uid, 'users')).rejects.toThrow('interruption');
        interrupted.mockRestore();
        const pending = (await marker.get()).data()!;
        expect(pending.expireAt).toBeUndefined();
        expect(isUserDeletionTombstoneActive(pending, Date.now() + 30 * 86400_000)).toBe(true);
        const restored = await beginAccountDataCleanup(db, uid);
        expect(restored.suuntoUserNames.sort()).toEqual(['synthetic-provider-one', 'synthetic-provider-two']);
        await deleteAccountFirestoreRoot(db, uid, 'users');
        await assertAccountFirestoreRootAbsent(db, uid, 'users');
        await completeAccountDataCleanup(db, uid);
        const complete = (await marker.get()).data()!;
        expect(complete.cleanupStatus).toBe('complete');
        expect(complete.expireAt.toMillis() - Date.now()).toBeGreaterThan(6 * 86400_000);
        // Keep lookup identities for duplicate Auth events throughout completed retention.
        expect(complete.providerIdentifiers.suuntoUserNames).toHaveLength(2);
    });

    it('orders a competing transaction-owned writer behind the deletion marker', async () => {
        const uid = owner();
        await db.doc(`users/${uid}`).set({ synthetic: true });
        let read!: () => void;
        let resume!: () => void;
        const readDone = new Promise<void>(resolve => { read = resolve; });
        const resumed = new Promise<void>(resolve => { resume = resolve; });
        let firstAttempt = true;
        const writer = db.runTransaction(async transaction => {
            const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (firstAttempt) { firstAttempt = false; read(); await resumed; }
            if (guard.shouldSkip) return false;
            transaction.set(db.doc(`users/${uid}/healthSourceRecords/late`), { synthetic: true });
            return true;
        });
        await readDone;
        // Firestore transactions can lock reads. Write the fence concurrently,
        // then release the writer; either order must be swept/fenced safely.
        const fence = beginAccountDataCleanup(db, uid);
        resume();
        await writer;
        await fence;
        await deleteAccountFirestoreRoot(db, uid, 'users');
        const lateWriter = await db.runTransaction(async transaction => {
            const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (guard.shouldSkip) return false;
            transaction.set(db.doc(`users/${uid}/healthSourceRecords/late`), { synthetic: true });
            return true;
        });
        expect(lateWriter).toBe(false);
        await assertAccountFirestoreRootAbsent(db, uid, 'users');
    }, 30_000);

    it('detects a late unguarded descendant and verifies top-level owned rows rather than an acknowledgement', async () => {
        const uid = owner();
        await beginAccountDataCleanup(db, uid);
        await deleteAccountFirestoreRoot(db, uid, 'users');
        await db.doc(`users/${uid}/unknown/missing/deep/late`).set({ synthetic: true });
        await expect(assertAccountFirestoreRootAbsent(db, uid, 'users')).rejects.toThrow('descendants remain');
        const ref = db.doc(`activitySyncQueue/${uid}`);
        await ref.set({ userID: uid });
        const query = db.collection('activitySyncQueue').where('userID', '==', uid);
        await expect(assertAccountCleanupQueryEmpty(query)).rejects.toThrow('remains');
        await db.recursiveDelete(ref);
        await assertAccountCleanupQueryEmpty(query);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('pending');
    });
});
