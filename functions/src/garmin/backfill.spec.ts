import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as requestHelper from '../request-helper';
import { backfillGarminAPIActivities } from './backfill';
import * as utils from '../utils';

// Simple, robust mock setup
const getMock = vi.fn();
const setMock = vi.fn();
const limitMock = vi.fn();
const docMock = vi.fn();
const collectionMock = vi.fn();

// Chainable query object
const queryObj = {
    limit: limitMock,
    get: getMock,
    where: vi.fn().mockReturnThis(),
};

// Document object
const docObj = {
    collection: collectionMock,
    get: getMock,
    set: setMock,
};

// Collection object
const collectionObj = {
    doc: docMock,
    limit: limitMock,
    where: vi.fn().mockReturnThis()
};

// Wiring
limitMock.mockReturnValue(queryObj); // limit() -> query
docMock.mockReturnValue(docObj); // doc() -> doc
collectionMock.mockReturnValue(collectionObj); // collection() -> collection

vi.mock('firebase-admin', () => ({
    firestore: () => ({
        collection: collectionMock,
        collectionGroup: vi.fn() // added collectionGroup if needed
    })
}));

vi.mock('firebase-functions/v1', async () => {
    const actual = await vi.importActual('firebase-functions/v1');
    return {
        ...actual,
        region: () => ({
            runWith: () => ({
                https: {
                    onCall: (handler: any) => handler,
                    onRequest: (handler: any) => handler
                }
            })
        })
    };
});

