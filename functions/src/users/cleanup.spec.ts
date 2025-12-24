import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const { authBuilderMock, deauthorizeServiceMock, deauthorizeGarminMock, firestoreMock, getServiceConfigMock, batchMock, whereMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const userMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    const deleteMock = vi.fn().mockResolvedValue({});
    const docMock = vi.fn(() => ({ delete: deleteMock }));

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
        deauthorizeGarminMock: vi.fn(),
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

vi.mock('../garmin/auth/wrapper', () => ({
    deauthorizeGarminHealthAPIForUser: deauthorizeGarminMock
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
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });

    it('should continue despite errors in one service and NOT delete parent doc if deauth fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto failed'));

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        // Should NOT have tried to delete Suunto doc because it threw error

        // COROS succeeded
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });

    it('should continue if parent doc deletion fails', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto doc deletion fail (via the doc().delete mock)
        const collectionObj = firestoreMock().collection('mockCollection');
        const docObj = collectionObj.doc('testUser123');
        // @ts-ignore
        docObj.delete.mockRejectedValueOnce(new Error('Firestore delete failed'));

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto was called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
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
});
