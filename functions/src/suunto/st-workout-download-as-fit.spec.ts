import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock node-fetch BEFORE importing the module
vi.mock('node-fetch', () => {
    const fetchMock = vi.fn();
    return {
        default: fetchMock,
        __esModule: true
    };
});

import { stWorkoutDownloadAsFit } from './st-workout-download-as-fit';
import fetch from 'node-fetch';

describe('stWorkoutDownloadAsFit', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        req = {
            query: {},
            body: {},
            headers: {
                'origin': 'http://localhost:4200'
            },
            get: vi.fn().mockReturnValue('application/json')
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            setHeader: vi.fn().mockReturnThis(),
            getHeader: vi.fn().mockReturnValue(undefined)
        };
    });

    it('should return 403 if activityID is missing', async () => {
        await stWorkoutDownloadAsFit(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith('No activity ID provided.');
    });

    it('should fetch from sports-tracker and return binary data', async () => {
        req.query.activityID = '123';
        const mockBuffer = Buffer.from('mock fit data');
        (fetch as any).mockResolvedValue({
            ok: true,
            buffer: () => Promise.resolve(mockBuffer)
        });

        // Use a promise to wait for res.send
        const sendPromise = new Promise(resolve => {
            res.send.mockImplementation(() => {
                resolve(null);
                return res;
            });
        });

        await stWorkoutDownloadAsFit(req, res);
        await sendPromise;

        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('123'), expect.any(Object));
        expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('should set 500 status if fetch fails but still return body', async () => {
        req.body.activityID = '456';
        const mockBuffer = Buffer.from('error body');
        (fetch as any).mockResolvedValue({
            ok: false,
            buffer: () => Promise.resolve(mockBuffer)
        });

        const sendPromise = new Promise(resolve => {
            res.send.mockImplementation(() => {
                resolve(null);
                return res;
            });
        });

        await stWorkoutDownloadAsFit(req, res);
        await sendPromise;

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });
});
