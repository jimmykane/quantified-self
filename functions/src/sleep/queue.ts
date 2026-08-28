import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    SleepMapperResult,
    SleepProvider,
    SLEEP_PROVIDERS,
    SLEEP_STAGES,
    SLEEP_SYNC_STATUSES,
} from '../../../shared/sleep';
import {
    HEALTH_PROVIDERS,
    HEALTH_SYNC_STATUSES,
} from '../../../shared/health';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import {
    SleepSyncQueueItemInterface,
    SleepSyncQueueItemType,
} from '../queue/queue-item.interface';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { enqueueSleepSyncTask, generateIDFromParts } from '../utils';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import {
    mapParsedCorosDailySleep,
    mapGarminSleepSummary,
    mapSuuntoSleepSample,
} from './provider-mappers';
import {
    buildSleepSessionDocumentId,
    markSleepSyncError,
    type SleepLifecycleWriterDependencies,
    updateSleepSyncState,
    upsertSleepSessions,
} from './writer';
import { replaceHealthSourceRecord, updateHealthSyncState } from '../health/writer';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import * as requestPromise from '../request-helper';
import { config } from '../config';
import { toSuuntoAuthorizationHeader } from '../suunto/authorization-header';
import {
    deferQueueItemForPendingDisconnect,
    increaseRetryCountForQueueItem,
    isCurrentSleepQueueTransition,
    markQueueItemSkipped,
    moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned,
    moveToDeadLetterQueueIfCurrentUserActive,
    PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
    ProviderOperationStillInFlightError,
    QUEUE_SKIPPED_REASONS,
    QueueResult,
    updateToProcessed,
} from '../queue-utils';
import { isSleepProviderEnabled, isSleepSyncUserAllowed, SLEEP_SYNC_DISABLED_PROVIDERS } from './provider-flags';
import {
    assertTrustedGarminCallbackURL,
    InvalidGarminCallbackUrlError,
    normalizeTrustedGarminCallbackURL,
} from './garmin-callback-url';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
    ProviderQueueUserDeletedOrDeletingError,
    ProviderQueueUserNotConnectedError,
} from '../queue/provider-queue-errors';
import {
    markQueueItemDispatchedIfUserActive,
    QueueDispatchMarkerResult,
} from '../queue/dispatch-marker';
import {
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from '../queue/cleanup-tombstone';
import { getActiveCOROSTokenSnapshot } from '../coros/account';
import {
    COROS_API_REQUEST_TIMEOUT_MS,
    COROS_DAILY_MAX_RECORDS,
    COROS_DAILY_MAX_RESPONSE_BYTES,
} from '../coros/constants';
import { formatCOROSCalendarDate, parseCOROSCalendarDate } from '../coros/date-range';
import { COROSDailyValidationError, parseCOROSDailyRecord } from '../coros/daily';
import { COROSDailyHealthResult, mapCOROSDailyHealth } from '../coros/daily-health';
import { getServiceConnectionMeta } from '../service-connection-meta';
import {
    ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
    areTokenCredentialSnapshotsEqual,
    getTokenCredentialSnapshot,
    TokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import {
    claimSleepQueueRevision,
    getSleepQueueRevisionIdentity,
    isCurrentSleepQueueRevision,
    releaseSleepQueueRevision,
} from './queue-revision';
import { getActiveRevisionProcessingLease } from '../queue/revision-processing-lease';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import {
    processSuuntoHealthQueueItem,
    sanitizeSuuntoHealthErrorForTelemetry,
    SuuntoHealthWriteLifecycleGuards,
} from '../suunto/health-sync';
import {
    SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH,
    SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS,
    SUUNTO_HEALTH_MAX_WINDOW_DAYS,
    SuuntoHealthResult,
} from '../suunto/health';
import {
    areSuuntoWebhookWriteLifecycleGuardsContinuous,
    captureActiveSuuntoWebhookWriteLifecycleGuards,
    captureCurrentSuuntoWebhookWriteLifecycleGuards,
    ensureSuuntoWebhookAccountBindingForProviderVerifiedToken,
    getSuuntoWebhookWriteLifecycleAuthorityDigest,
    type SuuntoWebhookWriteLifecycleGuards,
} from '../suunto/health-webhook-binding-lifecycle';
import {
    isGarminHealthSummaryType,
    isGarminSupportedSummaryType,
    type GarminSupportedSummaryType,
} from '../garmin/health-summary-types';
import {
    isGarminHealthSyncEnabled,
    isGarminHealthSyncUserAllowed,
} from '../garmin/health-rollout';
import {
    captureActiveGarminHealthWriteLifecycleGuards,
    GarminHealthAccountValidationError,
    type GarminHealthWriteLifecycleGuards,
} from '../garmin/health-lifecycle';
import {
    GarminHealthPermissionError,
    processGarminHealthQueueItem,
    sanitizeGarminHealthErrorForTelemetry,
} from '../garmin/health-sync';
import { GarminHealthValidationError, type GarminHealthResult } from '../garmin/health';

type TokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

class SuuntoSleepLifecycleChangedError extends Error {
    public readonly name = 'SuuntoSleepLifecycleChangedError';

    constructor() {
        super('Suunto Sleep account lifecycle changed.');
    }
}

class SuuntoCredentialRotationRetryableError extends Error {
    public readonly name = 'SuuntoCredentialRotationRetryableError';

    constructor() {
        super('Suunto credential rotated repeatedly during an authorized write.');
    }
}

const SUUNTO_CREDENTIAL_GUARD_WRITE_ATTEMPTS = 3;
const GARMIN_SLEEP_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const GARMIN_SLEEP_REQUEST_TIMEOUT_MS = 30_000;

interface COROSWriteLifecycleGuards {
    requiredExistingDocumentRef: admin.firestore.DocumentReference;
    requiredExistingTokenCredential: TokenCredentialSnapshot;
    requiredDocumentFieldValues: {
        documentRef: admin.firestore.DocumentReference;
        expectedFields: Readonly<Record<string, unknown>>;
    };
    additionalRequiredDocumentFieldValues: ReadonlyArray<{
        documentRef: admin.firestore.DocumentReference;
        expectedFields: Readonly<Record<string, unknown>>;
    }>;
}

interface AddSleepSyncQueueItemInput {
    type: SleepSyncQueueItemType;
    provider: SleepProvider;
    providerUserId: string;
    userID?: string;
    payload?: unknown;
    callbackURL?: string;
    garminCallbackURLs?: string[];
    garminSummaryType?: GarminSupportedSummaryType;
    garminHealthTokenCredentialGeneration?: string | null;
    garminHealthRootOAuthCredentialGeneration?: string | null;
    garminHealthConnectionStateGeneration?: string | null;
    rangeStartMs?: number;
    rangeEndMs?: number;
    healthTrigger?: 'poll' | 'webhook' | 'backfill';
    dedupeKey?: string;
    dispatchImmediately?: boolean;
    suuntoHealthTokenCredentialGeneration?: string | null;
    suuntoHealthRootOAuthCredentialGeneration?: string | null;
    suuntoHealthConnectionStateGeneration?: string | null;
    suuntoWebhookAuthorityDigest?: string;
    /** Server-only write fences. These references are never persisted in the queue payload. */
    requiredDocumentFieldValues?: ReadonlyArray<{
        documentRef: admin.firestore.DocumentReference;
        expectedFields: Readonly<Record<string, unknown>>;
    }>;
}

const GARMIN_PING_BINDING_LOOKUP_BATCH_SIZE = 30;
const GARMIN_PING_BINDING_LOOKUP_CONCURRENCY = 16;
export const GARMIN_PING_BATCH_MAX_CALLBACKS = 250;
export const GARMIN_PING_BATCH_MAX_CALLBACK_BYTES = 700 * 1024;

function queueCollection(): admin.firestore.CollectionReference {
    return admin.firestore().collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME);
}

function providerUserIdTokenField(provider: SleepProvider): string | null {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return 'userID';
        case SLEEP_PROVIDERS.SuuntoApp:
            return 'userName';
        case SLEEP_PROVIDERS.COROSAPI:
            return 'openId';
        default:
            return null;
    }
}

const SLEEP_SYNC_QUEUE_ITEM_TYPES = new Set<SleepSyncQueueItemType>([
    'garmin_ping',
    'garmin_ping_batch',
    'garmin_push',
    'suunto_webhook',
    'suunto_poll',
    'suunto_health_poll',
    'coros_poll',
]);
const SUUNTO_HEALTH_QUEUE_TRIGGERS = new Set(['poll', 'webhook', 'backfill']);
const MAX_LIFECYCLE_GENERATION_LENGTH = 128;
const GARMIN_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH = 512;

function normalizeLifecycleGeneration(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isValidOptionalLifecycleGeneration(value: unknown): boolean {
    return value === undefined
        || value === null
        || (typeof value === 'string'
            && value.trim() === value
            && value.length > 0
            && value.length <= MAX_LIFECYCLE_GENERATION_LENGTH);
}

function isValidSleepProvider(value: unknown): value is SleepProvider {
    return Object.values(SLEEP_PROVIDERS).includes(value as SleepProvider);
}

function getMalformedSleepQueueItemReason(queueItem: SleepSyncQueueItemInterface): string | null {
    if (!SLEEP_SYNC_QUEUE_ITEM_TYPES.has(queueItem.type)) {
        return `invalid type ${queueItem.type || 'missing'}`;
    }
    if (!isValidSleepProvider(queueItem.provider)) {
        return `invalid provider ${queueItem.provider || 'missing'}`;
    }
    const garminSummaryType = queueItem.garminSummaryType
        || (queueItem.provider === SLEEP_PROVIDERS.GarminAPI ? 'sleeps' : undefined);
    if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI
        && (queueItem.type === 'garmin_ping'
            || queueItem.type === 'garmin_ping_batch'
            || queueItem.type === 'garmin_push')
        && !isGarminSupportedSummaryType(garminSummaryType)) {
        return 'Garmin queue item has an invalid summary family';
    }
    if (queueItem.provider !== SLEEP_PROVIDERS.GarminAPI
        && (queueItem.garminSummaryType !== undefined
            || queueItem.garminCallbackURLs !== undefined
            || queueItem.garminHealthTokenCredentialGeneration !== undefined
            || queueItem.garminHealthRootOAuthCredentialGeneration !== undefined
            || queueItem.garminHealthConnectionStateGeneration !== undefined)) {
        return 'non-Garmin queue item unexpectedly contains Garmin Health fields';
    }
    if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI
        && !isGarminHealthSummaryType(garminSummaryType)
        && (queueItem.garminHealthTokenCredentialGeneration !== undefined
            || queueItem.garminHealthRootOAuthCredentialGeneration !== undefined
            || queueItem.garminHealthConnectionStateGeneration !== undefined)) {
        return 'Garmin Sleep queue item unexpectedly contains Garmin Health lifecycle fences';
    }
    if (isGarminHealthSummaryType(garminSummaryType)
        && (!isValidOptionalLifecycleGeneration(queueItem.garminHealthTokenCredentialGeneration)
            || !isValidOptionalLifecycleGeneration(queueItem.garminHealthRootOAuthCredentialGeneration)
            || !isValidOptionalLifecycleGeneration(queueItem.garminHealthConnectionStateGeneration))) {
        return 'Garmin Health queue item has invalid lifecycle fences';
    }
    if (queueItem.type === 'suunto_health_poll' && queueItem.provider !== SLEEP_PROVIDERS.SuuntoApp) {
        return 'Suunto Health queue item has an invalid provider';
    }
    if (queueItem.type === 'suunto_health_poll'
        && !SUUNTO_HEALTH_QUEUE_TRIGGERS.has(`${queueItem.healthTrigger || ''}`)) {
        return 'Suunto Health queue item has an invalid trigger';
    }
    if (queueItem.type === 'suunto_health_poll'
        && (!Number.isSafeInteger(queueItem.rangeStartMs)
            || !Number.isSafeInteger(queueItem.rangeEndMs)
            || Number(queueItem.rangeStartMs) < 0
            || Number(queueItem.rangeEndMs) <= Number(queueItem.rangeStartMs)
            || Number(queueItem.rangeEndMs) > SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS
            || Number(queueItem.rangeEndMs) - Number(queueItem.rangeStartMs)
                > SUUNTO_HEALTH_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000)) {
        return 'Suunto Health queue item has an invalid range';
    }
    if (queueItem.type !== 'suunto_health_poll' && queueItem.healthTrigger !== undefined) {
        return 'sleep queue item unexpectedly contains a Health trigger';
    }
    if (queueItem.type !== 'suunto_health_poll'
        && (queueItem.suuntoHealthTokenCredentialGeneration !== undefined
            || queueItem.suuntoHealthRootOAuthCredentialGeneration !== undefined
            || queueItem.suuntoHealthConnectionStateGeneration !== undefined)) {
        return 'sleep queue item unexpectedly contains Suunto Health lifecycle fences';
    }
    if (queueItem.type === 'suunto_webhook'
        && !/^[a-f0-9]{64}$/.test(`${queueItem.suuntoWebhookAuthorityDigest || ''}`)) {
        return 'Suunto Sleep webhook queue item has an invalid authority fence';
    }
    if (queueItem.type !== 'suunto_webhook'
        && queueItem.suuntoWebhookAuthorityDigest !== undefined) {
        return 'non-webhook queue item unexpectedly contains a Suunto authority fence';
    }
    if (queueItem.type === 'garmin_ping_batch'
        && !parseGarminPingBatchCallbackURLs(
            queueItem.garminCallbackURLs,
            garminSummaryType,
        )) {
        return 'Garmin Ping batch has invalid callback URLs';
    }
    if (queueItem.type === 'suunto_health_poll'
        && (!isValidOptionalLifecycleGeneration(queueItem.suuntoHealthTokenCredentialGeneration)
            || !isValidOptionalLifecycleGeneration(
                queueItem.suuntoHealthRootOAuthCredentialGeneration,
            )
            || !isValidOptionalLifecycleGeneration(queueItem.suuntoHealthConnectionStateGeneration))) {
        return 'Suunto Health queue item has invalid lifecycle fences';
    }
    if (typeof queueItem.providerUserId !== 'string' || queueItem.providerUserId.trim().length === 0) {
        return 'missing providerUserId';
    }
    if (isGarminHealthSummaryType(garminSummaryType)
        && queueItem.providerUserId.trim().length > GARMIN_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
        return 'Garmin Health queue item has an invalid provider account identifier';
    }
    if (queueItem.type === 'suunto_health_poll'
        && queueItem.providerUserId.trim().length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
        return 'Suunto Health queue item has an invalid provider account identifier';
    }
    return null;
}

