import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { USER_DELETION_TOMBSTONES_COLLECTION } from '../shared/user-deletion-guard';

// Exact installed delete-user-data scope. Do not infer other buckets or paths.
export const ACCOUNT_DELETION_STORAGE_BUCKET = 'quantified-self-io';
export const ACCOUNT_DELETION_ROOT_COLLECTIONS = ['users', 'customers'] as const;
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AccountDeletionIdentifiers {
    suuntoUserNames: string[];
    corosOpenIds: string[];
    garminUserIDs: string[];
    wahooUserIDs: string[];
}

function marker(db: admin.firestore.Firestore, uid: string): admin.firestore.DocumentReference {
    if (!uid || uid.length > 128 || uid.includes('/')) throw new Error('Invalid account deletion UID.');
    return db.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid);
}

/** Also fences administrator-initiated Auth deletion and upgrades old expiring markers. */
export async function beginAccountDataCleanup(db: admin.firestore.Firestore, uid: string): Promise<AccountDeletionIdentifiers> {
    const ref = marker(db, uid);
    const snapshot = await ref.get();
    const saved = snapshot.data()?.providerIdentifiers;
    await ref.set({
        cleanupStatus: 'pending',
        lastAttemptAt: FieldValue.serverTimestamp(),
        expireAt: FieldValue.delete(),
        completedAt: FieldValue.delete(),
    }, { merge: true });
    const strings = (key: keyof AccountDeletionIdentifiers): string[] =>
        Array.isArray(saved?.[key]) ? saved[key].filter((value: unknown) => typeof value === 'string' && value.length > 0) : [];
    return {
        suuntoUserNames: strings('suuntoUserNames'), corosOpenIds: strings('corosOpenIds'),
        garminUserIDs: strings('garminUserIDs'), wahooUserIDs: strings('wahooUserIDs'),
    };
}

/** Persist before removing credentials/queues; retries must retain provider-only lookup authority. */
export async function checkpointAccountDeletionIdentifiers(
    db: admin.firestore.Firestore, uid: string, identifiers: AccountDeletionIdentifiers,
): Promise<void> {
    const ref = marker(db, uid);
    const entries = Object.entries(identifiers).filter(([, values]) => values.length > 0);
    if (!entries.length) return;
    const providerIdentifiers = Object.fromEntries(entries
        .map(([key, values]) => [key, FieldValue.arrayUnion(...values)]));
    await ref.set({ providerIdentifiers }, { merge: true });
}

export async function completeAccountDataCleanup(db: admin.firestore.Firestore, uid: string): Promise<void> {
    // Only the owner orchestrator calls this after every mandatory stage and absence check.
    await marker(db, uid).set({
        cleanupStatus: 'complete', completedAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + COMPLETED_RETENTION_MS),
    }, { merge: true });
}

export async function deleteAccountFirestoreRoot(db: admin.firestore.Firestore, uid: string, collection: typeof ACCOUNT_DELETION_ROOT_COLLECTIONS[number]): Promise<void> {
    marker(db, uid); // Validate before constructing a privileged target.
    await db.recursiveDelete(db.collection(collection).doc(uid));
}

/** listDocuments includes missing parents; an ordinary collection query does not. */
export async function assertAccountFirestoreRootAbsent(db: admin.firestore.Firestore, uid: string, collection: typeof ACCOUNT_DELETION_ROOT_COLLECTIONS[number]): Promise<void> {
    marker(db, uid);
    const root = db.collection(collection).doc(uid);
    if ((await root.get()).exists) throw new Error('Account Firestore root remains.');
    const pending = [root];
    while (pending.length) {
        const ref = pending.pop()!;
        for (const child of await ref.listCollections()) {
            if (!(await child.limit(1).get()).empty) throw new Error('Account Firestore descendants remain.');
            pending.push(...await child.listDocuments());
        }
    }
}

export async function assertAccountCleanupQueryEmpty(
    query: admin.firestore.Query,
    shouldDelete?: (doc: admin.firestore.QueryDocumentSnapshot) => Promise<boolean>,
): Promise<void> {
    const snapshot = await (shouldDelete ? query : query.limit(1)).get();
    for (const doc of snapshot.docs) {
        if (!shouldDelete || await shouldDelete(doc)) throw new Error('Account operational cleanup remains.');
    }
}

function configuredAccountDeletionBucket(): Bucket {
    const runtimeProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (runtimeProject && runtimeProject !== 'quantified-self-io') {
        throw new Error('Account deletion Storage project is outside the configured scope.');
    }
    const appProject = admin.app().options.projectId;
    if ((!runtimeProject && !appProject) || (appProject && appProject !== 'quantified-self-io')) {
        throw new Error('Account deletion Storage project is outside the configured scope.');
    }
    return admin.storage().bucket(ACCOUNT_DELETION_STORAGE_BUCKET);
}

function isNotFound(error: unknown): boolean {
    return Number((error as { code?: unknown })?.code) === 404;
}

/** Bounded pages/concurrency, exact UID boundary, generation-pinned deletes. */
export async function deleteAccountStorageFiles(uid: string, bucket?: Bucket): Promise<void> {
    if (!uid || uid.length > 128 || uid.includes('/')) throw new Error('Invalid account deletion UID.');
    bucket ??= configuredAccountDeletionBucket();
    const prefix = `users/${uid}/`;
    let pageToken: string | undefined;
    let failed = false;
    // The configured path can also name an object itself, not only a folder.
    // Read it exactly; listing the bare prefix would include neighbouring UIDs.
    const exactObject = bucket.file(`users/${uid}`);
    try {
        const [metadata] = await exactObject.getMetadata();
        if (!metadata.generation) throw new Error('Storage generation unavailable.');
        await exactObject.delete({ ifGenerationMatch: metadata.generation });
    } catch (error) {
        if (!isNotFound(error)) failed = true;
    }
    do {
        const [files, next] = await bucket.getFiles({ prefix, maxResults: 100, autoPaginate: false, pageToken });
        for (let index = 0; index < files.length; index += 10) {
            const results = await Promise.allSettled(files.slice(index, index + 10).map(async file => {
                if (!file.name.startsWith(prefix)) throw new Error('Storage listing escaped account prefix.');
                try {
                    const metadata = file.metadata.generation ? file.metadata : (await file.getMetadata())[0];
                    if (!metadata.generation) throw new Error('Storage generation unavailable.');
                    await file.delete({ ifGenerationMatch: metadata.generation });
                } catch (error) {
                    if (!isNotFound(error)) throw error;
                }
            }));
            if (results.some(result => result.status === 'rejected')) failed = true;
        }
        pageToken = next?.pageToken;
    } while (pageToken);
    if (failed) throw new Error('Account Storage cleanup did not complete.');
}

export async function assertAccountStorageAbsent(uid: string, bucket?: Bucket): Promise<void> {
    if (!uid || uid.length > 128 || uid.includes('/')) throw new Error('Invalid account deletion UID.');
    bucket ??= configuredAccountDeletionBucket();
    try {
        await bucket.file(`users/${uid}`).getMetadata();
        throw new Error('Account Storage objects remain.');
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    const [remaining] = await bucket.getFiles({ prefix: `users/${uid}/`, maxResults: 1, autoPaginate: false });
    if (remaining.length) throw new Error('Account Storage objects remain.');
}
