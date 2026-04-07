import { describe, it, vi, expect, afterEach, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import firebaseFunctionsTest from 'firebase-functions-test';

const {
    deleteUserMock,
    getUserMock,
    mailSetMock,
    mailDocMock,
    deletionMarkerSetMock,
    deletionMarkerDeleteMock,
    deletionMarkerDocMock,
    firestoreCollectionMock,
    loggerInfoMock,
    loggerWarnMock,
    loggerErrorMock
} = vi.hoisted(() => {
    const mailSetMock = vi.fn().mockResolvedValue(undefined);
    const mailDocMock = vi.fn((_id?: string) => ({
        set: mailSetMock
    }));
    const deletionMarkerSetMock = vi.fn().mockResolvedValue(undefined);
    const deletionMarkerDeleteMock = vi.fn().mockResolvedValue(undefined);
    const deletionMarkerDocMock = vi.fn((_id?: string) => ({
        set: deletionMarkerSetMock,
        delete: deletionMarkerDeleteMock
    }));
    const firestoreCollectionMock = vi.fn((name?: string) => {
        if (name === 'mail') {
            return {
                doc: mailDocMock
            };
        }

        if (name === 'userDeletionTombstones') {
            return {
                doc: deletionMarkerDocMock
            };
        }

        return {
            doc: vi.fn()
        };
    });

    return {
        deleteUserMock: vi.fn().mockResolvedValue(undefined),
        getUserMock: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        mailSetMock,
        mailDocMock,
        deletionMarkerSetMock,
        deletionMarkerDeleteMock,
        deletionMarkerDocMock,
        firestoreCollectionMock,
        loggerInfoMock: vi.fn(),
        loggerWarnMock: vi.fn(),
        loggerErrorMock: vi.fn()
    };
});

const testEnv = firebaseFunctionsTest();

// Mock admin
vi.mock('firebase-admin', () => {
    const firestoreMock = Object.assign(vi.fn(() => ({
        collection: firestoreCollectionMock
    })), {
        Timestamp: {
            fromDate: vi.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }))
        },
        FieldValue: {
            serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP')
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
        deletionMarkerSetMock.mockResolvedValue(undefined);
        deletionMarkerDeleteMock.mockResolvedValue(undefined);
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
        expect(admin.firestore().collection).toHaveBeenCalledWith('userDeletionTombstones');
        expect(deletionMarkerDocMock).toHaveBeenCalledWith(uid);
        expect(deletionMarkerSetMock).toHaveBeenCalledWith({
            createdAt: 'SERVER_TIMESTAMP',
            source: 'deleteSelf',
            expireAt: expect.any(Object)
        }, { merge: true });
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

    it('should continue deleting the user if writing the deletion marker fails', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };

        const markerError = new Error('Marker write failed');
        deletionMarkerSetMock.mockRejectedValueOnce(markerError);

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(loggerErrorMock).toHaveBeenCalledWith(
            `Failed to write user deletion marker for ${uid}. Continuing with deletion.`,
            markerError
        );
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

    it('should return success if auth user is already deleted', async () => {
        const uid = 'test-uid';
        const context = {
            rawRequest: {},
            auth: {
                uid,
                token: {}
            },
            app: { appId: 'mock-app-id' }
        };
        const userNotFoundError = {
            errorInfo: {
                code: 'auth/user-not-found',
                message: 'There is no user record corresponding to the provided identifier.'
            }
        };
        getUserMock.mockRejectedValueOnce(userNotFoundError);
        deleteUserMock.mockRejectedValueOnce(userNotFoundError);

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(mailSetMock).not.toHaveBeenCalled();
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

        expect(deletionMarkerDeleteMock).toHaveBeenCalledTimes(1);
    });
});
