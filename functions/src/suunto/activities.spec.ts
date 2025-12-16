
import { describe, it, vi, expect, beforeEach } from 'vitest';
import * as functions from 'firebase-functions-test';
import * as admin from 'firebase-admin';

// Mock dependencies BEFORE importing the module under test
const requestMocks = {
    post: vi.fn(),
    put: vi.fn(),
};

vi.mock('../request-helper', () => ({
    default: {
        post: (...args: any[]) => requestMocks.post(...args),
        put: (...args: any[]) => requestMocks.put(...args),
    },
    post: (...args: any[]) => requestMocks.post(...args),
    put: (...args: any[]) => requestMocks.put(...args),
}));

const utilsMocks = {
    getUserIDFromFirebaseToken: vi.fn(),
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
};

vi.mock('../utils', () => ({
    getUserIDFromFirebaseToken: (...args: any[]) => utilsMocks.getUserIDFromFirebaseToken(...args),
    isCorsAllowed: (...args: any[]) => utilsMocks.isCorsAllowed(...args),
    setAccessControlHeadersOnResponse: (...args: any[]) => utilsMocks.setAccessControlHeadersOnResponse(...args),
}));

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
    });

    it('should successfully upload an activity', async () => {
        // Setup Mocks
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue('test-user-id');
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST)
        requestMocks.post.mockResolvedValue(JSON.stringify({ url: 'https://storage.suunto.com/upload-url' }));

        // Mock binary upload (PUT)
        requestMocks.put.mockResolvedValue({});

        // Mock Request and Response
        const fileContent = Buffer.from('fake-fit-file-content');
        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: fileContent,
            headers: { origin: 'http://localhost' }
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
                'Content-Type': 'application/octet-stream'
            })
        }));

        // 3. Success Response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
    });

    it('should handle initialization failure', async () => {
        // Setup Mocks
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue('test-user-id');
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) FAILURE
        requestMocks.post.mockRejectedValue(new Error('Init failed'));

        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: Buffer.from('data'),
            headers: { origin: 'http://localhost' }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            set: vi.fn(),
        } as any;

        await importActivityToSuuntoApp(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Error'); // e.name for Error('Init failed') is 'Error'
    });

    it('should handle upload failure', async () => {
        // Setup Mocks
        utilsMocks.getUserIDFromFirebaseToken.mockResolvedValue('test-user-id');
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });

        // Mock init upload (POST) SUCCESS
        requestMocks.post.mockResolvedValue(JSON.stringify({ url: 'https://url' }));

        // Mock binary upload (PUT) FAILURE
        requestMocks.put.mockRejectedValue(new Error('Upload failed'));

        const req = {
            method: 'POST',
            body: { some: 'data' },
            rawBody: Buffer.from('data'),
            headers: { origin: 'http://localhost' }
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
});
