
import { describe, it, vi, expect, beforeEach } from 'vitest';
import * as functions from 'firebase-functions-test';
import * as admin from 'firebase-admin';
import * as zlib from 'zlib';
import { PRO_REQUIRED_MESSAGE } from '../utils';

// Mock Dependencies
const requestMocks = {
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
};

vi.mock('../request-helper', () => ({
    default: {
        post: (...args: any[]) => requestMocks.post(...args),
    },
    post: (...args: any[]) => requestMocks.post(...args),
}));

const utilsMocks = {
    getUserIDFromFirebaseToken: vi.fn(),
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    isProUser: vi.fn(),
};

vi.mock('../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils')>();
    return {
        ...actual,
        getUserIDFromFirebaseToken: (...args: any[]) => utilsMocks.getUserIDFromFirebaseToken(...args),
        isCorsAllowed: (...args: any[]) => utilsMocks.isCorsAllowed(...args),
        setAccessControlHeadersOnResponse: (...args: any[]) => utilsMocks.setAccessControlHeadersOnResponse(...args),
        isProUser: (...args: any[]) => utilsMocks.isProUser(...args),
    };
});

const tokensMocks = {
    getTokenData: vi.fn(),
};

vi.mock('../tokens', () => ({
    getTokenData: (...args: any[]) => tokensMocks.getTokenData(...args),
}));

vi.mock('firebase-functions/v1', () => {
    return {
        region: () => ({
            https: {
                onRequest: (handler: any) => handler
            }
        }),
        config: () => ({
            suuntoapp: {
                subscription_key: 'test-key'
            }
        })
    };
});

vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const updateMock = vi.fn();
    const collectionMock: any = vi.fn();
    const docMock: any = vi.fn();

    // Needed for accessing metaData ref update
    const docObj = {
        collection: collectionMock,
        get: getMock,
        data: () => ({ uploadedRoutesCount: 0 }),
        ref: { update: updateMock }
    };

    collectionMock.mockReturnValue({ doc: docMock, get: getMock });
    docMock.mockReturnValue(docObj);

    // Setup successful query response for tokens
    getMock.mockResolvedValue({
        size: 1, // Token query snapshot size
        docs: [{ id: 'token1', data: () => ({}) }],
        data: () => ({ uploadedRoutesCount: 5 }) // Meta doc data
    });

    const firestoreMock = {
        collection: collectionMock,
    };

    return {
        firestore: () => firestoreMock,
        initializeApp: vi.fn(),
    };
});

// Import function under test
import { importRouteToSuuntoApp } from './routes';

describe('importRouteToSuuntoApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Happy path defaults
        utilsMocks.isCorsAllowed.mockReturnValue(true);
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue('test-user-id');
        utilsMocks.isProUser.mockResolvedValue(true);
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
    });

    it('should successfully upload a route', async () => {
        // Mock Pako ungzip
        const gpxContent = '<gpx>...</gpx>';
        // We can't easily mock Pako import unless we used vi.mock('pako') but let's assume Pako works 
        // OR we just assume req.body is base64 and the function decodes it.
        // Actually since we import * as Pako, we can verify the function behavior if we mock Pako.
        // But for integration, let's just use real Pako if it's a library, OR just trust it throws if bad input.
        // Given we didn't mock Pako, we must provide valid base64 gzip input OR we mock it now.
        // Let's rely on the logical flow mostly.

        // Mock request success
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'route-id',
            // Suunto route import returns JSON
        }));

        const req = {
            method: 'POST',
            // body containing base64 encoded gZIP
            body: Buffer.from(zlib.gzipSync(gpxContent)).toString('base64'),
            get: (h: string) => h === 'origin' ? 'http://localhost' : undefined
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(utilsMocks.getUserIDFromFirebaseToken).toHaveBeenCalled();
        expect(utilsMocks.isProUser).toHaveBeenCalledWith('test-user-id');
        expect(requestMocks.post).toHaveBeenCalled();

        // Check args for post
        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/route/import',
            headers: expect.objectContaining({
                'Authorization': 'fake-access-token',
                'Content-Type': 'application/gpx+xml'
            }),
            body: gpxContent // Since Pako.ungzip should have reversed it
        }));

        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should block non-pro user', async () => {
        utilsMocks.isProUser.mockResolvedValue(false);

        const req = {
            method: 'POST',
            get: vi.fn(),
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith(PRO_REQUIRED_MESSAGE);
    });

    it('should handle missing auth', async () => {
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue(null);

        const req = {
            method: 'POST',
            get: vi.fn(),
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith('Unauthorized');
    });

    it('should handle missing body', async () => {
        const req = {
            method: 'POST',
            get: vi.fn(),
            // body undefined
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle service error', async () => {
        // Mock request rejection
        requestMocks.post.mockRejectedValue(new Error('Suunto API Error'));
        const gpxContent = '<gpx>...</gpx>';

        const req = {
            method: 'POST',
            body: Buffer.from(zlib.gzipSync(gpxContent)).toString('base64'),
            get: vi.fn(),
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Error');
    });

    it('should handle service logic error (200 OK but error in JSON)', async () => {
        // Mock request success but with error field
        requestMocks.post.mockResolvedValue(JSON.stringify({
            error: 'Duplicate route'
        }));
        const gpxContent = '<gpx>...</gpx>';

        const req = {
            method: 'POST',
            body: Buffer.from(zlib.gzipSync(gpxContent)).toString('base64'),
            get: vi.fn(),
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importRouteToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Duplicate route');
    });
});
