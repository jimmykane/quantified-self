import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as functions from 'firebase-functions/v1';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const { authBuilderMock, deauthorizeServiceMock, firestoreMock, getServiceConfigMock, batchMock, whereMock, recursiveDeleteMock, tokensGetMock, setMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const userMock = vi.fn((_id?: string) => ({ onDelete: onDeleteMock }));

    const deleteMock = vi.fn().mockResolvedValue({});
    const setMock = vi.fn().mockResolvedValue({});

    // Mock for tokens subcollection - returns empty by default
    const tokensGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const tokensCollectionMock = vi.fn().mockReturnValue({ get: tokensGetMock });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const docMock = vi.fn((_id?: string) => ({
        delete: deleteMock,
        collection: tokensCollectionMock,  // Support for subcollection queries
        set: setMock
    }));

    // Define mocks first
    const querySnapshotMock = {
        docs: [
            { id: 'doc1', ref: 'ref1' },
            { id: 'doc2', ref: 'ref2' },
        ],
    };

    const whereMock = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(querySnapshotMock)
    });

    const collectionMock = vi.fn((collectionName) => {
        if (collectionName === 'mail') {
            return {
                where: whereMock,
                doc: docMock
            };
        }
        return {
            doc: docMock,
            where: whereMock
        };
    });

    const batchMock = {
        delete: vi.fn(),
        commit: vi.fn(),
    };

    const recursiveDeleteMock = vi.fn().mockResolvedValue({});

    // Timestamp mock
    const mockTimestamp = {
        toMillis: () => 1700000000000
    };

    const firestore = Object.assign(vi.fn(() => ({
        collection: collectionMock,
        batch: vi.fn(() => batchMock),
        recursiveDelete: recursiveDeleteMock
    })), {
        Timestamp: {
            now: vi.fn(() => mockTimestamp),
            fromMillis: vi.fn((ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
            fromDate: vi.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }))
        }
    });

    return {
        authBuilderMock: { user: userMock },
        deauthorizeServiceMock: vi.fn(),

        firestoreMock: firestore,
        getServiceConfigMock: vi.fn(),
        batchMock,
        whereMock,
        recursiveDeleteMock,
        tokensGetMock,
        setMock
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => ({
    auth: authBuilderMock,
    region: vi.fn().mockImplementation(() => ({
        auth: authBuilderMock
    })),
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => ({
    firestore: firestoreMock
}));

// Mock oauth wrappers
vi.mock('../OAuth2', () => ({
    deauthorizeServiceForUser: deauthorizeServiceMock,
    getServiceConfig: getServiceConfigMock
}));



// Import function under test
import { cleanupUserAccounts, ORPHANED_SERVICE_TOKENS_COLLECTION_NAME } from './cleanup';

const testEnv = functionsTest();

describe('cleanupUserAccounts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset console mocks to keep output clean during tests if needed
        global.console = { ...global.console, log: vi.fn(), error: vi.fn() };

        // Setup default mocks
        getServiceConfigMock.mockReturnValue({ tokenCollectionName: 'mockCollection' });

        // Reset batch/where mocks specific behavior if needed
        batchMock.commit.mockResolvedValue({});
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should deauthorize services and delete parent documents', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        expect(getServiceConfigMock).toHaveBeenCalledWith(ServiceNames.SuuntoApp);
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();

        // Verify COROS
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should force delete Suunto tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto 500 API Error'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        // But local cleanup should STILL happen
        expect(recursiveDeleteMock).toHaveBeenCalled();

        // COROS succeeded
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should continue if parent doc deletion fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto doc deletion fail (via the recursiveDelete mock)
        recursiveDeleteMock.mockRejectedValueOnce(new Error('Firestore delete failed'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Suunto was called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should query and delete emails for the user', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@example.com' });

        const uidDocs = { docs: [{ id: 'mail1', ref: 'ref1' }] };
        const emailDocs = { docs: [{ id: 'mail2', ref: 'ref2' }] };

        // Fix: where() returns an object with get(), which returns the promise.
        // The mock definition logic for whereMock was:
        // const whereMock = vi.fn().mockReturnValue({
        //     get: vi.fn().mockResolvedValue(querySnapshotMock)
        // });

        // We need to override the inner `get` behavior.
        const getMock = vi.fn();
        getMock
            .mockResolvedValueOnce(uidDocs)
            .mockResolvedValueOnce(emailDocs);

        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        expect(firestoreMock().collection).toHaveBeenCalledWith('mail');

        // Verify Queries
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
        expect(whereMock).toHaveBeenCalledWith('to', '==', 'test@example.com');

        // Verify Deletion
        // expect(firestoreMock().batch).toHaveBeenCalled(); // Removed as firestoreMock returns new instance with new batch spy each time
        expect(batchMock.delete).toHaveBeenCalledWith('ref1');
        expect(batchMock.delete).toHaveBeenCalledWith('ref2');
        expect(batchMock.commit).toHaveBeenCalled();
    });

    it('should recursively delete parent doc', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify recursiveDelete was called with the correct doc ref
        const docRef = firestoreMock().collection('mockCollection').doc('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalledWith(docRef);
    });

    it('should handle subcollection deletion error and continue', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make subcollection query throw for first service
        // Make recursiveDelete throw
        recursiveDeleteMock.mockRejectedValueOnce(new Error('Firestore error'));

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should still call COROS and Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
    });

    it('should force delete Garmin tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Garmin fail
        deauthorizeServiceMock.mockImplementation((userId, serviceName) => {
            if (serviceName === ServiceNames.GarminAPI) {
                return Promise.reject(new Error('Garmin 500 API Error'));
            }
            return Promise.resolve();
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify Garmin deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);

        // Verify local cleanup encountered error but TRIED to delete
        // Note: The helper calls deleteTokenDocumentWithSubcollections, which calls doc(uid).delete()
        expect(firestoreMock().collection).toHaveBeenCalledWith('garminAPITokens');
        expect(firestoreMock().collection('garminAPITokens').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should force delete COROS tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make COROS fail. Since deauthorizeServiceForUser is used for both Suunto and COROS,
        // we need to verify the call args to distinguish.
        // We can mock it to throw ONLY when called with COROSAPI.
        deauthorizeServiceMock.mockImplementation((userId, serviceName) => {
            if (serviceName === ServiceNames.COROSAPI) {
                return Promise.reject(new Error('COROS 500 API Error'));
            }
            return Promise.resolve();
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify COROS deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify local cleanup encountered error but TRIED to delete (COROS collection from config mock)
        // Note: Config mock returns 'mockCollection' for all calls currently
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should handle TokenNotFoundError gracefully', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Throw TokenNotFoundError for Suunto
        const tokenNotFoundError = new Error('No token found');
        tokenNotFoundError.name = 'TokenNotFoundError';
        deauthorizeServiceMock.mockRejectedValueOnce(tokenNotFoundError);

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should still process other services
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminAPI);
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should archive remaining tokens when they exist after deauthorization', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return some remaining tokens
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 2,
            docs: [
                { id: 'orphaned-token-1', data: () => ({ accessToken: 'tok1' }) },
                { id: 'orphaned-token-2', data: () => ({ accessToken: 'tok2' }) }
            ]
        });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify it called the correct collection
        expect(firestoreMock().collection).toHaveBeenCalledWith(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME);

        // Should have called set to archive the orphaned tokens
        // 3 services x 2 tokens each = 6 archive calls
        expect(setMock).toHaveBeenCalled();

        // Verify archive data structure
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            serviceName: expect.any(String),
            uid: 'testUser123',
            originalTokenId: expect.stringContaining('orphaned-token'),
            token: expect.any(Object),
            archivedAt: expect.any(Object),
            expireAt: expect.any(Object),
            lastError: expect.stringContaining('Cleanup: Token remained after deauthorization attempts')
        }));
    });

    it('should handle archive failure gracefully and continue cleanup', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return a remaining token
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [
                { id: 'failing-token', data: () => ({ accessToken: 'fail' }) }
            ]
        });

        // Make set fail for archiving
        setMock.mockRejectedValue(new Error('Firestore write failed'));

        // Should not throw, just log and continue
        await expect(wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext)).resolves.not.toThrow();

        // Should still call recursiveDelete
        expect(recursiveDeleteMock).toHaveBeenCalled();
    });

    it('should skip archiving when no tokens remain', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Tokens subcollection returns empty (default)
        tokensGetMock.mockResolvedValue({ empty: true, size: 0, docs: [] });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Set should NOT be called for archiving
        expect(setMock).not.toHaveBeenCalled();
    });

    it('should handle null email correctly and skip email query', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });
        // User without email - only uid query should run

        const getMock = vi.fn().mockResolvedValue({ docs: [] });
        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Should only query by toUids, not by email
        expect(whereMock).toHaveBeenCalledWith('toUids', 'array-contains', 'testUser123');
    });

    it('should log when no email documents found', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123', email: 'test@test.com' });

        // Both queries return empty
        const getMock = vi.fn().mockResolvedValue({ docs: [] });
        whereMock.mockReturnValue({ get: getMock });

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // No batch commit since no emails
        expect(batchMock.commit).not.toHaveBeenCalled();
    });
    it('should handle archiving with non-standard error and empty token data', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make tokens subcollection return a token with NO data (undefined data())
        tokensGetMock.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [
                { id: 'failing-token', data: () => undefined } // Returns undefined tokenData
            ]
        });

        // Make deauthorize fail with an object that has no message but has toString
        const weirdError = { toString: () => 'Weird Error Object' };
        deauthorizeServiceMock.mockRejectedValueOnce(weirdError);

        await wrapped(user, { eventId: 'eventId' } as unknown as functions.EventContext);

        // Verify set was called with the fallback error string and empty token object
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            token: {},
            lastError: 'Weird Error Object'
        }));
    });
});
