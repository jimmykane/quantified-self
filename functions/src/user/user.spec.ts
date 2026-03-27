import { describe, it, vi, expect, afterEach, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import firebaseFunctionsTest from 'firebase-functions-test';

const {
    deleteUserMock,
    getUserMock,
    mailSetMock,
    mailDocMock,
    mailCollectionMock,
    loggerInfoMock,
    loggerWarnMock,
    loggerErrorMock
} = vi.hoisted(() => {
    const mailSetMock = vi.fn().mockResolvedValue(undefined);
    const mailDocMock = vi.fn((_id?: string) => ({
        set: mailSetMock
    }));
    const mailCollectionMock = vi.fn((_name?: string) => ({
        doc: mailDocMock
    }));

    return {
        deleteUserMock: vi.fn().mockResolvedValue(undefined),
        getUserMock: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        mailSetMock,
        mailDocMock,
        mailCollectionMock,
        loggerInfoMock: vi.fn(),
        loggerWarnMock: vi.fn(),
        loggerErrorMock: vi.fn()
    };
});

const testEnv = firebaseFunctionsTest();

// Mock admin
vi.mock('firebase-admin', () => {
    const firestoreMock = Object.assign(vi.fn(() => ({
        collection: mailCollectionMock
    })), {
        Timestamp: {
            fromDate: vi.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }))
        }
    });

    return {
        auth: () => ({
            deleteUser: deleteUserMock,
            getUser: getUserMock
        }),
        firestore: firestoreMock,
        initializeApp: vi.fn(),
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => {
    return {
        runWith: () => ({
            region: () => ({
                https: {
                    onCall: (handler: any) => handler
                }
            })
        }),
        config: () => ({}),
        https: {
            HttpsError: class extends Error {
                code: string;
                constructor(code: string, message: string, details?: any) {
                    super(message);
                    this.code = code;
                }
            }
        }
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock
}));

// Mock utils
vi.mock('../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true)
}));

import { isCorsAllowed } from '../utils';
import { deleteSelf } from './user';

describe('deleteSelf Cloud Function', () => {
    beforeEach(() => {
        deleteUserMock.mockResolvedValue(undefined);
        getUserMock.mockResolvedValue({ email: 'test@example.com' });
        mailSetMock.mockResolvedValue(undefined);
    });

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should throw "failed-precondition" error if called without authentication', async () => {
        try {
            await (deleteSelf as any)({}, { rawRequest: {}, auth: null });
            // Should fail
        } catch (e: any) {
            expect(e.code).to.equal('failed-precondition');
            expect(e.message).to.equal('The function must be called while authenticated.');
        }
    });

    it('should throw "failed-precondition" error if CORS is not allowed', async () => {
        (isCorsAllowed as any).mockReturnValue(false);
        try {
            await (deleteSelf as any)({}, { rawRequest: {} });
        } catch (e: any) {
            expect(e.code).to.equal('failed-precondition');
            expect(e.message).to.equal('The function must be called from an allowed origin.');
        }
        (isCorsAllowed as any).mockReturnValue(true); // Reset
    });

    it('should successfully delete the authenticated user', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(getUserMock).toHaveBeenCalledWith(uid);
        expect(admin.firestore().collection).toHaveBeenCalledWith('mail');
        expect(mailDocMock).toHaveBeenCalledWith(`account_deleted_confirmation_${uid}`);
        expect(mailSetMock).toHaveBeenCalledWith(expect.objectContaining({
            to: 'test@example.com',
            from: 'Quantified Self <hello@quantified-self.io>',
            template: {
                name: 'account_deleted_confirmation',
                data: {}
            },
            expireAt: expect.any(Object)
        }));
        expect(result).toEqual({ success: true });
    });

    it('should skip confirmation email when user has no email', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };

        getUserMock.mockResolvedValue({ email: undefined });

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(mailSetMock).not.toHaveBeenCalled();
        expect(loggerInfoMock.mock.calls.some(([message]) =>
            typeof message === 'string' &&
            message.includes('Skipping account deletion confirmation email')
        )).toBe(true);
        expect(result).toEqual({ success: true });
    });

    it('should return success even when queuing confirmation email fails', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };

        const mailError = new Error('Mail queue write failed');
        mailSetMock.mockRejectedValueOnce(mailError);

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(mailSetMock).toHaveBeenCalled();
        expect(loggerErrorMock).toHaveBeenCalledWith(
            `Failed to queue account deletion confirmation email for user: ${uid}`,
            mailError
        );
        expect(result).toEqual({ success: true });
    });

    it('should throw "internal" error if deleteUser fails', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };

        deleteUserMock.mockRejectedValue(new Error('Firebase Auth Error'));

        try {
            await (deleteSelf as any)({}, context);
        } catch (e: any) {
            expect(e.code).to.equal('internal');
            expect(e.message).to.equal('Unable to delete user');
        }
    });
});
