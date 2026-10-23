import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
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

export interface AccountDeletionAttempt extends AccountDeletionIdentifiers { attemptId: string; }
export const ACCOUNT_DELETION_TARGETS_COLLECTION = 'operationalTargets';
export interface AccountDeletionTarget {
    path: string;
    fieldName: string;
    value: string;
    providerKeyed: boolean;
    // Minimal attribution survives a missing parent; never store queue payloads or credentials.
    ownerUid?: string | null;
    providerLookup?: { serviceName: string; tokenField: string; providerUserID: string } | null;
    sourceQueues?: string[];
}

/** Atomically restore lookup authority and supersede any older invocation. */
export async function beginAccountDataCleanup(db: admin.firestore.Firestore, uid: string): Promise<AccountDeletionAttempt> {
    const ref = marker(db, uid);
    const attemptId = randomUUID();
    return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const saved = snapshot.data()?.providerIdentifiers;
        tx.set(ref, {
            cleanupStatus: 'pending', cleanupAttemptId: attemptId,
            lastAttemptAt: FieldValue.serverTimestamp(),
            expireAt: FieldValue.delete(), completedAt: FieldValue.delete(),
        }, { merge: true });
        const strings = (key: keyof AccountDeletionIdentifiers): string[] =>
            Array.isArray(saved?.[key]) ? saved[key].filter((value: unknown) => typeof value === 'string' && value.length > 0) : [];
        return {
            attemptId,
            suuntoUserNames: strings('suuntoUserNames'), corosOpenIds: strings('corosOpenIds'),
            garminUserIDs: strings('garminUserIDs'), wahooUserIDs: strings('wahooUserIDs'),
        };
    });
}

async function requireCurrentAttempt(tx: admin.firestore.Transaction, ref: admin.firestore.DocumentReference, attemptId: string): Promise<void> {
    const snapshot = await tx.get(ref);
    if (!attemptId || snapshot.data()?.cleanupAttemptId !== attemptId || snapshot.data()?.cleanupStatus !== 'pending') {
        throw new Error('Account cleanup attempt was superseded.');
    }
}

/** Persist before removing credentials/queues; retries retain provider-only lookup authority. */
export async function checkpointAccountDeletionIdentifiers(
    db: admin.firestore.Firestore, uid: string, identifiers: AccountDeletionIdentifiers, attemptId: string,
): Promise<void> {
    const ref = marker(db, uid);
    const entries = Object.entries(identifiers).filter(([, values]) => values.length > 0);
    const providerIdentifiers = Object.fromEntries(entries.map(([key, values]) => [key, FieldValue.arrayUnion(...values)]));
    await db.runTransaction(async tx => {
        await requireCurrentAttempt(tx, ref, attemptId);
        if (entries.length) tx.set(ref, { providerIdentifiers }, { merge: true });
    });
}

/** A subcollection avoids the 1 MiB marker limit for accounts with many queue rows. */
export async function checkpointAccountDeletionTarget(
    db: admin.firestore.Firestore, uid: string, attemptId: string, target: AccountDeletionTarget,
): Promise<admin.firestore.DocumentReference> {
    const ref = marker(db, uid);
    const targetRef = ref.collection(ACCOUNT_DELETION_TARGETS_COLLECTION).doc(createHash('sha256').update(target.path).digest('hex'));
    await db.runTransaction(async tx => {
        await requireCurrentAttempt(tx, ref, attemptId);
        tx.set(targetRef, { ...target, attemptId });
    });
    return targetRef;
}

export async function removeAccountDeletionTargetCheckpoint(
    db: admin.firestore.Firestore, uid: string, attemptId: string, checkpoint: admin.firestore.DocumentReference,
): Promise<void> {
    await db.runTransaction(async tx => {
        await requireCurrentAttempt(tx, marker(db, uid), attemptId);
        const current = await tx.get(checkpoint);
        if (current.exists && current.get('attemptId') !== attemptId) throw new Error('Account cleanup target was superseded.');
        // Server-only leaf checkpoint; its target tree has already been verified absent.
        tx.delete(checkpoint);
    });
}

