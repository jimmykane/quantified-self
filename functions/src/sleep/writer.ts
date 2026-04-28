import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SleepMapperResult,
    SleepProvider,
    SleepSession,
    SleepSyncStatus,
    SLEEP_SESSIONS_COLLECTION_ID,
    SLEEP_SYNC_STATE_COLLECTION_ID,
    SLEEP_SYNC_STATUSES,
} from '../../../shared/sleep';
import { generateIDFromParts } from '../utils';

function userSleepSessionsRef(userID: string): admin.firestore.CollectionReference {
    return admin.firestore()
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SESSIONS_COLLECTION_ID);
}

function userSleepSyncStateRef(userID: string, provider: SleepProvider): admin.firestore.DocumentReference {
    return admin.firestore()
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SYNC_STATE_COLLECTION_ID)
        .doc(provider);
}

function cleanUndefined<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export async function buildSleepSessionDocumentId(userID: string, provider: SleepProvider, sourceSessionKey: string): Promise<string> {
    return generateIDFromParts([userID, provider, sourceSessionKey]);
}

export async function upsertSleepSession(
    userID: string,
    mapperResult: SleepMapperResult,
    nowMs = Date.now(),
): Promise<{ id: string; session: SleepSession }> {
    const id = await buildSleepSessionDocumentId(
        userID,
        mapperResult.session.source.provider,
        mapperResult.sourceSessionKey,
    );
    const docRef = userSleepSessionsRef(userID).doc(id);
    const existing = await docRef.get();
    const createdAtMs = existing.exists && typeof existing.data()?.createdAtMs === 'number'
        ? existing.data()?.createdAtMs as number
        : nowMs;
    const session: SleepSession = {
        ...mapperResult.session,
        id,
        userID,
        createdAtMs,
        updatedAtMs: nowMs,
    };
    await docRef.set(cleanUndefined(session), { merge: true });
    logger.info(`[SleepSync] Upserted ${mapperResult.session.source.provider} sleep session ${id} for ${userID}`);
    return { id, session };
}

export async function upsertSleepSessions(
    userID: string,
    mapperResults: readonly SleepMapperResult[],
    nowMs = Date.now(),
): Promise<{ written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;
    for (const mapperResult of mapperResults) {
        if (!mapperResult?.sourceSessionKey) {
            skipped += 1;
            continue;
        }
        await upsertSleepSession(userID, mapperResult, nowMs);
        written += 1;
    }
    return { written, skipped };
}

export async function updateSleepSyncState(
    userID: string,
    provider: SleepProvider,
    update: Partial<{
        status: SleepSyncStatus;
        lastWebhookAtMs: number | null;
        lastPollAtMs: number | null;
        nextPollFromMs: number | null;
        lastSyncedAtMs: number | null;
        lastError: string | null;
    }>,
    nowMs = Date.now(),
): Promise<void> {
    await userSleepSyncStateRef(userID, provider).set(cleanUndefined({
        provider,
        status: update.status || SLEEP_SYNC_STATUSES.Ready,
        ...update,
        updatedAtMs: nowMs,
    }), { merge: true });
}

export async function markSleepSyncError(
    userID: string,
    provider: SleepProvider,
    error: unknown,
    nowMs = Date.now(),
): Promise<void> {
    const message = error instanceof Error ? error.message : `${error}`;
    await updateSleepSyncState(userID, provider, {
        status: SLEEP_SYNC_STATUSES.Failed,
        lastError: message,
    }, nowMs);
}
