'use strict';

import { describe, it, vi, expect, beforeEach } from 'vitest';
import * as zlib from 'zlib';
import { PRO_REQUIRED_MESSAGE } from '../utils';
import { HttpsError } from 'firebase-functions/v2/https';

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
    isProUser: vi.fn(),
};

vi.mock('../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils')>();
    return {
        ...actual,
        isProUser: (...args: any[]) => utilsMocks.isProUser(...args),
    };
});

const tokensMocks = {
    getTokenData: vi.fn(),
};

vi.mock('../tokens', () => ({
    getTokenData: (...args: any[]) => tokensMocks.getTokenData(...args),
}));

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

vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const updateMock = vi.fn();
    const setMock = vi.fn();
    const collectionMock: any = vi.fn();
    const docMock: any = vi.fn();

    // Needed for accessing metaData ref update
    const docObj = {
        collection: collectionMock,
        get: getMock,
        data: () => ({ uploadedRoutesCount: 0 }),
        ref: { update: updateMock },
        set: setMock,
    };

    collectionMock.mockReturnValue({ doc: docMock, get: getMock });
    docMock.mockReturnValue(docObj);

    // Setup successful query response for tokens
    getMock.mockResolvedValue({
        size: 1,
        empty: false,
        docs: [{ id: 'token1', data: () => ({}) }],
        data: () => ({ uploadedRoutesCount: 5 }),
        ref: { update: updateMock },
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

// Helper to create mock request
function createMockRequest(overrides: Partial<{
    auth: { uid: string } | null;
    app: object | null;
    data: any;
}> = {}) {
    return {
        auth: overrides.auth !== undefined ? overrides.auth : { uid: 'test-user-id' },
        app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
        data: overrides.data ?? {},
    };
}

describe('importRouteToSuuntoApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Happy path defaults
        utilsMocks.isProUser.mockResolvedValue(true);
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
    });

    it('should successfully upload a route', async () => {
        const gpxContent = '<gpx>...</gpx>';

        // Mock request success
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'route-id',
        }));

        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');
        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        const result = await importRouteToSuuntoApp(request as any);

        expect(utilsMocks.isProUser).toHaveBeenCalledWith('test-user-id');
        expect(requestMocks.post).toHaveBeenCalled();

        // Check args for post
        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/route/import',
            headers: expect.objectContaining({
                'Authorization': 'fake-access-token',
                'Content-Type': 'application/gpx+xml'
            }),
            body: gpxContent
        }));

        expect(result).toEqual({ status: 'success' });
    });

    it('should block unauthenticated requests', async () => {
        const request = createMockRequest({
            auth: null,
            data: { file: 'base64data' }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('unauthenticated');
        }
    });

    it('should block requests without App Check', async () => {
        const request = createMockRequest({
            app: null,
            data: { file: 'base64data' }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('failed-precondition');
        }
    });

    it('should block non-pro user', async () => {
        utilsMocks.isProUser.mockResolvedValue(false);

        const request = createMockRequest({
            data: { file: 'base64data' }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('permission-denied');
            expect(e.message).toBe(PRO_REQUIRED_MESSAGE);
        }
    });

    it('should handle missing file', async () => {
        const request = createMockRequest({
            data: {}
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('invalid-argument');
        }
    });

    it('should handle service error', async () => {
        // Mock request rejection
        requestMocks.post.mockRejectedValue(new Error('Suunto API Error'));
        const gpxContent = '<gpx>...</gpx>';
        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');

        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
        }
    });

    it('should handle service logic error (200 OK but error in JSON)', async () => {
        // Mock request success but with error field
        requestMocks.post.mockResolvedValue(JSON.stringify({
            error: 'Duplicate route'
        }));
        const gpxContent = '<gpx>...</gpx>';
        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');

        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
        }
    });

    it('should handle auth error (401 from API)', async () => {
        const error: any = new Error('Unauthorized');
        error.statusCode = 401;
        requestMocks.post.mockRejectedValue(error);

        const gpxContent = '<gpx>...</gpx>';
        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');

        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('unauthenticated');
        }
    });

    it('should succeed even if metadata update fails', async () => {
        const gpxContent = '<gpx>...</gpx>';

        // Mock request success
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'route-id',
        }));

        // Mock Firestore set to fail
        const admin = await import('firebase-admin');
        const setMock = vi.fn().mockRejectedValue(new Error('Firestore error'));
        vi.spyOn(admin.firestore().collection('users').doc('test-user-id').collection('meta').doc('SuuntoApp'), 'set').mockImplementation(setMock as any);

        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');
        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        const result = await importRouteToSuuntoApp(request as any);

        expect(requestMocks.post).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success' });
    });
});
