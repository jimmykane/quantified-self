import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

interface MockTokenDocument {
    id: string;
    data: () => Record<string, unknown>;
    canonicalSuuntoRoot: boolean;
    ref: {
        parent: { parent: { id: string } };
        set: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
    };
}

const hoisted = vi.hoisted(() => ({
    collectionGroup: vi.fn(),
    collection: vi.fn(),
    collectionGroupGet: vi.fn(),
    metaDocGet: vi.fn(),
    mockGetUserDeletionGuardState: vi.fn(),
    getActiveCOROSTokenSnapshot: vi.fn(),
    maintenanceCursorGet: vi.fn(),
    maintenanceCursorSet: vi.fn(),
    collectionGroupLimit: vi.fn(),
    suuntoRootOrderBy: vi.fn(),
    suuntoRootStartAfter: vi.fn(),
    suuntoRootLimit: vi.fn(),
    suuntoRootGet: vi.fn(),
    suuntoTokenOrderBy: vi.fn(),
    installedTokenDocs: [] as MockTokenDocument[],
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: vi.fn((_options: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const firestore = vi.fn(() => ({
        collectionGroup: hoisted.collectionGroup,
        collection: hoisted.collection,
    }));
    Object.assign(firestore, {
        FieldPath: {
            documentId: vi.fn(() => '__name__'),
        },
    });
    return { firestore };
});

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.mockGetUserDeletionGuardState,
}));

vi.mock('../coros/account', () => ({
    getActiveCOROSTokenSnapshot: (...args: unknown[]) => hoisted.getActiveCOROSTokenSnapshot(...args),
}));

import { sleepPollingTestInternals } from './polling';
import { addSleepSyncQueueItem } from './queue';
import * as logger from 'firebase-functions/logger';

