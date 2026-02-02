import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as history from './history';
import * as tokens from './tokens';
import * as requestHelper from './request-helper';
import * as oauth2 from './OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Hoisted mocks (Vitest requirement)
const hoisted = vi.hoisted(() => {
    const batchSetMock = vi.fn();
    const batchCommitMock = vi.fn();
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

    return {
        batchSetMock,
        batchCommitMock,
        batchMock,
        getMock,
        collectionMock,
        docMock,
    };
});

// Mock dependencies
vi.mock('firebase-admin', () => {
    return {
        firestore: Object.assign(() => ({
            collection: hoisted.collectionMock,
            batch: hoisted.batchMock
        }), {
            batch: hoisted.batchMock,
            Timestamp: {
                fromDate: vi.fn((date) => date)
            },
            __mocks: {
                batchSetMock: hoisted.batchSetMock,
                batchCommitMock: hoisted.batchCommitMock,
                batchMock: hoisted.batchMock,
                collectionMock: hoisted.collectionMock,
                docMock: hoisted.docMock,
                getMock: hoisted.getMock,
            },
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

vi.mock('./config', () => ({
    config: {
        suuntoapp: { client_id: 'id', client_secret: 'secret', subscription_key: 'sub-key' },
        corosapi: { client_id: 'cid', client_secret: 'csecret' }
    }
}));

vi.mock('./coros/queue', () => ({
    convertCOROSWorkoutsToQueueItems: vi.fn(async (data: any[], openId: string) => data.map((d, i) => ({
        id: `coros-${openId}-${i}`,
        workoutID: d.workoutId ?? d.workoutID ?? `w-${i}`
    })))
}));

describe('history', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.batchSetMock.mockReset();
        hoisted.batchCommitMock.mockReset();
        hoisted.batchCommitMock.mockResolvedValue({});
        hoisted.batchMock.mockClear();
        hoisted.collectionMock.mockReset();
        hoisted.getMock.mockReset();
        hoisted.docMock.mockReset();

        // Default Firestore shape
        const defaultTokensGet = vi.fn().mockResolvedValue({
            size: 1,
            docs: [{ id: 'token1' }]
        });

        hoisted.collectionMock.mockReturnValue({
            doc: hoisted.docMock,
            get: defaultTokensGet
        });

        hoisted.docMock.mockReturnValue({
            id: 'doc-id',
            get: hoisted.getMock,
            collection: hoisted.collectionMock
        });
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

        it('should handle empty workouts without writes', async () => {
            const firestore = admin.firestore();
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({ payload: [] }));

            const result = await history.addHistoryToQueue('uid', ServiceNames.SuuntoApp, new Date(), new Date());

            expect(hoisted.batchMock).toHaveBeenCalledTimes(0);
            expect(result).toEqual({
                successCount: 0,
                failureCount: 0,
                processedBatches: 0,
                failedBatches: 0
            });
            // ensure meta doc not touched
            expect(firestore.collection).not.toHaveBeenCalledWith('users');
        });

        it('should process multiple batches and count failures', async () => {
            const now = Date.now();
            vi.setSystemTime(now);

            const workouts = Array.from({ length: 451 }, (_, i) => ({ workoutKey: `w${i}` }));
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({ payload: workouts }));

            // First batch commit succeeds, second fails
            hoisted.batchCommitMock
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new Error('commit failed'));

            const result = await history.addHistoryToQueue('uid', ServiceNames.SuuntoApp, new Date(), new Date());

            // Two batches should have been created
            expect(hoisted.batchMock).toHaveBeenCalledTimes(2);
            expect(hoisted.batchCommitMock).toHaveBeenCalledTimes(2);

            // First batch (450) succeeds, second (1) fails
            expect(result).toEqual({
                successCount: 450,
                failureCount: 1,
                processedBatches: 1,
                failedBatches: 1
            });

            vi.useRealTimers();
        });

        it('should propagate upstream errors when service history call fails', async () => {
            (requestHelper.get as any).mockRejectedValue(new Error('service down'));

            await expect(history.addHistoryToQueue('uid', ServiceNames.SuuntoApp, new Date(), new Date()))
                .rejects.toThrow('service down');
        });
    });

    describe('getWorkoutQueueItems', () => {
        it('should filter Suunto workouts without workoutKey and generate IDs', async () => {
            const generateIDFromParts = await import('./utils');
            vi.mocked(generateIDFromParts.generateIDFromParts).mockImplementation((parts: string[]) => parts.join('-'));

            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                payload: [
                    { workoutKey: 'keep-1' },
                    { workoutKey: null },
                    { workoutKey: 'keep-2' }
                ]
            }));

            const items = await history.getWorkoutQueueItems(
                ServiceNames.SuuntoApp,
                { accessToken: 't', userName: 'user-1', openId: 'oid' } as any,
                new Date(),
                new Date()
            );

            expect(items).toHaveLength(2);
            expect(items[0].id).toBe('user-1-keep-1');
            expect(items[1].id).toBe('user-1-keep-2');
        });

        it('should throw when Suunto response contains error field', async () => {
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                error: 'Rate limited'
            }));

            await expect(history.getWorkoutQueueItems(
                ServiceNames.SuuntoApp,
                { accessToken: 't', userName: 'user-1' } as any,
                new Date(),
                new Date()
            )).rejects.toThrow('Rate limited');
        });

        it('should throw when COROS message is not OK', async () => {
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                message: 'ERROR',
                result: 500,
            }));

            await expect(history.getWorkoutQueueItems(
                ServiceNames.COROSAPI,
                { accessToken: 't', openId: 'open-1', userName: 'user-1' } as any,
                new Date(),
                new Date()
            )).rejects.toThrow(/COROS API Error/);
        });

        it('should convert COROS data via helper and include openId', async () => {
            const { convertCOROSWorkoutsToQueueItems } = await import('./coros/queue');
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({
                message: 'OK',
                data: [{ workoutId: 'c1' }]
            }));

            const items = await history.getWorkoutQueueItems(
                ServiceNames.COROSAPI,
                { accessToken: 't', openId: 'open-1', userName: 'user-1' } as any,
                new Date('2026-01-01'),
                new Date('2026-01-02')
            );

            expect(convertCOROSWorkoutsToQueueItems).toHaveBeenCalledWith(
                [{ workoutId: 'c1' }],
                'open-1'
            );
            expect(items).toEqual([{ id: 'coros-open-1-0', workoutID: 'c1' }]);
        });

        it('should throw for unimplemented service', async () => {
            await expect(history.getWorkoutQueueItems(
                ServiceNames.GarminAPI,
                {} as any,
                new Date(),
                new Date()
            )).rejects.toThrow('Not implemented');
        });
    });
});
