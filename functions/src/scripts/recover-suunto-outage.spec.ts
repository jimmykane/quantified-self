import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const hoisted = vi.hoisted(() => {
    const SUUNTO_SERVICE_NAME = 'Suunto app';
    const SUUNTO_TOKEN_ROOT = 'suuntoAppAccessTokens';

    const adminApps: any[] = [];
    const metaDocs: any[] = [];
    const currentDocs = new Map<string, Record<string, unknown>>();
    const pitrDocs = new Map<string, Record<string, unknown>>();
    const directSets: any[] = [];
    const transactionSets: any[] = [];
    const initializeApp = vi.fn(() => adminApps.push({ name: 'test-app' }));
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();
    const deleteField = vi.fn(() => ({ __delete__: true }));
    const timestampFromMillis = vi.fn((millis: number) => ({ millis, toMillis: () => millis }));
    const getUserDeletionGuardState = vi.fn(async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    }));
    const getUserDeletionGuardStateInTransaction = vi.fn(async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    }));
    const addSleepSyncQueueItem = vi.fn(async () => undefined);
    const getTokenData = vi.fn(async () => ({ access_token: 'redacted' }));
    const addToQueueForSuunto = vi.fn(async () => true);
    const getWorkoutQueueItems = vi.fn(async () => []);
    const enqueueRouteSyncQueueItem = vi.fn(async () => ({ queued: true }));
    const listSuuntoRoutes = vi.fn(async () => ({ routes: [] }));
    const enqueueActivitySyncJobsForImportedEvent = vi.fn(async () => ({ queued: 1, skipped: 0 }));
    const enqueueRouteDeliverySyncJobsForImportedRoute = vi.fn(async () => ({ queued: 1, skipped: 0 }));
    const hasSuccessfulRouteDeliveryMetadataForRevision = vi.fn(async () => false);
    const buildRouteDeliverySourceRevisionKeyForRouteSource = vi.fn(() => 'revision-key');
    const markServiceConnected = vi.fn(async () => true);
    const requestGet = vi.fn(async () => []);

    class FakeDocRef {
        path: string;
        id: string;
        parent: any;

        constructor(path: string, parent: any = null) {
            this.path = path;
            const segments = path.split('/');
            this.id = segments[segments.length - 1];
            this.parent = parent;
        }

        collection(name: string): FakeCollectionRef {
            return new FakeCollectionRef(`${this.path}/${name}`, this);
        }

        async get(): Promise<any> {
            return makeSnapshot(this, currentDocs.get(this.path));
        }

        async set(payload: Record<string, unknown>, options?: unknown): Promise<void> {
            directSets.push({ path: this.path, payload, options });
            currentDocs.set(this.path, payload);
        }
    }

    class FakeCollectionRef {
        path: string;
        parent: any;

        constructor(path: string, parent: any = null) {
            this.path = path;
            this.parent = parent;
        }

        doc(id: string): FakeDocRef {
            return new FakeDocRef(`${this.path}/${id}`, this);
        }

        async get(): Promise<any> {
            if (this.path.startsWith(`${SUUNTO_TOKEN_ROOT}/`) && this.path.endsWith('/tokens')) {
                const prefix = `${this.path}/`;
                const docs = Array.from(currentDocs.entries())
                    .filter(([path]) => path.startsWith(prefix))
                    .map(([path, data]) => makeSnapshot(new FakeDocRef(path, this), data));
                return {
                    docs,
                    size: docs.length,
                    empty: docs.length === 0,
                };
            }
            return {
                docs: [],
                size: 0,
                empty: true,
            };
        }

        where(): FakeCollectionRef {
            return this;
        }

        orderBy(): FakeCollectionRef {
            return this;
        }

        limit(): FakeCollectionRef {
            return this;
        }

        startAfter(): FakeCollectionRef {
            return this;
        }
    }

    function makeSnapshot(ref: FakeDocRef, data: Record<string, unknown> | undefined): any {
        return {
            id: ref.id,
            ref,
            exists: data !== undefined,
            data: () => data,
        };
    }

    function makeMetaDoc(uid: string, data: Record<string, unknown>): any {
        const userRef = new FakeDocRef(`users/${uid}`);
        const metaCollectionRef = new FakeCollectionRef(`users/${uid}/meta`, userRef);
        const ref = new FakeDocRef(`users/${uid}/meta/${SUUNTO_SERVICE_NAME}`, metaCollectionRef);
        return {
            id: SUUNTO_SERVICE_NAME,
            ref,
            exists: true,
            data: () => data,
        };
    }

    function makeServiceMetaDoc(uid: string, serviceName: string, data: Record<string, unknown>): any {
        const userRef = new FakeDocRef(`users/${uid}`);
        const metaCollectionRef = new FakeCollectionRef(`users/${uid}/meta`, userRef);
        const ref = new FakeDocRef(`users/${uid}/meta/${serviceName}`, metaCollectionRef);
        return {
            id: serviceName,
            ref,
            exists: true,
            data: () => data,
        };
    }

    const collection = vi.fn((path: string) => new FakeCollectionRef(path));
    const collectionGroup = vi.fn((path: string) => {
        let limitValue = 200;
        let startAfterPath: string | null = null;
        const query = {
            where: vi.fn(() => query),
            orderBy: vi.fn(() => query),
            limit: vi.fn((value: number) => {
                limitValue = value;
                return query;
            }),
            startAfter: vi.fn((doc: { ref?: { path?: string } }) => {
                startAfterPath = doc?.ref?.path || null;
                return query;
            }),
            get: vi.fn(async () => {
                if (path !== 'meta') {
                    return { docs: [], size: 0, empty: true };
                }
                const orderedDocs = [...metaDocs]
                    .sort((a, b) => `${a.ref.path}`.localeCompare(`${b.ref.path}`));
                const startIndex = startAfterPath
                    ? orderedDocs.findIndex(doc => doc.ref.path === startAfterPath) + 1
                    : 0;
                const docs = orderedDocs.slice(startIndex, startIndex + limitValue);
                return { docs, size: docs.length, empty: docs.length === 0 };
            }),
        };
        return query;
    });
    const runTransaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => {
        const transaction = {
            get: vi.fn(async (ref: FakeDocRef) => makeSnapshot(ref, currentDocs.get(ref.path))),
            set: vi.fn((ref: FakeDocRef, payload: Record<string, unknown>, options?: unknown) => {
                transactionSets.push({ path: ref.path, payload, options });
                currentDocs.set(ref.path, payload);
            }),
        };
        return callback(transaction);
    });
    const getAll = vi.fn(async (...args: any[]) => {
        const maybeOptions = args[args.length - 1];
        const hasReadOptions = maybeOptions && typeof maybeOptions === 'object' && !('path' in maybeOptions);
        const refs = (hasReadOptions ? args.slice(0, -1) : args) as FakeDocRef[];
        const usePitr = Boolean(hasReadOptions && 'readTime' in maybeOptions);
        return refs.map((ref) => {
            const metaDoc = metaDocs.find(doc => doc.ref.path === ref.path);
            const data = usePitr
                ? pitrDocs.get(ref.path)
                : (currentDocs.get(ref.path) || metaDoc?.data());
            return makeSnapshot(ref, data);
        });
    });
    const firestoreFn = vi.fn(() => ({
        collection,
        collectionGroup,
        runTransaction,
        getAll,
    }));

    Object.assign(firestoreFn, {
        FieldValue: {
            delete: deleteField,
        },
        FieldPath: {
            documentId: () => '__name__',
        },
        Timestamp: {
            fromMillis: timestampFromMillis,
        },
    });

    return {
        SUUNTO_SERVICE_NAME,
        SUUNTO_TOKEN_ROOT,
        adminApps,
        metaDocs,
        currentDocs,
        pitrDocs,
        directSets,
        transactionSets,
        initializeApp,
        loggerInfo,
        loggerWarn,
        loggerError,
        deleteField,
        getUserDeletionGuardState,
        getUserDeletionGuardStateInTransaction,
        addSleepSyncQueueItem,
        getTokenData,
        addToQueueForSuunto,
        getWorkoutQueueItems,
        enqueueRouteSyncQueueItem,
        listSuuntoRoutes,
        enqueueActivitySyncJobsForImportedEvent,
        enqueueRouteDeliverySyncJobsForImportedRoute,
        hasSuccessfulRouteDeliveryMetadataForRevision,
        buildRouteDeliverySourceRevisionKeyForRouteSource,
        markServiceConnected,
        requestGet,
        makeMetaDoc,
        makeServiceMetaDoc,
        collection,
        collectionGroup,
        runTransaction,
        getAll,
        firestoreFn,
    };
});

