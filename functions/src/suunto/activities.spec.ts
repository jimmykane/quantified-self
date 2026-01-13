
import { describe, it, vi, expect, beforeEach } from 'vitest';

import * as admin from 'firebase-admin';
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
        // Add export helpers if needed, but usually default is enough if imported as * or default
    },
    // Also mock named exports if the implementation uses them specifically
    post: (...args: any[]) => requestMocks.post(...args),
    put: (...args: any[]) => requestMocks.put(...args),
    get: (...args: any[]) => requestMocks.get(...args),
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

// Mock firebase-functions to return the handler immediately so we can test it
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

    // Setup successfully query response
    getMock.mockResolvedValue({
        size: 1,
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

describe('importActivityToSuuntoApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default happy path
        utilsMocks.isCorsAllowed.mockReturnValue(true);
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue('test-user-id');
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

        // Mock Request and Response
        const fileContent = Buffer.from('fake-fit-file-content');
        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: fileContent,
            headers: { origin: 'http://localhost' },
            get: (header: string) => header === 'origin' ? 'http://localhost' : undefined // Basic checks
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        // Execute
        await importActivityToSuuntoApp(req, res);

        // Assertions
        expect(utilsMocks.getUserIDFromFirebaseToken).toHaveBeenCalled();
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
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
    });

    it('should block COMPATIBILITY check (CORS)', async () => {
        utilsMocks.isCorsAllowed.mockReturnValue(false);
        const req = {
            method: 'POST',
            get: vi.fn(),
        } as any;
        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith('Unauthorized');
    });

    it('should handle missing authentication', async () => {
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue(null);

        const req = {
            method: 'POST',
            get: vi.fn(),
            headers: { origin: 'http://localhost' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith('Unauthorized');
    });

    it('should block non-pro users', async () => {
        utilsMocks.isProUser.mockResolvedValue(false);

        const req = {
            method: 'POST',
            get: vi.fn(),
            headers: { origin: 'http://localhost' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(utilsMocks.getUserIDFromFirebaseToken).toHaveBeenCalled();
        expect(utilsMocks.isProUser).toHaveBeenCalledWith('test-user-id');
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send).toHaveBeenCalledWith(PRO_REQUIRED_MESSAGE);
    });

    it('should handle missing body', async () => {
        const req = {
            method: 'POST',
            // body is undefined
            get: vi.fn(),
            headers: { origin: 'http://localhost' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle invalid file content', async () => {
        const req = {
            method: 'POST',
            body: {},
            rawBody: Buffer.alloc(0), // Empty buffer
            get: vi.fn(),
            headers: { origin: 'http://localhost' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith('File content missing or invalid');
    });

    it('should handle initialization failure', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) FAILURE
        requestMocks.post.mockRejectedValue(new Error('Init failed'));

        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: Buffer.from('data'),
            headers: { origin: 'http://localhost' },
            get: vi.fn(),
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Init failed'); // Updated expectation
    });

    it('should handle upload failure', async () => {
        // Setup Mocks
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) SUCCESS
        requestMocks.post.mockResolvedValue(JSON.stringify({ url: 'https://url' }));

        // Mock binary upload (PUT) FAILURE
        requestMocks.put.mockRejectedValue(new Error('Upload failed'));

        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: Buffer.from('data'),
            headers: { origin: 'http://localhost' },
            get: vi.fn(),
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Upload failed');
    });

    it('should retry on 401 during initialization', async () => {
        // Setup Mocks
        tokensMocks.getTokenData
            .mockResolvedValueOnce({ accessToken: 'old-token' }) // 1st attempt
            .mockResolvedValueOnce({ accessToken: 'new-token' }); // 2nd attempt (force refresh)

        // Mock init upload (POST)
        // 1. Fail with 401
        // 2. Succeed
        requestMocks.post
            .mockRejectedValueOnce({ statusCode: 401, message: 'Unauthorized' })
            .mockResolvedValueOnce(JSON.stringify({
                id: 'test-upload-id-retry',
                url: 'https://storage.suunto.com/upload-url-retry',
                headers: {}
            }));

        // Mock binary upload (PUT) & Status (GET) for the successful retry
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue(JSON.stringify({ status: 'PROCESSED', workoutKey: 'retry-key' }));

        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: Buffer.from('data'),
            headers: { origin: 'http://localhost' },
            get: vi.fn(),
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        // Verify Retry Logic
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
        expect(tokensMocks.getTokenData).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), false);
        expect(tokensMocks.getTokenData).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), true);

        expect(requestMocks.post).toHaveBeenCalledTimes(2); // Initial + Retry
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