function parseGarminPingBatchCallbackURLs(
    value: unknown,
    summaryType: GarminSupportedSummaryType | undefined,
): string[] | null {
    if (!Array.isArray(value)
        || Buffer.byteLength(JSON.stringify(value), 'utf8')
            > GARMIN_PING_BATCH_MAX_CALLBACK_BYTES
        || !isGarminSupportedSummaryType(summaryType)) {
        return null;
    }
    if (value.length === 0 || value.length > GARMIN_PING_BATCH_MAX_CALLBACKS) {
        return null;
    }
    const normalized = value.map(callbackURL => normalizeTrustedGarminCallbackURL(
        typeof callbackURL === 'string' ? callbackURL : null,
        summaryType,
    ));
    return normalized.every((callbackURL): callbackURL is string => Boolean(callbackURL))
        ? normalized
        : null;
}

function compactQueuePayload(input: AddSleepSyncQueueItemInput): Partial<SleepSyncQueueItemInterface> {
    const payload: Partial<SleepSyncQueueItemInterface> = {
        type: input.type,
        provider: input.provider,
        providerUserId: input.providerUserId,
        userID: input.userID,
        payload: input.payload,
        callbackURL: input.callbackURL,
        garminCallbackURLs: input.garminCallbackURLs,
        garminSummaryType: input.garminSummaryType,
        garminHealthTokenCredentialGeneration: input.garminHealthTokenCredentialGeneration,
        garminHealthRootOAuthCredentialGeneration:
            input.garminHealthRootOAuthCredentialGeneration,
        garminHealthConnectionStateGeneration: input.garminHealthConnectionStateGeneration,
        rangeStartMs: input.rangeStartMs,
        rangeEndMs: input.rangeEndMs,
        healthTrigger: input.healthTrigger,
        suuntoHealthTokenCredentialGeneration: input.suuntoHealthTokenCredentialGeneration,
        suuntoHealthRootOAuthCredentialGeneration:
            input.suuntoHealthRootOAuthCredentialGeneration,
        suuntoHealthConnectionStateGeneration: input.suuntoHealthConnectionStateGeneration,
        suuntoWebhookAuthorityDigest: input.suuntoWebhookAuthorityDigest,
    };
    return JSON.parse(JSON.stringify(payload)) as Partial<SleepSyncQueueItemInterface>;
}

function stableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableComparableValue);
    }
    if (!value || typeof value !== 'object') {
        return value === undefined ? null : value;
    }

    const record = value as Record<string, unknown>;
    return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((target, key) => {
            if (record[key] !== undefined) {
                target[key] = stableComparableValue(record[key]);
            }
            return target;
        }, {});
}

function comparableQueuePayload(payload: Partial<SleepSyncQueueItemInterface>): unknown {
    return stableComparableValue({
        type: payload.type,
        provider: payload.provider,
        providerUserId: payload.providerUserId,
        userID: payload.userID,
        payload: payload.payload,
        callbackURL: payload.callbackURL,
        garminSummaryType: payload.garminSummaryType,
        garminHealthTokenCredentialGeneration: payload.garminHealthTokenCredentialGeneration,
        garminHealthRootOAuthCredentialGeneration:
            payload.garminHealthRootOAuthCredentialGeneration,
        garminHealthConnectionStateGeneration: payload.garminHealthConnectionStateGeneration,
        rangeStartMs: payload.rangeStartMs,
        rangeEndMs: payload.rangeEndMs,
        healthTrigger: payload.healthTrigger,
        suuntoHealthTokenCredentialGeneration: payload.suuntoHealthTokenCredentialGeneration,
        suuntoHealthRootOAuthCredentialGeneration:
            payload.suuntoHealthRootOAuthCredentialGeneration,
        suuntoHealthConnectionStateGeneration: payload.suuntoHealthConnectionStateGeneration,
        suuntoWebhookAuthorityDigest: payload.suuntoWebhookAuthorityDigest,
    });
}

function queuePayloadFingerprint(payload: Partial<SleepSyncQueueItemInterface>): string {
    return JSON.stringify(comparableQueuePayload(payload));
}

function isSameQueuePayload(
    existing: Partial<SleepSyncQueueItemInterface>,
    incoming: Partial<SleepSyncQueueItemInterface>,
): boolean {
    return queuePayloadFingerprint(existing) === queuePayloadFingerprint(incoming);
}

function moveSleepQueueItemToDeadLetterQueue(
    queueItem: SleepSyncQueueItemInterface,
    error: Error,
    context: string,
    resolvedUserID?: string | null,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {
    const userID = `${resolvedUserID || queueItem.userID || ''}`.trim();
    if (!userID) {
        return moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned({
            queueItem,
            error,
            context,
            collectionName: SLEEP_SYNC_QUEUE_COLLECTION_NAME,
            logPrefix: 'SleepSyncLegacy',
            isCurrent: currentQueueItem => isCurrentSleepQueueTransition(currentQueueItem, queueItem),
        });
    }
    return moveToDeadLetterQueueIfCurrentUserActive({
        queueItem,
        error,
        context,
        userID,
        phase: `sleep_sync_dlq:${context}`,
        logPrefix: 'SleepSync',
        isCurrent: currentQueueItem => isCurrentSleepQueueTransition(currentQueueItem, queueItem),
    });
}

function firebaseUserIdFromSleepTokenSnapshotOrNull(tokenSnapshot: TokenSnapshot | null): string | null {
    return tokenSnapshot?.ref.parent.parent?.id || null;
}

async function resolveFirebaseUserIDForSleepQueueInput(
    input: AddSleepSyncQueueItemInput,
    queueId: string,
): Promise<string> {
    if (input.userID) {
        return input.userID;
    }

    const tokenSnapshot = await findSleepTokenByProviderUserId(input.provider, input.providerUserId);
    const firebaseUserID = firebaseUserIdFromSleepTokenSnapshotOrNull(tokenSnapshot);
    if (!firebaseUserID) {
        throw new ProviderQueueUserNotConnectedError(
            serviceNameForProvider(input.provider),
            input.providerUserId,
            queueId,
        );
    }
    return firebaseUserID;
}

async function assertSleepQueueUserCanReceiveWork(
    input: AddSleepSyncQueueItemInput,
    userID: string,
    queueId: string,
    phase: string,
): Promise<void> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(userID, phase, error);
    }

    if (!deletionGuard.shouldSkip) {
        return;
    }

    logger.warn(`[SleepSync] Skipping queue item ${queueId} for ${input.provider} because user ${userID} is missing or deletion is in progress.`);
    throw new ProviderQueueUserDeletedOrDeletingError(
        serviceNameForProvider(input.provider),
        userID,
        input.providerUserId,
        queueId,
    );
}

async function deleteSleepQueueDocAfterDeletionGuard(
    docRef: admin.firestore.DocumentReference,
    queueId: string,
    userID: string,
): Promise<void> {
    try {
        const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
            SLEEP_SYNC_QUEUE_COLLECTION_NAME,
            queueId,
            QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
        );
        if (!tombstoneWritten) {
            logger.error(`[SleepSync] Failed to write cleanup tombstone for queue item ${queueId}; leaving item in place to avoid missing-doc Cloud Task retries.`);
            return;
        }
        await admin.firestore().recursiveDelete(docRef);
        logger.info(`[SleepSync] Deleted queue item ${queueId} for deleting user ${userID} before Cloud Task dispatch.`);
    } catch (error) {
        logger.error(`[SleepSync] Failed to delete queue item ${queueId} after deletion guard tripped for user ${userID}`, error);
    }
}

interface SleepQueueWriteResult {
    queueRevision: string;
    dateCreated: number;
    shouldDispatchImmediately: boolean;
}

async function prepareGarminHealthQueueAdmission(
    input: AddSleepSyncQueueItemInput,
    userID: string,
    queueId: string,
): Promise<AddSleepSyncQueueItemInput> {
    if (!isGarminHealthSummaryType(input.garminSummaryType)) return { ...input, userID };
    if (!isGarminHealthSyncEnabled() || !isGarminHealthSyncUserAllowed(userID)) {
        throw new ProviderQueueUserNotConnectedError(
            ServiceNames.GarminAPI,
            input.providerUserId,
            queueId,
        );
    }
    const tokenSnapshot = await admin.firestore()
        .collection('garminAPITokens')
        .doc(userID)
        .collection('tokens')
        .where('serviceName', '==', ServiceNames.GarminAPI)
        .where('userID', '==', input.providerUserId)
        .limit(1)
        .get();
    const token = tokenSnapshot.docs[0];
    if (!token) {
        throw new ProviderQueueUserNotConnectedError(
            ServiceNames.GarminAPI,
            input.providerUserId,
            queueId,
        );
    }
    const guards = await captureActiveGarminHealthWriteLifecycleGuards(
        admin.firestore(),
        userID,
        input.providerUserId,
        token,
    );
    if (!guards) {
        throw new ProviderQueueUserNotConnectedError(
            ServiceNames.GarminAPI,
            input.providerUserId,
            queueId,
        );
    }
    return {
        ...input,
        userID,
        garminHealthTokenCredentialGeneration: guards.tokenCredentialGeneration,
        garminHealthRootOAuthCredentialGeneration: guards.rootOAuthCredentialGeneration,
        garminHealthConnectionStateGeneration: guards.connectionStateGeneration,
        requiredDocumentFieldValues: [
            ...(input.requiredDocumentFieldValues || []),
            {
                documentRef: token.ref,
                expectedFields: {
                    serviceName: ServiceNames.GarminAPI,
                    userID: input.providerUserId,
                    tokenCredentialGeneration: guards.tokenCredentialGeneration || undefined,
                },
            },
            ...(guards.requiredDocumentFieldValues
                ? [guards.requiredDocumentFieldValues]
                : []),
            ...(guards.additionalRequiredDocumentFieldValues || []),
        ],
    };
}

function documentMatchesExpectedFields(
    snapshot: admin.firestore.DocumentSnapshot,
    expectedFields: Readonly<Record<string, unknown>>,
): boolean {
    if (!snapshot.exists) return false;
    const data = snapshot.data() as Record<string, unknown> | undefined;
    return Boolean(data) && Object.entries(expectedFields)
        .every(([field, expected]) => data?.[field] === expected);
}

async function writeSleepQueueItemIfUserActive(
    docRef: admin.firestore.DocumentReference,
    queueId: string,
    queuePayload: Partial<SleepSyncQueueItemInterface>,
    input: AddSleepSyncQueueItemInput,
    userID: string,
    nowMs: number,
): Promise<SleepQueueWriteResult> {
    const db = admin.firestore();
    const proposedQueueRevision = crypto.randomUUID();
    return db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(
                db,
                transaction,
                userID,
                nowMs,
            );
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, `sleep_sync_queue_write:${input.provider}`, error);
        }
        if (deletionGuard.shouldSkip) {
            throw new ProviderQueueUserDeletedOrDeletingError(
                serviceNameForProvider(input.provider),
                userID,
                input.providerUserId,
                queueId,
            );
        }

        const requiredDocumentFieldValues = input.requiredDocumentFieldValues || [];
        const requiredSnapshots = await Promise.all(requiredDocumentFieldValues.map(guard =>
            transaction.get(guard.documentRef)
        ));
        const failedGuardIndex = requiredSnapshots.findIndex(
            (snapshot, index) => !documentMatchesExpectedFields(
                snapshot,
                requiredDocumentFieldValues[index].expectedFields,
            ),
        );
        if (failedGuardIndex !== -1) {
            throw new ProviderQueueUserNotConnectedError(
                serviceNameForProvider(input.provider),
                input.providerUserId,
                queueId,
            );
        }

        const snapshot = await transaction.get(docRef);
        const current = snapshot.exists
            ? snapshot.data() as Partial<SleepSyncQueueItemInterface>
            : null;
        const activeLease = current && (
            !current.userID || current.userID === userID
        ) ? getActiveRevisionProcessingLease(current, nowMs) : null;

        // Concurrent exact webhook deliveries share the already-created live
        // revision instead of replacing its Cloud Task identity.
        if (input.dispatchImmediately
            && current
            && (current as { processed?: boolean }).processed !== true
            && current.dispatchedToCloudTask == null
            && !activeLease
            && isSameQueuePayload(current, queuePayload)) {
            const currentRevision = typeof current.queueRevision === 'string'
                ? current.queueRevision.trim()
                : '';
            return {
                queueRevision: currentRevision,
                dateCreated: Number(current.dateCreated),
                shouldDispatchImmediately: true,
            };
        }

        transaction.set(docRef, {
            id: queueId,
            dateCreated: nowMs,
            queueRevision: proposedQueueRevision,
            retryCount: 0,
            processed: false,
            dispatchedToCloudTask: activeLease
                ? Number(current?.dispatchedToCloudTask)
                    || PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
                : null,
            expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
            ...queuePayload,
            ...(activeLease || {}),
        }, { merge: false });
        return {
            queueRevision: proposedQueueRevision,
            dateCreated: nowMs,
            shouldDispatchImmediately: !activeLease,
        };
    });
}