vi.mock('firebase-admin', () => ({
    apps: hoisted.adminApps,
    initializeApp: hoisted.initializeApp,
    firestore: hoisted.firestoreFn,
}));

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        constructor(uid: string, phase: string, originalError: unknown) {
            super(`Could not read deletion guard for user ${uid} during ${phase}: ${String(originalError)}`);
            this.name = 'UserDeletionGuardReadError';
        }
    },
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
}));

vi.mock('../sleep/queue', () => ({
    addSleepSyncQueueItem: hoisted.addSleepSyncQueueItem,
}));

vi.mock('../tokens', () => ({
    getTokenData: hoisted.getTokenData,
}));

vi.mock('../queue', () => ({
    addToQueueForSuunto: hoisted.addToQueueForSuunto,
}));

vi.mock('../history', () => ({
    getWorkoutQueueItems: hoisted.getWorkoutQueueItems,
}));

vi.mock('../routes/route-sync-queue', () => ({
    enqueueRouteSyncQueueItem: hoisted.enqueueRouteSyncQueueItem,
}));

vi.mock('../suunto/routes', () => ({
    listSuuntoRoutes: hoisted.listSuuntoRoutes,
}));

vi.mock('../activity-sync/enqueue-imported-event', () => ({
    enqueueActivitySyncJobsForImportedEvent: hoisted.enqueueActivitySyncJobsForImportedEvent,
}));

