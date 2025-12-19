import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as utils from '../utils';
import * as requestHelper from '../request-helper';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock dependencies
vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const setMock = vi.fn().mockResolvedValue({});
    const docMock = vi.fn(() => ({
        get: getMock,
        set: setMock,
        collection: vi.fn(() => ({ doc: docMock }))
    }));
    const collectionMock = vi.fn(() => ({
        doc: docMock
    }));
    return {
        firestore: () => ({
            collection: collectionMock
        })
    };
});

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
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    getUserIDFromFirebaseToken: vi.fn().mockResolvedValue('testUserID')
}));

vi.mock('../request-helper', () => ({
    get: vi.fn()
}));

vi.mock('./auth/auth', () => ({
    GarminHealthAPIAuth: vi.fn(() => ({
        authorize: vi.fn().mockReturnValue({}),
        toHeader: vi.fn().mockReturnValue({})
    }))
}));

// Import AFTER mocks
import { backfillHealthAPIActivities } from './backfill';

describe('Garmin Backfill', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');

        req = {
            method: 'POST',
            body: {
                startDate: '2023-01-01',
                endDate: '2023-01-10'
            }
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
        };
    });

    describe('backfillHealthAPIActivities', () => {
        it('should trigger backfill and return 200', async () => {
            // Mock meta data (no previous import)
            const firestore = admin.firestore();
            (firestore.collection('users').doc('uid').collection('meta').doc('id').get as any).mockResolvedValue({ exists: false });
            // Mock tokens
            (firestore.collection('garminHealthAPITokens').doc('uid').get as any).mockResolvedValue({
                data: () => ({ accessToken: 't', accessTokenSecret: 's' })
            });

            await backfillHealthAPIActivities(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(requestHelper.get).toHaveBeenCalled();
        });

        it('should return 403 if throttled', async () => {
            const firestore = admin.firestore();
            // Mock recent import (1 day ago)
            (firestore.collection('users').doc('uid').collection('meta').doc('id').get as any).mockResolvedValue({
                exists: true,
                data: () => ({ didLastHistoryImport: Date.now() - (1 * 24 * 60 * 60 * 1000) })
            });

            await backfillHealthAPIActivities(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith(expect.stringContaining('History import cannot happen'));
        });

        it('should batch requests if range > 90 days', async () => {
            req.body = {
                startDate: '2023-01-01',
                endDate: '2023-04-10' // > 90 days (roughly 100 days)
            };
            const firestore = admin.firestore();
            (firestore.collection('users').doc('uid').collection('meta').doc('id').get as any).mockResolvedValue({ exists: false });
            (firestore.collection('garminHealthAPITokens').doc('uid').get as any).mockResolvedValue({
                data: () => ({ accessToken: 't', accessTokenSecret: 's' })
            });

            await backfillHealthAPIActivities(req, res);

            // Should call twice because 100 days > 90 days
            expect(requestHelper.get).toHaveBeenCalledTimes(2);
        });

        it('should return 500 if dates are invalid', async () => {
            req.body = { startDate: '2023-01-10', endDate: '2023-01-01' }; // Start after End

            await backfillHealthAPIActivities(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.send).toHaveBeenCalledWith('Start date if after the end date');
        });
    });
});