export async function addSleepSyncQueueItem(input: AddSleepSyncQueueItemInput): Promise<admin.firestore.DocumentReference> {
    const garminHealthInput = input.provider === SLEEP_PROVIDERS.GarminAPI
        && isGarminHealthSummaryType(input.garminSummaryType);
    if ((input.provider === SLEEP_PROVIDERS.GarminAPI
            && input.garminSummaryType !== undefined
            && !isGarminSupportedSummaryType(input.garminSummaryType))
        || (input.provider !== SLEEP_PROVIDERS.GarminAPI
            && (input.garminSummaryType !== undefined
                || input.garminCallbackURLs !== undefined
                || input.garminHealthTokenCredentialGeneration !== undefined
                || input.garminHealthRootOAuthCredentialGeneration !== undefined
                || input.garminHealthConnectionStateGeneration !== undefined))
        || (!garminHealthInput
            && (input.garminHealthTokenCredentialGeneration !== undefined
                || input.garminHealthRootOAuthCredentialGeneration !== undefined
                || input.garminHealthConnectionStateGeneration !== undefined))
        || !isValidOptionalLifecycleGeneration(input.garminHealthTokenCredentialGeneration)
        || !isValidOptionalLifecycleGeneration(input.garminHealthRootOAuthCredentialGeneration)
        || !isValidOptionalLifecycleGeneration(input.garminHealthConnectionStateGeneration)
        || (input.type === 'garmin_ping_batch'
            ? !parseGarminPingBatchCallbackURLs(
                input.garminCallbackURLs,
                input.garminSummaryType || 'sleeps',
            )
            : input.garminCallbackURLs !== undefined)) {
        throw new Error('Invalid Garmin Health queue fields.');
    }
    if ((input.type !== 'suunto_health_poll'
            && (input.suuntoHealthTokenCredentialGeneration !== undefined
                || input.suuntoHealthRootOAuthCredentialGeneration !== undefined
                || input.suuntoHealthConnectionStateGeneration !== undefined))
        || !isValidOptionalLifecycleGeneration(input.suuntoHealthTokenCredentialGeneration)
        || !isValidOptionalLifecycleGeneration(input.suuntoHealthRootOAuthCredentialGeneration)
        || !isValidOptionalLifecycleGeneration(input.suuntoHealthConnectionStateGeneration)) {
        throw new Error('Invalid Suunto Health queue lifecycle fences.');
    }
    if ((input.type === 'suunto_webhook'
            && input.suuntoWebhookAuthorityDigest !== undefined
            && !/^[a-f0-9]{64}$/.test(input.suuntoWebhookAuthorityDigest))
        || (input.type !== 'suunto_webhook'
            && input.suuntoWebhookAuthorityDigest !== undefined)) {
        throw new Error('Invalid Suunto Sleep webhook authority fence.');
    }
    const nowMs = Date.now();
    let queueId = await generateIDFromParts([
        input.provider,
        input.type,
        input.providerUserId,
        input.dedupeKey || input.callbackURL || `${input.rangeStartMs || ''}:${input.rangeEndMs || ''}:${nowMs}`,
    ]);
    const userID = await resolveFirebaseUserIDForSleepQueueInput(input, queueId);
    await assertSleepQueueUserCanReceiveWork(input, userID, queueId, `sleep_sync_queue_before_write:${input.provider}`);
    let queuePayloadInput: AddSleepSyncQueueItemInput = await prepareGarminHealthQueueAdmission({
        ...input,
    }, userID, queueId);
    if (input.type === 'suunto_webhook') {
        const admissionGuards = await captureCurrentSuuntoWebhookWriteLifecycleGuards(
            admin.firestore(),
            userID,
            input.providerUserId,
            nowMs,
        );
        if (!admissionGuards) {
            throw new ProviderQueueUserNotConnectedError(
                serviceNameForProvider(input.provider),
                input.providerUserId,
                queueId,
            );
        }
        queuePayloadInput = {
            ...queuePayloadInput,
            suuntoWebhookAuthorityDigest:
                getSuuntoWebhookWriteLifecycleAuthorityDigest(admissionGuards),
            requiredDocumentFieldValues: [
                admissionGuards.requiredDocumentFieldValues,
                ...admissionGuards.additionalRequiredDocumentFieldValues,
            ],
        };
    }
    const queuePayload = compactQueuePayload(queuePayloadInput);
    let docRef = queueCollection().doc(queueId);
    if (input.dispatchImmediately) {
        const existingSnapshot = await docRef.get();
        const existingQueueItem = existingSnapshot.exists ? existingSnapshot.data() as Partial<SleepSyncQueueItemInterface> : null;
        if (existingQueueItem?.processed || existingQueueItem?.dispatchedToCloudTask) {
            if (isSameQueuePayload(existingQueueItem, queuePayload)) {
                logger.info(`[SleepSync] Reusing existing immediate queue item ${queueId} for duplicate ${input.provider} ${input.type} notification.`);
                return docRef;
            }

            const revisionQueueId = await generateIDFromParts([
                input.provider,
                input.type,
                input.providerUserId,
                input.dedupeKey || input.callbackURL || queueId,
                'revision',
                queuePayloadFingerprint(queuePayload),
            ]);
            queueId = revisionQueueId;
            docRef = queueCollection().doc(queueId);
            const revisionSnapshot = await docRef.get();
            const existingRevisionQueueItem = revisionSnapshot.exists ? revisionSnapshot.data() as Partial<SleepSyncQueueItemInterface> : null;
            if ((existingRevisionQueueItem?.processed || existingRevisionQueueItem?.dispatchedToCloudTask)
                && isSameQueuePayload(existingRevisionQueueItem, queuePayload)) {
                logger.info(`[SleepSync] Reusing existing immediate queue item ${queueId} for duplicate ${input.provider} ${input.type} notification revision.`);
                return docRef;
            }
        }
    }

    const writeResult = await writeSleepQueueItemIfUserActive(
        docRef,
        queueId,
        queuePayload,
        queuePayloadInput,
        userID,
        nowMs,
    );

    try {
        await assertSleepQueueUserCanReceiveWork(input, userID, queueId, `sleep_sync_queue_after_write:${input.provider}`);
    } catch (error) {
        if (error instanceof ProviderQueueUserDeletedOrDeletingError) {
            await deleteSleepQueueDocAfterDeletionGuard(docRef, queueId, userID);
        }
        throw error;
    }

    if (input.dispatchImmediately && writeResult.shouldDispatchImmediately) {
        const wasTaskEnqueued = await enqueueSleepSyncTask(queueId, writeResult.dateCreated, undefined, {
            queueRevision: writeResult.queueRevision,
            queueDateCreated: writeResult.dateCreated,
        });
        if (wasTaskEnqueued) {
            const didMarkDispatched = await markSleepQueueItemDispatched(
                docRef,
                queueId,
                userID,
                nowMs,
                writeResult,
            );
            if (!didMarkDispatched) {
                throw new ProviderQueueUserDeletedOrDeletingError(
                    serviceNameForProvider(input.provider),
                    userID,
                    input.providerUserId,
                    queueId,
                );
            }
        }
    }
    return docRef;
}

function isFirestoreNotFoundError(error: unknown): boolean {
    const firestoreError = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : {};
    const code = firestoreError.code;
    const message = typeof firestoreError.message === 'string'
        ? firestoreError.message
        : '';
    return code === 5 || code === 'not-found' || code === 'NOT_FOUND' || message.includes('NOT_FOUND') || message.includes('No document to update');
}

async function markSleepQueueItemDispatched(
    queueItemDocument: admin.firestore.DocumentReference,
    queueItemId: string,
    userID: string,
    dispatchedAtMs: number,
    identity: Pick<SleepSyncQueueItemInterface, 'queueRevision' | 'dateCreated'>,
): Promise<boolean> {
    try {
        const result = await markQueueItemDispatchedIfUserActive({
            queueItemDocument,
            queueItemId,
            userID,
            phase: 'sleep_sync_queue_dispatch_marker',
            dispatchedAtMs,
            logPrefix: 'SleepSync',
            isCurrent: currentQueueItem => isCurrentSleepQueueRevision(currentQueueItem, identity),
        });
        return result !== QueueDispatchMarkerResult.SkippedDeletedUser;
    } catch (error) {
        if (!isFirestoreNotFoundError(error)) {
            throw error;
        }

        const failedJobSnapshot = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
        const failedJob = failedJobSnapshot.exists ? failedJobSnapshot.data() as { originalCollection?: unknown } : null;
        if (failedJob?.originalCollection === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
            logger.info(`[SleepSync] Queue item ${queueItemId} was already moved to failed_jobs before dispatch timestamp update.`);
            return true;
        }

        throw error;
    }
}

async function findSuuntoTokenByUserName(providerUserId: string): Promise<TokenSnapshot | null> {
    const snapshot = await admin.firestore().collectionGroup('tokens')
        .where('userName', '==', providerUserId)
        .where('serviceName', '==', ServiceNames.SuuntoApp)
        .limit(1)
        .get();
    return snapshot.docs[0] || null;
}

export async function findSleepTokenByProviderUserId(provider: SleepProvider, providerUserId: string): Promise<TokenSnapshot | null> {
    if (provider === SLEEP_PROVIDERS.SuuntoApp) {
        return findSuuntoTokenByUserName(providerUserId);
    }

    const tokenField = providerUserIdTokenField(provider);
    if (!tokenField) {
        return null;
    }
    const snapshot = await admin.firestore().collectionGroup('tokens')
        .where('serviceName', '==', serviceNameForProvider(provider))
        .where(tokenField, '==', providerUserId)
        .limit(1)
        .get();
    return snapshot.docs[0] || null;
}

/**
 * Resolves a bounded Garmin Ping batch with collection-group `in` lookups so
 * unsigned ingress cannot amplify one descriptor into one database query.
 * Ambiguous legacy bindings are deliberately omitted; the normal admission
 * path revalidates every returned uid against its server-owned token tree.
 */
export async function resolveGarminPingFirebaseUserIDs(
    providerUserIds: readonly string[],
): Promise<Map<string, string>> {
    const uniqueProviderUserIds = [...new Set(providerUserIds)];
    const batches: string[][] = [];
    for (let index = 0; index < uniqueProviderUserIds.length; index += GARMIN_PING_BINDING_LOOKUP_BATCH_SIZE) {
        batches.push(uniqueProviderUserIds.slice(index, index + GARMIN_PING_BINDING_LOOKUP_BATCH_SIZE));
    }

    const resolvedUserIDs = new Map<string, Set<string>>();
    let nextBatchIndex = 0;
    await Promise.all(Array.from(
        { length: Math.min(GARMIN_PING_BINDING_LOOKUP_CONCURRENCY, batches.length) },
        async () => {
            while (nextBatchIndex < batches.length) {
                const batch = batches[nextBatchIndex];
                nextBatchIndex += 1;
                const snapshot = await admin.firestore().collectionGroup('tokens')
                    .where('userID', 'in', batch)
                    .get();
                for (const token of snapshot.docs) {
                    const data = token.data() as Record<string, unknown>;
                    const tokenRoot = token.ref.parent.parent;
                    const tokenRootCollection = tokenRoot?.parent;
                    const providerUserId = typeof data.userID === 'string'
                        ? data.userID.trim()
                        : '';
                    if (!providerUserId
                        || data.serviceName !== ServiceNames.GarminAPI
                        || !tokenRoot
                        || token.ref.parent.id !== 'tokens'
                        || tokenRootCollection?.id !== 'garminAPITokens') {
                        continue;
                    }
                    const firebaseUserID = tokenRoot.id;
                    const matches = resolvedUserIDs.get(providerUserId) || new Set<string>();
                    matches.add(firebaseUserID);
                    resolvedUserIDs.set(providerUserId, matches);
                }
            }
        },
    ));

    return new Map([...resolvedUserIDs.entries()]
        .filter(([, firebaseUserIDs]) => firebaseUserIDs.size === 1)
        .map(([providerUserId, firebaseUserIDs]) => [
            providerUserId,
            [...firebaseUserIDs][0],
        ]));
}

async function findTokenForQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<TokenSnapshot | null> {
    if (queueItem.userID) {
        if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI) {
            try {
                return await getActiveCOROSTokenSnapshot(queueItem.userID, queueItem.providerUserId);
            } catch (error) {
                if (isTokenUseSkippedForPendingDisconnectError(error)) throw error;
                const code = `${(error as { code?: unknown } | null)?.code || ''}`.replace(/^functions\//, '');
                if (code === 'unauthenticated' || code === 'failed-precondition') {
                    return null;
                }
                throw new COROSDailyAccountValidationError();
            }
        }
        const tokenRoot = getTokenRoot(queueItem.provider, queueItem.userID);
        const tokenField = providerUserIdTokenField(queueItem.provider);
        if (!tokenRoot || !tokenField) {
            return null;
        }
        const snapshot = await tokenRoot
            .where(tokenField, '==', queueItem.providerUserId)
            .limit(1)
            .get();
        return snapshot.docs[0] || null;
    }
    return findSleepTokenByProviderUserId(queueItem.provider, queueItem.providerUserId);
}