vi.mock('../activity-sync/metadata', () => ({
    getActivitySyncMetadataDocId: (routeId: string) => `activitySync:${routeId}`,
}));

vi.mock('../route-delivery-sync/enqueue-imported-route', () => ({
    enqueueRouteDeliverySyncJobsForImportedRoute: hoisted.enqueueRouteDeliverySyncJobsForImportedRoute,
}));

vi.mock('../route-delivery-sync/revision', () => ({
    buildRouteDeliverySourceRevisionKeyForRouteSource: hoisted.buildRouteDeliverySourceRevisionKeyForRouteSource,
}));

vi.mock('../route-delivery-sync/delivery-metadata', () => ({
    hasSuccessfulRouteDeliveryMetadataForRevision: hoisted.hasSuccessfulRouteDeliveryMetadataForRevision,
}));

vi.mock('../service-connection-meta', () => ({
    markServiceConnected: hoisted.markServiceConnected,
}));

vi.mock('../request-helper', () => ({
    get: hoisted.requestGet,
}));

vi.mock('../config', () => ({
    config: {
        suuntoapp: {
            subscription_key: 'test-subscription-key',
        },
    },
}));

import {
    buildSuuntoSyncSettingsRestorePatch,
    chunkIncidentWindows,
    deriveIncidentWindow,
    extractActivityOriginalFiles,
    extractSuuntoProviderUserIdFromAuthFailure,
    isCurrentTokenNewerReconnect,
    parseSuuntoOutageRecoveryOptions,
    runSuuntoOutageRecoveryScript,
    shouldIncludeSuuntoRouteForIncident,
} from './recover-suunto-outage';

const disconnectedAtMs = Date.parse('2026-07-20T10:30:00Z');
const incidentStart = '2026-07-20T00:00:00Z';
const incidentEnd = '2026-07-21T00:00:00Z';

function suuntoTokenPath(uid: string, providerUserId: string): string {
    return `${hoisted.SUUNTO_TOKEN_ROOT}/${uid}/tokens/${providerUserId}`;
}

function settingsPath(uid: string): string {
    return `users/${uid}/config/settings`;
}

function addAffectedMeta(uid: string, providerUserId = 'suuntoUser'): void {
    hoisted.metaDocs.push(hoisted.makeMetaDoc(uid, {
        connectionState: 'reconnect_required',
        lastAuthFailureCode: 'invalid_grant',
        lastAuthFailureMessage: `Suunto token refresh failed: invalid_grant username=${providerUserId}`,
        lastDisconnectedAt: disconnectedAtMs,
    }));
}

