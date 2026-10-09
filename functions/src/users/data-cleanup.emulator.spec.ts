import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../wahoo/constants';
import {
    assertAccountCleanupQueryEmpty, assertAccountFirestoreRootAbsent, beginAccountDataCleanup,
    checkpointAccountDeletionIdentifiers, checkpointAccountDeletionTarget, completeAccountDataCleanup, deleteAccountFirestoreRoot,
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
            await db.recursiveDelete(db.doc(`userDeletionTombstones/${uid}`));
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
            if (ref.path === legacyRow.path && fail) {
                await legacyRow.delete(); // Fault injection: root gone, descendants still exist.
                throw new Error('synthetic queue interruption');
            }
            return remove(ref);
        });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('interruption');
            fail = false;
            expect((await legacyRow.get()).exists).toBe(false);
            expect((await legacyRow.collection('attempts').get()).empty).toBe(false);
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
        const { attemptId } = await beginAccountDataCleanup(db, uid);
        await checkpointAccountDeletionIdentifiers(db, uid, emptyIdentifiers, attemptId);
        await Promise.all(['synthetic-provider-one', 'synthetic-provider-two'].map(id =>
            checkpointAccountDeletionIdentifiers(db, uid, { ...emptyIdentifiers, suuntoUserNames: [id] }, attemptId)));
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
        await completeAccountDataCleanup(db, uid, restored.attemptId);
        const complete = (await marker.get()).data()!;
        expect(complete.cleanupStatus).toBe('complete');
        expect(complete.expireAt.toMillis() - Date.now()).toBeGreaterThan(6 * 86400_000);
        // Keep lookup identities for duplicate Auth events throughout completed retention.
        expect(complete.providerIdentifiers.suuntoUserNames).toHaveLength(2);
    });

    it('prevents superseded invocations and pending operational targets from recording completion', async () => {
        const uid = owner();
        const first = await beginAccountDataCleanup(db, uid);
        const second = await beginAccountDataCleanup(db, uid);
        await expect(completeAccountDataCleanup(db, uid, first.attemptId)).rejects.toThrow('superseded');
        await expect(checkpointAccountDeletionIdentifiers(db, uid, emptyIdentifiers, first.attemptId)).rejects.toThrow('superseded');
        const target = await checkpointAccountDeletionTarget(db, uid, second.attemptId, {
            path: `activitySyncQueue/${uid}`, fieldName: 'userID', value: uid, providerKeyed: false,
        });
        await expect(completeAccountDataCleanup(db, uid, second.attemptId)).rejects.toThrow('targets remain');
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.expireAt).toBeUndefined();
        await target.delete(); // Synthetic leaf checkpoint.
        await completeAccountDataCleanup(db, uid, second.attemptId);
    });

    it('preserves a different provider with the same ID string and no connected credentials', async () => {
        const uid = owner();
        const sharedId = `synthetic-shared-${uid}`;
        const owned = db.doc(`suuntoAppWorkoutQueue/${uid}`);
        const foreign = db.doc(`sleepSyncQueue/${uid}`);
        await owned.set({ firebaseUserID: uid, userName: sharedId });
        await foreign.set({ provider: 'COROSAPI', providerUserId: sharedId });
        const conflicted = db.doc(`activitySyncQueue/${uid}`);
        await conflicted.set({ userID: uid, firebaseUserID: owner() });
        const foreignProvider = `synthetic-foreign-${uid}`;
        const foreignSource = db.doc(`sleepSyncQueue/${uid}-foreign-source`);
        const foreignLegacy = db.doc(`suuntoAppWorkoutQueue/${uid}-foreign-legacy`);
        await foreignSource.set({ userID: uid, firebaseUserID: owner(), provider: 'SuuntoApp', providerUserId: foreignProvider });
        await foreignLegacy.set({ userName: foreignProvider });
        try {
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await owned.get()).exists).toBe(false);
            expect((await foreign.get()).exists).toBe(true);
            expect((await conflicted.get()).exists).toBe(true);
            expect((await foreignSource.get()).exists).toBe(true);
            expect((await foreignLegacy.get()).exists).toBe(true);
        } finally { await db.recursiveDelete(foreign); await db.recursiveDelete(conflicted); await db.recursiveDelete(foreignSource); await db.recursiveDelete(foreignLegacy); }
    }, 30_000);

    it('retries the real MCP owner cleanup after recursive deletion removes a parent and fails on descendants', async () => {
        const uid = owner();
        const root = db.doc(`mcpOAuthAccessTokens/${uid}`);
        await root.set({ uid });
        await root.collection('unknown').doc('retained').set({ synthetic: true });
        const remove = db.recursiveDelete.bind(db);
        let fail = true;
        const interruption = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            if (ref.path === root.path && fail) {
                await root.delete(); // Fault injection into real account cleanup.
                throw new Error('synthetic MCP interruption');
            }
            return remove(ref);
        });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('MCP interruption');
            expect((await root.get()).exists).toBe(false);
            expect((await root.collection('unknown').get()).empty).toBe(false);
            fail = false;
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await root.collection('unknown').get()).empty).toBe(true);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('complete');
        } finally { interruption.mockRestore(); await remove(root); }
    }, 30_000);

    it('recovers an MCP parent lost before interruption and refuses a reassigned checkpoint target', async () => {
        const uid = owner();
        const other = owner();
        const attempt = await beginAccountDataCleanup(db, uid);
        const root = db.doc(`mcpOAuthAccessTokens/${uid}`);
        await root.collection('unknown').doc('retained').set({ synthetic: true });
        await checkpointAccountDeletionTarget(db, uid, attempt.attemptId, {
            path: root.path, fieldName: 'uid', value: uid, providerKeyed: false,
        });
        const reassigned = db.doc(`activitySyncQueue/${uid}`);
        await reassigned.set({ userID: other });
        const checkpoint = await checkpointAccountDeletionTarget(db, uid, attempt.attemptId, {
            path: reassigned.path, fieldName: 'userID', value: uid, providerKeyed: false,
        });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('ownership changed');
            expect((await root.collection('unknown').get()).empty).toBe(true);
            expect((await reassigned.get()).data()?.userID).toBe(other);
            expect((await checkpoint.get()).exists).toBe(true);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.expireAt).toBeUndefined();
        } finally { await db.recursiveDelete(reassigned); }
    }, 30_000);

    it('rejects checkpoint paths outside operational roots without deleting another account', async () => {
        const uid = owner();
        const other = owner();
        await db.doc(`users/${other}`).set({ synthetic: true });
        const attempt = await beginAccountDataCleanup(db, uid);
        await checkpointAccountDeletionTarget(db, uid, attempt.attemptId, {
            path: `users/${other}`, fieldName: 'uid', value: uid, providerKeyed: false,
        });
        await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('outside the configured scope');
        expect((await db.doc(`users/${other}`).get()).exists).toBe(true);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.expireAt).toBeUndefined();
    }, 30_000);

    it('detects late token descendants below missing parents and completes only after a recursive retry', async () => {
        const uid = owner();
        const root = db.doc(`garminAPITokens/${uid}`);
        const child = root.collection('tokens').doc('missing').collection('unknown').doc('late');
        const remove = db.recursiveDelete.bind(db);
        let lateWrite = true;
        const writer = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            await remove(ref);
            if (ref.path === root.path && lateWrite) {
                lateWrite = false;
                await child.set({ synthetic: true });
            }
        });
        try {
            await expect(cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never)).rejects.toThrow('descendants remain');
            expect((await root.collection('tokens').get()).empty).toBe(true);
            expect((await child.get()).exists).toBe(true);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.expireAt).toBeUndefined();
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await child.get()).exists).toBe(false);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('complete');
        } finally { writer.mockRestore(); await remove(root); }
    }, 30_000);

    it('pages scoped queue cleanup and removes Wahoo provider-only dead letters without touching other owners', async () => {
        const uid = owner();
        const other = owner();
        const providerId = '60462';
        const batch = db.batch();
        const owned = [];
        const foreign = [];
        for (let index = 0; index < 101; index++) {
            const ref = db.doc(`activitySyncQueue/${uid}-owned-${index}`);
            owned.push(ref);
            batch.set(ref, { userID: uid });
            batch.set(ref.collection('unknown').doc('child'), { synthetic: true });
            const retained = db.doc(`activitySyncQueue/${uid}-foreign-${index}`);
            foreign.push(retained);
            batch.set(retained, { userID: uid, firebaseUserID: other });
        }
        const source = db.doc(`${WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME}/${uid}`);
        const deadLetter = db.doc(`failed_jobs/${uid}`);
        batch.set(source, { firebaseUserID: uid, wahooUserID: providerId });
        batch.set(deadLetter, { originalCollection: WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME, wahooUserID: Number(providerId) });
        await batch.commit();
        try {
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            for (const ref of owned) {
                expect((await ref.get()).exists).toBe(false);
                expect((await ref.collection('unknown').get()).empty).toBe(true);
            }
            expect((await source.get()).exists).toBe(false);
            expect((await deadLetter.get()).exists).toBe(false);
            for (const ref of foreign) expect((await ref.get()).exists).toBe(true);
        } finally { for (const ref of [...owned, ...foreign, source, deadLetter]) await db.recursiveDelete(ref); }
    }, 60_000);

    it('preserves literal custom UIDs during queue discovery, deletion and readback', async () => {
        const other = owner();
        const uid = ` ${other} `;
        owners.push(uid);
        const owned = db.doc(`activitySyncQueue/${other}-literal-uid`);
        const foreign = db.doc(`activitySyncQueue/${other}-trimmed-uid`);
        await db.doc(`users/${uid}`).set({ synthetic: true });
        await db.doc(`users/${other}`).set({ synthetic: true });
        await owned.set({ userID: uid });
        await foreign.set({ userID: other });
        try {
            await cleanupUserAccounts({ uid } as admin.auth.UserRecord, {} as never);
            expect((await owned.get()).exists).toBe(false);
            expect((await foreign.get()).exists).toBe(true);
            expect((await db.doc(`users/${other}`).get()).exists).toBe(true);
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()?.cleanupStatus).toBe('complete');
        } finally { await db.recursiveDelete(owned); await db.recursiveDelete(foreign); }
    }, 30_000);

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
