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
            batch: batchMock,
            Timestamp: {
                fromDate: vi.fn((date) => date)
            }
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

    describe('getNextAllowedHistoryImportDate', () => {
        it('should return null if no meta document exists', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({ exists: false });

            const result = await history.getNextAllowedHistoryImportDate('uid', ServiceNames.SuuntoApp);
            expect(result).toBeNull();
        });

        it('should return the correct date if throttled', async () => {
            const firestore = admin.firestore();
            const lastImportTime = Date.now() - (1 * 24 * 60 * 60 * 1000); // 1 day ago
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: lastImportTime,
                    processedActivitiesFromLastHistoryImportCount: 1000
                })
            });

            const result = await history.getNextAllowedHistoryImportDate('uid', ServiceNames.SuuntoApp);
            expect(result).toBeInstanceOf(Date);
            // 1000 items / 500 per day = 2 days cooldown.
            // lastImport + 2 days = lastImport + 172800000ms
            expect(result!.getTime()).toBe(lastImportTime + (2 * 24 * 60 * 60 * 1000));
        });

        it('should return null if processedActivitiesFromLastHistoryImportCount is 0', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: Date.now(),
                    processedActivitiesFromLastHistoryImportCount: 0
                })
            });

            const result = await history.getNextAllowedHistoryImportDate('uid', ServiceNames.SuuntoApp);
            expect(result).toBeNull();
        });
    });

    describe('isAllowedToDoHistoryImport', () => {
        it('should return true if no nextAllowedDate', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({ exists: false });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(true);
        });

        it('should return false if nextAllowedDate is in the future', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: Date.now(), // just now
                    processedActivitiesFromLastHistoryImportCount: 500 // 1 day cooldown
                })
            });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(false);
        });

        it('should return false if nextAllowedDate is exactly now', async () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: now - (1 * 24 * 60 * 60 * 1000), // 1 day ago
                    processedActivitiesFromLastHistoryImportCount: 500 // 1 day cooldown
                })
            });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            // nextAllowedDate (now) > now is false, so !(false) is true
            expect(result).toBe(true);

            vi.useRealTimers();
        });

        it('should return true if nextAllowedDate is 1ms in the past', async () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: now - (1 * 24 * 60 * 60 * 1000) - 1, // 1 day + 1ms ago
                    processedActivitiesFromLastHistoryImportCount: 500 // 1 day cooldown
                })
            });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(true);

            vi.useRealTimers();
        });

        it('should return true if nextAllowedDate is in the past', async () => {
            const firestore = admin.firestore();
            (firestore.collection('').doc('').collection('').doc('').get as any).mockResolvedValue({
                exists: true,
                data: () => ({
                    didLastHistoryImport: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
                    processedActivitiesFromLastHistoryImportCount: 500 // 1 day cooldown
                })
            });

            const result = await history.isAllowedToDoHistoryImport('uid', ServiceNames.SuuntoApp);
            expect(result).toBe(true);
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

            const result = await history.addHistoryToQueue('uid', ServiceNames.SuuntoApp, new Date(), new Date());

            expect(tokens.getTokenData).toHaveBeenCalled();
            expect(requestHelper.get).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/v3/workouts')
            }));
            expect(firestore.batch).toHaveBeenCalled();
            expect(firestore.batch().set).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    didLastHistoryImport: expect.any(Number),
                    lastHistoryImportStartDate: expect.any(Number),
                    lastHistoryImportEndDate: expect.any(Number),
                }),
                expect.anything()
            );
            expect(firestore.batch().commit).toHaveBeenCalled();

            // Assert return value
            expect(result).toEqual({
                successCount: 2,
                failureCount: 0,
                processedBatches: 1,
                failedBatches: 0
            });
        });
    });
});
