import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    ACTIVITY_SYNC_ROUTE_IDS,
    ACTIVITY_SYNC_ROUTES,
    ActivitySyncRouteId,
} from '../../../shared/activity-sync-routes';
import {
    ROUTE_DELIVERY_SYNC_ROUTE_IDS,
    ROUTE_DELIVERY_SYNC_ROUTES,
    RouteDeliverySyncRouteId,
} from '../../../shared/route-delivery-sync-routes';
import { SERVICE_CONNECTION_STATES } from '../../../shared/service-connection';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { getSleepBackfillWindowDays } from '../../../shared/sleep-backfill';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { addSleepSyncQueueItem } from '../sleep/queue';
import { getTokenData } from '../tokens';
import { addToQueueForSuunto } from '../queue';
import { getWorkoutQueueItems } from '../history';
import { enqueueRouteSyncQueueItem } from '../routes/route-sync-queue';
import { listSuuntoRoutes, SuuntoRouteSummary } from '../suunto/routes';
import { enqueueActivitySyncJobsForImportedEvent, EnqueueActivitySyncOriginalFileMetadata } from '../activity-sync/enqueue-imported-event';
import { getActivitySyncMetadataDocId } from '../activity-sync/metadata';
import { enqueueRouteDeliverySyncJobsForImportedRoute } from '../route-delivery-sync/enqueue-imported-route';
import { buildRouteDeliverySourceRevisionKeyForRouteSource } from '../route-delivery-sync/revision';
import { hasSuccessfulRouteDeliveryMetadataForRevision } from '../route-delivery-sync/delivery-metadata';
import { markServiceConnected } from '../service-connection-meta';
import * as requestPromise from '../request-helper';
import { config } from '../config';
import { toSuuntoAuthorizationHeader } from '../suunto/authorization-header';

type RecoveryStage = 'all' | 'restore' | 'restore-source' | 'source-backfill' | 'sync-reconcile';

const DEFAULT_LIMIT = 500;
const DEFAULT_INCIDENT_PADDING_HOURS = 12;
const DEFAULT_RESTORE_READ_OFFSET_MINUTES = 2;
const DEFAULT_RECONNECTION_GRACE_MS = 60 * 1000;
const DRY_RUN_TOKEN_EXPIRY_SAFETY_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 200;
const DIRECT_META_READ_BATCH_SIZE = 300;
const LOG_PREFIX = '[suunto-outage-recovery]';

const SUUNTO_ACTIVITY_SYNC_ROUTE_IDS: ActivitySyncRouteId[] = [
    ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
];

const SUUNTO_ROUTE_DELIVERY_SYNC_ROUTE_IDS: RouteDeliverySyncRouteId[] = [
    ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
];

const SUUNTO_SERVICE_IDENTIFIERS = new Set<string>([
    ServiceNames.SuuntoApp,
    'Suunto app',
    'suuntoApp',
]);

interface ScriptOptions {
    execute: boolean;
    stage: RecoveryStage;
    stageWasExplicit: boolean;
    uid?: string;
    uids?: string[];
    incidentStartMs?: number;
    incidentEndMs?: number;
    limit: number;
    pageSize: number;
    sleepWindowDays: number;
    incidentPaddingMs: number;
    restoreReadOffsetMs: number;
}

interface AffectedMetaCandidate {
    uid: string;
    metaPath: string;
    lastDisconnectedAtMs: number;
    providerUserId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
}

interface RecoveryTarget extends AffectedMetaCandidate {
    restoreReadTimeMs: number;
}

export interface SuuntoOutageRecoverySummary {
    dryRun: boolean;
    stage: RecoveryStage;
    incidentStart: string | null;
    incidentEnd: string | null;
    affectedCandidates: number;
    targets: number;
    skipped: Record<string, number>;
    tokenRestore: {
        checked: number;
        restored: number;
        currentTokenPreserved: number;
        currentTokenNewerReconnect: number;
        missingProviderUserId: number;
        missingPitrToken: number;
    };
    serviceState: {
        markedConnected: number;
        settingsRoutesRestored: number;
    };
    sleepBackfill: {
        windowsQueued: number;
    };
    activityBackfill: {
        providerWorkoutsFound: number;
        workoutsQueued: number;
    };
    routeBackfill: {
        providerRoutesFound: number;
        routesQueued: number;
        routesSkippedOutsideIncident: number;
    };
    activitySyncReconciliation: {
        scannedEvents: number;
        candidates: number;
        queued: number;
        skippedAlreadySuccessful: number;
    };
    routeDeliveryReconciliation: {
        scannedRoutes: number;
        candidates: number;
        queued: number;
        skippedAlreadySuccessful: number;
    };
    failed: number;
}

interface SyncSettingsRestorePatch {
    activitySyncRoutes: Partial<Record<ActivitySyncRouteId, { enabled: true }>>;
    routeDeliverySyncRoutes: Partial<Record<RouteDeliverySyncRouteId, { enabled: true }>>;
}

interface IncidentWindow {
    startMs: number;
    endMs: number;
}

interface SleepWindow {
    startMs: number;
    endMs: number;
}

