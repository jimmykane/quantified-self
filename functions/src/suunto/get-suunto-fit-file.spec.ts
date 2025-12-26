import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as requestHelper from '../request-helper';
import * as tokens from '../tokens';
import { getSuuntoFITFile } from './get-suunto-fit-file';
import { SERVICE_NAME } from './constants';

// Mock dependencies
const mockVerifyIdToken = vi.fn().mockResolvedValue({ uid: 'testUID' });
const mockAuth = {
    verifyIdToken: mockVerifyIdToken
};

vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const docMock = vi.fn(() => ({
        collection: vi.fn(() => ({ get: getMock }))
    }));
    return {
        auth: () => mockAuth,
        firestore: () => ({
            collection: vi.fn(() => ({ doc: docMock }))
        })
    };
});

vi.mock('../tokens', () => ({
    getTokenData: vi.fn()
}));

vi.mock('../request-helper', () => ({
    get: vi.fn()
}));

// We need to unmock and re-mock utils to control isCorsAllowed
vi.mock('../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    ALLOWED_CORS_ORIGINS: ['*']
}));

describe('getSuuntoFITFile', () => {
    let req: any;
    let res: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        const { isCorsAllowed } = await import('../utils');
        (isCorsAllowed as any).mockReturnValue(true);

        req = {
            method: 'POST',
            headers: {
                'authorization': 'Bearer token',
                'origin': 'http://localhost:4200'
            },
            body: { workoutID: 'w1', userName: 'u1' },
            get: vi.fn().mockImplementation((name) => req.headers[name.toLowerCase()])
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            setHeader: vi.fn().mockReturnThis(),
            getHeader: vi.fn()
        };
    });

    it('should return 403 if not allowed by CORS or method', async () => {
        const { isCorsAllowed } = await import('../utils');
        (isCorsAllowed as any).mockReturnValue(false);

        await getSuuntoFITFile(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should download FIT file on valid request', async () => {
        const firestore = admin.firestore();
        const mockTokenDoc = { id: 't1' };
        // Setup Firestore chain
        (firestore.collection('').doc('').collection('').get as any).mockResolvedValue({
            size: 1,
            docs: [mockTokenDoc]
        });

        // Setup token and request helper
        (tokens.getTokenData as any).mockResolvedValue({ userName: 'u1', accessToken: 'at' });
        (requestHelper.get as any).mockResolvedValue(Buffer.from('fit content'));

        await getSuuntoFITFile(req, res);

        expect(mockVerifyIdToken).toHaveBeenCalledWith('Bearer token');
        expect(requestHelper.get).toHaveBeenCalledWith(expect.objectContaining({
            url: expect.stringContaining('/v3/workouts/w1/fit'),
            headers: expect.objectContaining({ Authorization: 'at' })
        }));
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
    });

    it('should return 404 if no matching username token found', async () => {
        const firestore = admin.firestore();
        (firestore.collection('').doc('').collection('').get as any).mockResolvedValue({
            size: 1,
            docs: [{ id: 't1' }]
        });
        (tokens.getTokenData as any).mockResolvedValue({ userName: 'differentUser' });

        await getSuuntoFITFile(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });
});
