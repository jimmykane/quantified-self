import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME } from './constants';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../shared/history-import.constants';

// Mock dependencies
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onCall: (handler: any) => handler
        }
    }),
    runWith: () => ({
        region: () => ({
            https: {
                onCall: (handler: any) => handler
            }
        })
    }),
    https: {
        HttpsError: class HttpsError extends Error {
            constructor(public code: string, message: string) {
                super(message);
                this.name = 'HttpsError';
            }
        }
    }
}));

vi.mock('../utils', () => ({
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

vi.mock('../history', () => ({
    addHistoryToQueue: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, processedBatches: 1, failedBatches: 0 }),
    getNextAllowedHistoryImportDate: vi.fn().mockResolvedValue(null)
}));

// Import AFTER mocks
import { addCOROSAPIHistoryToQueue } from './history-to-queue';

describe('COROS History to Queue', () => {
    let context: any;
    let data: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);
        (history.getNextAllowedHistoryImportDate as any).mockResolvedValue(null);

        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 7); // 7 days ago
        const endDate = new Date();

        context = {
            app: { appId: 'test-app' },
            auth: { uid: 'testUserID' }
        };
        data = {
            startDate: recentDate.toISOString(),
            endDate: endDate.toISOString()
        };
    });

    describe('addCOROSAPIHistoryToQueue', () => {
        it('should add history to queue and return success', async () => {
            const result = await addCOROSAPIHistoryToQueue(data, context);

            expect(history.getNextAllowedHistoryImportDate).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(history.addHistoryToQueue).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date)
            );
            expect(result).toEqual({
                result: 'History items added to queue',
                stats: { successCount: 1, failureCount: 0, processedBatches: 1, failedBatches: 0 }
            });
        });

        it('should throw error if start date is after end date', async () => {
            const startDate = new Date();
            const endDate = new Date(startDate.getTime() - 86400000); // 1 day before
            data = {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            };

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('Start date is after the end date');
        });

        it('should work if start date and end date are the same', async () => {
            const sameDate = new Date().toISOString();
            data = {
                startDate: sameDate,
                endDate: sameDate
            };

            const result = await addCOROSAPIHistoryToQueue(data, context);
            expect(result.result).toBe('History items added to queue');
            expect(history.addHistoryToQueue).toHaveBeenCalled();
        });

        it('should batch requests if range > 30 days', async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 40); // 40 days ago
            data = {
                startDate: startDate.toISOString(),
                endDate: new Date().toISOString()
            };

            await addCOROSAPIHistoryToQueue(data, context);

            // 40 days / 30 days batches = 2 batches
            expect(history.addHistoryToQueue).toHaveBeenCalledTimes(2);
        });

        it('should throw error during batch processing', async () => {
            (history.addHistoryToQueue as any).mockRejectedValueOnce(new Error('Queue failure'));

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('Queue failure');
        });

        it('should throw error if end date is older than the limit', async () => {
            const olderThanLimit = new Date();
            olderThanLimit.setMonth(olderThanLimit.getMonth() - (COROS_HISTORY_IMPORT_LIMIT_MONTHS + 1));

            data = {
                startDate: new Date(olderThanLimit.getTime() - 86400000).toISOString(),
                endDate: olderThanLimit.toISOString()
            };

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow(`COROS API limits history to the last ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months.`);
        });

        it('should clamp start date if it is older than the limit', async () => {
            const limitDate = new Date();
            limitDate.setMonth(limitDate.getMonth() - COROS_HISTORY_IMPORT_LIMIT_MONTHS);
            limitDate.setHours(0, 0, 0, 0);

            const olderThanLimit = new Date(limitDate.getTime() - 86400000); // 1 day older

            data = {
                startDate: olderThanLimit.toISOString(),
                endDate: new Date().toISOString()
            };

            const result = await addCOROSAPIHistoryToQueue(data, context);

            expect(history.addHistoryToQueue).toHaveBeenCalled();
            const callArgs = (history.addHistoryToQueue as any).mock.calls[0];
            expect(callArgs[2].getTime()).toBeGreaterThanOrEqual(limitDate.getTime());
            expect(result).toEqual({
                result: 'History items added to queue',
                stats: { successCount: 4, failureCount: 0, processedBatches: 4, failedBatches: 0 }
            });
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            context.auth = null;

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('User must be authenticated.');
        });

        it('should throw error for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('Service sync is a Pro feature.');
        });
    });
});
