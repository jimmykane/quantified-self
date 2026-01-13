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
        collection: collectionMock
    })
}));

vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        runWith: () => ({
            https: {
                onRequest: (handler: any) => handler
            }
        })
    })
}));

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
    let req: any;
    let res: any;

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
                                    docs: [{ data: () => ({ accessToken: 't', refreshToken: 'r', userID: 'u' }) }]
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
                                        get: vi.fn().mockResolvedValue({ exists: false }) // Default: meta not found
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

        req = {
            method: 'POST',
            body: { startDate: '2023-01-01', endDate: '2023-01-10' }
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
        };
    });

    it('should trigger backfill and return 200', async () => {
        await backfillGarminAPIActivities(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(requestHelper.get).toHaveBeenCalled();
    });

    it('should return 403 if throttled', async () => {
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
            return collectionObj; // Need to ensure tokens still work? 
            // The code pulls user ID first, then tokens.
            // If we only override users, others might default to 'collectionObj' return from TOP level mock.
            // But we overwrote the implementation!
            // We must support 'garminAPITokens' too.
        });

        // Wait, rewriting implementation entirely is risky. 
        // Better to use stateful mocks or distinct spies.
        // But for this test, if it fails throttling, it never reaches tokens.

        await backfillGarminAPIActivities(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should batch requests if range > 90 days', async () => {
        req.body = { startDate: '2023-01-01', endDate: '2023-04-10' };

        // Restore default implementation (set in beforeEach) which has valid tokens
        // But we need to verify 'garminAPITokens' works.
        // beforeEach sets it up.

        await backfillGarminAPIActivities(req, res);
        expect(requestHelper.get).toHaveBeenCalledTimes(2);
    });

    it('should return 409 if Garmin returns Conflict', async () => {
        const error: any = new Error('Conflict');
        error.statusCode = 409;
        (requestHelper.get as any).mockRejectedValue(error);

        await backfillGarminAPIActivities(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
    });
});
