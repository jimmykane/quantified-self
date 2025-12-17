
import { describe, it, vi, expect, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
// We don't import the function directly because we need to mock its dependencies first if we were using require, 
// but since we are using modules, we rely on vi.mock. 
// However, typically to test onCall, we might use firebase-functions-test.
// But following the suunto example, let's see. 
// The suunto example tests an onRequest function. onCall is different.
// Ideally we use firebase-functions-test.

import firebaseFunctionsTest from 'firebase-functions-test';
const testEnv = firebaseFunctionsTest();

// Mock admin
vi.mock('firebase-admin', () => {
    const deleteUserMock = vi.fn();
    return {
        auth: () => ({
            deleteUser: deleteUserMock
        }),
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

// Mock utils
vi.mock('../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true)
}));

import { isCorsAllowed } from '../utils';
import { deleteSelf } from './user';

describe('deleteSelf Cloud Function', () => {

    afterEach(() => {
        testEnv.cleanup();
        vi.clearAllMocks();
    });

    it('should throw "failed-precondition" error if called without authentication', async () => {
        try {
            await (deleteSelf as any)({}, { auth: null });
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
            auth: {
                uid,
                token: {}
            }
        };

        const deleteUserMock = admin.auth().deleteUser as any; // Type assertion for mock
        deleteUserMock.mockResolvedValue();

        const result = await (deleteSelf as any)({}, context);

        expect(deleteUserMock).toHaveBeenCalledWith(uid);
        expect(result).toEqual({ success: true });
    });

    it('should throw "internal" error if deleteUser fails', async () => {
        const uid = 'test-uid';
        const context = {
            auth: {
                uid,
                token: {}
            }
        };

        const deleteUserMock = admin.auth().deleteUser as any;
        deleteUserMock.mockRejectedValue(new Error('Firebase Auth Error'));

        try {
            await (deleteSelf as any)({}, context);
        } catch (e: any) {
            expect(e.code).to.equal('internal');
            expect(e.message).to.equal('Unable to delete user');
        }
    });
});

