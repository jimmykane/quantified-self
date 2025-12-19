import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as history from './history';
import * as tokens from './tokens';
import * as requestHelper from './request-helper';
import * as oauth2 from './OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock dependencies
vi.mock('firebase-admin', () => {
    const batchSetMock = vi.fn().mockReturnThis();
    const batchCommitMock = vi.fn().mockResolvedValue({});
    const batchMock = vi.fn(() => ({
        set: batchSetMock,
        commit: batchCommitMock
    }));

    const getMock = vi.fn();
    const collectionMock = vi.fn();
    const docMock = vi.fn(() => ({
        get: getMock,
        collection: collectionMock
    }));
    collectionMock.mockReturnValue({
        doc: docMock,
        get: vi.fn().mockResolvedValue({
            size: 1,
            docs: [{ id: 'token1' }]
        })
    });

    return {
        firestore: Object.assign(() => ({
            collection: collectionMock,
            batch: batchMock
        }), {
            batch: batchMock
        })
    };
});

vi.mock('./tokens', () => ({
    getTokenData: vi.fn().mockResolvedValue({ accessToken: 'testToken', userName: 'testUser' })
}));

// We use the real request-helper but we need it to be unmocked if test-setup mocks it
vi.unmock('./request-helper');
vi.mock('./request-helper', () => ({
    get: vi.fn(),
    default: {
        get: vi.fn()
    }
}));

vi.mock('./utils', () => ({
    generateIDFromParts: vi.fn().mockReturnValue('mockID')
}));

vi.mock('./OAuth2', () => ({
    getServiceConfig: vi.fn().mockReturnValue({ tokenCollectionName: 'tokens' })
}));

describe('history', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isAllowedToDoHistoryImport', () => {
        it('should return true if no meta document exists', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({ exists: false });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(true);
        });

        it('should return false if throttled', async () => {
            const firestore = admin.firestore();
            // 1000 items processed, 3 days needed? 
            // Logic: data.didLastHistoryImport + ((data.processedActivitiesFromLastHistoryImportCount / 500) * 24 * 60 * 60 * 1000)
            // If count = 1000, then (1000/500) = 2 days.
            // If last import was 1 day ago, it should be false.
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: Date.now() - (1 * 24 * 60 * 60 * 1000), // 1 day ago
                    processedActivitiesFromLastHistoryImportCount: 1000
                })
            });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(false);
        });
    });

    describe('addHistoryToQueue', () => {
        it('should fetch workouts and commit in batches', async () => {
            const firestore = admin.firestore();
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                payload: [
                    { workoutKey: 'w1' },
                    { workoutKey: 'w2' }
                ]
            }));

            await history.addHistoryToQueue('uid', ServiceNames.SuuntoApp, new Date(), new Date());

            expect(tokens.getTokenData).toHaveBeenCalled();
            expect(requestHelper.get).toHaveBeenCalled();
            expect(firestore.batch).toHaveBeenCalled();
            expect(firestore.batch().commit).toHaveBeenCalled();
        });
    });
});