function getTokenRoot(provider: SleepProvider, userID: string): admin.firestore.CollectionReference | null {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return admin.firestore().collection('garminAPITokens').doc(userID).collection('tokens');
        case SLEEP_PROVIDERS.SuuntoApp:
            return admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens');
        case SLEEP_PROVIDERS.COROSAPI:
            return admin.firestore().collection('COROSAPIAccessTokens').doc(userID).collection('tokens');
        default:
            return null;
    }
}

export function firebaseUserIdFromSleepTokenSnapshot(tokenSnapshot: TokenSnapshot): string {
    const userRef = tokenSnapshot.ref.parent.parent;
    if (!userRef) {
        throw new Error('Sleep token snapshot has no user parent');
    }
    return userRef.id;
}

function serviceNameForProvider(provider: SleepProvider): ServiceNames {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return ServiceNames.GarminAPI;
        case SLEEP_PROVIDERS.SuuntoApp:
            return ServiceNames.SuuntoApp;
        case SLEEP_PROVIDERS.COROSAPI:
            return ServiceNames.COROSAPI;
        default:
            throw new Error(`Unsupported sleep provider ${provider}`);
    }
}

function normalizePayloadArray(payload: unknown, key?: string): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (key && payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        return Array.isArray(record[key]) ? record[key] as unknown[] : [];
    }
    return [];
}

function mapperResultStageSeconds(result: SleepMapperResult, stages: readonly string[]): number {
    const stageDurations = result.session.stageDurationsSeconds || {};
    return stages.reduce((total, stage) => total + Math.max(0, Number(stageDurations[stage as keyof typeof stageDurations]) || 0), 0);
}

function compareMapperResultCompleteness(left: SleepMapperResult, right: SleepMapperResult): number {
    const leftSleepStageSeconds = mapperResultStageSeconds(left, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem]);
    const rightSleepStageSeconds = mapperResultStageSeconds(right, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem]);
    if (leftSleepStageSeconds !== rightSleepStageSeconds) {
        return leftSleepStageSeconds - rightSleepStageSeconds;
    }

    const leftKnownStageSeconds = mapperResultStageSeconds(left, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem, SLEEP_STAGES.Awake]);
    const rightKnownStageSeconds = mapperResultStageSeconds(right, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem, SLEEP_STAGES.Awake]);
    if (leftKnownStageSeconds !== rightKnownStageSeconds) {
        return leftKnownStageSeconds - rightKnownStageSeconds;
    }

    const leftNonNapScore = left.session.isNap ? 0 : 1;
    const rightNonNapScore = right.session.isNap ? 0 : 1;
    if (leftNonNapScore !== rightNonNapScore) {
        return leftNonNapScore - rightNonNapScore;
    }

    const leftScorePresent = Number.isFinite(Number(left.session.score?.value)) ? 1 : 0;
    const rightScorePresent = Number.isFinite(Number(right.session.score?.value)) ? 1 : 0;
    if (leftScorePresent !== rightScorePresent) {
        return leftScorePresent - rightScorePresent;
    }

    return Math.max(0, Number(left.session.durationSeconds) || 0) - Math.max(0, Number(right.session.durationSeconds) || 0);
}

function keepBestMapperResultPerSourceSession(mapperResults: readonly SleepMapperResult[]): SleepMapperResult[] {
    const bestResults = new Map<string, SleepMapperResult>();
    for (const mapperResult of mapperResults) {
        const current = bestResults.get(mapperResult.sourceSessionKey);
        if (!current || compareMapperResultCompleteness(current, mapperResult) < 0) {
            bestResults.set(mapperResult.sourceSessionKey, mapperResult);
        }
    }
    return [...bestResults.values()];
}

function assertGarminSleepPermission(tokenData: Record<string, unknown>, userID: string): void {
    const permissions = tokenData.permissions;
    if (!Array.isArray(permissions) || permissions.length === 0) {
        return;
    }
    if (!permissions.includes('HEALTH_EXPORT')) {
        throw new GarminSleepPermissionError(userID);
    }
}

class GarminSleepPermissionError extends Error {
    constructor(public readonly userID: string) {
        super('Missing Garmin health export permission for sleep sync');
    }
}

class GarminSleepCallbackRequestError extends Error {
    readonly name = 'GarminSleepCallbackRequestError';

    constructor() {
        // Provider/request-library errors can contain Garmin's signed callback
        // URL. Keep logs, sync state, retry rows, and the DLQ opaque.
        super('Garmin sleep callback request failed.');
    }
}

class UnsupportedGarminPushPayloadError extends Error {
    constructor() {
        super('Garmin push sleep payloads are not accepted without authenticated delivery');
    }
}

class MissingSleepProviderTokenError extends Error {
    constructor(public readonly provider: SleepProvider) {
        super(`No ${provider} token found`);
    }
}

class COROSDailyRequestError extends Error {
    readonly name = 'COROSDailyRequestError';

    constructor(resultCode?: string) {
        super(resultCode
            ? `COROS daily data request failed with result ${resultCode}.`
            : 'COROS daily data request failed.');
    }
}

class COROSDailyAccountValidationError extends Error {
    readonly name = 'COROSDailyAccountValidationError';

    constructor() {
        super('COROS account validation failed.');
    }
}

class COROSDailyProcessingError extends Error {
    readonly name = 'COROSDailyProcessingError';

    constructor() {
        super('COROS daily synchronization failed.');
    }
}

class COROSDailyReconnectRequiredError extends Error {
    readonly name = 'COROSDailyReconnectRequiredError';

    constructor() {
        super('COROS connection requires reconnect.');
    }
}

/**
 * Only errors created from already-bounded COROS response validation are safe
 * for durable telemetry. Token refresh and datastore errors can contain the
 * raw token document ID, access-token-bearing URLs, or provider response data.
 */
function sanitizeCOROSDailyErrorForTelemetry(error: unknown): Error {
    if (error instanceof TerminalServiceAuthError) {
        return new COROSDailyReconnectRequiredError();
    }
    if (error instanceof COROSDailyRequestError
        || error instanceof COROSDailyAccountValidationError
        || error instanceof COROSDailyValidationError) {
        return error;
    }
    return new COROSDailyProcessingError();
}

async function captureCOROSWriteLifecycleGuards(
    firebaseUserID: string,
    providerUserId: string,
    tokenRef: admin.firestore.DocumentReference,
    expectedCredential: TokenCredentialSnapshot,
): Promise<COROSWriteLifecycleGuards> {
    let serviceMeta;
    try {
        serviceMeta = await getServiceConnectionMeta(firebaseUserID, ServiceNames.COROSAPI);
    } catch {
        throw new COROSDailyAccountValidationError();
    }
    const pinnedProviderUserId = typeof serviceMeta?.providerUserId === 'string'
        ? serviceMeta.providerUserId.trim()
        : '';
    const expectedProviderUserId = providerUserId.trim();
    if (!expectedCredential.accessToken
        || !serviceMeta
        || isServiceUnavailableForSyncConnection(serviceMeta)
        || pinnedProviderUserId !== expectedProviderUserId) {
        throw new COROSDailyAccountValidationError();
    }
    return {
        requiredExistingDocumentRef: tokenRef,
        requiredExistingTokenCredential: expectedCredential,
        requiredDocumentFieldValues: {
            documentRef: admin.firestore().collection('users')
                .doc(firebaseUserID)
                .collection('meta')
                .doc(ServiceNames.COROSAPI),
            expectedFields: {
                providerUserId: serviceMeta.providerUserId,
                connectionState: serviceMeta.connectionState,
                connectionStateGeneration: serviceMeta.connectionStateGeneration,
            },
        },
        additionalRequiredDocumentFieldValues: [{
            documentRef: getServiceTokenRootDocumentRef(firebaseUserID, ServiceNames.COROSAPI),
            expectedFields: {
                [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: expectedCredential.credentialGeneration
                    || undefined,
            },
        }],
    };
}

function assertCOROSLifecycleContinuity(
    initialGuards: COROSWriteLifecycleGuards,
    currentGuards: COROSWriteLifecycleGuards,
): void {
    const initialGeneration = initialGuards.requiredDocumentFieldValues
        .expectedFields.connectionStateGeneration;
    const currentGeneration = currentGuards.requiredDocumentFieldValues
        .expectedFields.connectionStateGeneration;
    if (initialGeneration !== currentGeneration) {
        throw new COROSDailyAccountValidationError();
    }
}

function corosCredentialFromSnapshot(tokenSnapshot: TokenSnapshot): TokenCredentialSnapshot {
    const credential = getTokenCredentialSnapshot(
        tokenSnapshot.data() as Record<string, unknown> | undefined,
    );
    if (!credential.accessToken) {
        throw new COROSDailyAccountValidationError();
    }
    return credential;
}

function isTokenUseSkippedForPendingDisconnectError(error: unknown): error is Error & {
    firebaseUserID: string;
    serviceName: ServiceNames;
    reason?: 'service_disconnect' | 'inactive_oauth_credential';
} {
    return error instanceof Error
        && error.name === 'TokenUseSkippedForPendingDisconnectError'
        && typeof (error as { firebaseUserID?: unknown }).firebaseUserID === 'string'
        && typeof (error as { serviceName?: unknown }).serviceName === 'string';
}

async function resolveTokenAndUser(queueItem: SleepSyncQueueItemInterface): Promise<{
    tokenSnapshot: TokenSnapshot;
    firebaseUserID: string;
}> {
    const tokenSnapshot = await findTokenForQueueItem(queueItem);
    if (!tokenSnapshot) {
        throw new MissingSleepProviderTokenError(queueItem.provider);
    }
    return {
        tokenSnapshot,
        firebaseUserID: firebaseUserIdFromSleepTokenSnapshot(tokenSnapshot),
    };
}

async function processGarminQueueItem(queueItem: SleepSyncQueueItemInterface, tokenSnapshot: TokenSnapshot, firebaseUserID: string): Promise<SleepMapperResult[]> {
    if (queueItem.type === 'garmin_ping') {
        const callbackURL = assertTrustedGarminCallbackURL(queueItem.callbackURL);
        const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI);
        assertGarminSleepPermission(tokenData as unknown as Record<string, unknown>, firebaseUserID);
        let payload: unknown;
        try {
            payload = await requestPromise.get({
                headers: {
                    Authorization: `Bearer ${tokenData.accessToken}`,
                },
                json: true,
                maxResponseBytes: GARMIN_SLEEP_MAX_RESPONSE_BYTES,
                timeout: GARMIN_SLEEP_REQUEST_TIMEOUT_MS,
                url: callbackURL,
            });
        } catch {
            throw new GarminSleepCallbackRequestError();
        }
        return normalizePayloadArray(payload, 'sleeps')
            .map((summary) => mapGarminSleepSummary(summary, queueItem.providerUserId, Date.now(), callbackURL))
            .filter((result): result is SleepMapperResult => result !== null);
    }

    const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI);
    assertGarminSleepPermission(tokenData as unknown as Record<string, unknown>, firebaseUserID);
    return normalizePayloadArray(queueItem.payload, 'sleeps')
        .map((summary) => mapGarminSleepSummary(summary, queueItem.providerUserId, Date.now(), queueItem.callbackURL))
        .filter((result): result is SleepMapperResult => result !== null);
}

async function processSuuntoQueueItem(
    queueItem: SleepSyncQueueItemInterface,
    tokenSnapshot: TokenSnapshot,
    firebaseUserID: string,
    initialLifecycleGuards: SuuntoWebhookWriteLifecycleGuards,
    onLifecycleGuardsCaptured: (guards: SuuntoWebhookWriteLifecycleGuards) => void,
): Promise<SleepMapperResult[]> {
    if (queueItem.type === 'suunto_poll') {
        if (!Number.isFinite(queueItem.rangeStartMs) || !Number.isFinite(queueItem.rangeEndMs)) {
            throw new Error(`Suunto poll queue item ${queueItem.id} has invalid range`);
        }
        const tokenData = await getTokenData(tokenSnapshot, ServiceNames.SuuntoApp);
        const refreshedProviderUserId = typeof tokenData.userName === 'string'
            ? tokenData.userName.trim()
            : '';
        if (refreshedProviderUserId !== queueItem.providerUserId) {
            throw new SuuntoSleepLifecycleChangedError();
        }
        const refreshedTokenSnapshot = {
            id: tokenSnapshot.id,
            ref: tokenSnapshot.ref,
            data: () => ({
                ...(tokenSnapshot.data() as Record<string, unknown> | undefined),
                ...(tokenData as unknown as Record<string, unknown>),
                serviceName: ServiceNames.SuuntoApp,
                userName: refreshedProviderUserId,
                tokenCredentialGeneration:
                    initialLifecycleGuards.requiredExistingTokenCredential.credentialGeneration,
            }),
        } as unknown as TokenSnapshot;
        const currentLifecycleGuards = await captureActiveSuuntoWebhookWriteLifecycleGuards(
            admin.firestore(),
            firebaseUserID,
            queueItem.providerUserId,
            refreshedTokenSnapshot,
        );
        if (!currentLifecycleGuards
            || !areSuuntoWebhookWriteLifecycleGuardsContinuous(
                initialLifecycleGuards,
                currentLifecycleGuards,
            )) {
            throw new SuuntoSleepLifecycleChangedError();
        }
        // Publish the rotated credential guard before provider I/O so a later
        // request failure cannot make our own refresh suppress error state.
        onLifecycleGuardsCaptured(currentLifecycleGuards);
        const payload = await requestPromise.get({
            headers: {
                Authorization: toSuuntoAuthorizationHeader(tokenData.accessToken),
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
            },
            json: true,
            url: `https://cloudapi.suunto.com/247samples/sleep?from=${Math.floor(queueItem.rangeStartMs || 0)}&to=${Math.floor(queueItem.rangeEndMs || 0)}`,
        });
        return keepBestMapperResultPerSourceSession(normalizePayloadArray(payload, 'samples')
            .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
            .filter((result): result is SleepMapperResult => result !== null));
    }

    return keepBestMapperResultPerSourceSession(normalizePayloadArray(queueItem.payload, 'samples')
        .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
        .filter((result): result is SleepMapperResult => result !== null));
}