describe('sleep polling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.metaDocGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.installedTokenDocs.length = 0;
        hoisted.getActiveCOROSTokenSnapshot.mockImplementation(async (userID: string) => {
            const token = hoisted.installedTokenDocs.find(candidate => candidate.ref.parent.parent.id === userID);
            if (!token) throw new Error('No active COROS token');
            return token;
        });
        hoisted.maintenanceCursorGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.maintenanceCursorSet.mockResolvedValue(undefined);
    });

    function createTokenDoc(
        userID: string,
        data: Record<string, unknown>,
        canonicalSuuntoRoot = data.serviceName === ServiceNames.SuuntoApp,
    ) {
        return {
            id: `${data['openId'] || data['userName'] || 'token'}`,
            data: () => data,
            canonicalSuuntoRoot,
            ref: {
                parent: {
                    parent: {
                        id: userID,
                    },
                },
                set: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
            },
        };
    }

    function installCollectionGroupTokenMock(docs: MockTokenDocument[]) {
        hoisted.installedTokenDocs.splice(0, hoisted.installedTokenDocs.length, ...docs);
        hoisted.collectionGroupGet.mockResolvedValue({ docs });
        const collectionGroupQuery = {
            where: vi.fn().mockReturnThis(),
            limit: hoisted.collectionGroupLimit,
            get: hoisted.collectionGroupGet,
        };
        hoisted.collectionGroupLimit.mockReturnValue(collectionGroupQuery);
        hoisted.collectionGroup.mockReturnValue(collectionGroupQuery);
        let rootStartAfter: string | null = null;
        let rootLimit = Number.POSITIVE_INFINITY;
        const tokenCollectionForUser = (userID: string) => {
            let tokenLimit = Number.POSITIVE_INFINITY;
            let tokenStartAfter: string | null = null;
            const tokenQuery = {
                where: vi.fn().mockReturnThis(),
                orderBy: hoisted.suuntoTokenOrderBy,
                startAfter: vi.fn((tokenID: string) => {
                    tokenStartAfter = tokenID;
                    return tokenQuery;
                }),
                limit: vi.fn((value: number) => {
                    tokenLimit = value;
                    return tokenQuery;
                }),
                get: vi.fn(async () => ({
                    docs: hoisted.installedTokenDocs
                        .filter(token => (
                            token.canonicalSuuntoRoot
                            &&
                            token.ref.parent.parent.id === userID
                            && token.data().serviceName === ServiceNames.SuuntoApp
                        ))
                        .sort((left, right) => left.id.localeCompare(right.id))
                        .filter(token => !tokenStartAfter || token.id > tokenStartAfter)
                        .slice(0, tokenLimit),
                })),
            };
            hoisted.suuntoTokenOrderBy.mockReturnValue(tokenQuery);
            return tokenQuery;
        };
        const rootDocument = (userID: string) => {
            const tokenCollection = vi.fn(() => tokenCollectionForUser(userID));
            const document = {
                id: userID,
                exists: true,
                collection: tokenCollection,
                ref: {
                    collection: tokenCollection,
                },
                get: vi.fn(),
            };
            document.get.mockImplementation(async () => {
                const exists = hoisted.installedTokenDocs.some(token => (
                    token.canonicalSuuntoRoot
                    && token.ref.parent.parent.id === userID
                    && token.data().serviceName === ServiceNames.SuuntoApp
                ));
                return exists ? document : { ...document, exists: false };
            });
            return document;
        };
        const rootQuery = {
            orderBy: hoisted.suuntoRootOrderBy,
            startAfter: hoisted.suuntoRootStartAfter,
            limit: hoisted.suuntoRootLimit,
            get: hoisted.suuntoRootGet,
        };
        hoisted.suuntoRootOrderBy.mockReturnValue(rootQuery);
        hoisted.suuntoRootStartAfter.mockImplementation((userID: string) => {
            rootStartAfter = userID;
            return rootQuery;
        });
        hoisted.suuntoRootLimit.mockImplementation((value: number) => {
            rootLimit = value;
            return rootQuery;
        });
        hoisted.suuntoRootGet.mockImplementation(async () => {
            const userIDs = [...new Set(hoisted.installedTokenDocs
                .filter(token => (
                    token.canonicalSuuntoRoot
                    && token.data().serviceName === ServiceNames.SuuntoApp
                ))
                .map(token => token.ref.parent.parent.id))]
                .sort()
                .filter(userID => !rootStartAfter || userID > rootStartAfter)
                .slice(0, rootLimit);
            return { docs: userIDs.map(rootDocument) };
        });
        hoisted.collection.mockImplementation((name: string) => {
            if (name === 'providerMaintenanceState') {
                return {
                    doc: vi.fn(() => ({
                        get: hoisted.maintenanceCursorGet,
                        set: hoisted.maintenanceCursorSet,
                    })),
                };
            }
            if (name === 'suuntoAppAccessTokens') {
                return {
                    ...rootQuery,
                    doc: vi.fn((userID: string) => rootDocument(userID)),
                };
            }
            if (name !== 'users') {
                return undefined;
            }
            return {
                doc: vi.fn(() => ({
                    collection: vi.fn(() => ({
                        doc: vi.fn(() => ({
                            get: hoisted.metaDocGet,
                        })),
                    })),
                })),
            };
        });
    }

    it('chunks recent polling windows by provider API maximum range', () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const nowMs = Date.UTC(2026, 3, 28);

        const windows = sleepPollingTestInternals.chunkRecentWindow(nowMs, 70, 30);

        expect(windows).toEqual([
            { startMs: nowMs - (70 * dayMs), endMs: nowMs - (40 * dayMs) },
            { startMs: nowMs - (40 * dayMs), endMs: nowMs - (10 * dayMs) },
            { startMs: nowMs - (10 * dayMs), endMs: nowMs },
        ]);
    });

    it('queues COROS token docs when sleep sync is open to all users', async () => {
        const userID = 'coros-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.COROSAPI,
                openId: 'coros-open-id-1',
            }),
        ]);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.COROSAPI,
            ServiceNames.COROSAPI,
            30,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'coros_poll',
            provider: SLEEP_PROVIDERS.COROSAPI,
            userID,
            providerUserId: 'coros-open-id-1',
        }));
    });

    it('queues only the active COROS account when a user has legacy token documents', async () => {
        const userID = 'coros-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        const oldToken = createTokenDoc(userID, {
            serviceName: ServiceNames.COROSAPI,
            openId: 'coros-open-old',
        });
        const activeToken = createTokenDoc(userID, {
            serviceName: ServiceNames.COROSAPI,
            openId: 'coros-open-active',
        });
        installCollectionGroupTokenMock([oldToken, activeToken]);
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.COROSAPI,
            ServiceNames.COROSAPI,
            30,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID,
            providerUserId: 'coros-open-active',
        }));
    });

    it('uses the active COROS token document id for legacy tokens without an openId field', async () => {
        const userID = 'coros-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        const legacyToken = createTokenDoc(userID, {
            serviceName: ServiceNames.COROSAPI,
        });
        legacyToken.id = 'legacy-coros-open-id';
        installCollectionGroupTokenMock([legacyToken]);
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(legacyToken);

        await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.COROSAPI,
            ServiceNames.COROSAPI,
            30,
            nowMs,
        );

        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID,
            providerUserId: 'legacy-coros-open-id',
        }));
    });

    it('bounds active COROS account lookups for production-wide polling', async () => {
        const concurrency = sleepPollingTestInternals.COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY;
        const candidateUserIDs = Array.from({ length: concurrency + 5 }, (_, index) => `coros-user-${index}`);
        const tokens = candidateUserIDs.map((userID, index) => createTokenDoc(userID, {
            serviceName: ServiceNames.COROSAPI,
            openId: `coros-open-${index}`,
        }));
        installCollectionGroupTokenMock(tokens);
        let inFlight = 0;
        let maxInFlight = 0;
        hoisted.getActiveCOROSTokenSnapshot.mockImplementation(async (userID: string) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight -= 1;
            return tokens.find(token => token.ref.parent.parent.id === userID)!;
        });

        const resolved = await sleepPollingTestInternals.resolveActiveCOROSTokenSnapshots(candidateUserIDs);

        expect(resolved).toHaveLength(candidateUserIDs.length);
        expect(maxInFlight).toBe(concurrency);
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenCalledTimes(candidateUserIDs.length);
    });

    it('queries a bounded Suunto token page when sleep sync is open to all users', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(hoisted.collection).toHaveBeenCalledWith('suuntoAppAccessTokens');
        expect(hoisted.collectionGroup).not.toHaveBeenCalledWith('tokens');
        expect(hoisted.collection).toHaveBeenCalledWith('users');
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_poll',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            userID,
            providerUserId: 'suunto-user-1',
        }));
        expect(hoisted.suuntoRootLimit).toHaveBeenCalledWith(
            sleepPollingTestInternals.SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE + 1,
        );
    });

    it('does not let Suunto-shaped token rows under a client-writable provider consume the canonical page', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        const poison = createTokenDoc('attacker-user', {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'victim-provider-account',
        }, false);
        const legitimate = createTokenDoc('legitimate-user', {
            serviceName: ServiceNames.SuuntoApp,
            userName: 'legitimate-provider-account',
        });
        installCollectionGroupTokenMock([poison, legitimate]);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID: 'legitimate-user',
            providerUserId: 'legitimate-provider-account',
        }));
        expect(addSleepSyncQueueItem).not.toHaveBeenCalledWith(expect.objectContaining({
            userID: 'attacker-user',
        }));
    });

    it('queues at most one bounded canonical Suunto root page and advances its keyset cursor', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        const pageSize = sleepPollingTestInternals.SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE;
        installCollectionGroupTokenMock(Array.from(
            { length: pageSize + 1 },
            (_, index) => createTokenDoc(`user-${index}`, {
                serviceName: ServiceNames.SuuntoApp,
                userName: `provider-${index}`,
            }),
        ));

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(pageSize);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(pageSize);
        expect(hoisted.maintenanceCursorSet).toHaveBeenCalledWith(expect.objectContaining({
            lastCompletedUserID: expect.any(String),
            currentUserID: null,
            rootPageSize: pageSize,
        }), { merge: false });
        expect(hoisted.collectionGroup).not.toHaveBeenCalledWith('tokens');
    });

    it('resumes within a canonical root so every retained Suunto account is processed', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        const userID = 'multi-account-user';
        installCollectionGroupTokenMock(Array.from(
            { length: sleepPollingTestInternals.SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT + 1 },
            (_, index) => createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: `provider-${index}`,
            }),
        ));

        const firstQueued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(firstQueued).toBe(sleepPollingTestInternals.SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT);
        const firstCursor = hoisted.maintenanceCursorSet.mock.calls.at(-1)?.[0];
        expect(firstCursor).toEqual(expect.objectContaining({
            lastCompletedUserID: null,
            currentUserID: userID,
            lastProcessedTokenID: 'provider-7',
        }));

        vi.mocked(addSleepSyncQueueItem).mockClear();
        hoisted.maintenanceCursorGet.mockResolvedValue({
            exists: true,
            data: () => firstCursor,
        });
        const secondQueued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs + 1,
        );

        expect(secondQueued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID,
            providerUserId: 'provider-8',
        }));
        expect(hoisted.maintenanceCursorSet).toHaveBeenLastCalledWith(expect.objectContaining({
            lastCompletedUserID: userID,
            currentUserID: null,
            lastProcessedTokenID: null,
        }), { merge: false });
    });

    it('resumes Suunto polling after the last root key instead of a shifting numeric offset', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('user-a', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'provider-a',
            }),
            createTokenDoc('user-c', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'provider-c',
            }),
        ]);
        hoisted.maintenanceCursorGet.mockResolvedValue({
            exists: true,
            data: () => ({
                lastCompletedUserID: 'user-b',
                sweepStartedAtMs: nowMs - 60_000,
            }),
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID: 'user-c',
        }));
        expect(addSleepSyncQueueItem).not.toHaveBeenCalledWith(expect.objectContaining({
            userID: 'user-a',
        }));
        expect(hoisted.suuntoRootStartAfter).toHaveBeenCalledWith('user-b');
    });

    it('pauses a completed production-wide Suunto sweep for 24 hours', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('user-a', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'provider-a',
            }),
        ]);
        hoisted.maintenanceCursorGet.mockResolvedValue({
            exists: true,
            data: () => ({
                lastCompletedUserID: null,
                lastCompletedSweepAtMs: nowMs - (60 * 60 * 1000),
            }),
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(hoisted.suuntoRootGet).not.toHaveBeenCalled();
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('queues production-wide Suunto Health polls from canonical account roots', async () => {
        const userID = 'health-user-1';
        const nowMs = Date.UTC(2026, 7, 27, 12);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'private-suunto-account',
            }),
            createTokenDoc('health-user-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'other-suunto-account',
            }),
        ]);
        hoisted.maintenanceCursorGet.mockResolvedValue({
            exists: true,
            data: () => ({
                lastCompletedUserID: userID,
                lastCompletedSweepAtMs: nowMs,
            }),
        });

        const queued = await sleepPollingTestInternals.enqueueSuuntoHealthPolls(nowMs);

        expect(queued).toBe(2);
        expect(hoisted.suuntoRootLimit).toHaveBeenCalledWith(
            sleepPollingTestInternals.SUUNTO_HEALTH_POLL_ROOT_PAGE_SIZE + 1,
        );
        expect(hoisted.maintenanceCursorSet).toHaveBeenCalledWith(
            expect.objectContaining({
                cursorScope: 'global-v1',
                lastCompletedSweepAtMs: nowMs,
            }),
            { merge: false },
        );
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith({
            type: 'suunto_health_poll',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            userID,
            providerUserId: 'private-suunto-account',
            rangeStartMs: nowMs - (7 * 24 * 60 * 60 * 1000),
            rangeEndMs: nowMs,
            healthTrigger: 'poll',
            dedupeKey: `suunto-health-poll:${userID}:private-suunto-account:${nowMs - (7 * 24 * 60 * 60 * 1000)}:${nowMs}`,
        });
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID: 'health-user-2',
            providerUserId: 'other-suunto-account',
        }));
    });

    it('resumes production-wide Health polling after the first retained-account page', async () => {
        const userID = 'health-user-1';
        const nowMs = Date.UTC(2026, 7, 27, 12);
        installCollectionGroupTokenMock(Array.from(
            { length: sleepPollingTestInternals.SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT + 1 },
            (_, index) => createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: `health-provider-${index}`,
            }),
        ));

        const firstQueued = await sleepPollingTestInternals.enqueueSuuntoHealthPolls(nowMs);
        expect(firstQueued).toBe(sleepPollingTestInternals.SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT);
        const firstCursor = hoisted.maintenanceCursorSet.mock.calls.at(-1)?.[0];
        expect(firstCursor).toEqual(expect.objectContaining({
            currentUserID: userID,
            lastProcessedTokenID: 'health-provider-7',
        }));

        vi.mocked(addSleepSyncQueueItem).mockClear();
        hoisted.maintenanceCursorGet.mockResolvedValue({
            exists: true,
            data: () => firstCursor,
        });
        const secondQueued = await sleepPollingTestInternals.enqueueSuuntoHealthPolls(nowMs + 1);

        expect(secondQueued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID,
            providerUserId: 'health-provider-8',
        }));
    });

    it('skips users marked reconnect_required in service meta', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.metaDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ connectionState: 'reconnect_required' }),
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('skips polling when user deletion is in progress', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('skips polling when the user document is missing', async () => {
        const userID = 'suunto-user-id';
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc(userID, {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });

    it('continues polling other users when deletion guard lookup fails for one user', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        hoisted.mockGetUserDeletionGuardState
            .mockRejectedValueOnce(new Error('guard read failed'))
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
            userID: 'suunto-user-id-2',
        }));
        expect(logger.warn).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Failed to read deletion guard for user suunto-user-id-1; skipping sleep polling for this user.',
            { errorName: 'Error' },
        );
    });

    it('continues polling when reconnect state lookup fails for one user', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        hoisted.metaDocGet
            .mockRejectedValueOnce(new Error('meta read failed'))
            .mockResolvedValueOnce({ exists: false, data: () => undefined });

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(2);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Failed to read service connection state for user suunto-user-id-1 and service suuntoApp; continuing sleep polling.',
            { errorName: 'Error' },
        );
    });

    it('stops queueing windows for a user when deletion starts after a queue write', async () => {
        const nowMs = Date.UTC(2026, 3, 28);
        installCollectionGroupTokenMock([
            createTokenDoc('suunto-user-id-1', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-1',
            }),
            createTokenDoc('suunto-user-id-2', {
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user-2',
            }),
        ]);
        vi.mocked(addSleepSyncQueueItem)
            .mockRejectedValueOnce(Object.assign(new Error('deleted mid-enqueue'), {
                name: 'ProviderQueueUserDeletedOrDeletingError',
            }))
            .mockResolvedValue({} as Awaited<ReturnType<typeof addSleepSyncQueueItem>>);

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.SuuntoApp,
            ServiceNames.SuuntoApp,
            28,
            nowMs,
        );

        expect(queued).toBe(1);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(2);
        expect(addSleepSyncQueueItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            userID: 'suunto-user-id-1',
        }));
        expect(addSleepSyncQueueItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            userID: 'suunto-user-id-2',
        }));
        expect(logger.info).toHaveBeenCalledWith(
            '[SleepSync][SuuntoApp] Stopped queueing polls for user suunto-user-id-1 because deletion started during queue creation.',
        );
    });
});
