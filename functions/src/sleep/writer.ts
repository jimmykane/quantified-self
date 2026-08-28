import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SleepMapperResult,
    SleepProvider,
    SleepSession,
    SleepSyncStatus,
    SLEEP_PROVIDERS,
    SLEEP_SESSIONS_COLLECTION_ID,
    SLEEP_STAGES,
    SLEEP_SYNC_STATE_COLLECTION_ID,
    SLEEP_SYNC_STATUSES,
} from '../../../shared/sleep';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { generateIDFromParts } from '../utils';
import {
    areTokenCredentialSnapshotsEqual,
    getTokenCredentialSnapshot,
    type TokenCredentialSnapshot,
} from '../token-refresh-coordinator';

function userSleepSessionsRef(db: admin.firestore.Firestore, userID: string): admin.firestore.CollectionReference {
    return db
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SESSIONS_COLLECTION_ID);
}

function userSleepSyncStateRef(
    db: admin.firestore.Firestore,
    userID: string,
    provider: SleepProvider,
): admin.firestore.DocumentReference {
    return db
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SYNC_STATE_COLLECTION_ID)
        .doc(provider);
}

function cleanUndefined<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export interface SleepLifecycleWriterDependencies {
    /** Skip the Sleep write if this provider lifecycle document is absent. */
    requiredExistingDocumentRef?: admin.firestore.DocumentReference;
    /** Require the same in-memory OAuth credential revision at commit time. */
    requiredExistingTokenCredential?: TokenCredentialSnapshot;
    /** Skip unless the lifecycle authority still has every expected flat field value. */
    requiredDocumentFieldValues?: {
        documentRef: admin.firestore.DocumentReference;
        expectedFields: Readonly<Record<string, unknown>>;
    };
    /** Additional lifecycle authorities that must still have every expected flat field value. */
    additionalRequiredDocumentFieldValues?: ReadonlyArray<{
        documentRef: admin.firestore.DocumentReference;
        expectedFields: Readonly<Record<string, unknown>>;
    }>;
}

export class SleepLifecycleGuardReadError extends Error {
    public readonly name = 'SleepLifecycleGuardReadError';
    public readonly code = 'sleep_lifecycle_guard_unavailable';

    constructor() {
        super('Sleep lifecycle guard could not be read.');
    }
}

export class SleepLifecycleGuardConfigurationError extends Error {
    public readonly name = 'SleepLifecycleGuardConfigurationError';
    public readonly code = 'sleep_lifecycle_guard_invalid';

    constructor() {
        super('A Sleep token-credential guard requires a document reference.');
    }
}

function validateSleepLifecycleWriterDependencies(
    dependencies: SleepLifecycleWriterDependencies,
): void {
    if (dependencies.requiredExistingTokenCredential
        && !dependencies.requiredExistingDocumentRef) {
        throw new SleepLifecycleGuardConfigurationError();
    }
}

async function getSleepLifecycleGuardSnapshot(
    transaction: admin.firestore.Transaction,
    documentRef: admin.firestore.DocumentReference,
): Promise<admin.firestore.DocumentSnapshot> {
    try {
        return await transaction.get(documentRef);
    } catch {
        // Provider token document IDs can be raw account identifiers. Do not
        // propagate datastore paths into queue errors, sync state, or logs.
        throw new SleepLifecycleGuardReadError();
    }
}

async function sleepLifecycleFieldsMatch(
    transaction: admin.firestore.Transaction,
    guard: NonNullable<SleepLifecycleWriterDependencies['requiredDocumentFieldValues']>,
): Promise<boolean> {
    const snapshot = await getSleepLifecycleGuardSnapshot(transaction, guard.documentRef);
    const data = snapshot.exists
        ? snapshot.data() as Record<string, unknown> | undefined
        : undefined;
    return Boolean(data) && !Object.entries(guard.expectedFields)
        .some(([field, expectedValue]) => data?.[field] !== expectedValue);
}

async function allSleepLifecycleFieldsMatch(
    transaction: admin.firestore.Transaction,
    dependencies: SleepLifecycleWriterDependencies,
): Promise<boolean> {
    const guards = [
        ...(dependencies.requiredDocumentFieldValues
            ? [dependencies.requiredDocumentFieldValues]
            : []),
        ...(dependencies.additionalRequiredDocumentFieldValues || []),
    ];
    for (const guard of guards) {
        if (!(await sleepLifecycleFieldsMatch(transaction, guard))) {
            return false;
        }
    }
    return true;
}