async function rebaseContinuousSuuntoWebhookGuards(
    firebaseUserID: string,
    providerUserId: string,
    authorityBaseline: SuuntoWebhookWriteLifecycleGuards,
): Promise<SuuntoWebhookWriteLifecycleGuards | null> {
    let currentGuards: SuuntoWebhookWriteLifecycleGuards | null;
    try {
        currentGuards = await captureCurrentSuuntoWebhookWriteLifecycleGuards(
            admin.firestore(),
            firebaseUserID,
            providerUserId,
        );
    } catch {
        throw new SuuntoCredentialRotationRetryableError();
    }
    return currentGuards
        && areSuuntoWebhookWriteLifecycleGuardsContinuous(authorityBaseline, currentGuards)
        ? currentGuards
        : null;
}

async function runWithSuuntoWebhookCredentialRebase<T>(
    firebaseUserID: string,
    providerUserId: string,
    authorityBaseline: SuuntoWebhookWriteLifecycleGuards,
    currentGuards: SuuntoWebhookWriteLifecycleGuards,
    write: (guards: SuuntoWebhookWriteLifecycleGuards) => Promise<T>,
    wasCredentialGuardRejected: (result: T) => boolean,
): Promise<{ result: T; guards: SuuntoWebhookWriteLifecycleGuards | null }> {
    let guards = currentGuards;
    for (let attempt = 0; attempt < SUUNTO_CREDENTIAL_GUARD_WRITE_ATTEMPTS; attempt += 1) {
        const result = await write(guards);
        if (!wasCredentialGuardRejected(result)) return { result, guards };
        const rebasedGuards = await rebaseContinuousSuuntoWebhookGuards(
            firebaseUserID,
            providerUserId,
            authorityBaseline,
        );
        if (!rebasedGuards) return { result, guards: null };
        guards = rebasedGuards;
    }
    throw new SuuntoCredentialRotationRetryableError();
}

async function rebaseContinuousSuuntoHealthGuards(
    firebaseUserID: string,
    providerUserId: string,
    authorityBaseline: SuuntoWebhookWriteLifecycleGuards,
): Promise<SuuntoHealthWriteLifecycleGuards | null> {
    const webhookGuards = await rebaseContinuousSuuntoWebhookGuards(
        firebaseUserID,
        providerUserId,
        authorityBaseline,
    );
    return webhookGuards;
}

async function runWithSuuntoHealthCredentialRebase<T>(
    firebaseUserID: string,
    providerUserId: string,
    authorityBaseline: SuuntoWebhookWriteLifecycleGuards,
    currentGuards: SuuntoHealthWriteLifecycleGuards,
    write: (guards: SuuntoHealthWriteLifecycleGuards) => Promise<T>,
    wasCredentialGuardRejected: (result: T) => boolean,
): Promise<{ result: T; guards: SuuntoHealthWriteLifecycleGuards | null }> {
    let guards = currentGuards;
    for (let attempt = 0; attempt < SUUNTO_CREDENTIAL_GUARD_WRITE_ATTEMPTS; attempt += 1) {
        const result = await write(guards);
        if (!wasCredentialGuardRejected(result)) return { result, guards };
        const rebasedGuards = await rebaseContinuousSuuntoHealthGuards(
            firebaseUserID,
            providerUserId,
            authorityBaseline,
        );
        if (!rebasedGuards) return { result, guards: null };
        guards = rebasedGuards;
    }
    throw new SuuntoCredentialRotationRetryableError();
}

function expectedSuuntoLifecycleField(
    guards: SuuntoWebhookWriteLifecycleGuards,
    fieldName: string,
): unknown {
    return [
        guards.requiredDocumentFieldValues,
        ...guards.additionalRequiredDocumentFieldValues,
    ].map(guard => guard.expectedFields[fieldName])
        .find(value => value !== undefined);
}

function normalizeCOROSDailyResultCode(value: unknown): string {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return `${value}`;
    if (typeof value === 'string' && value.length <= 32) {
        const normalized = value.trim();
        if (/^\d+$/.test(normalized)) return normalized;
    }
    return value === undefined || value === null ? '' : 'invalid';
}

function isValidCOROSDailyMessage(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string' || value.length > 16) return false;
    return ['', 'OK'].includes(value.trim());
}

async function assertActiveCOROSQueueAccount(
    firebaseUserID: string,
    providerUserId: string,
    expectedCredential: TokenCredentialSnapshot,
): Promise<void> {
    let activeTokenSnapshot: TokenSnapshot;
    try {
        activeTokenSnapshot = await getActiveCOROSTokenSnapshot(firebaseUserID, providerUserId);
    } catch (error) {
        if (isTokenUseSkippedForPendingDisconnectError(error)) throw error;
        const code = `${(error as { code?: unknown } | null)?.code || ''}`.replace(/^functions\//, '');
        if (code === 'unauthenticated' || code === 'failed-precondition') {
            throw new MissingSleepProviderTokenError(SLEEP_PROVIDERS.COROSAPI);
        }
        // Firestore and lifecycle errors may contain the token-document path,
        // whose document ID is the provider account ID. Keep retry telemetry
        // opaque while preserving the retryable failure class.
        throw new COROSDailyAccountValidationError();
    }
    if (!areTokenCredentialSnapshotsEqual(
        corosCredentialFromSnapshot(activeTokenSnapshot),
        expectedCredential,
    )) {
        throw new COROSDailyAccountValidationError();
    }
}

function extractCOROSDailyList(payload: unknown): unknown[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new COROSDailyValidationError('COROS daily response must be an object.');
    }
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new COROSDailyValidationError('COROS daily response data must be an object.');
    }
    const dailyList = (data as { dailyList?: unknown }).dailyList;
    // The live COROS API returns an empty data object, rather than
    // `dailyList: []`, when a successful range contains no daily records.
    // Accept only that exact empty success envelope; any other unrecognized
    // data shape still fails closed so an API contract change is not silently
    // mistaken for a valid no-data response.
    if (dailyList === undefined && Object.keys(data).length === 0) {
        return [];
    }
    if (!Array.isArray(dailyList)) {
        throw new COROSDailyValidationError('COROS daily response must contain a dailyList array.');
    }
    return dailyList;
}

