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

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const getMock = vi.fn();

    // Create a recursive mock structure
    const collectionMock: any = vi.fn();
    const docMock: any = vi.fn();

    const colObj = { doc: docMock, get: getMock };
    const docObj = { collection: collectionMock, get: getMock };

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
        firestore: () => firestoreMock,
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

describe('importActivityToSuuntoApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default happy path
        utilsMocks.isProUser.mockResolvedValue(true);
    });

    it('should successfully upload an activity', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST)
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: { 'x-ms-blob-type': 'BlockBlob', 'Custom-Header': 'Value' }
        }));

        // Mock status check (GET) - Polling simulation
        requestMocks.get
            .mockResolvedValueOnce(JSON.stringify({ status: 'NEW' }))
            .mockResolvedValueOnce(JSON.stringify({ status: 'PROCESSED', workoutKey: 'test-workout-key' }));

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
        expect(utilsMocks.isProUser).toHaveBeenCalledWith('test-user-id');
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
        requestMocks.post.mockResolvedValue(JSON.stringify({
            id: 'test-upload-id-dup',
            url: 'https://storage.suunto.com/upload-url-dup',
            headers: {}
        }));

        // Mock binary upload (PUT)
        requestMocks.put.mockResolvedValue({});

        // Mock status check (GET) - Returning "Already exists"
        requestMocks.get.mockResolvedValue(JSON.stringify({ status: 'ERROR', message: 'Already exists' }));

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
        utilsMocks.isProUser.mockResolvedValue(false);

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
        requestMocks.post.mockResolvedValue(JSON.stringify({ url: 'https://url', id: 'test-id', headers: {} }));

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
});
