
import functionsTest from 'firebase-functions-test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoist mocks
const { authBuilderMock, deauthorizeServiceMock, deauthorizeGarminMock } = vi.hoisted(() => {
    const onDeleteMock = vi.fn((handler) => handler);
    const userMock = vi.fn(() => ({ onDelete: onDeleteMock }));

    return {
        authBuilderMock: { user: userMock },
        deauthorizeServiceMock: vi.fn(),
        deauthorizeGarminMock: vi.fn(),
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => ({
    auth: authBuilderMock,
    region: vi.fn().mockImplementation(() => ({
        auth: authBuilderMock
    })),
}));

// Mock oauth wrappers
vi.mock('../OAuth2', () => ({
    deauthorizeServiceForUser: deauthorizeServiceMock
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
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should attempt to deauthorize all services for a deleted user', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto deauthorization
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS deauthorization
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin deauthorization
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });

    it('should continue despite errors in one service', async () => {
        const wrapped = cleanupUserAccounts;
        const user = testEnv.auth.makeUserRecord({ uid: 'testUser123' });

        // Make Suunto fail
        deauthorizeServiceMock.mockRejectedValueOnce(new Error('Suunto failed'));

        await wrapped(user, { eventId: 'eventId' } as any);

        // Verify Suunto was called (and failed)
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.SuuntoApp);

        // Verify COROS was still called
        expect(deauthorizeServiceMock).toHaveBeenCalledWith('testUser123', ServiceNames.COROSAPI);

        // Verify Garmin was still called
        expect(deauthorizeGarminMock).toHaveBeenCalledWith('testUser123');
    });
});