async function processCorosQueueItem(
    queueItem: SleepSyncQueueItemInterface,
    tokenSnapshot: TokenSnapshot,
    firebaseUserID: string,
    initialLifecycleGuards: COROSWriteLifecycleGuards,
    onTokenCredentialResolved?: (credential: TokenCredentialSnapshot) => void,
    onLifecycleGuardsCaptured?: (guards: COROSWriteLifecycleGuards) => void,
): Promise<{
    sleepResults: SleepMapperResult[];
    healthResults: COROSDailyHealthResult[];
    lifecycleGuards: COROSWriteLifecycleGuards;
}> {
    if (!Number.isSafeInteger(queueItem.rangeStartMs)
        || !Number.isSafeInteger(queueItem.rangeEndMs)
        || Number(queueItem.rangeStartMs) < 0
        || Number(queueItem.rangeEndMs) < 0) {
        throw new COROSDailyValidationError('COROS daily poll range is invalid.');
    }
    const rangeStartDate = parseCOROSCalendarDate(queueItem.rangeStartMs);
    const rangeEndDate = parseCOROSCalendarDate(queueItem.rangeEndMs);
    const inclusiveRangeDays = rangeStartDate && rangeEndDate
        ? Math.floor((rangeEndDate.getTime() - rangeStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1
        : 0;
    if (!rangeStartDate
        || !rangeEndDate
        || inclusiveRangeDays < 1
        || inclusiveRangeDays > COROS_DAILY_MAX_RECORDS) {
        throw new COROSDailyValidationError('COROS daily poll range exceeds the bounded daily range.');
    }
    const tokenData = await getTokenData(tokenSnapshot, ServiceNames.COROSAPI);
    const tokenCredential = getTokenCredentialSnapshot(
        tokenData as unknown as Record<string, unknown>,
    );
    if (tokenCredential.credentialGeneration
        !== initialLifecycleGuards.requiredExistingTokenCredential.credentialGeneration) {
        throw new COROSDailyAccountValidationError();
    }
    // Token refresh can change the exact credential fence before the service
    // metadata read below. Publish that narrower update first so a transient
    // metadata-read failure remains retryable under the refreshed credential.
    onTokenCredentialResolved?.(tokenCredential);
    const lifecycleGuards = await captureCOROSWriteLifecycleGuards(
        firebaseUserID,
        queueItem.providerUserId,
        tokenSnapshot.ref,
        tokenCredential,
    );
    assertCOROSLifecycleContinuity(initialLifecycleGuards, lifecycleGuards);
    // Publish refreshed credentials immediately. If later provider I/O or
    // validation fails, queue error-state writes must use the refreshed fence
    // instead of mistaking our own refresh for an account reconnect.
    onLifecycleGuardsCaptured?.(lifecycleGuards);
    if (await shouldSkipQueueWorkForDeletedUser(
        firebaseUserID,
        ServiceNames.COROSAPI,
        queueItem.id,
        'before_sleep_provider_sync',
    )) {
        throw new TokenRefreshSkippedForDeletedUserError(
            firebaseUserID,
            ServiceNames.COROSAPI,
            tokenSnapshot.id,
            'before_return',
        );
    }
    await assertActiveCOROSQueueAccount(
        firebaseUserID,
        queueItem.providerUserId,
        tokenCredential,
    );
    const startDate = formatCOROSCalendarDate(queueItem.rangeStartMs || 0);
    const endDate = formatCOROSCalendarDate(queueItem.rangeEndMs || 0);
    let payload: unknown;
    try {
        payload = await requestPromise.get({
            url: `https://open.coros.com/coros/daily/query?token=${encodeURIComponent(tokenData.accessToken)}&openId=${encodeURIComponent(queueItem.providerUserId)}&startDate=${startDate}&endDate=${endDate}`,
            json: true,
            timeout: COROS_API_REQUEST_TIMEOUT_MS,
            maxResponseBytes: COROS_DAILY_MAX_RESPONSE_BYTES,
        });
    } catch {
        // Fetch, decode, and provider errors may carry the query URL, token, or
        // response snippets. Keep every durable/logged representation opaque.
        throw new COROSDailyRequestError();
    }
    const receivedAtMs = Date.now();
    const resultCode = normalizeCOROSDailyResultCode(
        (payload as { result?: unknown } | null)?.result,
    );
    if (!/^0+$/.test(resultCode) || !isValidCOROSDailyMessage(
        (payload as { message?: unknown } | null)?.message,
    )) {
        throw new COROSDailyRequestError(resultCode || 'unknown');
    }
    const dailyList = extractCOROSDailyList(payload);
    if (dailyList.length > COROS_DAILY_MAX_RECORDS) {
        throw new COROSDailyValidationError('COROS daily response exceeds the bounded record count.');
    }

    const firstRequestedDay = formatCOROSCalendarDate(rangeStartDate);
    const lastRequestedDay = formatCOROSCalendarDate(rangeEndDate);
    const parsedRowsByDate = new Map<string, ReturnType<typeof parseCOROSDailyRecord>>();
    dailyList.forEach((daily) => {
        const parsed = parseCOROSDailyRecord(daily);
        if (!parsed.happenDay) {
            throw new COROSDailyValidationError(
                'COROS daily response contains a row without a valid provider date.',
            );
        }
        if (parsed.happenDay < firstRequestedDay || parsed.happenDay > lastRequestedDay) {
            throw new COROSDailyValidationError(
                'COROS daily response contains a date outside the requested range.',
            );
        }
        // A provider date is the identity boundary. Last-in-response wins for
        // duplicate rows because COROS does not define duplicate ordering.
        parsedRowsByDate.set(parsed.happenDay, parsed);
    });

    const sleepResults: SleepMapperResult[] = [];
    const healthResults: COROSDailyHealthResult[] = [];
    for (const parsed of parsedRowsByDate.values()) {
        const sleepResult = mapParsedCorosDailySleep(parsed, queueItem.providerUserId, receivedAtMs);
        let sleepDocumentId: string | null = null;
        if (sleepResult) {
            sleepResults.push(sleepResult);
            sleepDocumentId = await buildSleepSessionDocumentId(
                firebaseUserID,
                SLEEP_PROVIDERS.COROSAPI,
                sleepResult.sourceSessionKey,
            );
        }
        const healthResult = mapCOROSDailyHealth(
            parsed,
            queueItem.providerUserId,
            receivedAtMs,
            sleepDocumentId,
        );
        if (healthResult) healthResults.push(healthResult);
    }
    healthResults.sort((left, right) => left.input.calendarDate.localeCompare(right.input.calendarDate));
    // Token refresh and the provider request can race a disconnect. Recheck the
    // pinned account after decoding but before either normalized domain writes.
    await assertActiveCOROSQueueAccount(
        firebaseUserID,
        queueItem.providerUserId,
        tokenCredential,
    );
    return { sleepResults, healthResults, lifecycleGuards };
}

function assertNeverQueueItemType(type: never): never {
    throw new Error(`Unsupported sleep queue item type ${type}`);
}

function isPollQueueItemType(type: SleepSyncQueueItemType): boolean {
    switch (type) {
        case 'suunto_poll':
        case 'suunto_health_poll':
        case 'coros_poll':
            return true;
        case 'garmin_ping':
        case 'garmin_ping_batch':
        case 'garmin_push':
        case 'suunto_webhook':
            return false;
        default:
            return assertNeverQueueItemType(type);
    }
}

function isWebhookQueueItemType(type: SleepSyncQueueItemType): boolean {
    switch (type) {
        case 'garmin_ping':
        case 'garmin_ping_batch':
        case 'garmin_push':
        case 'suunto_webhook':
            return true;
        case 'suunto_poll':
        case 'suunto_health_poll':
        case 'coros_poll':
            return false;
        default:
            return assertNeverQueueItemType(type);
    }
}

function isSuuntoHealthQueueItem(queueItem: SleepSyncQueueItemInterface): boolean {
    return queueItem.type === 'suunto_health_poll';
}

function isGarminHealthQueueItem(queueItem: SleepSyncQueueItemInterface): boolean {
    return queueItem.provider === SLEEP_PROVIDERS.GarminAPI
        && (queueItem.type === 'garmin_ping' || queueItem.type === 'garmin_ping_batch')
        && isGarminHealthSummaryType(queueItem.garminSummaryType);
}

function isHealthQueueItem(queueItem: SleepSyncQueueItemInterface): boolean {
    return isSuuntoHealthQueueItem(queueItem) || isGarminHealthQueueItem(queueItem);
}

async function fanOutGarminPingBatch(
    queueItem: SleepSyncQueueItemInterface,
    firebaseUserID: string,
): Promise<number> {
    const summaryType = queueItem.garminSummaryType
        || (queueItem.provider === SLEEP_PROVIDERS.GarminAPI ? 'sleeps' : undefined);
    const callbackURLs = parseGarminPingBatchCallbackURLs(
        queueItem.garminCallbackURLs,
        summaryType,
    );
    if (!callbackURLs || !summaryType) {
        throw new GarminHealthValidationError('Garmin Ping batch contains invalid callback URLs.');
    }

    let nextIndex = 0;
    await Promise.all(Array.from(
        { length: Math.min(16, callbackURLs.length) },
        async () => {
            while (nextIndex < callbackURLs.length) {
                const callbackURL = callbackURLs[nextIndex];
                nextIndex += 1;
                await addSleepSyncQueueItem({
                    type: 'garmin_ping',
                    provider: SLEEP_PROVIDERS.GarminAPI,
                    providerUserId: queueItem.providerUserId,
                    userID: firebaseUserID,
                    callbackURL,
                    garminSummaryType: summaryType,
                    dedupeKey: `${summaryType}:${callbackURL}`,
                    dispatchImmediately: false,
                });
            }
        },
    ));
    return callbackURLs.length;
}

function isQueueUserAllowed(queueItem: SleepSyncQueueItemInterface, userID: string): boolean {
    if (isSuuntoHealthQueueItem(queueItem)) return true;
    if (isGarminHealthQueueItem(queueItem)) return isGarminHealthSyncUserAllowed(userID);
    return isSleepSyncUserAllowed(userID);
}

function doesGarminHealthQueueFenceMatch(
    queueItem: SleepSyncQueueItemInterface,
    guards: GarminHealthWriteLifecycleGuards,
): boolean {
    return (queueItem.garminHealthTokenCredentialGeneration === undefined
            || queueItem.garminHealthTokenCredentialGeneration
                === guards.tokenCredentialGeneration)
        && (queueItem.garminHealthRootOAuthCredentialGeneration === undefined
            || queueItem.garminHealthRootOAuthCredentialGeneration
                === guards.rootOAuthCredentialGeneration)
        && (queueItem.garminHealthConnectionStateGeneration === undefined
            || queueItem.garminHealthConnectionStateGeneration
                === guards.connectionStateGeneration);
}

export async function processSleepSyncQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<QueueResult> {
    logger.info(`[SleepSync] Processing queue item ${queueItem.id}`);
    // Lease fields read from Firestore belong to whichever invocation claimed
    // them. Never let a duplicate task reuse those values as proof of ownership
    // for an early completion, retry, or DLQ transition.
    delete queueItem.processingOwner;
    delete queueItem.processingRevision;
    delete queueItem.processingLeaseExpiresAt;
    let corosLifecycleGuards: COROSWriteLifecycleGuards | null = null;
    let garminHealthLifecycleGuards: GarminHealthWriteLifecycleGuards | null = null;
    let suuntoHealthLifecycleGuards: SuuntoHealthWriteLifecycleGuards | null = null;
    let suuntoSleepLifecycleGuards: SuuntoWebhookWriteLifecycleGuards | null = null;
    let suuntoAuthorityBaseline: SuuntoWebhookWriteLifecycleGuards | null = null;
    let resolvedFirebaseUserID = typeof queueItem.userID === 'string'
        ? queueItem.userID.trim() || null
        : null;
    let processingOwner: string | null = null;
    let processingUserID: string | null = null;

    try {
        const providerForDeletionGuard = isValidSleepProvider(queueItem.provider) ? queueItem.provider : null;
        if (queueItem.userID && providerForDeletionGuard && await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            serviceNameForProvider(providerForDeletionGuard),
            queueItem.id,
            'before_sleep_token_resolution',
        )) {
            return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        const malformedReason = getMalformedSleepQueueItemReason(queueItem);
        if (malformedReason) {
            const error = new Error(`Malformed sleep sync queue item ${queueItem.id}: ${malformedReason}`);
            logger.warn(`[SleepSync] Queue item ${queueItem.id} is malformed (${malformedReason}); moving to DLQ`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'INVALID_SLEEP_QUEUE_ITEM',
                resolvedFirebaseUserID,
            );
        }

        if (isSuuntoHealthQueueItem(queueItem) && !isSuuntoHealthSyncEnabled()) {
            logger.info(`[HealthSync][Suunto] Health ingestion is disabled; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'provider_disabled',
                providerDisabled: true,
                sessionsWritten: 0,
                sessionsSkipped: 0,
                healthRecordsWritten: 0,
            });
        }

        if (isGarminHealthQueueItem(queueItem) && !isGarminHealthSyncEnabled()) {
            logger.info(`[HealthSync][Garmin] Health ingestion is disabled; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'provider_disabled',
                providerDisabled: true,
                sessionsWritten: 0,
                sessionsSkipped: 0,
                healthRecordsWritten: 0,
            });
        }

        if (!isHealthQueueItem(queueItem) && !isSleepProviderEnabled(queueItem.provider)) {
            logger.info(`[SleepSync] Provider ${queueItem.provider} disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'provider_disabled',
                providerDisabled: true,
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        if (queueItem.userID && !isQueueUserAllowed(queueItem, queueItem.userID)) {
            logger.info(`[${isHealthQueueItem(queueItem) ? 'HealthSync' : 'SleepSync'}] User outside the configured rollout; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'user_not_allowed',
                userAllowed: false,
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI && queueItem.type === 'garmin_ping') {
            assertTrustedGarminCallbackURL(
                queueItem.callbackURL,
                queueItem.garminSummaryType || 'sleeps',
            );
        }
        if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI && queueItem.type === 'garmin_push') {
            throw new UnsupportedGarminPushPayloadError();
        }

        const resolvedTokenAndUser = await resolveTokenAndUser(queueItem);
        let tokenSnapshot = resolvedTokenAndUser.tokenSnapshot;
        const firebaseUserID = resolvedTokenAndUser.firebaseUserID;
        resolvedFirebaseUserID = firebaseUserID;
        // Legacy provider-only rows gain the resolved uid in memory so every
        // subsequent completion/retry/DLQ transition uses the shared user and
        // revision guard without rewriting the provider payload first.
        queueItem.userID = firebaseUserID;
        if (!isQueueUserAllowed(queueItem, firebaseUserID)) {
            logger.info(`[${isHealthQueueItem(queueItem) ? 'HealthSync' : 'SleepSync'}] Resolved user is outside the configured rollout; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'user_not_allowed',
                userAllowed: false,
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }
        if (queueItem.provider === SLEEP_PROVIDERS.SuuntoApp) {
            suuntoSleepLifecycleGuards = await captureActiveSuuntoWebhookWriteLifecycleGuards(
                admin.firestore(),
                firebaseUserID,
                queueItem.providerUserId,
                tokenSnapshot,
            );
            if (!suuntoSleepLifecycleGuards && queueItem.type !== 'suunto_webhook') {
                const verificationStatus = await ensureSuuntoWebhookAccountBindingForProviderVerifiedToken(
                    admin.firestore(),
                    firebaseUserID,
                    tokenSnapshot,
                );
                if (verificationStatus === 'created' || verificationStatus === 'current') {
                    const refreshedResolution = await resolveTokenAndUser(queueItem);
                    if (refreshedResolution.firebaseUserID === firebaseUserID) {
                        tokenSnapshot = refreshedResolution.tokenSnapshot;
                        suuntoSleepLifecycleGuards =
                            await captureActiveSuuntoWebhookWriteLifecycleGuards(
                                admin.firestore(),
                                firebaseUserID,
                                queueItem.providerUserId,
                                tokenSnapshot,
                            );
                    }
                }
            }
            if (!suuntoSleepLifecycleGuards) {
                logger.info('[SleepSync][Suunto] Skipping work without a current provider-authorized binding.');
                return markQueueItemSkipped(
                    queueItem,
                    undefined,
                    'user_or_provider_lifecycle_changed',
                    {
                        skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                        sessionsWritten: 0,
                        sessionsSkipped: 0,
                    },
                );
            }
            suuntoAuthorityBaseline = suuntoSleepLifecycleGuards;
            if (queueItem.type === 'suunto_webhook'
                && queueItem.suuntoWebhookAuthorityDigest
                    !== getSuuntoWebhookWriteLifecycleAuthorityDigest(
                        suuntoSleepLifecycleGuards,
                    )) {
                logger.info('[SleepSync][Suunto] Skipping webhook work from a superseded account authority.');
                return markQueueItemSkipped(
                    queueItem,
                    undefined,
                    'user_or_provider_lifecycle_changed',
                    {
                        skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                        sessionsWritten: 0,
                        sessionsSkipped: 0,
                    },
                );
            }
        }
        if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI) {
            corosLifecycleGuards = await captureCOROSWriteLifecycleGuards(
                firebaseUserID,
                queueItem.providerUserId,
                tokenSnapshot.ref,
                corosCredentialFromSnapshot(tokenSnapshot),
            );
        }
        if (isGarminHealthQueueItem(queueItem)) {
            garminHealthLifecycleGuards = await captureActiveGarminHealthWriteLifecycleGuards(
                admin.firestore(),
                firebaseUserID,
                queueItem.providerUserId,
                tokenSnapshot,
            );
            if (!garminHealthLifecycleGuards
                || !doesGarminHealthQueueFenceMatch(queueItem, garminHealthLifecycleGuards)) {
                logger.info('[HealthSync][Garmin] Skipping webhook work from a superseded account lifecycle.');
                return markQueueItemSkipped(
                    queueItem,
                    undefined,
                    'user_or_provider_lifecycle_changed',
                    {
                        skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                        sessionsWritten: 0,
                        sessionsSkipped: 0,
                        healthRecordsWritten: 0,
                        healthRecordsUnchanged: 0,
                        healthRecordsStale: 0,
                    },
                );
            }
        }
        if (isSuuntoHealthQueueItem(queueItem)) {
            if (!suuntoSleepLifecycleGuards) {
                throw new SuuntoSleepLifecycleChangedError();
            }
            suuntoHealthLifecycleGuards = suuntoSleepLifecycleGuards;
            const capturedTokenGeneration = suuntoHealthLifecycleGuards
                .requiredExistingTokenCredential.credentialGeneration || null;
            const capturedRootOAuthGeneration = normalizeLifecycleGeneration(
                expectedSuuntoLifecycleField(
                    suuntoHealthLifecycleGuards,
                    ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
                ),
            );
            const capturedConnectionGeneration = normalizeLifecycleGeneration(
                expectedSuuntoLifecycleField(
                    suuntoHealthLifecycleGuards,
                    'connectionStateGeneration',
                ),
            );
            if ((queueItem.suuntoHealthTokenCredentialGeneration !== undefined
                    && queueItem.suuntoHealthTokenCredentialGeneration !== capturedTokenGeneration)
                || (queueItem.suuntoHealthRootOAuthCredentialGeneration !== undefined
                    && queueItem.suuntoHealthRootOAuthCredentialGeneration
                        !== capturedRootOAuthGeneration)
                || (queueItem.suuntoHealthConnectionStateGeneration !== undefined
                    && queueItem.suuntoHealthConnectionStateGeneration !== capturedConnectionGeneration)) {
                logger.info('[HealthSync][Suunto] Skipping webhook work from a superseded account lifecycle.');
                return markQueueItemSkipped(
                    queueItem,
                    undefined,
                    'user_or_provider_lifecycle_changed',
                    {
                        skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                        sessionsWritten: 0,
                        sessionsSkipped: 0,
                        healthRecordsWritten: 0,
                        healthRecordsUnchanged: 0,
                        healthRecordsStale: 0,
                    },
                );
            }
        }
        if (await shouldSkipQueueWorkForDeletedUser(
            firebaseUserID,
            serviceNameForProvider(queueItem.provider),
            queueItem.id,
            'before_sleep_provider_sync',
        )) {
            return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        processingOwner = crypto.randomUUID();
        const claimResult = await claimSleepQueueRevision(queueItem, firebaseUserID, processingOwner);
        if (claimResult === 'deleted_user') {
            return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }
        if (claimResult === 'superseded') return QueueResult.Processed;
        if (claimResult === 'busy') {
            throw new ProviderOperationStillInFlightError(queueItem.id, Date.now());
        }
        queueItem.processingOwner = processingOwner;
        queueItem.processingRevision = getSleepQueueRevisionIdentity(queueItem) || undefined;
        processingUserID = firebaseUserID;

        if (queueItem.type === 'garmin_ping_batch') {
            const callbacksQueued = await fanOutGarminPingBatch(queueItem, firebaseUserID);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'success',
                callbacksQueued,
                sessionsWritten: 0,
                sessionsSkipped: 0,
                healthRecordsWritten: 0,
            });
        }

        let mapperResults: SleepMapperResult[] = [];
        let healthResults: Array<COROSDailyHealthResult | SuuntoHealthResult | GarminHealthResult> = [];
        switch (queueItem.provider) {
            case SLEEP_PROVIDERS.GarminAPI:
                if (isGarminHealthQueueItem(queueItem)) {
                    const initialGarminLifecycleGuards = garminHealthLifecycleGuards;
                    if (!initialGarminLifecycleGuards) {
                        throw new GarminHealthAccountValidationError();
                    }
                    const garminHealthResult = await processGarminHealthQueueItem(
                        queueItem,
                        tokenSnapshot,
                        firebaseUserID,
                        initialGarminLifecycleGuards,
                        guards => {
                            garminHealthLifecycleGuards = guards;
                        },
                    );
                    healthResults = garminHealthResult.healthResults;
                    garminHealthLifecycleGuards = garminHealthResult.lifecycleGuards;
                } else {
                    mapperResults = await processGarminQueueItem(
                        queueItem,
                        tokenSnapshot,
                        firebaseUserID,
                    );
                }
                break;
            case SLEEP_PROVIDERS.SuuntoApp:
                if (isSuuntoHealthQueueItem(queueItem)) {
                    const initialSuuntoLifecycleGuards = suuntoHealthLifecycleGuards;
                    if (!initialSuuntoLifecycleGuards) {
                        throw new Error('Missing Suunto Health lifecycle guards.');
                    }
                    const suuntoHealthResult = await processSuuntoHealthQueueItem(
                        queueItem,
                        tokenSnapshot,
                        firebaseUserID,
                        initialSuuntoLifecycleGuards,
                        guards => {
                            suuntoHealthLifecycleGuards = guards;
                        },
                    );
                    healthResults = suuntoHealthResult.healthResults;
                    suuntoHealthLifecycleGuards = suuntoHealthResult.lifecycleGuards;
                } else {
                    const initialSuuntoLifecycleGuards = suuntoSleepLifecycleGuards;
                    if (!initialSuuntoLifecycleGuards) {
                        throw new SuuntoSleepLifecycleChangedError();
                    }
                    mapperResults = await processSuuntoQueueItem(
                        queueItem,
                        tokenSnapshot,
                        firebaseUserID,
                        initialSuuntoLifecycleGuards,
                        guards => {
                            suuntoSleepLifecycleGuards = guards;
                        },
                    );
                }
                break;
            case SLEEP_PROVIDERS.COROSAPI:
                {
                    const initialCorosLifecycleGuards = corosLifecycleGuards;
                    if (!initialCorosLifecycleGuards) {
                        throw new COROSDailyAccountValidationError();
                    }
                    const corosResult = await processCorosQueueItem(
                        queueItem,
                        tokenSnapshot,
                        firebaseUserID,
                        initialCorosLifecycleGuards,
                        credential => {
                            if (corosLifecycleGuards) {
                                corosLifecycleGuards = {
                                    ...corosLifecycleGuards,
                                    requiredExistingTokenCredential: credential,
                                };
                            }
                        },
                        guards => {
                            corosLifecycleGuards = guards;
                        },
                    );
                    mapperResults = corosResult.sleepResults;
                    healthResults = corosResult.healthResults;
                    corosLifecycleGuards = corosResult.lifecycleGuards;
                }
                break;
            default:
                throw new Error(`Unsupported sleep provider ${queueItem.provider}`);
        }

        if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI && !corosLifecycleGuards) {
            throw new COROSDailyAccountValidationError();
        }
        if (isSuuntoHealthQueueItem(queueItem) && !suuntoHealthLifecycleGuards) {
            throw new Error('Missing Suunto Health lifecycle guards.');
        }
        if (isGarminHealthQueueItem(queueItem) && !garminHealthLifecycleGuards) {
            throw new GarminHealthAccountValidationError();
        }
        const corosHealthLifecycleGuards = queueItem.provider === SLEEP_PROVIDERS.COROSAPI
            ? corosLifecycleGuards
            : null;
        let result: Awaited<ReturnType<typeof upsertSleepSessions>>;
        if (isSuuntoHealthQueueItem(queueItem) || isGarminHealthQueueItem(queueItem)) {
            result = { written: 0, skipped: 0 };
        } else if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI) {
            result = await upsertSleepSessions(
                firebaseUserID,
                mapperResults,
                Date.now(),
                corosLifecycleGuards || undefined,
            );
        } else if (queueItem.provider === SLEEP_PROVIDERS.SuuntoApp
            && suuntoSleepLifecycleGuards
            && suuntoAuthorityBaseline) {
            const writeAttempt = await runWithSuuntoWebhookCredentialRebase(
                firebaseUserID,
                queueItem.providerUserId,
                suuntoAuthorityBaseline,
                suuntoSleepLifecycleGuards,
                guards => upsertSleepSessions(firebaseUserID, mapperResults, Date.now(), guards),
                writeResult => writeResult.lifecycleGuardSkipped === true,
            );
            result = writeAttempt.result;
            suuntoSleepLifecycleGuards = writeAttempt.guards;
        } else {
            result = await upsertSleepSessions(firebaseUserID, mapperResults);
        }
        if (result.lifecycleGuardSkipped) {
            return markQueueItemSkipped(queueItem, undefined, 'provider_disconnected_during_sync', {
                skippedContext: 'PROVIDER_LIFECYCLE_GUARD',
                sessionsWritten: result.written,
                sessionsSkipped: result.skipped,
                healthRecordsWritten: 0,
                healthRecordsUnchanged: 0,
                healthRecordsStale: 0,
            });
        }
        let healthRecordsWritten = 0;
        let healthRecordsUnchanged = 0;
        let healthRecordsStale = 0;
        for (const healthResult of healthResults) {
            let writeResult: Awaited<ReturnType<typeof replaceHealthSourceRecord>>;
            if (isSuuntoHealthQueueItem(queueItem)
                && suuntoHealthLifecycleGuards
                && suuntoAuthorityBaseline) {
                const writeAttempt = await runWithSuuntoHealthCredentialRebase(
                    firebaseUserID,
                    queueItem.providerUserId,
                    suuntoAuthorityBaseline,
                    suuntoHealthLifecycleGuards,
                    guards => replaceHealthSourceRecord(
                        firebaseUserID,
                        healthResult.input,
                        Date.now(),
                        guards,
                    ),
                    candidate => candidate.status === 'skipped_lifecycle_guard',
                );
                writeResult = writeAttempt.result;
                suuntoHealthLifecycleGuards = writeAttempt.guards;
            } else if (isGarminHealthQueueItem(queueItem) && garminHealthLifecycleGuards) {
                writeResult = await replaceHealthSourceRecord(
                    firebaseUserID,
                    healthResult.input,
                    Date.now(),
                    garminHealthLifecycleGuards,
                );
            } else {
                writeResult = await replaceHealthSourceRecord(
                    firebaseUserID,
                    healthResult.input,
                    Date.now(),
                    corosHealthLifecycleGuards || {},
                );
            }
            if (writeResult.status === 'skipped_deleted_user') {
                return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                    skippedContext: 'USER_DELETION_GUARD',
                    sessionsWritten: result.written,
                    sessionsSkipped: result.skipped,
                    healthRecordsWritten,
                    healthRecordsUnchanged,
                    healthRecordsStale,
                });
            }
            if (writeResult.status === 'skipped_lifecycle_guard') {
                return markQueueItemSkipped(queueItem, undefined, 'provider_disconnected_during_sync', {
                    skippedContext: 'PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: result.written,
                    sessionsSkipped: result.skipped,
                    healthRecordsWritten,
                    healthRecordsUnchanged,
                    healthRecordsStale,
                });
            }
            if (writeResult.status === 'written') healthRecordsWritten += 1;
            if (writeResult.status === 'unchanged') healthRecordsUnchanged += 1;
            if (writeResult.status === 'stale') healthRecordsStale += 1;
        }
        const stateUpdateMs = Date.now();
        if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI
            || isSuuntoHealthQueueItem(queueItem)
            || isGarminHealthQueueItem(queueItem)) {
            const healthProvider = isSuuntoHealthQueueItem(queueItem)
                ? HEALTH_PROVIDERS.SuuntoApp
                : isGarminHealthQueueItem(queueItem)
                    ? HEALTH_PROVIDERS.GarminAPI
                    : HEALTH_PROVIDERS.COROSAPI;
            const isHealthPoll = queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                || queueItem.healthTrigger === 'poll';
            const healthStateUpdate = {
                status: HEALTH_SYNC_STATUSES.Ready,
                lastSyncedAtMs: stateUpdateMs,
                lastPollAtMs: isHealthPoll ? stateUpdateMs : undefined,
                lastWebhookAtMs: queueItem.healthTrigger === 'webhook'
                    || isGarminHealthQueueItem(queueItem)
                    ? stateUpdateMs
                    : undefined,
                lastObservedAtMs: healthResults.length > 0
                    ? Math.max(...healthResults.map(item => item.observedAtMs))
                    : undefined,
                lastErrorCode: null,
            };
            let healthStateWritten: boolean;
            if (isSuuntoHealthQueueItem(queueItem)
                && suuntoHealthLifecycleGuards
                && suuntoAuthorityBaseline) {
                const stateAttempt = await runWithSuuntoHealthCredentialRebase(
                    firebaseUserID,
                    queueItem.providerUserId,
                    suuntoAuthorityBaseline,
                    suuntoHealthLifecycleGuards,
                    guards => updateHealthSyncState(
                        firebaseUserID,
                        healthProvider,
                        healthStateUpdate,
                        stateUpdateMs,
                        guards,
                    ),
                    written => !written,
                );
                healthStateWritten = stateAttempt.result;
                suuntoHealthLifecycleGuards = stateAttempt.guards;
            } else if (isGarminHealthQueueItem(queueItem) && garminHealthLifecycleGuards) {
                healthStateWritten = await updateHealthSyncState(
                    firebaseUserID,
                    healthProvider,
                    healthStateUpdate,
                    stateUpdateMs,
                    garminHealthLifecycleGuards,
                );
            } else {
                healthStateWritten = await updateHealthSyncState(
                    firebaseUserID,
                    healthProvider,
                    healthStateUpdate,
                    stateUpdateMs,
                    corosHealthLifecycleGuards || {},
                );
            }
            if (!healthStateWritten) {
                return markQueueItemSkipped(queueItem, undefined, 'user_or_provider_lifecycle_changed', {
                    skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: result.written,
                    sessionsSkipped: result.skipped,
                    healthRecordsWritten,
                    healthRecordsUnchanged,
                    healthRecordsStale,
                });
            }
        }
        if (!isHealthQueueItem(queueItem)) {
            const sleepStateUpdate = {
                status: SLEEP_SYNC_STATUSES.Ready,
                lastSyncedAtMs: stateUpdateMs,
                lastPollAtMs: isPollQueueItemType(queueItem.type) ? stateUpdateMs : undefined,
                lastWebhookAtMs: isWebhookQueueItemType(queueItem.type) ? stateUpdateMs : undefined,
                lastError: null,
            };
            let sleepStateWritten: boolean;
            let usedSleepLifecycleGuard = false;
            if (queueItem.provider === SLEEP_PROVIDERS.SuuntoApp
                && suuntoSleepLifecycleGuards
                && suuntoAuthorityBaseline) {
                usedSleepLifecycleGuard = true;
                const stateAttempt = await runWithSuuntoWebhookCredentialRebase(
                    firebaseUserID,
                    queueItem.providerUserId,
                    suuntoAuthorityBaseline,
                    suuntoSleepLifecycleGuards,
                    guards => updateSleepSyncState(
                        firebaseUserID,
                        queueItem.provider,
                        sleepStateUpdate,
                        stateUpdateMs,
                        guards,
                    ),
                    written => !written,
                );
                sleepStateWritten = stateAttempt.result;
                suuntoSleepLifecycleGuards = stateAttempt.guards;
            } else {
                const sleepLifecycleGuards: SleepLifecycleWriterDependencies | undefined =
                    queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                        ? corosLifecycleGuards || undefined
                        : undefined;
                usedSleepLifecycleGuard = !!sleepLifecycleGuards;
                sleepStateWritten = sleepLifecycleGuards
                    ? await updateSleepSyncState(
                        firebaseUserID,
                        queueItem.provider,
                        sleepStateUpdate,
                        stateUpdateMs,
                        sleepLifecycleGuards,
                    )
                    : await updateSleepSyncState(firebaseUserID, queueItem.provider, sleepStateUpdate);
            }
            if (usedSleepLifecycleGuard && sleepStateWritten === false) {
                return markQueueItemSkipped(queueItem, undefined, 'user_or_provider_lifecycle_changed', {
                    skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: result.written,
                    sessionsSkipped: result.skipped,
                    healthRecordsWritten,
                    healthRecordsUnchanged,
                    healthRecordsStale,
                });
            }
        }
        logger.info(`[${isHealthQueueItem(queueItem) ? 'HealthSync' : 'SleepSync'}] Queue item ${queueItem.id} completed`, {
            sessionsWritten: result.written,
            sessionsSkipped: result.skipped,
            healthRecordsWritten,
            healthRecordsUnchanged,
            healthRecordsStale,
        });
        return updateToProcessed(queueItem, undefined, {
            resultStatus: 'success',
            sessionsWritten: result.written,
            sessionsSkipped: result.skipped,
            healthRecordsWritten,
            healthRecordsUnchanged,
            healthRecordsStale,
        });
    } catch (error) {
        if (error instanceof ProviderOperationStillInFlightError) throw error;
        if (error instanceof SuuntoCredentialRotationRetryableError) {
            logger.warn('[SleepSync][Suunto] Credential kept rotating during an authorized write; retrying the current queue revision.');
            return increaseRetryCountForQueueItem(queueItem, error);
        }
        if (error instanceof SuuntoSleepLifecycleChangedError) {
            return markQueueItemSkipped(
                queueItem,
                undefined,
                'user_or_provider_lifecycle_changed',
                {
                    skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: 0,
                    sessionsSkipped: 0,
                },
            );
        }
        if (error instanceof GarminHealthAccountValidationError) {
            logger.info('[HealthSync][Garmin] Skipping work because the account lifecycle changed.');
            return markQueueItemSkipped(
                queueItem,
                undefined,
                'user_or_provider_lifecycle_changed',
                {
                    skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: 0,
                    sessionsSkipped: 0,
                    healthRecordsWritten: 0,
                    healthRecordsUnchanged: 0,
                    healthRecordsStale: 0,
                },
            );
        }
        if (error instanceof GarminHealthPermissionError) {
            if (garminHealthLifecycleGuards) {
                const stateWritten = await updateHealthSyncState(
                    error.userID,
                    HEALTH_PROVIDERS.GarminAPI,
                    {
                        status: HEALTH_SYNC_STATUSES.PermissionMissing,
                        lastErrorCode: error.code,
                    },
                    Date.now(),
                    garminHealthLifecycleGuards,
                );
                if (!stateWritten) {
                    return markQueueItemSkipped(
                        queueItem,
                        undefined,
                        'user_or_provider_lifecycle_changed',
                        {
                            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                            sessionsWritten: 0,
                            sessionsSkipped: 0,
                            healthRecordsWritten: 0,
                            healthRecordsUnchanged: 0,
                            healthRecordsStale: 0,
                        },
                    );
                }
            }
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'GARMIN_HEALTH_PERMISSION_MISSING',
                error.userID,
            );
        }
        if (isGarminHealthQueueItem(queueItem)
            && error instanceof GarminHealthValidationError) {
            logger.warn(`[HealthSync][Garmin] Queue item ${queueItem.id} contains an invalid provider response; moving to DLQ`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'INVALID_GARMIN_HEALTH_RESPONSE',
                resolvedFirebaseUserID,
            );
        }
        if (error instanceof InvalidGarminCallbackUrlError) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} has untrusted Garmin callback URL; moving to DLQ`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'INVALID_GARMIN_CALLBACK_URL',
                resolvedFirebaseUserID,
            );
        }
        if (error instanceof GarminSleepPermissionError) {
            await updateSleepSyncState(error.userID, SLEEP_PROVIDERS.GarminAPI, {
                status: SLEEP_SYNC_STATUSES.PermissionMissing,
                lastError: error.message,
            });
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'PERMISSION_MISSING',
                error.userID,
            );
        }
        if (error instanceof UnsupportedGarminPushPayloadError) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} has unsupported Garmin push payload; moving to DLQ`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'UNSUPPORTED_GARMIN_PUSH_PAYLOAD',
                resolvedFirebaseUserID,
            );
        }
        if (error instanceof MissingSleepProviderTokenError) {
            if (!isHealthQueueItem(queueItem)
                && queueItem.userID
                && (queueItem.provider !== SLEEP_PROVIDERS.COROSAPI || corosLifecycleGuards)) {
                if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI) {
                    await markSleepSyncError(
                        queueItem.userID,
                        queueItem.provider,
                        error,
                        Date.now(),
                        corosLifecycleGuards || {},
                    );
                } else if (queueItem.provider === SLEEP_PROVIDERS.SuuntoApp
                    && suuntoSleepLifecycleGuards) {
                    await markSleepSyncError(
                        queueItem.userID,
                        queueItem.provider,
                        error,
                        Date.now(),
                        suuntoSleepLifecycleGuards,
                    );
                } else if (queueItem.provider !== SLEEP_PROVIDERS.SuuntoApp) {
                    await markSleepSyncError(queueItem.userID, queueItem.provider, error);
                }
            }
            logger.warn(`[SleepSync] Queue item ${queueItem.id} has no connected ${error.provider} token; moving to DLQ`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                error,
                'NO_TOKEN_FOUND',
                resolvedFirebaseUserID,
            );
        }
        if (error instanceof TerminalServiceAuthError) {
            const errorUserID = error.firebaseUserID || queueItem.userID;
            const telemetryError = isGarminHealthQueueItem(queueItem)
                ? sanitizeGarminHealthErrorForTelemetry(error)
                : isSuuntoHealthQueueItem(queueItem)
                ? sanitizeSuuntoHealthErrorForTelemetry(error)
                : queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                    ? sanitizeCOROSDailyErrorForTelemetry(error)
                    : error;
            if (!isHealthQueueItem(queueItem)
                && errorUserID
                && (queueItem.provider !== SLEEP_PROVIDERS.COROSAPI || corosLifecycleGuards)) {
                if (queueItem.provider === SLEEP_PROVIDERS.COROSAPI) {
                    await markSleepSyncError(
                        errorUserID,
                        queueItem.provider,
                        telemetryError,
                        Date.now(),
                        corosLifecycleGuards || {},
                    );
                } else if (queueItem.provider === SLEEP_PROVIDERS.SuuntoApp
                    && suuntoSleepLifecycleGuards) {
                    await markSleepSyncError(
                        errorUserID,
                        queueItem.provider,
                        telemetryError,
                        Date.now(),
                        suuntoSleepLifecycleGuards,
                    );
                } else if (queueItem.provider !== SLEEP_PROVIDERS.SuuntoApp) {
                    await markSleepSyncError(errorUserID, queueItem.provider, telemetryError);
                }
            }
            // Terminal token cleanup owns the guarded reconnect-required
            // transition for service metadata and provider Health state when supported.
            // A second queue-local write could race a newer reconnect or
            // explicit disconnect and must not overwrite that lifecycle.
            logger.warn(`[SleepSync] Queue item ${queueItem.id} hit terminal auth failure for ${queueItem.provider}; moving to DLQ with ${error.dlqContext}`);
            return moveSleepQueueItemToDeadLetterQueue(
                queueItem,
                telemetryError,
                error.dlqContext,
                errorUserID,
            );
        }
        if (error instanceof TokenRefreshSkippedForDeletedUserError) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} skipped token refresh because user ${error.firebaseUserID} is missing or deletion is in progress.`);
            return markQueueItemSkipped(queueItem, undefined, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }
        if (isHealthQueueItem(queueItem)
            && isTokenUseSkippedForPendingDisconnectError(error)
            && error.reason === 'inactive_oauth_credential') {
            logger.info('[HealthSync] Skipping work from an inactive OAuth credential generation.');
            return markQueueItemSkipped(
                queueItem,
                undefined,
                'user_or_provider_lifecycle_changed',
                {
                    skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                    sessionsWritten: 0,
                    sessionsSkipped: 0,
                    healthRecordsWritten: 0,
                    healthRecordsUnchanged: 0,
                    healthRecordsStale: 0,
                },
            );
        }
        if (isTokenUseSkippedForPendingDisconnectError(error)) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} deferred token use because service disconnect is pending.`);
            return deferQueueItemForPendingDisconnect(queueItem, undefined, {
                sessionsWritten: 0,
                sessionsSkipped: 0,
            }, {
                userID: error.firebaseUserID,
                serviceName: error.serviceName,
            });
        }
        const telemetryError = isGarminHealthQueueItem(queueItem)
            ? sanitizeGarminHealthErrorForTelemetry(error)
            : isSuuntoHealthQueueItem(queueItem)
            ? sanitizeSuuntoHealthErrorForTelemetry(error)
            : queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                ? sanitizeCOROSDailyErrorForTelemetry(error)
                : error;
        if (queueItem.userID) {
            const sleepErrorStateWritten = isHealthQueueItem(queueItem)
                ? undefined
                : queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                    ? corosLifecycleGuards
                        ? await markSleepSyncError(
                            queueItem.userID,
                            queueItem.provider,
                            telemetryError,
                            Date.now(),
                            corosLifecycleGuards,
                        )
                        : undefined
                    : queueItem.provider === SLEEP_PROVIDERS.SuuntoApp
                        ? suuntoSleepLifecycleGuards
                            ? await markSleepSyncError(
                                queueItem.userID,
                                queueItem.provider,
                                telemetryError,
                                Date.now(),
                                suuntoSleepLifecycleGuards,
                            )
                            : undefined
                        : await markSleepSyncError(queueItem.userID, queueItem.provider, telemetryError);
            if ((queueItem.provider === SLEEP_PROVIDERS.COROSAPI && corosLifecycleGuards
                || queueItem.provider === SLEEP_PROVIDERS.SuuntoApp && suuntoSleepLifecycleGuards)
                && sleepErrorStateWritten === false) {
                return markQueueItemSkipped(
                    queueItem,
                    undefined,
                    'user_or_provider_lifecycle_changed',
                    {
                        skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                        sessionsWritten: 0,
                        sessionsSkipped: 0,
                    },
                );
            }
            const failedHealthProvider = isSuuntoHealthQueueItem(queueItem)
                ? HEALTH_PROVIDERS.SuuntoApp
                : isGarminHealthQueueItem(queueItem)
                    ? HEALTH_PROVIDERS.GarminAPI
                : queueItem.provider === SLEEP_PROVIDERS.COROSAPI
                    ? HEALTH_PROVIDERS.COROSAPI
                    : null;
            const failedHealthLifecycleGuards = isSuuntoHealthQueueItem(queueItem)
                ? suuntoHealthLifecycleGuards
                : isGarminHealthQueueItem(queueItem)
                    ? garminHealthLifecycleGuards
                    : corosLifecycleGuards;
            const failedHealthUserID = queueItem.userID;
            if (failedHealthProvider && failedHealthLifecycleGuards && failedHealthUserID) {
                try {
                    const failedAtMs = Date.now();
                    const failureStateUpdate = {
                        status: HEALTH_SYNC_STATUSES.Failed,
                        lastErrorCode: isSuuntoHealthQueueItem(queueItem)
                            ? 'suunto_health_sync_failed'
                            : isGarminHealthQueueItem(queueItem)
                                ? 'garmin_health_sync_failed'
                                : 'coros_daily_sync_failed',
                    };
                    let healthStateWritten: boolean;
                    if (isSuuntoHealthQueueItem(queueItem)
                        && suuntoHealthLifecycleGuards
                        && suuntoAuthorityBaseline) {
                        const stateAttempt = await runWithSuuntoHealthCredentialRebase(
                            failedHealthUserID,
                            queueItem.providerUserId,
                            suuntoAuthorityBaseline,
                            suuntoHealthLifecycleGuards,
                            guards => updateHealthSyncState(
                                failedHealthUserID,
                                failedHealthProvider,
                                failureStateUpdate,
                                failedAtMs,
                                guards,
                            ),
                            written => !written,
                        );
                        healthStateWritten = stateAttempt.result;
                        suuntoHealthLifecycleGuards = stateAttempt.guards;
                    } else {
                        healthStateWritten = await updateHealthSyncState(
                            failedHealthUserID,
                            failedHealthProvider,
                            failureStateUpdate,
                            failedAtMs,
                            failedHealthLifecycleGuards,
                        );
                    }
                    if (!healthStateWritten) {
                        return markQueueItemSkipped(
                            queueItem,
                            undefined,
                            'user_or_provider_lifecycle_changed',
                            {
                                skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
                                sessionsWritten: 0,
                                sessionsSkipped: 0,
                            },
                        );
                    }
                } catch {
                    // Queue retry accounting is the durable recovery path. A
                    // sync-state outage must not bypass that transition.
                    logger.error('[HealthSync] Failed to record provider Health sync failure.', {
                        failure: isSuuntoHealthQueueItem(queueItem)
                            ? 'suunto_health_state_write_failed'
                            : isGarminHealthQueueItem(queueItem)
                                ? 'garmin_health_state_write_failed'
                                : 'coros_health_state_write_failed',
                    });
                }
            }
        }
        logger.error(`[SleepSync] Queue item ${queueItem.id} failed`, telemetryError);
        return increaseRetryCountForQueueItem(
            queueItem,
            telemetryError instanceof Error ? telemetryError : new Error(`${telemetryError}`),
        );
    } finally {
        if (processingOwner && processingUserID) {
            try {
                await releaseSleepQueueRevision(queueItem, processingUserID, processingOwner);
            } catch (releaseError) {
                logger.warn(`[SleepSync] Failed to release processing lease for queue item ${queueItem.id}.`, {
                    errorName: releaseError instanceof Error ? releaseError.name : 'UnknownError',
                });
            }
        }
    }
}

export function getSleepSyncServiceName(provider: SleepProvider): ServiceNames {
    return serviceNameForProvider(provider);
}
