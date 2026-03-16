'use strict';

import { describe, it, vi, expect, beforeEach } from 'vitest';
import { PRO_REQUIRED_MESSAGE } from '../utils';

// Mock dependencies BEFORE importing the module under test
vi.mock('../config', () => ({
    config: {
        suuntoapp: { subscription_key: 'test-key' }
    }
}));

const requestMocks = {
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
};

vi.mock('../request-helper', () => ({
    default: {
        post: (...args: any[]) => requestMocks.post(...args),
        put: (...args: any[]) => requestMocks.put(...args),
        get: (...args: any[]) => requestMocks.get(...args),
    },
    post: (...args: any[]) => requestMocks.post(...args),
    put: (...args: any[]) => requestMocks.put(...args),
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

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const setMock = vi.fn();

    // Create a recursive mock structure
    const collectionMock: any = vi.fn();
    const docMock: any = vi.fn();

    const colObj = { doc: docMock, get: getMock, set: setMock };
    const docObj = { collection: collectionMock, get: getMock, set: setMock };

    collectionMock.mockReturnValue(colObj);
    docMock.mockReturnValue(docObj);

    // Setup successful query response
    getMock.mockResolvedValue({
        size: 1,
        empty: false,
        docs: [{ id: 'token1', data: () => ({}) }]
    });

    const firestoreMock = {
        collection: collectionMock,
    };

    return {
        firestore: Object.assign(() => firestoreMock, {
            FieldValue: {
                increment: vi.fn((val) => ({ val, type: 'increment' }))
            }
        }),
        initializeApp: vi.fn(),
    };
});

// Import the function under test
import { importActivityToSuuntoApp } from './activities';

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

function createStatusCodeError(message: string, statusCode: number) {
    const error: any = new Error(message);
    error.statusCode = statusCode;
    return error;
}

describe('importActivityToSuuntoApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default happy path
        utilsMocks.hasProAccess.mockResolvedValue(true);
    });

    it('should successfully upload an activity', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST)
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: { 'x-ms-blob-type': 'BlockBlob', 'Custom-Header': 'Value' }
        });

        // Mock status check (GET) - Polling simulation
        requestMocks.get
            .mockResolvedValueOnce({ status: 'NEW' })
            .mockResolvedValueOnce({ status: 'PROCESSED', workoutKey: 'test-workout-key' });

        // Mock binary upload (PUT)
        requestMocks.put.mockResolvedValue({});

        // Create base64 encoded file
        const fileContent = Buffer.from('fake-fit-file-content');
        const base64File = fileContent.toString('base64');

        const request = createMockRequest({
            data: { file: base64File }
        });

        // Execute
        const result = await importActivityToSuuntoApp(request as any);

        // Assertions
        expect(utilsMocks.hasProAccess).toHaveBeenCalledWith('test-user-id');
        expect(tokensMocks.getTokenData).toHaveBeenCalled();

        // 1. Check Init Upload
        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/upload/',
            headers: expect.objectContaining({
                'Content-Type': 'application/json'
            })
        }));

        // 2. Check Binary Upload
        expect(requestMocks.put).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://storage.suunto.com/upload-url',
            body: fileContent,
            headers: expect.objectContaining({
                'x-ms-blob-type': 'BlockBlob',
                'Custom-Header': 'Value'
            }),
            json: false
        }));

        // 3. Success Response
        expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    }, 30000);

    it('should handle "Already exists" error from Suunto gracefully', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST)
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id-dup',
            url: 'https://storage.suunto.com/upload-url-dup',
            headers: {}
        });

        // Mock binary upload (PUT)
        requestMocks.put.mockResolvedValue({});

        // Mock status check (GET) - Returning "Already exists"
        requestMocks.get.mockResolvedValue({ status: 'ERROR', message: 'Already exists' });

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');

        const request = createMockRequest({
            data: { file: base64File }
        });

        const result = await importActivityToSuuntoApp(request as any);

        // Assertions - should return success with ALREADY_EXISTS code
        expect(result).toEqual(expect.objectContaining({
            code: 'ALREADY_EXISTS'
        }));
    }, 30000);

    it('should retry initialization on transient 504 and then succeed', async () => {
        const transientError = createStatusCodeError('Gateway Timeout', 504);

        requestMocks.post
            .mockRejectedValueOnce(transientError)
            .mockResolvedValueOnce({
                id: 'retry-upload-id',
                url: 'https://storage.suunto.com/upload-url-retry',
                headers: { 'x-ms-blob-type': 'BlockBlob' }
            });

        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'retry-workout-key' });

        const fileContent = Buffer.from('retry-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        const result = await importActivityToSuuntoApp(request as any);

        expect(requestMocks.post).toHaveBeenCalledTimes(2);
        expect(result).toEqual(expect.objectContaining({
            status: 'success',
            workoutKey: 'retry-workout-key'
        }));
    }, 30000);

    it('should retry blob upload on transient 500 and then succeed', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'blob-retry-upload-id',
            url: 'https://storage.suunto.com/blob-upload-url',
            headers: { 'x-ms-blob-type': 'BlockBlob' }
        });

        requestMocks.put
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockResolvedValueOnce({});

        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'blob-retry-workout-key' });

        const fileContent = Buffer.from('blob-retry-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        const result = await importActivityToSuuntoApp(request as any);

        expect(requestMocks.put).toHaveBeenCalledTimes(2);
        expect(result).toEqual(expect.objectContaining({
            status: 'success',
            workoutKey: 'blob-retry-workout-key'
        }));
    }, 30000);

    it('should retry blob upload with a stable copy of the init headers', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'blob-header-retry-upload-id',
            url: 'https://storage.suunto.com/blob-header-retry-upload-url',
            headers: { 'x-ms-blob-type': 'BlockBlob', 'Custom-Header': 'Value' }
        });

        let putAttempts = 0;
        requestMocks.put.mockImplementation(async (options: any) => {
            putAttempts++;

            if (putAttempts === 1) {
                options.headers['Custom-Header'] = 'mutated';
                throw createStatusCodeError('Internal Server Error', 500);
            }

            expect(options.headers).toEqual({
                'x-ms-blob-type': 'BlockBlob',
                'Custom-Header': 'Value'
            });

            return {};
        });

        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'blob-header-retry-workout-key' });

        const fileContent = Buffer.from('blob-header-retry-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        const result = await importActivityToSuuntoApp(request as any);

        expect(putAttempts).toBe(2);
        expect(result).toEqual(expect.objectContaining({
            status: 'success',
            workoutKey: 'blob-header-retry-workout-key'
        }));
    }, 30000);

    it('should continue polling after transient status 500 and then succeed', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'status-retry-upload-id',
            url: 'https://storage.suunto.com/status-retry-upload-url',
            headers: {}
        });

        requestMocks.put.mockResolvedValue({});

        requestMocks.get
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockResolvedValueOnce({ status: 'PROCESSED', workoutKey: 'status-retry-workout-key' });

        const fileContent = Buffer.from('status-retry-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        const result = await importActivityToSuuntoApp(request as any);

        expect(requestMocks.get).toHaveBeenCalledTimes(4);
        expect(result).toEqual(expect.objectContaining({
            status: 'success',
            workoutKey: 'status-retry-workout-key'
        }));
    }, 30000);

    it('should cap transient status polling retries by actual request budget', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'status-budget-upload-id',
            url: 'https://storage.suunto.com/status-budget-upload-url',
            headers: {}
        });

        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockRejectedValue(createStatusCodeError('Internal Server Error', 500));

        const fileContent = Buffer.from('status-budget-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'unavailable',
            message: 'Suunto activity upload is temporarily unavailable. Please retry.'
        });
        expect(requestMocks.get).toHaveBeenCalledTimes(10);
    }, 30000);

    it('should not retry permanent-looking Suunto 500 payload errors', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'status-permanent-error-upload-id',
            url: 'https://storage.suunto.com/status-permanent-error-upload-url',
            headers: {}
        });

        requestMocks.put.mockResolvedValue({});

        const permanentError = createStatusCodeError('Internal Server Error', 500);
        permanentError.error = { message: 'Unsupported FIT file format' };
        requestMocks.get.mockRejectedValue(permanentError);

        const fileContent = Buffer.from('status-permanent-error-data');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'internal',
            message: 'Unsupported FIT file format'
        });
        expect(requestMocks.get).toHaveBeenCalledTimes(1);
    }, 30000);

    it('should surface persistent upstream 500s as unavailable', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500))
            .mockRejectedValueOnce(createStatusCodeError('Internal Server Error', 500));

        const fileContent = Buffer.from('provider-down');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'unavailable',
            message: 'Suunto activity upload is temporarily unavailable. Please retry.'
        });
    }, 30000);

    it('should throw internal error if initialization response is missing url or id', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) - MISSING URL/ID
        requestMocks.post.mockResolvedValue({
            // Missing url and id
            headers: {}
        });

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');
        const request = createMockRequest({ data: { file: base64File } });

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
            expect(e.message).toContain('Invalid response from Suunto initialization');
        }
        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow('Invalid response from Suunto initialization');
    });

    it('should handle polling response missing status', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'valid-id',
            url: 'https://valid-url',
            headers: {}
        });
        requestMocks.put.mockResolvedValue({});

        // Mock status check (GET) - MISSING STATUS
        // Then eventually succeeds to break loop or fails. 
        // If status is missing, code logs warn and loop continues/finishes. 
        // We simulate it missing once, then PROCESSED.
        requestMocks.get
            .mockResolvedValueOnce({}) // Missing status -> Status is undefined -> Loop continues or errors
            .mockResolvedValueOnce({ status: 'PROCESSED', workoutKey: 'key' });

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');
        const request = createMockRequest({ data: { file: base64File } });

        const result = await importActivityToSuuntoApp(request as any);
        // It should recover if subsequent call works
        expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    });

    it('should throw internal error if polling returns ERROR status (not already exists)', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        requestMocks.post.mockResolvedValue({
            id: 'valid-id',
            url: 'https://valid-url',
            headers: {}
        });
        requestMocks.put.mockResolvedValue({});

        // Mock status check (GET) - ERROR
        requestMocks.get.mockResolvedValue({ status: 'ERROR', message: 'Something went wrong' });

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');
        const request = createMockRequest({ data: { file: base64File } });

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
            expect(e.message).toContain('Something went wrong');
        }
        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow('Something went wrong');
    });

    it('should block unauthenticated requests', async () => {
        const request = createMockRequest({
            auth: null,
            data: { file: 'base64data' }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('unauthenticated');
        }
    });

    it('should block requests without App Check', async () => {
        const request = createMockRequest({
            app: null,
            data: { file: 'base64data' }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('failed-precondition');
        }
    });

    it('should block non-pro users', async () => {
        utilsMocks.hasProAccess.mockResolvedValue(false);

        const request = createMockRequest({
            data: { file: 'base64data' }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('permission-denied');
            expect(e.message).toBe(PRO_REQUIRED_MESSAGE);
        }
    });

    it('should handle missing file', async () => {
        const request = createMockRequest({
            data: {}
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('invalid-argument');
        }
    });

    it('should handle empty file content', async () => {
        const request = createMockRequest({
            data: { file: '' } // Empty base64 string
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('invalid-argument');
        }
    });

    it('should handle initialization failure', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) FAILURE
        requestMocks.post.mockRejectedValue(new Error('Init failed'));

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');

        const request = createMockRequest({
            data: { file: base64File }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
        }
    });

    it('should handle upload failure', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) SUCCESS
        requestMocks.post.mockResolvedValue({ url: 'https://url', id: 'test-id', headers: {} });

        // Mock binary upload (PUT) FAILURE
        requestMocks.put.mockRejectedValue(new Error('Upload failed'));

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');

        const request = createMockRequest({
            data: { file: base64File }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toThrow();

        try {
            await importActivityToSuuntoApp(request as any);
        } catch (e: any) {
            expect(e.code).toBe('internal');
        }
    });

    it('should increment uploadedActivitiesCount on successful upload', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST)
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: {}
        });

        // Mock binary upload (PUT)
        requestMocks.put.mockResolvedValue({});

        // Mock status check (GET)
        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'test-workout-key' });

        const fileContent = Buffer.from('data');
        const base64File = fileContent.toString('base64');

        const request = createMockRequest({
            data: { file: base64File }
        });

        await importActivityToSuuntoApp(request as any);

        // Verification of Firestore call
        const admin = await import('firebase-admin');
        const setMock = admin.firestore().collection('users').doc('test-user-id').collection('meta').doc('SuuntoApp').set;
        expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
            uploadedActivitiesCount: expect.any(Object)
        }), expect.objectContaining({ merge: true }));
    }, 30000);
});