function sleepLifecycleSnapshotMatchesCredential(
    snapshot: admin.firestore.DocumentSnapshot,
    expectedCredential: TokenCredentialSnapshot | undefined,
): boolean {
    if (!snapshot.exists) return false;
    if (!expectedCredential) return true;
    return areTokenCredentialSnapshotsEqual(
        getTokenCredentialSnapshot(snapshot.data() as Record<string, unknown> | undefined),
        expectedCredential,
    );
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

async function shouldSkipSleepUserWriteInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    userID: string,
    provider: SleepProvider,
    target: 'session' | 'state',
): Promise<boolean> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(userID, `sleep_sync_${target}_write`, error);
    }

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

function stableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableComparableValue);
    }
    if (!value || typeof value !== 'object') {
        return value === undefined ? null : value;
    }

    const source = value as Record<string, unknown>;
    return Object.keys(source)
        .sort()
        .reduce<Record<string, unknown>>((target, key) => {
            if (source[key] !== undefined) {
                target[key] = stableComparableValue(source[key]);
            }
            return target;
        }, {});
}

function comparableSleepSessionPayload(session: SleepSession | SleepMapperResult['session']): unknown {
    const payload = { ...(session as SleepSession) } as Record<string, unknown>;
    delete payload.id;
    delete payload.userID;
    delete payload.createdAtMs;
    delete payload.updatedAtMs;

    const source = payload.source && typeof payload.source === 'object'
        ? payload.source as Record<string, unknown>
        : {};
    payload.source = {
        ...source,
        callbackURL: undefined,
        receivedAtMs: undefined,
    };

    if (source.provider === SLEEP_PROVIDERS.COROSAPI) {
        // Daily Health fields written by the legacy COROS mapper must remain
        // recoverable until the explicit migration has persisted them. Ignore
        // them for idempotence so their deliberate omission from new mapper
        // output neither clears them through merge writes nor forces a write
        // on every poll.
        delete payload.hrvSamples;
        const providerFields = payload.providerFields && typeof payload.providerFields === 'object'
            ? { ...payload.providerFields as Record<string, unknown> }
            : null;
        const corosFields = providerFields?.coros && typeof providerFields.coros === 'object'
            ? { ...providerFields.coros as Record<string, unknown> }
            : null;
        if (providerFields && corosFields) {
            for (const field of ['step', 'calorie', 'rhr', 'ppgHrv', 'sleepAvgHr']) {
                delete corosFields[field];
            }
            providerFields.coros = corosFields;
            payload.providerFields = providerFields;
        }
    }

    return stableComparableValue(payload);
}

function isIdempotentSleepSessionWrite(existing: SleepSession, incoming: SleepMapperResult['session']): boolean {
    if (existing.source?.provider !== incoming.source?.provider
        || existing.source?.sourceSessionKey !== incoming.source?.sourceSessionKey) {
        return false;
    }

    return JSON.stringify(comparableSleepSessionPayload(existing)) === JSON.stringify(comparableSleepSessionPayload(incoming));
}

