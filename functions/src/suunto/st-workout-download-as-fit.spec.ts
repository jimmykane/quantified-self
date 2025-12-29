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
                'origin': 'http://localhost:4200' // Allowed origin
            },
            get: vi.fn().mockImplementation((header) => {
                if (header === 'origin') return 'http://localhost:4200';
                return 'application/json';
            })
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            setHeader: vi.fn().mockReturnThis(),
            getHeader: vi.fn().mockReturnValue(undefined)
        };
    });

    it('should NOT allow requests from disallowed origins', async () => {
        req.headers.origin = 'http://evil.com';
        req.get.mockImplementation((header: string) => {
            if (header === 'origin') return 'http://evil.com';
            return 'application/json';
        });

        // The cors middleware will not call the next() callback if origin is not allowed?
        // Actually, the 'cors' package usually proceeds but doesn't set the Access-Control-Allow-Origin header if the origin is not allowed.
        // Or if options.origin is a function/array, it might block?
        // Let's see how 'cors' behaves. If it's just setting headers, the function body will still run, but the browser would block the response.
        // However, standard `cors` middleware implementation often just sets headers.

        await stWorkoutDownloadAsFit(req, res);

        // If the origin is not allowed, the CORS middleware should NOT set the Access-Control-Allow-Origin header
        expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://evil.com');
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
