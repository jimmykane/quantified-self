'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME } from './constants';

// Mock firebase-functions/v2/https
vi.mock('firebase-functions/v2/https', () => {
    return {
        onCall: (options: any, handler: any) => {
            return handler;
        },
        HttpsError: class HttpsError extends Error {
            code: string;
            constructor(code: string, message: string) {
                super(message);
                this.code = code;
                this.name = 'HttpsError';
            }
        }
    };
});

vi.mock('../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils')>();
    return {
        ...actual,
        isProUser: vi.fn().mockResolvedValue(true),
    };
});

vi.mock('../history', () => ({
    addHistoryToQueue: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, processedBatches: 1, failedBatches: 0 }),
    getNextAllowedHistoryImportDate: vi.fn().mockResolvedValue(null)
}));

// Import AFTER mocks
import { addSuuntoAppHistoryToQueue } from './history-to-queue';

// Helper to create mock request
function createMockRequest(overrides: Partial<{
    auth: { uid: string } | null;
    app: object | null;
    data: any;
}> = {}) {
    return {
        auth: overrides.auth !== undefined ? overrides.auth : { uid: 'testUserID' },
        app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
        data: overrides.data ?? {},
    };
}

describe('Suunto History to Queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);
        (history.getNextAllowedHistoryImportDate as any).mockResolvedValue(null);
    });

    describe('addSuuntoAppHistoryToQueue', () => {
        it('should add history to queue and return success', async () => {
            const recentDate = new Date();
            recentDate.setDate(recentDate.getDate() - 7);
            const endDate = new Date();

            const request = createMockRequest({
                data: {
                    startDate: recentDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            });

            const result = await addSuuntoAppHistoryToQueue(request as any);

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
            const request = createMockRequest({
                data: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow('Start date is after the end date');
        });

        it('should work if start date and end date are the same', async () => {
            const sameDate = new Date().toISOString();
            const request = createMockRequest({
                data: {
                    startDate: sameDate,
                    endDate: sameDate
                }
            });

            const result = await addSuuntoAppHistoryToQueue(request as any);
            expect(result.result).toBe('History items added to queue');
            expect(history.addHistoryToQueue).toHaveBeenCalled();
        });

        it('should throw error during queue processing', async () => {
            (history.addHistoryToQueue as any).mockRejectedValueOnce(new Error('Queue failure'));
            const recentDate = new Date();
            recentDate.setDate(recentDate.getDate() - 7);
            const endDate = new Date();

            const request = createMockRequest({
                data: {
                    startDate: recentDate.toISOString(),
                    endDate: endDate.toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow('Queue failure');
        });

        it('should throw error if App Check fails', async () => {
            const request = createMockRequest({
                app: null,
                data: {
                    startDate: new Date().toISOString(),
                    endDate: new Date().toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            const request = createMockRequest({
                auth: null,
                data: {
                    startDate: new Date().toISOString(),
                    endDate: new Date().toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow('User must be authenticated.');
        });

        it('should throw error for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);
            const request = createMockRequest({
                data: {
                    startDate: new Date().toISOString(),
                    endDate: new Date().toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow();

            try {
                await addSuuntoAppHistoryToQueue(request as any);
            } catch (e: any) {
                expect(e.code).toBe('permission-denied');
            }
        });

        it('should throw error if history import not allowed', async () => {
            (history.getNextAllowedHistoryImportDate as any).mockResolvedValue(new Date(Date.now() + 86400000));
            const request = createMockRequest({
                data: {
                    startDate: new Date().toISOString(),
                    endDate: new Date().toISOString()
                }
            });

            await expect(addSuuntoAppHistoryToQueue(request as any))
                .rejects.toThrow('History import is not allowed');
        });
    });
});