export async function upsertSleepSession(
    userID: string,
    mapperResult: SleepMapperResult,
    nowMs = Date.now(),
    dependencies: SleepLifecycleWriterDependencies = {},
): Promise<{
    id: string;
    session: SleepSession;
    written: boolean;
    lifecycleGuardSkipped?: true;
}> {
    validateSleepLifecycleWriterDependencies(dependencies);
    const provider = mapperResult.session.source.provider;
    const id = await buildSleepSessionDocumentId(
        userID,
        provider,
        mapperResult.sourceSessionKey,
    );
    const skippedSession: SleepSession = {
        ...mapperResult.session,
        id,
        userID,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
    };

    const db = admin.firestore();
    const docRef = userSleepSessionsRef(db, userID).doc(id);
    return db.runTransaction(async (transaction) => {
        if (await shouldSkipSleepUserWriteInTransaction(db, transaction, userID, provider, 'session')) {
            return { id, session: skippedSession, written: false };
        }
        if (dependencies.requiredExistingDocumentRef) {
            const lifecycleSnapshot = await getSleepLifecycleGuardSnapshot(
                transaction,
                dependencies.requiredExistingDocumentRef,
            );
            if (!sleepLifecycleSnapshotMatchesCredential(
                lifecycleSnapshot,
                dependencies.requiredExistingTokenCredential,
            )) {
                return {
                    id,
                    session: skippedSession,
                    written: false,
                    lifecycleGuardSkipped: true as const,
                };
            }
        }
        if (!(await allSleepLifecycleFieldsMatch(transaction, dependencies))) {
            return {
                id,
                session: skippedSession,
                written: false,
                lifecycleGuardSkipped: true as const,
            };
        }

        const existing = await transaction.get(docRef);
        const existingSession = existing.exists ? existing.data() as SleepSession : null;
        if (existingSession && shouldKeepExistingSleepSession(existingSession, mapperResult.session)) {
            logger.info(`[SleepSync] Preserved fuller ${provider} sleep session ${id} for ${userID}`);
            return { id, session: existingSession, written: false };
        }
        if (existingSession && isIdempotentSleepSessionWrite(existingSession, mapperResult.session)) {
            logger.info(`[SleepSync] Skipped unchanged ${provider} sleep session ${id} for ${userID}`);
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
        transaction.set(docRef, cleanUndefined(session), { merge: true });
        logger.info(`[SleepSync] Upserted ${provider} sleep session ${id} for ${userID}`);
        return { id, session, written: true };
    });
}

export async function upsertSleepSessions(
    userID: string,
    mapperResults: readonly SleepMapperResult[],
    nowMs = Date.now(),
    dependencies: SleepLifecycleWriterDependencies = {},
): Promise<{ written: number; skipped: number; lifecycleGuardSkipped?: true }> {
    validateSleepLifecycleWriterDependencies(dependencies);
    const provider = mapperResults.find((mapperResult) => mapperResult?.session?.source?.provider)?.session.source.provider;
    if (provider && await shouldSkipSleepUserWrite(userID, provider, 'session')) {
        return {
            written: 0,
            skipped: mapperResults.length,
        };
    }

    let written = 0;
    let skipped = 0;
    for (let index = 0; index < mapperResults.length; index += 1) {
        const mapperResult = mapperResults[index];
        if (!mapperResult?.sourceSessionKey) {
            skipped += 1;
            continue;
        }
        const result = await upsertSleepSession(userID, mapperResult, nowMs, dependencies);
        if (result.lifecycleGuardSkipped) {
            return {
                written,
                skipped: skipped + (mapperResults.length - index),
                lifecycleGuardSkipped: true,
            };
        }
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
        providerMinBackfillStartMs: number | null;
        providerMinBackfillStartProviderUserId: string | null;
        lastError: string | null;
    }>,
    nowMs = Date.now(),
    dependencies: SleepLifecycleWriterDependencies = {},
): Promise<boolean> {
    validateSleepLifecycleWriterDependencies(dependencies);
    const db = admin.firestore();
    const stateRef = userSleepSyncStateRef(db, userID, provider);
    return db.runTransaction(async (transaction) => {
        if (await shouldSkipSleepUserWriteInTransaction(db, transaction, userID, provider, 'state')) {
            return false;
        }
        if (dependencies.requiredExistingDocumentRef) {
            const lifecycleSnapshot = await getSleepLifecycleGuardSnapshot(
                transaction,
                dependencies.requiredExistingDocumentRef,
            );
            if (!sleepLifecycleSnapshotMatchesCredential(
                lifecycleSnapshot,
                dependencies.requiredExistingTokenCredential,
            )) {
                return false;
            }
        }
        if (!(await allSleepLifecycleFieldsMatch(transaction, dependencies))) {
            return false;
        }
        transaction.set(stateRef, cleanUndefined({
            provider,
            status: update.status || SLEEP_SYNC_STATUSES.Ready,
            ...update,
            updatedAtMs: nowMs,
        }), { merge: true });
        return true;
    });
}

export async function markSleepSyncError(
    userID: string,
    provider: SleepProvider,
    error: unknown,
    nowMs = Date.now(),
    dependencies: SleepLifecycleWriterDependencies = {},
): Promise<boolean> {
    const message = error instanceof Error ? error.message : `${error}`;
    return updateSleepSyncState(userID, provider, {
        status: SLEEP_SYNC_STATUSES.Failed,
        lastError: message,
    }, nowMs, dependencies);
}
