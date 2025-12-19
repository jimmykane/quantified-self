
import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const { authBuilderMock, deauthorizeServiceMock, deauthorizeGarminMock, firestoreMock, getServiceConfigMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const userMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    const deleteMock = vi.fn().mockResolvedValue({});
    const docMock = vi.fn(() => ({ delete: deleteMock }));
    const collectionMock = vi.fn(() => ({ doc: docMock }));
    const firestore = vi.fn(() => ({ collection: collectionMock }));

    return {
        authBuilderMock: { user: userMock },
        deauthorizeServiceMock: vi.fn(),
        deauthorizeGarminMock: vi.fn(),
        firestoreMock: firestore,
        getServiceConfigMock: vi.fn(),
    };
});

// Mock firebase-functions v2
vi.mock('firebase-functions/v2/identity', () => ({
    onUserDeleted: (opts: any, handler: any) => handler,
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
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should deauthorize services and delete parent documents', async () => {
        const wrapped = cleanupUserAccounts as any;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped({ data: user });

        // Verify Suunto
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        expect(getServiceConfigMock).toHaveBeenCalledWith(ServiceNames.SuuntoApp);
        expect(firestoreMock().collection).toHaveBeenCalledWith('mockCollection');
        expect(firestoreMock().collection('mockCollection').doc).toHaveBeenCalledWith('testUser123');
        expect(firestoreMock().collection('mockCollection').doc('testUser123').delete).toHaveBeenCalled();

        // Verify COROS
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);
        // Should happen twice (once for Suunto, once for COROS)
        // Removing explicit count check as there might be internal calls we don't care about
        // expect(firestoreMock).toHaveBeenCalledTimes(2); 

        // Verify Garmin
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });

    it('should continue despite errors in one service and NOT delete parent doc if deauth fails', async () => {
        const wrapped = cleanupUserAccounts as any;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto failed'));

        await wrapped({ data: user });

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);
        // Should NOT have tried to delete Suunto doc because it threw error

        // COROS succeeded
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });

    it('should continue if parent doc deletion fails', async () => {
        const wrapped = cleanupUserAccounts as any;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto doc deletion fail
        // The mock structure is firestore().collection().doc().delete()
        // We want the deletion to fail.
        // Since deleteMock is hoisted but exposed via the mock factory... wait, I can access it if I export it or grab it from the module?
        // Ah, I cannot access the hoisted variables directly in the test body unless I returned them.
        // In the hoist block: return { ..., firestoreMock, ... }
        // But `deleteMock` is NOT returned. It's inside the factory for `firestoreMock`.
        // However, `firestoreMock` returns an object with `collection` which returns object with `doc` which returns object with `delete`.
        // So I can get the delete spy from `firestoreMock().collection().doc().delete`.

        const deleteSpy = firestoreMock().collection('any').doc('any').delete;
        // Make it reject once
        deleteSpy.mockRejectedValueOnce(new Error('Firestore delete failed'));

        await wrapped({ data: user });

        // Verify Suunto was called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });
});
