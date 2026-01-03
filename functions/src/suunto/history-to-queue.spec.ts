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
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

vi.mock('../history', () => ({
    addToHistoryImportQueue: vi.fn().mockResolvedValue({}),
    isAllowedToDoHistoryImport: vi.fn().mockResolvedValue(true)
}));

// Import AFTER mocks
import { addSuuntoAppHistoryToQueue } from './history-to-queue';

describe('Suunto History to Queue', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');
        (utils.isProUser as any).mockResolvedValue(true);
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

    describe('addSuuntoAppHistoryToQueue', () => {
        it('should add history to queue and return 200', async () => {
            await addSuuntoAppHistoryToQueue(req, res);

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

        it('should return 403 if user is not pro', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await addSuuntoAppHistoryToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Service sync is a Pro feature.');
        });

        it('should return 500 if dates missing', async () => {
            req.body = {};

            await addSuuntoAppHistoryToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.send).toHaveBeenCalledWith('No start and/or end date');
        });
    });
});
