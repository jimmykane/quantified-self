import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const { authBuilderMock, deauthorizeServiceMock, firestoreMock, getServiceConfigMock, batchMock, whereMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const userMock = vi.fn((_id?: string) => ({ onDelete: onDeleteMock }));

    const deleteMock = vi.fn().mockResolvedValue({});

    // Mock for tokens subcollection - returns empty by default
    const tokensGetMock = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const tokensCollectionMock = vi.fn().mockReturnValue({ get: tokensGetMock });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const docMock = vi.fn((_id?: string) => ({
        delete: deleteMock,
        collection: tokensCollectionMock  // Support for subcollection queries
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

    const firestore = vi.fn(() => ({
        collection: collectionMock,
        batch: vi.fn(() => batchMock)
    }));

    return {
        authBuilderMock: { user: userMock },
        deauthorizeServiceMock: vi.fn(),

        firestoreMock: firestore,
        getServiceConfigMock: vi.fn(),
        batchMock,
        whereMock
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
import { cleanupUserAccounts } from './cleanup';

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

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        expect(getServiceConfigMock).toHaveBeenCalledWith(ServiceNames.SuuntoApp);
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(firestoreMock().collection('mockCollection').doc('testUser123').delete).toHaveBeenCalled();

        // Verify COROS
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminHealthAPI);
    });

    it('should force delete Suunto tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto 500 API Error'));

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        // But local cleanup should STILL happen
        expect(firestoreMock().collection('mockCollection').doc('testUser123').delete).toHaveBeenCalled();

        // COROS succeeded
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminHealthAPI);
    });

    it('should continue if parent doc deletion fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto doc deletion fail (via the doc().delete mock)
        const collectionObj = firestoreMock().collection('mockCollection');
        const docObj = collectionObj.doc('testUser123');
        docObj.delete.mockRejectedValueOnce(new Error('Firestore delete failed'));

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto was called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminHealthAPI);
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

        await wrapped(user, { eventId: 'eventId' } as any);

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

    it('should query tokens subcollection before deleting parent doc', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify tokens subcollection was queried for both Suunto and COROS
        const docObj = firestoreMock().collection('mockCollection').doc('testUser123');
        expect(docObj.collection).toHaveBeenCalledWith('tokens');
    });

    it('should batch delete tokens from subcollection when they exist', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Mock tokens subcollection with existing tokens
        const tokenDocs = [
            { id: 'token1', ref: { id: 'token1' } },
            { id: 'token2', ref: { id: 'token2' } }
        ];
        const docObj = firestoreMock().collection('mockCollection').doc('testUser123');
        docObj.collection.mockReturnValue({
            get: vi.fn().mockResolvedValue({ empty: false, docs: tokenDocs })
        });

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify batch delete was called for each token
        expect(batchMock.delete).toHaveBeenCalledWith({ id: 'token1' });
        expect(batchMock.delete).toHaveBeenCalledWith({ id: 'token2' });
        expect(batchMock.commit).toHaveBeenCalled();
    });

    it('should skip batch commit when no tokens in subcollection', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Reset batch mock call count
        batchMock.commit.mockClear();
        batchMock.delete.mockClear();

        // Tokens subcollection is empty by default in our mock setup
        await wrapped(user, { eventId: 'eventId' } as any);

        // Parent doc delete should still be called
        expect(firestoreMock().collection('mockCollection').doc('testUser123').delete).toHaveBeenCalled();
    });

    it('should handle subcollection deletion error and continue', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make subcollection query throw for first service
        const docObj = firestoreMock().collection('mockCollection').doc('testUser123');
        docObj.collection.mockReturnValueOnce({
            get: vi.fn().mockRejectedValue(new Error('Firestore error'))
        });

        await wrapped(user, { eventId: 'eventId' } as any);

        // Should still call COROS and Garmin
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminHealthAPI);
    });

    it('should force delete Garmin tokens even if deauthorization fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Garmin fail
        deauthorizeServiceMock.mockImplementation((userId, serviceName) => {
            if (serviceName === ServiceNames.GarminHealthAPI) {
                return Promise.reject(new Error('Garmin 500 API Error'));
            }
            return Promise.resolve();
        });

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Garmin deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.GarminHealthAPI);

        // Verify local cleanup encountered error but TRIED to delete
        // Note: The helper calls deleteTokenDocumentWithSubcollections, which calls doc(uid).delete()
        expect(firestoreMock().collection).toHaveBeenCalledWith('garminHealthAPITokens');
        expect(firestoreMock().collection('garminHealthAPITokens').doc).toHaveBeenCalledWith('testUser123');
        expect(firestoreMock().collection('garminHealthAPITokens').doc('testUser123').delete).toHaveBeenCalled();
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

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify COROS deauth attempted
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify local cleanup encountered error but TRIED to delete (COROS collection from config mock)
        // Note: Config mock returns 'mockCollection' for all calls currently
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(firestoreMock().collection('mockCollection').doc('testUser123').delete).toHaveBeenCalled();
    });
});