vi.mock('../utils', () => ({
    getUserIDFromFirebaseToken: vi.fn(),
    isProUser: vi.fn(),
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

vi.mock('../request-helper', () => ({
    get: vi.fn()
}));

vi.mock('./auth/auth', () => ({
    GarminAPIAuth: vi.fn()
}));

// Mock getTokenData for auto-refresh
vi.mock('../tokens', () => ({
    getTokenData: vi.fn()
}));

import * as tokens from '../tokens';

describe('Garmin Backfill', () => {
    let context: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Default util mocks
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');
        (utils.isProUser as any).mockResolvedValue(true);

        // Mock getTokenData to return a valid token
        (tokens.getTokenData as any).mockResolvedValue({
            accessToken: 'valid-access-token',
            refreshToken: 'valid-refresh-token',
            userID: 'garmin-user-123',
            permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT']
        });

        // Reset default mock returns
        limitMock.mockReturnValue(queryObj);
        docMock.mockReturnValue(docObj);
        collectionMock.mockReturnValue(collectionObj);

        // Specific Logic for Collection chaining
        collectionMock.mockImplementation((name: string) => {
            if (name === 'garminAPITokens') {
                return {
                    doc: vi.fn().mockReturnValue({ // .doc(uid)
                        collection: vi.fn().mockReturnValue({ // .collection(tokens)
                            limit: vi.fn().mockReturnValue({ // .limit(1)
                                get: vi.fn().mockResolvedValue({ // .get() -> tokens
                                    empty: false,
                                    docs: [{ data: () => ({ accessToken: 't', refreshToken: 'r', userID: 'u' }), id: 'tokenId', ref: { parent: { parent: { id: 'u' } } } }]
                                })
                            })
                        }),
                        get: getMock // Fallback if old code used it
                    })
                };
            }
            if (name === 'users') {
                return {
                    doc: vi.fn().mockReturnValue({ // .doc(uid)
                        collection: vi.fn().mockImplementation((subName) => { // .collection(meta)
                            if (subName === 'meta') {
                                return {
                                    doc: vi.fn().mockReturnValue({ // .doc(id)
                                        get: vi.fn().mockResolvedValue({ exists: false }), // Default: meta not found
                                        set: setMock
                                    })
                                };
                            }
                            return collectionObj;
                        })
                    })
                };
            }
            return collectionObj; // Fallback
        });

        context = {
            auth: { uid: 'testUserID' },
            app: { appId: 'testAppId' }
        };
    });

    it('should trigger backfill and return void on success', async () => {
        const data = { startDate: '2023-01-01', endDate: '2023-01-10' };

        await (backfillGarminAPIActivities as any)(data, context);

        expect(requestHelper.get).toHaveBeenCalled();
        // onCall functions return data directly or void, status is handled by framework
        // We verify side effects (setMock for updating timestamp)
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            didLastHistoryImport: expect.any(Number),
            lastHistoryImportStartDate: expect.any(Number),
            lastHistoryImportEndDate: expect.any(Number),
        }));
    });

    it('should throw failed-precondition if app is undefined', async () => {
        context.app = undefined;
        const data = { startDate: '2023-01-01', endDate: '2023-01-10' };
        await expect((backfillGarminAPIActivities as any)(data, context)).rejects.toThrow('The function must be called from an App Check verified app.');
    });

    it('should throw unauthenticated if auth is undefined', async () => {
        context.auth = undefined;
        const data = { startDate: '2023-01-01', endDate: '2023-01-10' };
        await expect((backfillGarminAPIActivities as any)(data, context)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw permission-denied if throttled', async () => {
        // Override for throttling
        collectionMock.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    doc: vi.fn().mockReturnValue({
                        collection: vi.fn().mockReturnValue({
                            doc: vi.fn().mockReturnValue({
                                get: vi.fn().mockResolvedValue({
                                    exists: true,
                                    data: () => ({ didLastHistoryImport: Date.now() }) // Recently imported
                                })
                            })
                        })
                    })
                };
            }
            if (name === 'garminAPITokens') return collectionObj; // fallback for tokens lookups that happen later
            return collectionObj;
        });

        const data = { startDate: '2023-01-01', endDate: '2023-01-10' };
        await expect((backfillGarminAPIActivities as any)(data, context)).rejects.toThrow('History import cannot happen');
    });

    it('should batch requests if range > 90 days', async () => {
        const data = { startDate: '2023-01-01', endDate: '2023-04-10' };

        // We rely on the default mock implementation in beforeEach which has valid tokens/meta

        await (backfillGarminAPIActivities as any)(data, context);
        expect(requestHelper.get).toHaveBeenCalledTimes(2);
    });

    it('should throw already-exists if Garmin returns Conflict', async () => {
        const error: any = new Error('Duplicate backfill detected');
        error.message = 'Duplicate backfill detected'; // Matches code check
        error.statusCode = 409;
        (requestHelper.get as any).mockRejectedValue(error);

        const data = { startDate: '2023-01-01', endDate: '2023-01-10' };
        // The implementation wraps errors. e.statusCode=409 -> throws 'Duplicate backfill detected...'
        // then the onCall wrapper catches it and rethrows HttpsError('already-exists', ...)

        await expect((backfillGarminAPIActivities as any)(data, context)).rejects.toThrow('Duplicate backfill detected');
    });

    it('should throw invalid-argument if start date is after end date', async () => {
        const data = { startDate: '2023-01-10', endDate: '2023-01-01' };
        await expect((backfillGarminAPIActivities as any)(data, context))
            .rejects.toThrow('Start date if after the end date');
    });

    it('should skip invalid batches (400) and continue with other batches', async () => {
        const data = { startDate: '2023-01-01', endDate: '2023-06-01' }; // > 90 days, at least 2 batches

        // Mock requestHelper.get to fail with 400 for the first call and succeed for the rest
        const garminError: any = {
            statusCode: 400,
            error: {
                error: {
                    errorMessage: 'start date before min start time'
                }
            }
        };

        (requestHelper.get as any)
            .mockRejectedValueOnce(garminError)
            .mockResolvedValueOnce({ success: true });

        await (backfillGarminAPIActivities as any)(data, context);

        // Should have called get twice (for 2 batches)
        expect(requestHelper.get).toHaveBeenCalledTimes(2);
    });
});
