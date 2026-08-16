import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME } from './constants';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../../../shared/history-import.constants';

const accountMocks = vi.hoisted(() => ({
    getActiveCOROSTokenSnapshot: vi.fn(),
    getUserDeletionGuardState: vi.fn(),
    isServiceUnavailableForSyncForUser: vi.fn(),
}));

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
    hasProAccess: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

vi.mock('../history', () => ({
    addHistoryToQueue: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, processedBatches: 1, failedBatches: 0 }),
    getNextAllowedHistoryImportDate: vi.fn().mockResolvedValue(null)
}));

vi.mock('./account', () => ({
    getActiveCOROSTokenSnapshot: (...args: unknown[]) => accountMocks.getActiveCOROSTokenSnapshot(...args),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({})),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: (...args: unknown[]) => accountMocks.getUserDeletionGuardState(...args),
}));

vi.mock('../service-connection-meta', () => ({
    isServiceUnavailableForSyncForUser: (...args: unknown[]) => accountMocks.isServiceUnavailableForSyncForUser(...args),
}));

// Import AFTER mocks
import { addCOROSAPIHistoryToQueue } from './history-to-queue';

describe('COROS History to Queue', () => {
    let context: any;
    let data: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.hasProAccess as any).mockResolvedValue(true);
        (history.getNextAllowedHistoryImportDate as any).mockResolvedValue(null);
        accountMocks.getActiveCOROSTokenSnapshot.mockResolvedValue({ id: 'coros-open-id-1' });
        accountMocks.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        accountMocks.isServiceUnavailableForSyncForUser.mockResolvedValue(false);

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
                expect.any(Date),
                {
                    expectedProviderUserId: 'coros-open-id-1',
                    cumulativeMetadata: {
                        startDate: expect.any(Date),
                        endDate: expect.any(Date),
                        processedActivitiesCountOffset: 0,
                    },
                },
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

        it('rejects a missing request payload as an invalid date range', async () => {
            await expect(addCOROSAPIHistoryToQueue(null as never, context)).rejects.toMatchObject({
                code: 'invalid-argument',
                message: 'No start and/or end date',
            });
            expect(accountMocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
            expect(history.addHistoryToQueue).not.toHaveBeenCalled();
        });

        it('rejects a future range before creating provider windows', async () => {
            const futureDate = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000));
            data = {
                startDate: new Date().toISOString(),
                endDate: futureDate.toISOString(),
            };

            await expect(addCOROSAPIHistoryToQueue(data, context)).rejects.toMatchObject({
                code: 'invalid-argument',
                message: 'End date is too far in the future.',
            });
            expect(accountMocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
            expect(history.addHistoryToQueue).not.toHaveBeenCalled();
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
            expect(history.addHistoryToQueue).toHaveBeenNthCalledWith(
                1,
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date),
                {
                    expectedProviderUserId: 'coros-open-id-1',
                    cumulativeMetadata: {
                        startDate: expect.any(Date),
                        endDate: expect.any(Date),
                        processedActivitiesCountOffset: 0,
                    },
                },
            );
            expect(history.addHistoryToQueue).toHaveBeenNthCalledWith(
                2,
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date),
                {
                    expectedProviderUserId: 'coros-open-id-1',
                    cumulativeMetadata: {
                        startDate: expect.any(Date),
                        endDate: expect.any(Date),
                        processedActivitiesCountOffset: 1,
                    },
                },
            );

            const historyQueueCalls = vi.mocked(history.addHistoryToQueue).mock.calls;
            const firstMetadata = historyQueueCalls[0][4].cumulativeMetadata;
            const secondMetadata = historyQueueCalls[1][4].cumulativeMetadata;
            expect(firstMetadata.startDate.getTime()).toBe(secondMetadata.startDate.getTime());
            expect(firstMetadata.endDate.getTime()).toBeLessThan(secondMetadata.endDate.getTime());
        });

        it('should throw error during batch processing', async () => {
            (history.addHistoryToQueue as any).mockRejectedValueOnce(new Error('Queue failure'));

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toMatchObject({
                    code: 'internal',
                    message: 'Could not import COROS history. Please retry.',
                });
        });

        it('preserves reconnect semantics when the active account cannot be resolved', async () => {
            accountMocks.getActiveCOROSTokenSnapshot.mockRejectedValueOnce(Object.assign(
                new Error('token path detail'),
                { code: 'unauthenticated' },
            ));

            await expect(addCOROSAPIHistoryToQueue(data, context)).rejects.toMatchObject({
                code: 'unauthenticated',
                message: 'Reconnect COROS before importing history.',
            });
            expect(history.addHistoryToQueue).not.toHaveBeenCalled();
        });

        it('blocks history before account or provider access when deletion is in progress', async () => {
            accountMocks.getUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });

            await expect(addCOROSAPIHistoryToQueue(data, context)).rejects.toMatchObject({
                code: 'failed-precondition',
                message: 'Account is being deleted or no longer exists.',
            });
            expect(accountMocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
            expect(history.addHistoryToQueue).not.toHaveBeenCalled();
        });

        it('blocks history while COROS is unavailable for sync', async () => {
            accountMocks.isServiceUnavailableForSyncForUser.mockResolvedValueOnce(true);

            await expect(addCOROSAPIHistoryToQueue(data, context)).rejects.toMatchObject({
                code: 'failed-precondition',
                message: 'Reconnect COROS before importing history.',
            });
            expect(accountMocks.getActiveCOROSTokenSnapshot).not.toHaveBeenCalled();
            expect(history.addHistoryToQueue).not.toHaveBeenCalled();
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
            const expectedBatches = (history.addHistoryToQueue as any).mock.calls.length;
            expect(expectedBatches).toBeGreaterThan(0);
            expect(result).toEqual({
                result: 'History items added to queue',
                stats: {
                    successCount: expectedBatches,
                    failureCount: 0,
                    processedBatches: expectedBatches,
                    failedBatches: 0
                }
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
            (utils.hasProAccess as any).mockResolvedValue(false);

            await expect(addCOROSAPIHistoryToQueue(data, context))
                .rejects.toThrow('Service sync is a Pro feature.');
        });
    });
});
