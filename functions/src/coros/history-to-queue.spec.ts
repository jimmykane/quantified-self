import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME, COROS_HISTORY_IMPORT_LIMIT_MONTHS } from './constants';

// Mock dependencies
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onRequest: (handler: any) => handler
        }
    })
}));

vi.mock('../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    getUserIDFromFirebaseToken: vi.fn().mockResolvedValue('testUserID'),
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

vi.mock('../history', () => ({
    addToHistoryImportQueue: vi.fn().mockResolvedValue({}),
    isAllowedToDoHistoryImport: vi.fn().mockResolvedValue(true)
}));

// Import AFTER mocks
import { addCOROSAPIHistoryToQueue } from './history-to-queue';

describe('COROS History to Queue', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');
        (utils.isProUser as any).mockResolvedValue(true);
        (history.isAllowedToDoHistoryImport as any).mockResolvedValue(true);

        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 7); // 7 days ago
        const endDate = new Date();

        req = {
            method: 'POST',
            body: {
                startDate: recentDate.toISOString(),
                endDate: endDate.toISOString()
            }
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
        };
    });

    describe('addCOROSAPIHistoryToQueue', () => {
        it('should add history to queue and return 200', async () => {
            await addCOROSAPIHistoryToQueue(req, res);

            expect(history.isAllowedToDoHistoryImport).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(history.addToHistoryImportQueue).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date)
            );
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith({ result: 'History items added to queue' });
        });

        it('should batch requests if range > 30 days', async () => {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 40); // 40 days ago
            req.body = {
                startDate: startDate.toISOString(),
                endDate: new Date().toISOString() // 40 days range
            };

            await addCOROSAPIHistoryToQueue(req, res);

            // 40 days / 30 days batches = 2 batches
            expect(history.addToHistoryImportQueue).toHaveBeenCalledTimes(2);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should handle errors during batch processing', async () => {
            (history.addToHistoryImportQueue as any).mockRejectedValueOnce(new Error('Queue failure'));

            await addCOROSAPIHistoryToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.send).toHaveBeenCalledWith('Queue failure');
        });

        it('should reject if end date is older than the limit', async () => {
            const olderThanLimit = new Date();
            olderThanLimit.setMonth(olderThanLimit.getMonth() - (COROS_HISTORY_IMPORT_LIMIT_MONTHS + 1));

            req.body = {
                startDate: new Date(olderThanLimit.getTime() - 86400000).toISOString(),
                endDate: olderThanLimit.toISOString()
            };

            await addCOROSAPIHistoryToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.send).toHaveBeenCalledWith(`COROS API limits history to the last ${COROS_HISTORY_IMPORT_LIMIT_MONTHS} months.`);
        });

        it('should clamp start date if it is older than the limit', async () => {
            const limitDate = new Date();
            limitDate.setMonth(limitDate.getMonth() - COROS_HISTORY_IMPORT_LIMIT_MONTHS);
            limitDate.setHours(0, 0, 0, 0);

            const olderThanLimit = new Date(limitDate.getTime() - 86400000); // 1 day older

            req.body = {
                startDate: olderThanLimit.toISOString(),
                endDate: new Date().toISOString()
            };

            await addCOROSAPIHistoryToQueue(req, res);

            expect(history.addToHistoryImportQueue).toHaveBeenCalled();
            // The first call (or only call if range is small) should use the limitDate as startDate
            const callArgs = (history.addToHistoryImportQueue as any).mock.calls[0];
            // callArgs[2] is startDate
            expect(callArgs[2].getTime()).toBeGreaterThanOrEqual(limitDate.getTime());
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
