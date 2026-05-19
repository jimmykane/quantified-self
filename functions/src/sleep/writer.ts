import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SleepMapperResult,
    SleepProvider,
    SleepSession,
    SleepSyncStatus,
    SLEEP_SESSIONS_COLLECTION_ID,
    SLEEP_STAGES,
    SLEEP_SYNC_STATE_COLLECTION_ID,
    SLEEP_SYNC_STATUSES,
} from '../../../shared/sleep';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
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

async function shouldSkipSleepUserWrite(userID: string, provider: SleepProvider, target: 'session' | 'state'): Promise<boolean> {
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    if (!deletionGuard.shouldSkip) {
        return false;
    }

    logger.warn(
        `[SleepSync] Skipping ${provider} sleep sync ${target} write for user ${userID} because the user is missing or deletion is in progress.`,
    );
    return true;
}

export async function buildSleepSessionDocumentId(userID: string, provider: SleepProvider, sourceSessionKey: string): Promise<string> {
    return generateIDFromParts([userID, provider, sourceSessionKey]);
}

function stageDurationSeconds(session: Pick<SleepSession, 'stageDurationsSeconds'>, stages: readonly string[]): number {
    const stageDurations = session.stageDurationsSeconds || {};
    return stages.reduce((total, stage) => total + Math.max(0, Number(stageDurations[stage as keyof typeof stageDurations]) || 0), 0);
}

function shouldKeepExistingSleepSession(existing: SleepSession, incoming: SleepMapperResult['session']): boolean {
    if (existing.source?.provider !== incoming.source?.provider
        || existing.source?.sourceSessionKey !== incoming.source?.sourceSessionKey) {
        return false;
    }

    const sleepStages = [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem];
    const knownStages = [...sleepStages, SLEEP_STAGES.Awake];
    const existingSleepStageSeconds = stageDurationSeconds(existing, sleepStages);
    const incomingSleepStageSeconds = stageDurationSeconds(incoming as Pick<SleepSession, 'stageDurationsSeconds'>, sleepStages);
    const existingKnownStageSeconds = stageDurationSeconds(existing, knownStages);
    const incomingKnownStageSeconds = stageDurationSeconds(incoming as Pick<SleepSession, 'stageDurationsSeconds'>, knownStages);

    if (existingKnownStageSeconds > 0 && incomingKnownStageSeconds === 0) {
        return true;
    }

    return existing.isNap !== true
        && incoming.isNap === true
        && existingSleepStageSeconds > incomingSleepStageSeconds;
}

export async function upsertSleepSession(
    userID: string,
    mapperResult: SleepMapperResult,
    nowMs = Date.now(),
): Promise<{ id: string; session: SleepSession; written: boolean }> {
    const id = await buildSleepSessionDocumentId(
        userID,
        mapperResult.session.source.provider,
        mapperResult.sourceSessionKey,
    );
    if (await shouldSkipSleepUserWrite(userID, mapperResult.session.source.provider, 'session')) {
        return {
            id,
            session: {
                ...mapperResult.session,
                id,
                userID,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
            },
            written: false,
        };
    }
    const docRef = userSleepSessionsRef(userID).doc(id);
    const existing = await docRef.get();
    const existingSession = existing.exists ? existing.data() as SleepSession : null;
    if (existingSession && shouldKeepExistingSleepSession(existingSession, mapperResult.session)) {
        logger.info(`[SleepSync] Preserved fuller ${mapperResult.session.source.provider} sleep session ${id} for ${userID}`);
        return { id, session: existingSession, written: false };
    }

    const createdAtMs = existingSession && typeof existingSession.createdAtMs === 'number'
        ? existingSession.createdAtMs
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
    return { id, session, written: true };
}

export async function upsertSleepSessions(
    userID: string,
    mapperResults: readonly SleepMapperResult[],
    nowMs = Date.now(),
): Promise<{ written: number; skipped: number }> {
    const provider = mapperResults.find((mapperResult) => mapperResult?.session?.source?.provider)?.session.source.provider;
    if (provider && await shouldSkipSleepUserWrite(userID, provider, 'session')) {
        return {
            written: 0,
            skipped: mapperResults.length,
        };
    }

    let written = 0;
    let skipped = 0;
    for (const mapperResult of mapperResults) {
        if (!mapperResult?.sourceSessionKey) {
            skipped += 1;
            continue;
        }
        const result = await upsertSleepSession(userID, mapperResult, nowMs);
        if (result.written) {
            written += 1;
        } else {
            skipped += 1;
        }
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
        lastBackfillQueuedAtMs: number | null;
        lastBackfillStartMs: number | null;
        lastBackfillEndMs: number | null;
        lastBackfillQueueItems: number | null;
        nextBackfillAllowedAtMs: number | null;
        lastError: string | null;
    }>,
    nowMs = Date.now(),
): Promise<void> {
    if (await shouldSkipSleepUserWrite(userID, provider, 'state')) {
        return;
    }
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
