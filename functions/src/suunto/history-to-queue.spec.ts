import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME } from './constants';

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
    addHistoryToQueue: vi.fn().mockResolvedValue({}),
    isAllowedToDoHistoryImport: vi.fn().mockResolvedValue(true)
}));

// Import AFTER mocks
import { addSuuntoAppHistoryToQueue } from './history-to-queue';

describe('Suunto History to Queue', () => {
    let context: any;
    let data: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);
        (history.isAllowedToDoHistoryImport as any).mockResolvedValue(true);

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

    describe('addSuuntoAppHistoryToQueue', () => {
        it('should add history to queue and return success', async () => {
            const result = await addSuuntoAppHistoryToQueue(data, context);

            expect(history.isAllowedToDoHistoryImport).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(history.addHistoryToQueue).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date)
            );
            expect(result).toEqual({ result: 'History items added to queue' });
        });

        it('should throw error during queue processing', async () => {
            (history.addHistoryToQueue as any).mockRejectedValueOnce(new Error('Queue failure'));

            await expect(addSuuntoAppHistoryToQueue(data, context))
                .rejects.toThrow('Queue failure');
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(addSuuntoAppHistoryToQueue(data, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            context.auth = null;

            await expect(addSuuntoAppHistoryToQueue(data, context))
                .rejects.toThrow('User must be authenticated.');
        });

        it('should throw error for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await expect(addSuuntoAppHistoryToQueue(data, context))
                .rejects.toThrow('Service sync is a Pro feature.');
        });

        it('should throw error if history import not allowed', async () => {
            (history.isAllowedToDoHistoryImport as any).mockResolvedValue(false);

            await expect(addSuuntoAppHistoryToQueue(data, context))
                .rejects.toThrow('History import is not allowed');
        });
    });
});