describe('recover-suunto-outage script helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.adminApps.length = 0;
        hoisted.metaDocs.length = 0;
        hoisted.currentDocs.clear();
        hoisted.pitrDocs.clear();
        hoisted.directSets.length = 0;
        hoisted.transactionSets.length = 0;
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.addSleepSyncQueueItem.mockResolvedValue(undefined);
        hoisted.getTokenData.mockResolvedValue({ access_token: 'redacted' });
        hoisted.addToQueueForSuunto.mockResolvedValue(true);
        hoisted.getWorkoutQueueItems.mockResolvedValue([]);
        hoisted.enqueueRouteSyncQueueItem.mockResolvedValue({ queued: true });
        hoisted.listSuuntoRoutes.mockResolvedValue({ routes: [] });
        hoisted.enqueueActivitySyncJobsForImportedEvent.mockResolvedValue({ queued: 1, skipped: 0 });
        hoisted.enqueueRouteDeliverySyncJobsForImportedRoute.mockResolvedValue({ queued: 1, skipped: 0 });
        hoisted.hasSuccessfulRouteDeliveryMetadataForRevision.mockResolvedValue(false);
        hoisted.markServiceConnected.mockResolvedValue(true);
        hoisted.requestGet.mockResolvedValue([]);
    });

    it('parses dry-run defaults and restore-source stage', () => {
        const options = parseSuuntoOutageRecoveryOptions([
            '--apply',
            '--stage=restore-source',
            '--uid',
            'u1',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(options.execute).toBe(true);
        expect(options.stage).toBe('restore-source');
        expect(options.stageWasExplicit).toBe(true);
        expect(options.uid).toBe('u1');
        expect(options.incidentStartMs).toBe(Date.parse(incidentStart));
        expect(options.incidentEndMs).toBe(Date.parse(incidentEnd));
    });

    it('requires an explicit stage in apply mode so reconciliation is not run accidentally', () => {
        expect(() => parseSuuntoOutageRecoveryOptions([
            '--apply',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ])).toThrow('Apply mode requires an explicit --stage');
        expect(() => parseSuuntoOutageRecoveryOptions([
            '--apply',
            '--stage=all',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ])).toThrow('Apply mode does not support --stage=all');

        const dryRunOptions = parseSuuntoOutageRecoveryOptions([]);
        expect(dryRunOptions.execute).toBe(false);
        expect(dryRunOptions.stage).toBe('all');
        expect(dryRunOptions.stageWasExplicit).toBe(false);
    });

    it('extracts the Suunto provider user id from invalid_grant details', () => {
        expect(extractSuuntoProviderUserIdFromAuthFailure(
            'invalid_grant',
            'Refresh failed, username=dimitrioskanellopoulos, status=400',
        )).toBe('dimitrioskanellopoulos');
        expect(extractSuuntoProviderUserIdFromAuthFailure(
            null,
            'providerUserId: suunto-123 invalid_grant',
        )).toBe('suunto-123');
    });

    it('derives a padded full UTC incident window from affected timestamps', () => {
        const window = deriveIncidentWindow([
            { lastDisconnectedAtMs: Date.parse('2026-07-20T13:15:00Z') },
            { lastDisconnectedAtMs: Date.parse('2026-07-21T01:30:00Z') },
        ], {
            incidentStartMs: undefined,
            incidentEndMs: undefined,
            incidentPaddingMs: 12 * 60 * 60 * 1000,
        });

        expect(window).toEqual({
            startMs: Date.parse('2026-07-20T00:00:00Z'),
            endMs: Date.parse('2026-07-22T00:00:00Z'),
        });
    });

    it('builds a settings restore patch only for Suunto routes enabled before the incident', () => {
        const patch = buildSuuntoSyncSettingsRestorePatch({
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
                },
            },
        }, {
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: { enabled: true },
                },
                routeDeliverySyncRoutes: {
                    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
                },
            },
        });

        expect(patch.activitySyncRoutes).toEqual({
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
        });
        expect(patch.routeDeliverySyncRoutes).toEqual({
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
        });
    });

    it('detects newer reconnect tokens and incident route timestamps', () => {
        expect(isCurrentTokenNewerReconnect({
            dateCreated: disconnectedAtMs + 61_000,
        }, disconnectedAtMs)).toBe(true);
        expect(isCurrentTokenNewerReconnect({
            dateCreated: disconnectedAtMs + 30_000,
        }, disconnectedAtMs)).toBe(false);

        expect(shouldIncludeSuuntoRouteForIncident({
            created: Date.parse('2026-07-20T03:00:00Z'),
            modified: null,
        } as any, {
            startMs: Date.parse(incidentStart),
            endMs: Date.parse(incidentEnd),
        })).toBe(true);
        expect(shouldIncludeSuuntoRouteForIncident({
            created: Date.parse('2026-07-19T03:00:00Z'),
            modified: Date.parse('2026-07-21T03:00:00Z'),
        } as any, {
            startMs: Date.parse(incidentStart),
            endMs: Date.parse(incidentEnd),
        })).toBe(false);
    });

    it('chunks incident-only sleep windows and extracts original file metadata', () => {
        expect(chunkIncidentWindows(
            Date.parse('2026-07-20T00:00:00Z'),
            Date.parse('2026-07-23T00:00:00Z'),
            1,
        )).toHaveLength(3);

        expect(extractActivityOriginalFiles({
            originalFiles: [
                { path: 'users/u1/events/e1/source.fit', bucket: 'bucket-a', originalFilename: 'source.fit' },
                { bucket: 'missing-path' },
            ],
        })).toEqual([
            {
                path: 'users/u1/events/e1/source.fit',
                bucket: 'bucket-a',
                originalFilename: 'source.fit',
            },
        ]);
    });
});

