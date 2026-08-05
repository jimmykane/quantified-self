'use strict';

import { describe, it, vi, expect, beforeEach } from 'vitest';
import * as zlib from 'zlib';
import { PRO_REQUIRED_MESSAGE } from '../utils';

const loggerMocks = vi.hoisted(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => loggerMocks);

const VALID_GPX_ROUTE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Quantified Self" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>Test route</name>
    <rtept lat="37.1" lon="23.7"><ele>120</ele></rtept>
    <rtept lat="37.2" lon="23.8"><ele>135</ele></rtept>
  </rte>
</gpx>`;

// Mock Dependencies
const requestMocks = {
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
};

vi.mock('../request-helper', () => ({
    default: {
        post: (...args: any[]) => requestMocks.post(...args),
        get: (...args: any[]) => requestMocks.get(...args),
    },
    post: (...args: any[]) => requestMocks.post(...args),
    get: (...args: any[]) => requestMocks.get(...args),
}));

const utilsMocks = {
    hasProAccess: vi.fn(),
};

vi.mock('../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils')>();
    return {
        ...actual,
        hasProAccess: (...args: any[]) => utilsMocks.hasProAccess(...args),
    };
});

const tokensMocks = {
    getTokenData: vi.fn(),
};

vi.mock('../tokens', () => ({
    getTokenData: (...args: any[]) => tokensMocks.getTokenData(...args),
    TokenUseSkippedForPendingDisconnectError: class TokenUseSkippedForPendingDisconnectError extends Error {
        readonly name = 'TokenUseSkippedForPendingDisconnectError';
        constructor(
            public readonly firebaseUserID: string,
            public readonly serviceName: string,
            public readonly tokenDocumentID: string,
            public readonly phase: string,
        ) {
            super(`Skipping ${serviceName} token use while disconnect is pending.`);
        }
    },
}));

const deletionGuardMocks = {
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
};

const disconnectPendingMocks = {
    isServiceDisconnectPendingForUser: vi.fn(),
};

vi.mock('../service-disconnect-pending', () => ({
    isServiceDisconnectPendingForUser: (...args: unknown[]) => disconnectPendingMocks.isServiceDisconnectPendingForUser(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: (...args: any[]) => deletionGuardMocks.getUserDeletionGuardState(...args),
    getUserDeletionGuardStateInTransaction: (...args: any[]) => deletionGuardMocks.getUserDeletionGuardStateInTransaction(...args),
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';
        readonly code = 'unavailable';
        readonly statusCode = 503;

        constructor(
            public readonly uid: string,
            public readonly phase: string,
            public readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    },
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
    const tokenRefGetMock = vi.fn();
    const updateMock = vi.fn();
    const setMock = vi.fn();
    const runTransactionMock = vi.fn();
    const collectionMock: any = vi.fn();
    const docMock: any = vi.fn();
    const tokenSnapshot: any = {
        id: 'token1',
        exists: true,
        data: () => ({ userName: 'suunto-user' }),
        ref: { get: tokenRefGetMock, update: updateMock },
    };
    tokenRefGetMock.mockResolvedValue(tokenSnapshot);

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
        docs: [tokenSnapshot],
        data: () => ({ uploadedRoutesCount: 5 }),
        ref: { update: updateMock },
    });

    const firestoreMock = {
        collection: collectionMock,
        runTransaction: runTransactionMock,
    };

    return {
        firestore: () => firestoreMock,
        initializeApp: vi.fn(),
    };
});

// Import functions under test
import {
    createSuuntoRouteUploadContext,
    exportSuuntoRouteAsGPX,
    importRouteToSuuntoApp,
    uploadGPXRouteToSuuntoApp,
} from './routes';

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
    beforeEach(async () => {
        vi.clearAllMocks();
        // Happy path defaults
        utilsMocks.hasProAccess.mockResolvedValue(true);
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        deletionGuardMocks.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        deletionGuardMocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        disconnectPendingMocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
        const admin = await import('firebase-admin');
        const setMock = (admin.firestore() as any)
            .collection('users')
            .doc('test-user-id')
            .collection('meta')
            .doc('SuuntoApp')
            .set;
        (admin.firestore() as any).runTransaction.mockImplementation(
            async (runner: (transaction: { set: (...args: any[]) => unknown }) => unknown) => runner({ set: setMock }),
        );
    });

    it('encodes provider route ids before exporting with an OAuth token', async () => {
        const tokenSnapshot = {
            id: 'token1',
            exists: true,
            data: () => ({ userName: 'suunto-user' }),
        };
        const context = {
            tokenRefs: [{
                id: 'token1',
                providerUserId: 'suunto-user',
                sourceKey: 'suunto-user:source',
                ref: { get: vi.fn().mockResolvedValue(tokenSnapshot) },
            }],
            userNames: ['suunto-user'],
        };
        requestMocks.get.mockResolvedValue('<gpx>route</gpx>');

        const result = await exportSuuntoRouteAsGPX(
            'test-user-id',
            '../routes?access=other',
            { context: context as any, providerUserId: 'suunto-user' },
        );

        expect(result).toBe('<gpx>route</gpx>');
        expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/route/..%2Froutes%3Faccess%3Dother/export',
        }));
    });

    it('should successfully upload a route', async () => {
        const gpxContent = VALID_GPX_ROUTE;

        // Mock request success
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'route-id',
        }));

        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');
        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        const result = await importRouteToSuuntoApp(request as any);

        expect(utilsMocks.hasProAccess).toHaveBeenCalledWith('test-user-id');
        expect(requestMocks.post).toHaveBeenCalled();

        // Check args for post
        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/route/import',
            headers: expect.objectContaining({
                'Authorization': 'Bearer fake-access-token',
                'Content-Type': 'application/gpx+xml'
            }),
            body: expect.stringContaining('<rtept lat="37.1" lon="23.7">')
        }));

        expect(result).toEqual({ status: 'success' });
    });

    it('accepts an uncompressed GPX route from the current uploader', async () => {
        const gpxContent = VALID_GPX_ROUTE;
        requestMocks.post.mockResolvedValue(JSON.stringify({ id: 'route-id' }));

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: {
                file: Buffer.from(gpxContent).toString('base64'),
                filename: 'route.gpx',
            },
        }) as any)).resolves.toEqual({ status: 'success' });

        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            body: expect.stringContaining('<rtept lat="37.1" lon="23.7">'),
        }));
    });

    it('rejects a malformed current GPX upload before calling Suunto', async () => {
        requestMocks.post.mockResolvedValue(JSON.stringify({ id: 'route-id' }));

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: {
                file: Buffer.from('<gpx></gpx>').toString('base64'),
                filename: 'route.gpx',
            },
        }) as any)).rejects.toMatchObject({ code: 'invalid-argument' });

        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('does not parse or send a manual route while Suunto disconnect is pending', async () => {
        disconnectPendingMocks.isServiceDisconnectPendingForUser.mockResolvedValue(true);

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: {
                file: Buffer.from(VALID_GPX_ROUTE).toString('base64'),
                filename: 'route.gpx',
            },
        }) as any)).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Suunto disconnect is pending.',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('returns a callable-safe error when route context creation sees a pending disconnect', async () => {
        disconnectPendingMocks.isServiceDisconnectPendingForUser.mockResolvedValue(true);

        await expect(createSuuntoRouteUploadContext('test-user-id')).rejects.toMatchObject({
            name: 'TokenUseSkippedForPendingDisconnectError',
            code: 'failed-precondition',
            message: 'Suunto disconnect is pending.',
        });
    });

    it('rejects legacy gzip routes that expand beyond the manual route limit before calling Suunto', async () => {
        const expandedPayload = Buffer.alloc((20 * 1024 * 1024) + 1, 'a');
        const compressedBase64 = Buffer.from(zlib.gzipSync(expandedPayload)).toString('base64');

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: { file: compressedBase64 },
        }) as any)).rejects.toMatchObject({
            code: 'invalid-argument',
            message: 'Route file is too large after decompression. Maximum decompressed size is 20MB.',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('does not log raw Suunto route response errors', async () => {
        const providerError = 'provider-error-containing-route-content';
        requestMocks.post.mockResolvedValue(JSON.stringify({ error: providerError }));
        const compressedBase64 = Buffer.from(zlib.gzipSync(VALID_GPX_ROUTE)).toString('base64');

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: { file: compressedBase64 },
        }) as any)).rejects.toMatchObject({ code: 'failed-precondition' });

        const loggedOutput = JSON.stringify({
            error: loggerMocks.error.mock.calls,
            info: loggerMocks.info.mock.calls,
            warn: loggerMocks.warn.mock.calls,
        });
        expect(loggedOutput).not.toContain(providerError);
    });

    it('does not log raw Suunto route error bodies returned with an HTTP failure', async () => {
        const providerError = 'provider-error-body-containing-route-content';
        requestMocks.post.mockRejectedValue(Object.assign(new Error('Suunto request failed'), {
            statusCode: 422,
            error: { message: providerError },
        }));
        const compressedBase64 = Buffer.from(zlib.gzipSync(VALID_GPX_ROUTE)).toString('base64');

        await expect(importRouteToSuuntoApp(createMockRequest({
            data: { file: compressedBase64 },
        }) as any)).rejects.toMatchObject({ code: 'failed-precondition' });

        const loggedOutput = JSON.stringify({
            error: loggerMocks.error.mock.calls,
            info: loggerMocks.info.mock.calls,
            warn: loggerMocks.warn.mock.calls,
        });
        expect(loggedOutput).not.toContain(providerError);
    });

    it('fetches the latest Suunto token snapshot for each upload when a batch context is reused', async () => {
        const firstSnapshot = {
            id: 'token1',
            exists: true,
            data: () => ({ accessToken: 'stale-access-token' }),
            ref: { update: vi.fn() },
        };
        const secondSnapshot = {
            id: 'token1',
            exists: true,
            data: () => ({ accessToken: 'fresh-access-token' }),
            ref: { update: vi.fn() },
        };
        const tokenRefGetMock = vi.fn()
            .mockResolvedValueOnce(firstSnapshot)
            .mockResolvedValueOnce(secondSnapshot);

        tokensMocks.getTokenData.mockImplementation(async (tokenSnapshot: { data: () => { accessToken: string } }) => ({
            accessToken: tokenSnapshot.data().accessToken,
        }));
        requestMocks.post.mockResolvedValue(JSON.stringify({ id: 'route-id' }));

        const context = {
            tokenRefs: [{ id: 'token1', ref: { get: tokenRefGetMock }, providerUserId: 'suunto-user' }],
        };
        await uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>first</gpx>', context as any);
        await uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>second</gpx>', context as any);

        expect(tokenRefGetMock).toHaveBeenCalledTimes(2);
        expect(requestMocks.post).toHaveBeenNthCalledWith(1, expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer stale-access-token',
            }),
            body: '<gpx>first</gpx>',
        }));
        expect(requestMocks.post).toHaveBeenNthCalledWith(2, expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer fresh-access-token',
            }),
            body: '<gpx>second</gpx>',
        }));
    });

    it('persists each accepted Suunto delivery before starting the next account upload', async () => {
        const createTokenRef = (id: string) => ({
            id,
            providerUserId: `suunto-${id}`,
            ref: {
                get: vi.fn().mockResolvedValue({
                    id,
                    exists: true,
                    ref: { update: vi.fn() },
                    data: () => ({ accessToken: `access-${id}` }),
                }),
            },
        });
        const context = {
            tokenRefs: [createTokenRef('token-1'), createTokenRef('token-2')],
            userNames: ['suunto-token-1', 'suunto-token-2'],
        };
        requestMocks.post.mockResolvedValueOnce(JSON.stringify({ id: 'route-1' }));
        const persistenceError = new Error('receipt write failed');
        const onProviderAccepted = vi.fn().mockRejectedValueOnce(persistenceError);

        await expect(uploadGPXRouteToSuuntoApp(
            'test-user-id',
            '<gpx>route</gpx>',
            context as any,
            onProviderAccepted,
        )).rejects.toBe(persistenceError);

        expect(onProviderAccepted).toHaveBeenCalledWith({
            providerRouteId: 'route-1',
            complete: false,
            deliveries: [{
                providerUserId: 'suunto-token-1',
                providerRouteId: 'route-1',
            }],
        });
        expect(requestMocks.post).toHaveBeenCalledTimes(1);
    });

    it('marks multi-account acceptance complete only after every account was attempted', async () => {
        const createTokenRef = (id: string) => ({
            id,
            providerUserId: `suunto-${id}`,
            ref: {
                get: vi.fn().mockResolvedValue({
                    id,
                    exists: true,
                    ref: { update: vi.fn() },
                    data: () => ({ accessToken: `access-${id}` }),
                }),
            },
        });
        const context = {
            tokenRefs: [createTokenRef('token-1'), createTokenRef('token-2')],
            userNames: ['suunto-token-1', 'suunto-token-2'],
        };
        requestMocks.post
            .mockResolvedValueOnce(JSON.stringify({ id: 'route-1' }))
            .mockResolvedValueOnce(JSON.stringify({ id: 'route-2' }));
        const onProviderAccepted = vi.fn().mockResolvedValue(undefined);

        const result = await uploadGPXRouteToSuuntoApp(
            'test-user-id',
            '<gpx>route</gpx>',
            context as any,
            onProviderAccepted,
        );

        expect(result).toMatchObject({ status: 'success', successCount: 2 });
        expect(onProviderAccepted).toHaveBeenNthCalledWith(1, {
            providerRouteId: 'route-1',
            complete: false,
            deliveries: [{
                providerUserId: 'suunto-token-1',
                providerRouteId: 'route-1',
            }],
        });
        expect(onProviderAccepted).toHaveBeenNthCalledWith(2, {
            providerRouteId: 'route-1',
            complete: true,
            deliveries: [{
                providerUserId: 'suunto-token-1',
                providerRouteId: 'route-1',
            }, {
                providerUserId: 'suunto-token-2',
                providerRouteId: 'route-2',
            }],
        });
        expect(onProviderAccepted).toHaveBeenCalledTimes(2);
    });

    it('surfaces a deleted Suunto token as reconnect-required auth failure', async () => {
        const context = {
            tokenRefs: [{
                id: 'token1',
                providerUserId: 'suunto-user',
                ref: {
                    get: vi.fn().mockResolvedValue({ exists: false }),
                },
            }],
        };

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>', context as any))
            .rejects.toMatchObject({
                code: 'unauthenticated',
                message: 'Authentication failed. Please re-connect your Suunto account.',
            });

        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('normalizes terminal token refresh cleanup as reconnect-required auth failure', async () => {
        tokensMocks.getTokenData.mockRejectedValue(Object.assign(new Error('Refresh token revoked'), {
            name: 'TerminalServiceAuthError',
            providerErrorCode: 'invalid_grant',
            providerUserId: 'suunto-user',
            dlqContext: 'INVALID_GRANT',
        }));

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'auth_required',
                retryMode: 'none',
                code: 'unauthenticated',
                dlqContext: 'INVALID_GRANT',
            });
        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('keeps temporary Suunto invalid_grant refresh failures retryable before route creation', async () => {
        tokensMocks.getTokenData.mockRejectedValue(Object.assign(new Error('Temporary invalid_grant'), {
            statusCode: 400,
            error: {
                error: 'invalid_grant',
                error_description: 'Temporary provider outage',
            },
        }));

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                code: 'unavailable',
                dlqContext: 'SUUNTO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
            });
        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('does not classify a token refresh 503 as an ambiguous route create', async () => {
        const refreshError = Object.assign(new Error('Token endpoint unavailable'), { statusCode: 503 });
        tokensMocks.getTokenData.mockRejectedValue(refreshError);

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toBe(refreshError);

        expect(requestMocks.post).not.toHaveBeenCalled();
    });

    it('keeps an explicit Suunto rate-limit rejection retryable', async () => {
        requestMocks.post.mockRejectedValue(Object.assign(new Error('Rate limited'), { statusCode: 429 }));

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                code: 'resource-exhausted',
            });
    });

    it.each([
        ['HTTP 503', Object.assign(new Error('Service unavailable'), { statusCode: 503 })],
        ['transport reset', Object.assign(new Error('Socket reset'), { code: 'ECONNRESET' })],
    ])('fails closed after an ambiguous Suunto route create outcome: %s', async (_scenario, providerError) => {
        requestMocks.post.mockRejectedValue(providerError);

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'permanent',
                retryMode: 'none',
                dlqContext: 'SUUNTO_ROUTE_CREATE_AMBIGUOUS',
            });
        expect(requestMocks.post).toHaveBeenCalledTimes(1);
    });

    it('preserves pending-disconnect token failures for queue deferral', async () => {
        tokensMocks.getTokenData.mockRejectedValue(Object.assign(new Error('Disconnect pending'), {
            name: 'TokenUseSkippedForPendingDisconnectError',
            serviceName: 'suuntoApp',
        }));

        await expect(uploadGPXRouteToSuuntoApp('test-user-id', '<gpx>route</gpx>'))
            .rejects.toMatchObject({ name: 'TokenUseSkippedForPendingDisconnectError' });
        expect(requestMocks.post).not.toHaveBeenCalled();
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
        utilsMocks.hasProAccess.mockResolvedValue(false);

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
        const gpxContent = VALID_GPX_ROUTE;
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
        const gpxContent = VALID_GPX_ROUTE;
        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');

        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        await expect(importRouteToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importRouteToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('failed-precondition');
        }
    });

    it('should handle auth error (401 from API)', async () => {
        const error: any = new Error('Unauthorized');
        error.statusCode = 401;
        requestMocks.post.mockRejectedValue(error);

        const gpxContent = VALID_GPX_ROUTE;
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

    it('should handle auth error from response status code', async () => {
        const error: any = new Error('Unauthorized');
        error.response = { statusCode: 401 };
        requestMocks.post.mockRejectedValue(error);

        const gpxContent = VALID_GPX_ROUTE;
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
        const gpxContent = VALID_GPX_ROUTE;

        // Mock request success
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'route-id',
        }));

        // Mock Firestore transaction to fail after the provider upload succeeds.
        const admin = await import('firebase-admin');
        (admin.firestore() as any).runTransaction.mockRejectedValueOnce(new Error('Firestore error'));

        const compressedBase64 = Buffer.from(zlib.gzipSync(gpxContent)).toString('base64');
        const request = createMockRequest({
            data: { file: compressedBase64 }
        });

        const result = await importRouteToSuuntoApp(request as any);

        expect(requestMocks.post).toHaveBeenCalled();
        expect(result).toEqual({ status: 'success' });
    });
});