interface SourceBackfillToken {
    tokenSnapshot: admin.firestore.DocumentSnapshot;
    providerUserId: string;
}

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === key) {
            return argv[index + 1];
        }
        if (token.startsWith(equalsPrefix)) {
            return token.slice(equalsPrefix.length);
        }
    }
    return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateMs(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid date value: ${value}`);
    }
    return parsed;
}

function parseUIDAllowlist(value: string | undefined): string[] | undefined {
    const values = `${value || ''}`
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function parseStage(value: string | undefined): RecoveryStage {
    const normalized = `${value || 'all'}`.trim();
    if (
        normalized === 'all'
        || normalized === 'restore'
        || normalized === 'restore-source'
        || normalized === 'source-backfill'
        || normalized === 'sync-reconcile'
    ) {
        return normalized;
    }
    throw new Error(`Invalid --stage ${value}. Expected all, restore, restore-source, source-backfill, or sync-reconcile.`);
}

export function parseSuuntoOutageRecoveryOptions(argv: string[]): ScriptOptions {
    const uid = readArgValue(argv, '--uid');
    const uids = uid ? undefined : parseUIDAllowlist(readArgValue(argv, '--uids'));
    const defaultSleepWindowDays = getSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp) || 28;
    const stageValue = readArgValue(argv, '--stage');
    const stage = parseStage(stageValue);
    const execute = argv.includes('--apply') || argv.includes('--execute');
    if (execute && !stageValue) {
        throw new Error('Apply mode requires an explicit --stage. Use --stage=restore, --stage=restore-source, --stage=source-backfill, or --stage=sync-reconcile.');
    }
    if (execute && stage === 'all') {
        throw new Error('Apply mode does not support --stage=all. Run apply stages separately so source imports can drain before sync reconciliation.');
    }

    return {
        execute,
        stage,
        stageWasExplicit: Boolean(stageValue),
        uid,
        uids,
        incidentStartMs: parseDateMs(readArgValue(argv, '--start') || readArgValue(argv, '--incident-start')),
        incidentEndMs: parseDateMs(readArgValue(argv, '--end') || readArgValue(argv, '--incident-end')),
        limit: parsePositiveInt(readArgValue(argv, '--limit'), DEFAULT_LIMIT),
        pageSize: parsePositiveInt(readArgValue(argv, '--page-size'), DEFAULT_PAGE_SIZE),
        sleepWindowDays: parsePositiveNumber(readArgValue(argv, '--sleep-window-days'), defaultSleepWindowDays),
        incidentPaddingMs: parsePositiveNumber(readArgValue(argv, '--incident-padding-hours'), DEFAULT_INCIDENT_PADDING_HOURS) * 60 * 60 * 1000,
        restoreReadOffsetMs: parsePositiveNumber(readArgValue(argv, '--restore-read-offset-minutes'), DEFAULT_RESTORE_READ_OFFSET_MINUTES) * 60 * 1000,
    };
}

function uidAllowed(uid: string, options: ScriptOptions): boolean {
    if (options.uid) {
        return uid === options.uid;
    }
    if (options.uids && options.uids.length > 0) {
        return options.uids.includes(uid);
    }
    return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeErrorText(value: unknown): string {
    return `${value || ''}`.trim();
}

function includesInvalidGrant(code: unknown, message: unknown): boolean {
    return `${normalizeErrorText(code)} ${normalizeErrorText(message)}`.toLowerCase().includes('invalid_grant');
}

export function extractSuuntoProviderUserIdFromAuthFailure(
    failureCode: unknown,
    failureMessage: unknown,
): string | null {
    const text = `${normalizeErrorText(failureCode)} ${normalizeErrorText(failureMessage)}`;
    const usernameMatch = text.match(/(?:^|[,\s])username=([^,\s]+)/i);
    if (usernameMatch?.[1]) {
        return usernameMatch[1].trim();
    }

    const explicitMatch = text.match(/(?:providerUserId|providerUserID|userName|username)[:=]\s*([^,\s]+)/i);
    return explicitMatch?.[1]?.trim() || null;
}

function toEpochMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.getTime();
    }
    if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        const millis = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        return Number.isFinite(date.getTime()) ? date.getTime() : null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function floorUtcDay(ms: number): number {
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function ceilUtcDay(ms: number): number {
    const start = floorUtcDay(ms);
    return start === ms ? ms : start + 24 * 60 * 60 * 1000;
}

export function deriveIncidentWindow(
    candidates: readonly Pick<AffectedMetaCandidate, 'lastDisconnectedAtMs'>[],
    options: Pick<ScriptOptions, 'incidentStartMs' | 'incidentEndMs' | 'incidentPaddingMs'>,
): IncidentWindow | null {
    if (options.incidentStartMs !== undefined && options.incidentEndMs !== undefined) {
        if (options.incidentStartMs > options.incidentEndMs) {
            throw new Error('Incident start must be before incident end.');
        }
        return {
            startMs: options.incidentStartMs,
            endMs: options.incidentEndMs,
        };
    }

    if (candidates.length === 0) {
        return null;
    }

    const values = candidates
        .map(candidate => candidate.lastDisconnectedAtMs)
        .filter(value => Number.isFinite(value));
    if (values.length === 0) {
        return null;
    }

    return {
        startMs: floorUtcDay(Math.min(...values) - options.incidentPaddingMs),
        endMs: ceilUtcDay(Math.max(...values) + options.incidentPaddingMs),
    };
}

export function chunkIncidentWindows(startMs: number, endMs: number, windowDays: number): SleepWindow[] {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(windowDays) || windowDays <= 0 || endMs <= startMs) {
        return [];
    }
    const windowMs = Math.floor(windowDays * 24 * 60 * 60 * 1000);
    const windows: SleepWindow[] = [];
    for (let cursor = startMs; cursor < endMs; cursor += windowMs) {
        windows.push({
            startMs: cursor,
            endMs: Math.min(endMs, cursor + windowMs),
        });
    }
    return windows;
}

function readNestedRecord(data: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
    const value = data?.[key];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function isRouteSettingEnabled(settingsData: Record<string, unknown> | null, kind: 'activity' | 'routeDelivery', routeId: string): boolean {
    const serviceSyncSettings = readNestedRecord(settingsData, 'serviceSyncSettings');
    const routeRoot = readNestedRecord(
        serviceSyncSettings,
        kind === 'activity' ? 'activitySyncRoutes' : 'routeDeliverySyncRoutes',
    );
    return readNestedRecord(routeRoot, routeId)?.enabled === true;
}

export function buildSuuntoSyncSettingsRestorePatch(
    currentSettingsData: Record<string, unknown> | null,
    historicalSettingsData: Record<string, unknown> | null,
): SyncSettingsRestorePatch {
    const patch: SyncSettingsRestorePatch = {
        activitySyncRoutes: {},
        routeDeliverySyncRoutes: {},
    };

    for (const routeId of SUUNTO_ACTIVITY_SYNC_ROUTE_IDS) {
        if (
            isRouteSettingEnabled(historicalSettingsData, 'activity', routeId)
            && !isRouteSettingEnabled(currentSettingsData, 'activity', routeId)
        ) {
            patch.activitySyncRoutes[routeId] = { enabled: true };
        }
    }

    for (const routeId of SUUNTO_ROUTE_DELIVERY_SYNC_ROUTE_IDS) {
        if (
            isRouteSettingEnabled(historicalSettingsData, 'routeDelivery', routeId)
            && !isRouteSettingEnabled(currentSettingsData, 'routeDelivery', routeId)
        ) {
            patch.routeDeliverySyncRoutes[routeId] = { enabled: true };
        }
    }

    return patch;
}

function patchRouteCount(patch: SyncSettingsRestorePatch): number {
    return Object.keys(patch.activitySyncRoutes).length + Object.keys(patch.routeDeliverySyncRoutes).length;
}

export function isCurrentTokenNewerReconnect(tokenData: Record<string, unknown> | null, lastDisconnectedAtMs: number): boolean {
    const dateCreated = toEpochMs(tokenData?.dateCreated);
    return dateCreated !== null && dateCreated > lastDisconnectedAtMs + DEFAULT_RECONNECTION_GRACE_MS;
}

function hasServiceName(data: Record<string, unknown> | null, serviceName: ServiceNames): boolean {
    const storedServiceName = data?.serviceName;
    if (serviceName === ServiceNames.SuuntoApp) {
        return !storedServiceName || SUUNTO_SERVICE_IDENTIFIERS.has(`${storedServiceName}`);
    }
    return !storedServiceName || storedServiceName === serviceName;
}

function buildCurrentSuuntoTokenForDryRun(tokenSnapshot: admin.firestore.DocumentSnapshot): Record<string, unknown> | null {
    const tokenData = asRecord(tokenSnapshot.data());
    if (!hasServiceName(tokenData, ServiceNames.SuuntoApp)) {
        return null;
    }
    const accessToken = normalizeString(tokenData?.accessToken);
    const userName = normalizeString(tokenData?.userName) || tokenSnapshot.id;
    const expiresAtMs = toEpochMs(tokenData?.expiresAt);
    if (!accessToken || !userName || expiresAtMs === null || expiresAtMs <= Date.now() + DRY_RUN_TOKEN_EXPIRY_SAFETY_MS) {
        return null;
    }

    return {
        serviceName: ServiceNames.SuuntoApp,
        accessToken,
        expiresAt: expiresAtMs,
        scope: normalizeString(tokenData?.scope) || undefined,
        tokenType: normalizeString(tokenData?.tokenType) || undefined,
        userName,
        dateRefreshed: tokenData?.dateRefreshed,
        dateCreated: tokenData?.dateCreated,
    };
}

function buildInitialSummary(options: ScriptOptions): SuuntoOutageRecoverySummary {
    return {
        dryRun: !options.execute,
        stage: options.stage,
        incidentStart: null,
        incidentEnd: null,
        affectedCandidates: 0,
        targets: 0,
        skipped: {},
        tokenRestore: {
            checked: 0,
            restored: 0,
            currentTokenPreserved: 0,
            currentTokenNewerReconnect: 0,
            missingProviderUserId: 0,
            missingPitrToken: 0,
        },
        serviceState: {
            markedConnected: 0,
            settingsRoutesRestored: 0,
        },
        sleepBackfill: {
            windowsQueued: 0,
        },
        activityBackfill: {
            providerWorkoutsFound: 0,
            workoutsQueued: 0,
        },
        routeBackfill: {
            providerRoutesFound: 0,
            routesQueued: 0,
            routesSkippedOutsideIncident: 0,
        },
        activitySyncReconciliation: {
            scannedEvents: 0,
            candidates: 0,
            queued: 0,
            skippedAlreadySuccessful: 0,
        },
        routeDeliveryReconciliation: {
            scannedRoutes: 0,
            candidates: 0,
            queued: 0,
            skippedAlreadySuccessful: 0,
        },
        failed: 0,
    };
}

function incrementSkipped(summary: SuuntoOutageRecoverySummary, reason: string): void {
    summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
}

async function getDocumentAtReadTime(
    ref: admin.firestore.DocumentReference,
    readTimeMs: number,
): Promise<admin.firestore.DocumentSnapshot> {
    const db = admin.firestore();
    const [snapshot] = await db.getAll(ref, {
        readTime: admin.firestore.Timestamp.fromMillis(readTimeMs),
    } as unknown as admin.firestore.ReadOptions);
    return snapshot;
}

function affectedMetaCandidateFromSnapshot(doc: admin.firestore.DocumentSnapshot, options: ScriptOptions): AffectedMetaCandidate | null {
    if (!doc.exists || !SUUNTO_SERVICE_IDENTIFIERS.has(doc.id)) {
        return null;
    }

    const uid = doc.ref.parent.parent?.id || null;
    if (!uid || !uidAllowed(uid, options)) {
        return null;
    }
    const data = doc.data() as Record<string, unknown>;
    const failureCode = normalizeString(data.lastAuthFailureCode);
    const failureMessage = normalizeString(data.lastAuthFailureMessage);
    if (!includesInvalidGrant(failureCode, failureMessage)) {
        return null;
    }
    const lastDisconnectedAtMs = toEpochMs(data.lastDisconnectedAt);
    if (lastDisconnectedAtMs === null) {
        return null;
    }

    return {
        uid,
        metaPath: doc.ref.path,
        lastDisconnectedAtMs,
        providerUserId: extractSuuntoProviderUserIdFromAuthFailure(failureCode, failureMessage),
        failureCode,
        failureMessage,
    };
}

async function getAffectedMetaCandidatesForExplicitUsers(options: ScriptOptions): Promise<AffectedMetaCandidate[] | null> {
    const uids = Array.from(new Set(options.uid ? [options.uid] : (options.uids || [])));
    if (uids.length === 0) {
        return null;
    }

    const db = admin.firestore();
    const refs = uids.flatMap(uid => (
        Array.from(SUUNTO_SERVICE_IDENTIFIERS).map(serviceIdentifier => (
            db.collection('users').doc(uid).collection('meta').doc(serviceIdentifier)
        ))
    ));
    const candidates: AffectedMetaCandidate[] = [];
    const seenPaths = new Set<string>();

    for (let index = 0; index < refs.length; index += DIRECT_META_READ_BATCH_SIZE) {
        const snapshots = await db.getAll(...refs.slice(index, index + DIRECT_META_READ_BATCH_SIZE));
        for (const doc of snapshots) {
            if (seenPaths.has(doc.ref.path)) {
                continue;
            }
            seenPaths.add(doc.ref.path);
            const candidate = affectedMetaCandidateFromSnapshot(doc, options);
            if (!candidate) {
                continue;
            }
            candidates.push(candidate);
            if (candidates.length >= options.limit) {
                return candidates;
            }
        }
    }

    return candidates;
}

async function getAffectedMetaCandidates(options: ScriptOptions): Promise<AffectedMetaCandidate[]> {
    const explicitUserCandidates = await getAffectedMetaCandidatesForExplicitUsers(options);
    if (explicitUserCandidates) {
        return explicitUserCandidates;
    }

    const candidates: AffectedMetaCandidate[] = [];
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (candidates.length < options.limit) {
        const queryLimit = Math.min(options.pageSize, options.limit - candidates.length);
        let query = admin.firestore()
            .collectionGroup('meta')
            .where('connectionState', '==', SERVICE_CONNECTION_STATES.ReconnectRequired)
            .limit(queryLimit);
        if (cursor) {
            query = query.startAfter(cursor);
        }
        const snapshot = await query.get();
        if (snapshot.empty) {
            break;
        }

        for (const doc of snapshot.docs) {
            const candidate = affectedMetaCandidateFromSnapshot(doc, options);
            if (!candidate) {
                continue;
            }
            candidates.push(candidate);
            if (candidates.length >= options.limit) {
                break;
            }
        }

        if (snapshot.size < queryLimit) {
            break;
        }
        cursor = snapshot.docs[snapshot.docs.length - 1];
    }

    if (candidates.length >= options.limit) {
        logger.warn(`${LOG_PREFIX} Reached affected-user scan limit. Re-run with a higher --limit to ensure no Suunto outage candidates are missed.`, {
            limit: options.limit,
            candidates: candidates.length,
        });
    }

    return candidates;
}

async function getManualTargetsFromCurrentTokens(options: ScriptOptions, incidentWindow: IncidentWindow): Promise<RecoveryTarget[]> {
    const uids = options.uid ? [options.uid] : (options.uids || []);
    const targets: RecoveryTarget[] = [];
    for (const uid of uids) {
        const tokenSnapshot = await admin.firestore()
            .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
            .doc(uid)
            .collection('tokens')
            .get();
        for (const tokenDoc of tokenSnapshot.docs) {
            const tokenData = tokenDoc.data() as Record<string, unknown>;
            if (!hasServiceName(tokenData, ServiceNames.SuuntoApp)) {
                continue;
            }
            const providerUserId = normalizeString(tokenData.userName) || tokenDoc.id;
            targets.push({
                uid,
                metaPath: `users/${uid}/meta/${ServiceNames.SuuntoApp}`,
                lastDisconnectedAtMs: incidentWindow.startMs,
                providerUserId,
                failureCode: null,
                failureMessage: null,
                restoreReadTimeMs: incidentWindow.startMs,
            });
        }
    }
    return targets;
}

async function resolveRecoveryTargets(options: ScriptOptions, summary: SuuntoOutageRecoverySummary): Promise<{
    targets: RecoveryTarget[];
    incidentWindow: IncidentWindow | null;
}> {
    const candidates = await getAffectedMetaCandidates(options);
    summary.affectedCandidates = candidates.length;
    const incidentWindow = deriveIncidentWindow(candidates, options);
    if (!incidentWindow) {
        return {
            targets: [],
            incidentWindow,
        };
    }

    const filteredCandidates = candidates.filter(candidate => (
        candidate.lastDisconnectedAtMs >= incidentWindow.startMs
        && candidate.lastDisconnectedAtMs <= incidentWindow.endMs
    ));

    if (filteredCandidates.length > 0) {
        return {
            incidentWindow,
            targets: filteredCandidates.map(candidate => ({
                ...candidate,
                restoreReadTimeMs: candidate.lastDisconnectedAtMs - options.restoreReadOffsetMs,
            })),
        };
    }

    if ((options.stage === 'source-backfill' || options.stage === 'sync-reconcile') && (options.uid || options.uids?.length)) {
        return {
            incidentWindow,
            targets: await getManualTargetsFromCurrentTokens(options, incidentWindow),
        };
    }

    return {
        targets: [],
        incidentWindow,
    };
}

async function shouldSkipDeletedUser(uid: string, phase: string): Promise<boolean> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    } catch (error) {
        throw new UserDeletionGuardReadError(uid, `suunto_outage_recovery:${phase}`, error);
    }
    return deletionGuard.shouldSkip;
}

async function restoreTokenIfMissing(
    target: RecoveryTarget,
    historicalTokenData: Record<string, unknown>,
): Promise<'restored' | 'current_exists' | 'user_deleted_or_deleting'> {
    const db = admin.firestore();
    const tokenDocRef = db
        .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
        .doc(target.uid)
        .collection('tokens')
        .doc(target.providerUserId as string);

    return db.runTransaction(async (transaction) => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, target.uid);
        } catch (error) {
            throw new UserDeletionGuardReadError(target.uid, 'suunto_outage_token_restore', error);
        }
        if (deletionGuard.shouldSkip) {
            return 'user_deleted_or_deleting';
        }

        const currentTokenSnapshot = await transaction.get(tokenDocRef);
        if (currentTokenSnapshot.exists) {
            return 'current_exists';
        }

        transaction.set(tokenDocRef, historicalTokenData);
        return 'restored';
    });
}

async function restoreSettingsIfNeeded(
    target: RecoveryTarget,
    historicalSettingsData: Record<string, unknown> | null,
    execute: boolean,
): Promise<number> {
    if (!historicalSettingsData) {
        return 0;
    }

    const db = admin.firestore();
    const settingsRef = db.collection('users').doc(target.uid).collection('config').doc('settings');

    if (!execute) {
        const currentSettingsSnapshot = await settingsRef.get();
        const currentSettingsData = asRecord(currentSettingsSnapshot.data());
        const patch = buildSuuntoSyncSettingsRestorePatch(currentSettingsData, historicalSettingsData);
        const count = patchRouteCount(patch);
        if (count === 0) {
            return 0;
        }

        logger.info(`${LOG_PREFIX} Would restore ${count} Suunto-related sync route settings for ${target.uid}.`, {
            uid: target.uid,
            activitySyncRoutes: Object.keys(patch.activitySyncRoutes),
            routeDeliverySyncRoutes: Object.keys(patch.routeDeliverySyncRoutes),
        });
        return count;
    }

    const restoredCount = await db.runTransaction(async (transaction) => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, target.uid);
        } catch (error) {
            throw new UserDeletionGuardReadError(target.uid, 'suunto_outage_settings_restore', error);
        }
        if (deletionGuard.shouldSkip) {
            logger.warn(`${LOG_PREFIX} Skipping settings restore because user is missing or deletion is in progress.`, {
                uid: target.uid,
            });
            return 0;
        }

        const currentSettingsSnapshot = await transaction.get(settingsRef);
        const currentSettingsData = asRecord(currentSettingsSnapshot.data());
        const patch = buildSuuntoSyncSettingsRestorePatch(currentSettingsData, historicalSettingsData);
        const count = patchRouteCount(patch);
        if (count === 0) {
            return 0;
        }

        logger.info(`${LOG_PREFIX} Restoring ${count} Suunto-related sync route settings for ${target.uid}.`, {
            uid: target.uid,
            activitySyncRoutes: Object.keys(patch.activitySyncRoutes),
            routeDeliverySyncRoutes: Object.keys(patch.routeDeliverySyncRoutes),
        });

        const serviceSyncSettings: Record<string, unknown> = {};
        if (Object.keys(patch.activitySyncRoutes).length > 0) {
            serviceSyncSettings.activitySyncRoutes = patch.activitySyncRoutes;
        }
        if (Object.keys(patch.routeDeliverySyncRoutes).length > 0) {
            serviceSyncSettings.routeDeliverySyncRoutes = patch.routeDeliverySyncRoutes;
        }
        transaction.set(settingsRef, {
            serviceSyncSettings,
        }, { merge: true });
        return count;
    });
    return restoredCount;
}

async function markSuuntoConnectedIfNeeded(target: RecoveryTarget, execute: boolean): Promise<boolean> {
    logger.info(`${LOG_PREFIX} ${execute ? 'Clearing' : 'Would clear'} false Suunto reconnect state.`, {
        uid: target.uid,
        providerUserId: target.providerUserId,
    });
    if (!execute) {
        return true;
    }
    const didWrite = await markServiceConnected(target.uid, ServiceNames.SuuntoApp);
    if (!didWrite) {
        logger.warn(`${LOG_PREFIX} Skipping reconnect-state clear because user is missing or deletion is in progress.`, {
            uid: target.uid,
            providerUserId: target.providerUserId,
        });
    }
    return didWrite;
}

async function runRestoreForTarget(
    target: RecoveryTarget,
    summary: SuuntoOutageRecoverySummary,
    execute: boolean,
): Promise<boolean> {
    summary.tokenRestore.checked += 1;

    if (!target.providerUserId) {
        summary.tokenRestore.missingProviderUserId += 1;
        incrementSkipped(summary, 'missing_provider_user_id');
        return false;
    }

    if (await shouldSkipDeletedUser(target.uid, 'restore_target')) {
        incrementSkipped(summary, 'user_deleted_or_deleting');
        return false;
    }

    const db = admin.firestore();
    const tokenDocRef = db
        .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
        .doc(target.uid)
        .collection('tokens')
        .doc(target.providerUserId);
    const currentTokenSnapshot = await tokenDocRef.get();
    if (currentTokenSnapshot.exists) {
        const currentTokenData = currentTokenSnapshot.data() as Record<string, unknown>;
        if (isCurrentTokenNewerReconnect(currentTokenData, target.lastDisconnectedAtMs)) {
            summary.tokenRestore.currentTokenNewerReconnect += 1;
            incrementSkipped(summary, 'current_token_is_newer_reconnect');
            return false;
        }
        summary.tokenRestore.currentTokenPreserved += 1;
    } else {
        const historicalTokenSnapshot = await getDocumentAtReadTime(tokenDocRef, target.restoreReadTimeMs);
        if (!historicalTokenSnapshot.exists) {
            summary.tokenRestore.missingPitrToken += 1;
            incrementSkipped(summary, 'missing_pitr_token');
            return false;
        }
        const historicalTokenData = historicalTokenSnapshot.data() as Record<string, unknown>;
        if (!hasServiceName(historicalTokenData, ServiceNames.SuuntoApp)) {
            summary.tokenRestore.missingPitrToken += 1;
            incrementSkipped(summary, 'pitr_token_service_mismatch');
            return false;
        }

        logger.info(`${LOG_PREFIX} ${execute ? 'Restoring' : 'Would restore'} Suunto token.`, {
            uid: target.uid,
            providerUserId: target.providerUserId,
            restoreReadTime: new Date(target.restoreReadTimeMs).toISOString(),
        });

        if (execute) {
            const outcome = await restoreTokenIfMissing(target, historicalTokenData);
            if (outcome === 'user_deleted_or_deleting') {
                incrementSkipped(summary, 'user_deleted_or_deleting');
                return false;
            }
            if (outcome === 'current_exists') {
                summary.tokenRestore.currentTokenPreserved += 1;
            } else {
                summary.tokenRestore.restored += 1;
            }
        } else {
            summary.tokenRestore.restored += 1;
        }
    }

    const historicalSettingsSnapshot = await getDocumentAtReadTime(
        db.collection('users').doc(target.uid).collection('config').doc('settings'),
        target.restoreReadTimeMs,
    );
    summary.serviceState.settingsRoutesRestored += await restoreSettingsIfNeeded(
        target,
        historicalSettingsSnapshot.exists ? asRecord(historicalSettingsSnapshot.data()) : null,
        execute,
    );
    if (await markSuuntoConnectedIfNeeded(target, execute)) {
        summary.serviceState.markedConnected += 1;
    }
    return true;
}

async function getCurrentSuuntoTokensForTarget(target: RecoveryTarget): Promise<SourceBackfillToken[]> {
    const tokenCollectionRef = admin.firestore()
        .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
        .doc(target.uid)
        .collection('tokens');

    const tokenSnapshots = target.providerUserId
        ? [await tokenCollectionRef.doc(target.providerUserId).get()]
        : (await tokenCollectionRef.get()).docs;

    const result: SourceBackfillToken[] = [];
    for (const tokenSnapshot of tokenSnapshots) {
        if (!tokenSnapshot.exists) {
            continue;
        }
        const tokenData = tokenSnapshot.data() as Record<string, unknown>;
        if (!hasServiceName(tokenData, ServiceNames.SuuntoApp)) {
            continue;
        }
        const providerUserId = normalizeString(tokenData.userName) || tokenSnapshot.id;
        result.push({
            tokenSnapshot,
            providerUserId,
        });
    }
    return result;
}

async function runSleepBackfillForToken(
    target: RecoveryTarget,
    providerUserId: string,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    const windows = chunkIncidentWindows(incidentWindow.startMs, incidentWindow.endMs, options.sleepWindowDays);
    for (const window of windows) {
        if (options.execute) {
            await addSleepSyncQueueItem({
                type: 'suunto_poll',
                provider: SLEEP_PROVIDERS.SuuntoApp,
                userID: target.uid,
                providerUserId,
                rangeStartMs: window.startMs,
                rangeEndMs: window.endMs,
                dedupeKey: `suunto-outage-sleep:${target.uid}:${providerUserId}:${window.startMs}:${window.endMs}`,
            });
        }
        summary.sleepBackfill.windowsQueued += 1;
    }
}

async function runActivityBackfillForToken(
    token: SourceBackfillToken,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    const serviceToken = options.execute
        ? await getTokenData(token.tokenSnapshot, ServiceNames.SuuntoApp, false) as any
        : buildCurrentSuuntoTokenForDryRun(token.tokenSnapshot);
    if (!serviceToken) {
        incrementSkipped(summary, 'source_backfill_dry_run_token_requires_refresh');
        logger.info(`${LOG_PREFIX} Skipping dry-run Suunto activity candidate lookup because the token would need refresh.`, {
            uid: token.tokenSnapshot.ref.parent.parent?.id,
            providerUserId: token.providerUserId,
        });
        return;
    }
    const queueItems = await getWorkoutQueueItems(
        ServiceNames.SuuntoApp,
        serviceToken,
        new Date(incidentWindow.startMs),
        new Date(incidentWindow.endMs),
    ) as any[];
    const items = Array.isArray(queueItems) ? queueItems : [];
    summary.activityBackfill.providerWorkoutsFound += items.length;

    for (const item of items) {
        const workoutID = normalizeString(item.workoutID);
        const userName = normalizeString(item.userName) || token.providerUserId;
        if (!workoutID || !userName) {
            continue;
        }
        if (options.execute) {
            await addToQueueForSuunto({
                userName,
                workoutID,
            });
        }
        summary.activityBackfill.workoutsQueued += 1;
    }
}

export function shouldIncludeSuuntoRouteForIncident(route: Pick<SuuntoRouteSummary, 'created' | 'modified'>, incidentWindow: IncidentWindow): boolean {
    const timestamps = [
        toEpochMs(route.created),
        toEpochMs(route.modified),
    ].filter((value): value is number => value !== null);
    return timestamps.some(value => value >= incidentWindow.startMs && value <= incidentWindow.endMs);
}

function normalizeDryRunSuuntoRouteSummary(
    value: unknown,
    providerUserId: string,
): SuuntoRouteSummary | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const route = value as Record<string, unknown>;
    const id = normalizeString(route.id);
    if (!id) {
        return null;
    }

    return {
        providerUserId,
        providerSourceKey: `${providerUserId}:dry-run`,
        id,
        description: normalizeString(route.description),
        created: toEpochMs(route.created),
        modified: toEpochMs(route.modified),
    };
}

async function listSuuntoRoutesForDryRun(
    token: SourceBackfillToken,
): Promise<SuuntoRouteSummary[] | null> {
    const serviceToken = buildCurrentSuuntoTokenForDryRun(token.tokenSnapshot);
    if (!serviceToken) {
        return null;
    }

    const result = await requestPromise.get({
        headers: {
            'Authorization': toSuuntoAuthorizationHeader(`${serviceToken.accessToken}`),
            'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
        },
        json: true,
        url: 'https://cloudapi.suunto.com/v2/route',
    });
    const payload = typeof result === 'string' ? JSON.parse(result) : result;
    if (!Array.isArray(payload)) {
        logger.warn(`${LOG_PREFIX} Dry-run Suunto route listing returned unexpected payload shape.`, {
            uid: token.tokenSnapshot.ref.parent.parent?.id,
            providerUserId: token.providerUserId,
            payloadType: typeof payload,
        });
        return [];
    }

    return payload
        .map(route => normalizeDryRunSuuntoRouteSummary(route, token.providerUserId))
        .filter((route): route is SuuntoRouteSummary => route !== null);
}

async function runRouteBackfillForTarget(
    target: RecoveryTarget,
    tokens: SourceBackfillToken[],
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    let routes: SuuntoRouteSummary[] = [];
    if (options.execute) {
        const routeListResult = await listSuuntoRoutes(target.uid);
        routes = routeListResult.routes;
    } else {
        for (const token of tokens) {
            const tokenRoutes = await listSuuntoRoutesForDryRun(token);
            if (!tokenRoutes) {
                incrementSkipped(summary, 'route_backfill_dry_run_token_requires_refresh');
                logger.info(`${LOG_PREFIX} Skipping dry-run Suunto route candidate lookup because the token would need refresh.`, {
                    uid: target.uid,
                    providerUserId: token.providerUserId,
                });
                continue;
            }
            routes.push(...tokenRoutes);
        }
    }

    const affectedProviderUserIds = target.providerUserId ? new Set([target.providerUserId]) : null;
    routes = routes.filter(route => !affectedProviderUserIds || affectedProviderUserIds.has(route.providerUserId));
    summary.routeBackfill.providerRoutesFound += routes.length;

    for (const route of routes) {
        if (!shouldIncludeSuuntoRouteForIncident(route, incidentWindow)) {
            summary.routeBackfill.routesSkippedOutsideIncident += 1;
            continue;
        }
        if (options.execute) {
            await enqueueRouteSyncQueueItem({
                sourceServiceName: ServiceNames.SuuntoApp,
                providerUserId: route.providerUserId,
                providerRouteId: route.id,
                providerRouteName: route.description || null,
                providerRouteCreatedAt: route.created ?? null,
                providerRouteModifiedAt: route.modified ?? null,
                manual: true,
                firebaseUserID: target.uid,
            });
        }
        summary.routeBackfill.routesQueued += 1;
    }
}

async function runSourceBackfillForTarget(
    target: RecoveryTarget,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    if (await shouldSkipDeletedUser(target.uid, 'source_backfill_target')) {
        incrementSkipped(summary, 'user_deleted_or_deleting');
        return;
    }

    const tokens = await getCurrentSuuntoTokensForTarget(target);
    if (tokens.length === 0) {
        incrementSkipped(summary, 'source_backfill_no_current_token');
        return;
    }

    for (const token of tokens) {
        await runSleepBackfillForToken(target, token.providerUserId, incidentWindow, options, summary);
        await runActivityBackfillForToken(token, incidentWindow, options, summary);
    }
    await runRouteBackfillForTarget(target, tokens, incidentWindow, options, summary);
}

function toEnqueueOriginalFile(candidate: Record<string, unknown>): EnqueueActivitySyncOriginalFileMetadata | null {
    const path = normalizeString(candidate.path);
    if (!path) {
        return null;
    }
    return {
        path,
        bucket: normalizeString(candidate.bucket) || undefined,
        startDate: candidate.startDate,
        originalFilename: normalizeString(candidate.originalFilename) || undefined,
    };
}

export function extractActivityOriginalFiles(eventData: Record<string, unknown>): EnqueueActivitySyncOriginalFileMetadata[] {
    const files: EnqueueActivitySyncOriginalFileMetadata[] = [];
    if (Array.isArray(eventData.originalFiles)) {
        for (const file of eventData.originalFiles) {
            const normalized = asRecord(file) ? toEnqueueOriginalFile(asRecord(file) as Record<string, unknown>) : null;
            if (normalized) {
                files.push(normalized);
            }
        }
    }

    if (files.length === 0 && asRecord(eventData.originalFile)) {
        const normalized = toEnqueueOriginalFile(asRecord(eventData.originalFile) as Record<string, unknown>);
        if (normalized) {
            files.push(normalized);
        }
    }
    return files;
}

function getSourceActivityID(sourceMetaData: Record<string, unknown>): string | undefined {
    const candidate = normalizeString(sourceMetaData.activityFileID)
        || normalizeString(sourceMetaData.workoutID)
        || normalizeString(sourceMetaData.summaryId);
    return candidate || undefined;
}

async function reconcileActivitySyncForTarget(
    target: RecoveryTarget,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    const db = admin.firestore();
    const settingsSnapshot = await db.collection('users').doc(target.uid).collection('config').doc('settings').get();
    const settingsData = asRecord(settingsSnapshot.data());
    const routeIds = SUUNTO_ACTIVITY_SYNC_ROUTE_IDS.filter(routeId => (
        ACTIVITY_SYNC_ROUTES[routeId] && isRouteSettingEnabled(settingsData, 'activity', routeId)
    ));
    if (routeIds.length === 0) {
        return;
    }

    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    while (true) {
        let query = db.collection('users')
            .doc(target.uid)
            .collection('events')
            .where('startDate', '>=', incidentWindow.startMs)
            .where('startDate', '<=', incidentWindow.endMs)
            .orderBy('startDate', 'asc')
            .limit(options.pageSize);
        if (cursor) {
            query = query.startAfter(cursor);
        }
        const page = await query.get();
        if (page.empty) {
            break;
        }
        summary.activitySyncReconciliation.scannedEvents += page.size;
        for (const eventDoc of page.docs) {
            const eventData = eventDoc.data() as Record<string, unknown>;
            const originalFiles = extractActivityOriginalFiles(eventData);
            if (originalFiles.length === 0) {
                continue;
            }

            for (const routeId of routeIds) {
                const route = ACTIVITY_SYNC_ROUTES[routeId];
                const sourceMetaSnapshot = await eventDoc.ref.collection('metaData').doc(route.sourceServiceName).get();
                if (!sourceMetaSnapshot.exists) {
                    continue;
                }
                const existingMetadata = await eventDoc.ref.collection('metaData').doc(getActivitySyncMetadataDocId(routeId)).get();
                if ((existingMetadata.data() as Record<string, unknown> | undefined)?.status === 'success') {
                    summary.activitySyncReconciliation.skippedAlreadySuccessful += 1;
                    continue;
                }

                summary.activitySyncReconciliation.candidates += 1;
                if (options.execute) {
                    const sourceMetaData = sourceMetaSnapshot.data() as Record<string, unknown>;
                    const result = await enqueueActivitySyncJobsForImportedEvent({
                        userID: target.uid,
                        eventID: eventDoc.id,
                        sourceServiceName: route.sourceServiceName,
                        sourceActivityID: getSourceActivityID(sourceMetaData),
                        originalFiles,
                        manual: true,
                        routeIdFilter: routeId,
                        respectRouteEnabled: false,
                    });
                    summary.activitySyncReconciliation.queued += result.queued;
                } else {
                    summary.activitySyncReconciliation.queued += 1;
                }
            }
        }
        if (page.size < options.pageSize) {
            break;
        }
        cursor = page.docs[page.docs.length - 1];
    }
}

function getRouteSourceSummary(routeData: Record<string, unknown>): Record<string, unknown> | null {
    return asRecord(routeData.sourceSummary);
}

function routeDocumentOverlapsIncident(routeData: Record<string, unknown>, incidentWindow: IncidentWindow): boolean {
    const sourceSummary = getRouteSourceSummary(routeData);
    const timestamps = [
        toEpochMs(sourceSummary?.modifiedAt),
        toEpochMs(sourceSummary?.importedAt),
        toEpochMs(routeData.importedAt),
    ].filter((value): value is number => value !== null);
    return timestamps.some(value => value >= incidentWindow.startMs && value <= incidentWindow.endMs);
}

async function reconcileRouteDeliveryForTarget(
    target: RecoveryTarget,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    const db = admin.firestore();
    const settingsSnapshot = await db.collection('users').doc(target.uid).collection('config').doc('settings').get();
    const settingsData = asRecord(settingsSnapshot.data());
    const routeIds = SUUNTO_ROUTE_DELIVERY_SYNC_ROUTE_IDS.filter(routeId => isRouteSettingEnabled(settingsData, 'routeDelivery', routeId));
    if (routeIds.length === 0) {
        return;
    }

    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    while (true) {
        let query = db.collection('users')
            .doc(target.uid)
            .collection('routes')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.pageSize);
        if (cursor) {
            query = query.startAfter(cursor);
        }
        const page = await query.get();
        if (page.empty) {
            break;
        }
        summary.routeDeliveryReconciliation.scannedRoutes += page.size;
        for (const routeDoc of page.docs) {
            const routeData = routeDoc.data() as Record<string, unknown>;
            const sourceSummary = getRouteSourceSummary(routeData);
            if (normalizeString(sourceSummary?.sourceServiceName) !== ServiceNames.SuuntoApp) {
                continue;
            }
            if (!routeDocumentOverlapsIncident(routeData, incidentWindow)) {
                continue;
            }
            for (const routeId of routeIds) {
                const route = ROUTE_DELIVERY_SYNC_ROUTES[routeId];
                const sourceProviderRouteId = normalizeString(sourceSummary?.providerRouteId) || routeDoc.id;
                const sourceProviderUserId = normalizeString(sourceSummary?.providerUserId) || undefined;
                const sourceRevisionKey = buildRouteDeliverySourceRevisionKeyForRouteSource({
                    sourceServiceName: route.sourceServiceName,
                    sourceSummary,
                    fallbackProviderRouteId: sourceProviderRouteId,
                    routeImportedAt: routeData.importedAt,
                    fallbackRouteID: routeDoc.id,
                });
                if (await hasSuccessfulRouteDeliveryMetadataForRevision({
                    routeRef: routeDoc.ref,
                    routeId,
                    destinationServiceName: route.destinationServiceName,
                    sourceRevisionKey,
                })) {
                    summary.routeDeliveryReconciliation.skippedAlreadySuccessful += 1;
                    continue;
                }
                summary.routeDeliveryReconciliation.candidates += 1;
                if (options.execute) {
                    const result = await enqueueRouteDeliverySyncJobsForImportedRoute({
                        userID: target.uid,
                        savedRouteID: routeDoc.id,
                        sourceServiceName: route.sourceServiceName,
                        sourceProviderRouteId,
                        sourceProviderUserId,
                        sourceRevisionKey,
                        routeIdFilter: routeId,
                        manual: true,
                        respectRouteEnabled: false,
                        skipExistingSuccessfulDeliveryCheck: true,
                    });
                    summary.routeDeliveryReconciliation.queued += result.queued;
                } else {
                    summary.routeDeliveryReconciliation.queued += 1;
                }
            }
        }
        if (page.size < options.pageSize) {
            break;
        }
        cursor = page.docs[page.docs.length - 1];
    }
}

async function runSyncReconciliationForTarget(
    target: RecoveryTarget,
    incidentWindow: IncidentWindow,
    options: ScriptOptions,
    summary: SuuntoOutageRecoverySummary,
): Promise<void> {
    if (await shouldSkipDeletedUser(target.uid, 'sync_reconcile_target')) {
        incrementSkipped(summary, 'user_deleted_or_deleting');
        return;
    }
    await reconcileActivitySyncForTarget(target, incidentWindow, options, summary);
    await reconcileRouteDeliveryForTarget(target, incidentWindow, options, summary);
}

function stageIncludesRestore(stage: RecoveryStage): boolean {
    return stage === 'all' || stage === 'restore' || stage === 'restore-source';
}

function stageIncludesSourceBackfill(stage: RecoveryStage): boolean {
    return stage === 'all' || stage === 'restore-source' || stage === 'source-backfill';
}

function stageIncludesSyncReconcile(stage: RecoveryStage): boolean {
    return stage === 'all' || stage === 'sync-reconcile';
}

export async function runSuuntoOutageRecoveryScript(argv: string[]): Promise<SuuntoOutageRecoverySummary> {
    const options = parseSuuntoOutageRecoveryOptions(argv);
    const summary = buildInitialSummary(options);

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const { targets, incidentWindow } = await resolveRecoveryTargets(options, summary);
    summary.targets = targets.length;
    if (incidentWindow) {
        summary.incidentStart = new Date(incidentWindow.startMs).toISOString();
        summary.incidentEnd = new Date(incidentWindow.endMs).toISOString();
    }

    logger.info(`${LOG_PREFIX} Starting run.`, {
        dryRun: !options.execute,
        stage: options.stage,
        incidentStart: summary.incidentStart,
        incidentEnd: summary.incidentEnd,
        targets: targets.map(target => ({
            uid: target.uid,
            providerUserId: target.providerUserId,
            lastDisconnectedAt: new Date(target.lastDisconnectedAtMs).toISOString(),
        })),
    });

    if (!incidentWindow || targets.length === 0) {
        logger.info(`${LOG_PREFIX} No targets found.`, summary);
        return summary;
    }

    for (const target of targets) {
        try {
            const restoredOrAvailable = stageIncludesRestore(options.stage)
                ? await runRestoreForTarget(target, summary, options.execute)
                : true;

            if (stageIncludesSourceBackfill(options.stage) && restoredOrAvailable) {
                await runSourceBackfillForTarget(target, incidentWindow, options, summary);
            }

            if (stageIncludesSyncReconcile(options.stage) && restoredOrAvailable) {
                await runSyncReconciliationForTarget(target, incidentWindow, options, summary);
            }
        } catch (error) {
            summary.failed += 1;
            logger.error(`${LOG_PREFIX} Failed target.`, {
                uid: target.uid,
                providerUserId: target.providerUserId,
                error,
            });
        }
    }

    logger.info(`${LOG_PREFIX} Summary`, summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runSuuntoOutageRecoveryScript(process.argv.slice(2));
    process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error(`${LOG_PREFIX} Fatal error`, error);
        process.exitCode = 1;
    });
}