describe('recover-suunto-outage restore flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.adminApps.length = 0;
        hoisted.metaDocs.length = 0;
        hoisted.currentDocs.clear();
        hoisted.pitrDocs.clear();
        hoisted.directSets.length = 0;
        hoisted.transactionSets.length = 0;
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.markServiceConnected.mockResolvedValue(true);
        hoisted.requestGet.mockResolvedValue([]);
    });

    it('restores only a missing Suunto token from PITR, restores disabled settings, and clears false reconnect state', async () => {
        addAffectedMeta('u1', 'suuntoUser');
        hoisted.pitrDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
            accessToken: 'redacted-access-token',
            refreshToken: 'redacted-refresh-token',
        });
        hoisted.pitrDocs.set(settingsPath('u1'), {
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                },
            },
        });
        hoisted.currentDocs.set(settingsPath('u1'), {
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
                },
            },
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.tokenRestore.restored).toBe(1);
        expect(summary.serviceState.settingsRoutesRestored).toBe(1);
        expect(summary.serviceState.markedConnected).toBe(1);
        expect(hoisted.transactionSets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: suuntoTokenPath('u1', 'suuntoUser'),
                payload: expect.objectContaining({
                    serviceName: ServiceNames.SuuntoApp,
                    userName: 'suuntoUser',
                }),
            }),
            expect.objectContaining({
                path: settingsPath('u1'),
                payload: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                        },
                    },
                },
            }),
        ]));
        expect(hoisted.markServiceConnected).toHaveBeenCalledWith('u1', ServiceNames.SuuntoApp);
    });

    it('paginates affected reconnect-required meta docs instead of only scanning the first page', async () => {
        addAffectedMeta('u1', 'suuntoUser1');
        addAffectedMeta('u2', 'suuntoUser2');
        for (const [uid, providerUserId] of [
            ['u1', 'suuntoUser1'],
            ['u2', 'suuntoUser2'],
        ]) {
            hoisted.pitrDocs.set(suuntoTokenPath(uid, providerUserId), {
                serviceName: ServiceNames.SuuntoApp,
                userName: providerUserId,
            });
        }

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--page-size=1',
            '--limit=10',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.affectedCandidates).toBe(2);
        expect(summary.tokenRestore.restored).toBe(2);
        expect(hoisted.collectionGroup).toHaveBeenCalledWith('meta');
    });

    it('reads explicit user meta directly so targeted recovery does not need the global meta collection-group index', async () => {
        addAffectedMeta('u1', 'suuntoUser1');
        addAffectedMeta('u2', 'suuntoUser2');
        for (const [uid, providerUserId] of [
            ['u1', 'suuntoUser1'],
            ['u2', 'suuntoUser2'],
        ]) {
            hoisted.pitrDocs.set(suuntoTokenPath(uid, providerUserId), {
                serviceName: ServiceNames.SuuntoApp,
                userName: providerUserId,
            });
        }

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--uids=u1,u2',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.affectedCandidates).toBe(2);
        expect(summary.tokenRestore.restored).toBe(2);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('keeps paginating when full pages contain filtered non-Suunto meta docs', async () => {
        addAffectedMeta('u1', 'suuntoUser1');
        hoisted.metaDocs.push(hoisted.makeServiceMetaDoc('u-filtered', 'Garmin API', {
            connectionState: 'reconnect_required',
            lastAuthFailureCode: 'invalid_grant',
            lastAuthFailureMessage: 'invalid_grant',
            lastDisconnectedAt: disconnectedAtMs,
        }));
        addAffectedMeta('u2', 'suuntoUser2');
        for (const [uid, providerUserId] of [
            ['u1', 'suuntoUser1'],
            ['u2', 'suuntoUser2'],
        ]) {
            hoisted.pitrDocs.set(suuntoTokenPath(uid, providerUserId), {
                serviceName: ServiceNames.SuuntoApp,
                userName: providerUserId,
            });
        }

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--page-size=1',
            '--limit=2',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.affectedCandidates).toBe(2);
        expect(summary.tokenRestore.restored).toBe(2);
    });

    it('recomputes settings restore patch inside the transaction', async () => {
        addAffectedMeta('u1', 'suuntoUser');
        hoisted.pitrDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
        });
        hoisted.pitrDocs.set(settingsPath('u1'), {
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                },
            },
        });
        hoisted.currentDocs.set(settingsPath('u1'), {
            serviceSyncSettings: {
                activitySyncRoutes: {
                    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                },
            },
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.serviceState.settingsRoutesRestored).toBe(0);
        expect(hoisted.transactionSets).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                path: settingsPath('u1'),
            }),
        ]));
    });

    it('skips deleted users before restoring token material', async () => {
        addAffectedMeta('u1', 'suuntoUser');
        hoisted.pitrDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
        });
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: false,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.tokenRestore.restored).toBe(0);
        expect(summary.skipped.user_deleted_or_deleting).toBe(1);
        expect(hoisted.transactionSets).toHaveLength(0);
        expect(hoisted.markServiceConnected).not.toHaveBeenCalled();
    });

    it('does not overwrite a newer current Suunto token', async () => {
        addAffectedMeta('u1', 'suuntoUser');
        hoisted.currentDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
            dateCreated: disconnectedAtMs + 120_000,
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=restore',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.tokenRestore.currentTokenNewerReconnect).toBe(1);
        expect(summary.skipped.current_token_is_newer_reconnect).toBe(1);
        expect(hoisted.transactionSets).toHaveLength(0);
        expect(hoisted.markServiceConnected).not.toHaveBeenCalled();
    });
});