/** Keep native recursive enumeration; serialize each delete with ownership/revision checks. */
export async function deleteAccountOperationalTree(
    db: admin.firestore.Firestore, uid: string, attemptId: string,
    root: admin.firestore.DocumentSnapshot,
    beforeDelete: (transaction: admin.firestore.Transaction, isRoot: boolean) => Promise<void>,
): Promise<void> {
    const writer = db.bulkWriter();
    const flush = writer.flush.bind(writer);
    // Limit transaction pressure even when recursiveDelete streams a large subtree.
    const lanes: Promise<unknown>[] = Array.from({ length: 10 }, () => Promise.resolve());
    let laneIndex = 0;
    let firstError: unknown;
    let rootOperation: Promise<admin.firestore.WriteResult> | undefined;
    writer.delete = ref => {
        const isRoot = ref.path === root.ref.path;
        const lane = laneIndex++ % lanes.length;
        const prior = isRoot ? Promise.all(lanes) : lanes[lane];
        const operation = prior.then(async () => {
            if (firstError) throw firstError;
            return db.runTransaction(async transaction => {
                await requireCurrentAttempt(transaction, marker(db, uid), attemptId);
                const current = await transaction.get(root.ref);
                if (current.exists !== root.exists
                    || (root.exists && !current.updateTime!.isEqual(root.updateTime!))) {
                    throw new Error('Account operational target ownership changed.');
                }
                await beforeDelete(transaction, isRoot);
                transaction.delete(ref);
                const writeTime = Timestamp.now();
                return { writeTime, isEqual: (other: admin.firestore.WriteResult) => writeTime.isEqual(other.writeTime) };
            });
        });
        // Attach immediately: SDK consumers also observe the original rejection.
        void operation.catch(error => { firstError ??= error; });
        if (isRoot) rootOperation = operation;
        else lanes[lane] = operation;
        return operation;
    };
    writer.flush = async () => {
        await Promise.allSettled([...lanes, ...(rootOperation ? [rootOperation] : [])]);
        await flush();
    };
    try {
        await db.recursiveDelete(root.ref, writer);
    } finally {
        writer.flush = flush;
        await writer.close();
    }
}

export async function completeAccountDataCleanup(db: admin.firestore.Firestore, uid: string, attemptId: string): Promise<void> {
    const ref = marker(db, uid);
    await db.runTransaction(async tx => {
        await requireCurrentAttempt(tx, ref, attemptId);
        const targets = await tx.get(ref.collection(ACCOUNT_DELETION_TARGETS_COLLECTION).limit(1));
        if (!targets.empty) throw new Error('Account operational cleanup targets remain.');
        tx.set(ref, {
            cleanupStatus: 'complete', completedAt: FieldValue.serverTimestamp(),
            expireAt: Timestamp.fromMillis(Date.now() + COMPLETED_RETENTION_MS),
        }, { merge: true });
    });
}

export async function deleteAccountFirestoreRoot(db: admin.firestore.Firestore, uid: string, collection: typeof ACCOUNT_DELETION_ROOT_COLLECTIONS[number]): Promise<void> {
    marker(db, uid); // Validate before constructing a privileged target.
    await db.recursiveDelete(db.collection(collection).doc(uid));
}

/** listDocuments includes missing parents; an ordinary collection query does not. */
export async function assertAccountFirestoreRootAbsent(db: admin.firestore.Firestore, uid: string, collection: typeof ACCOUNT_DELETION_ROOT_COLLECTIONS[number]): Promise<void> {
    marker(db, uid);
    await assertAccountFirestoreTreeAbsent(db.collection(collection).doc(uid));
}

export async function assertAccountFirestoreTreeAbsent(root: admin.firestore.DocumentReference): Promise<void> {
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
    if (!shouldDelete) {
        if (!(await query.limit(1).get()).empty) throw new Error('Account operational cleanup remains.');
        return;
    }
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    while (true) {
        let pageQuery = query.limit(100);
        if (cursor) pageQuery = pageQuery.startAfter(cursor);
        const page = await pageQuery.get();
        for (const doc of page.docs) {
            if (await shouldDelete(doc)) throw new Error('Account operational cleanup remains.');
        }
        if (page.docs.length < 100) return;
        cursor = page.docs[page.docs.length - 1];
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
