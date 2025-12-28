import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../utils';
import * as history from '../history';
import { SERVICE_NAME } from './constants';

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
    assertProServiceAccess: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../history', () => ({
    addHistoryToQueue: vi.fn().mockResolvedValue({}),
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
        (history.isAllowedToDoHistoryImport as any).mockResolvedValue(true);

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

    describe('addCOROSAPIHistoryToQueue', () => {
        it('should add history to queue and return 200', async () => {
            await addCOROSAPIHistoryToQueue(req, res);

            expect(history.isAllowedToDoHistoryImport).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(history.addHistoryToQueue).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                expect.any(Date),
                expect.any(Date)
            );
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith({ result: 'History items added to queue' });
        });

        it('should batch requests if range > 30 days', async () => {
            req.body = {
                startDate: '2023-01-01',
                endDate: '2023-02-10' // 40 days
            };

            await addCOROSAPIHistoryToQueue(req, res);

            // 40 days / 30 days batches = 2 batches
            expect(history.addHistoryToQueue).toHaveBeenCalledTimes(2);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should handle errors during batch processing', async () => {
            (history.addHistoryToQueue as any).mockRejectedValueOnce(new Error('Queue failure'));

            await addCOROSAPIHistoryToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.send).toHaveBeenCalledWith('Queue failure');
        });
    });
});