describe('recover-suunto-outage source backfill flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.adminApps.length = 0;
        hoisted.metaDocs.length = 0;
        hoisted.currentDocs.clear();
        hoisted.pitrDocs.clear();
        hoisted.directSets.length = 0;
        hoisted.transactionSets.length = 0;
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getTokenData.mockResolvedValue({ access_token: 'redacted' });
        hoisted.requestGet.mockResolvedValue([]);
        hoisted.getWorkoutQueueItems.mockResolvedValue([
            { userName: 'suuntoUser', workoutID: 'workout-1' },
            { userName: 'suuntoUser', workoutID: 'workout-2' },
        ]);
        hoisted.requestGet.mockResolvedValue([
            {
                id: 'route-1',
                description: 'Incident route',
                created: Date.parse('2026-07-20T06:00:00Z'),
                modified: null,
            },
            {
                id: 'route-2',
                description: 'Old route',
                created: Date.parse('2026-07-18T06:00:00Z'),
                modified: null,
            },
        ]);
        hoisted.listSuuntoRoutes.mockResolvedValue({
            routes: [
                {
                    id: 'route-1',
                    providerUserId: 'suuntoUser',
                    description: 'Incident route',
                    created: Date.parse('2026-07-20T06:00:00Z'),
                    modified: null,
                },
                {
                    id: 'route-2',
                    providerUserId: 'suuntoUser',
                    description: 'Old route',
                    created: Date.parse('2026-07-18T06:00:00Z'),
                    modified: null,
                },
            ],
        });
    });

    it('queues incident-only sleep windows, Suunto workouts, and incident routes through existing enqueue paths', async () => {
        hoisted.currentDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--apply',
            '--stage=source-backfill',
            '--uid',
            'u1',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.sleepBackfill.windowsQueued).toBe(1);
        expect(summary.activityBackfill.providerWorkoutsFound).toBe(2);
        expect(summary.activityBackfill.workoutsQueued).toBe(2);
        expect(summary.routeBackfill.providerRoutesFound).toBe(2);
        expect(summary.routeBackfill.routesQueued).toBe(1);
        expect(summary.routeBackfill.routesSkippedOutsideIncident).toBe(1);
        expect(hoisted.addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_poll',
            userID: 'u1',
            providerUserId: 'suuntoUser',
            dedupeKey: expect.stringContaining('suunto-outage-sleep:u1:suuntoUser:'),
        }));
        expect(hoisted.addToQueueForSuunto).toHaveBeenCalledTimes(2);
        expect(hoisted.addToQueueForSuunto).toHaveBeenCalledWith({
            userName: 'suuntoUser',
            workoutID: 'workout-1',
        });
        expect(hoisted.enqueueRouteSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            sourceServiceName: ServiceNames.SuuntoApp,
            providerUserId: 'suuntoUser',
            providerRouteId: 'route-1',
            firebaseUserID: 'u1',
        }));
    });

    it('dry-run source backfill skips provider candidate reads when the token would need refresh', async () => {
        hoisted.currentDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
            accessToken: 'redacted-access-token',
            expiresAt: Date.now() - 1_000,
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--stage=source-backfill',
            '--uid',
            'u1',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.dryRun).toBe(true);
        expect(summary.sleepBackfill.windowsQueued).toBe(1);
        expect(summary.skipped.source_backfill_dry_run_token_requires_refresh).toBe(1);
        expect(summary.skipped.route_backfill_dry_run_token_requires_refresh).toBe(1);
        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.getWorkoutQueueItems).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.listSuuntoRoutes).not.toHaveBeenCalled();
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
        expect(hoisted.enqueueRouteSyncQueueItem).not.toHaveBeenCalled();
    });

    it('dry-run source backfill counts candidates from non-expired token data without refreshing or queueing', async () => {
        hoisted.currentDocs.set(suuntoTokenPath('u1', 'suuntoUser'), {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'suuntoUser',
            accessToken: 'redacted-access-token',
            refreshToken: 'redacted-refresh-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
        });

        const summary = await runSuuntoOutageRecoveryScript([
            '--stage=source-backfill',
            '--uid',
            'u1',
            '--start',
            incidentStart,
            '--end',
            incidentEnd,
        ]);

        expect(summary.dryRun).toBe(true);
        expect(summary.activityBackfill.providerWorkoutsFound).toBe(2);
        expect(summary.activityBackfill.workoutsQueued).toBe(2);
        expect(summary.routeBackfill.providerRoutesFound).toBe(2);
        expect(summary.routeBackfill.routesQueued).toBe(1);
        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.getWorkoutQueueItems).toHaveBeenCalledWith(
            ServiceNames.SuuntoApp,
            expect.objectContaining({
                accessToken: 'redacted-access-token',
                userName: 'suuntoUser',
            }),
            expect.any(Date),
            expect.any(Date),
        );
        expect(hoisted.getWorkoutQueueItems.mock.calls[0][1]).not.toHaveProperty('refreshToken');
        expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/route',
            headers: expect.objectContaining({
                Authorization: 'Bearer redacted-access-token',
            }),
        }));
        expect(hoisted.addSleepSyncQueueItem).not.toHaveBeenCalled();
        expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
        expect(hoisted.enqueueRouteSyncQueueItem).not.toHaveBeenCalled();
    });
});
