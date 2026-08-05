'use strict';

import { describe, it, vi, expect, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
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

const disconnectPendingMocks = {
    isServiceDisconnectPendingForUser: vi.fn(),
};

vi.mock('../service-disconnect-pending', () => ({
    isServiceDisconnectPendingForUser: (...args: unknown[]) => disconnectPendingMocks.isServiceDisconnectPendingForUser(...args),
}));

vi.mock('../service-auth-lifecycle', () => ({
    extractRefreshFailureDetails: (error: any) => {
        const statusCode = error?.statusCode || error?.output?.statusCode || null;
        const providerErrorCode = `${error?.data?.payload?.error || error?.data?.error || error?.error?.error || ''}`.trim();
        const providerErrorMessage = `${
            error?.data?.payload?.error_description
            || error?.data?.payload?.message
            || error?.data?.error_description
            || error?.error?.error_description
            || error?.message
            || providerErrorCode
            || ''
        }`.trim();
        const isInvalidGrant = [providerErrorCode, providerErrorMessage, `${error?.message || ''}`]
            .some(value => value.toLowerCase().includes('invalid_grant'));
        return {
            statusCode,
            providerErrorCode: providerErrorCode || null,
            providerErrorMessage: providerErrorMessage || null,
            isInvalidGrant,
            isTerminalAuthFailure: statusCode === 401 || isInvalidGrant,
            isTransientError: false,
            logMessage: providerErrorMessage || providerErrorCode || 'Unknown token refresh failure',
        };
    },
    isTerminalRefreshFailureForService: (serviceName: ServiceNames, failure: {
        isInvalidGrant: boolean;
        isTerminalAuthFailure: boolean;
        statusCode: number | null;
    }) => !(serviceName === ServiceNames.SuuntoApp
        && failure.isInvalidGrant
        && failure.statusCode === 400)
        && failure.isTerminalAuthFailure,
}));

const deletionGuardMocks = {
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
};

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
            details: unknown;
            constructor(code: string, message: string, details?: unknown) {
                super(message);
                this.code = code;
                this.details = details;
                this.name = 'HttpsError';
            }
        }
    };
});

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const setMock = vi.fn();
    const runTransactionMock = vi.fn();

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
        runTransaction: runTransactionMock,
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
import {
    getSuuntoActivityUploadStatus,
    importActivityToSuuntoApp,
    recordSuccessfulSuuntoActivityUploadForQueueItem,
    resumeSuuntoActivityBlobUpload,
    uploadActivityFileToSuunto,
} from './activities';
import { ProviderOperationError } from '../shared/provider-operation-error';

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

const activeUserGuard = {
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
};

const deletedUserGuard = {
    userExists: true,
    deletionInProgress: true,
    shouldSkip: true,
};

describe('importActivityToSuuntoApp', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Default happy path
        utilsMocks.hasProAccess.mockResolvedValue(true);
        disconnectPendingMocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
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
        const admin = await import('firebase-admin');
        const setMock = (admin.firestore() as any)
            .collection('users')
            .doc('test-user-id')
            .collection('meta')
            .doc('SuuntoApp')
            .set;
        (admin.firestore() as any).runTransaction.mockImplementation(
            async (runner: (transaction: {
                get: (...args: any[]) => unknown;
                set: (...args: any[]) => unknown;
            }) => unknown) => runner({
                get: vi.fn(async () => ({ exists: true, data: () => ({}) })),
                set: setMock,
            }),
        );
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
            url: 'https://cloudapi.suunto.com/v2/upload',
            headers: expect.objectContaining({
                'Authorization': 'Bearer fake-access-token',
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': 'test-key',
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

        // 3. Check Status Polling Auth Header
        expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({
                'Authorization': 'Bearer fake-access-token',
                'Ocp-Apim-Subscription-Key': 'test-key',
            }),
        }));

        // 3. Success Response
        expect(result).toEqual(expect.objectContaining({ status: 'success' }));
        expect(result).not.toHaveProperty('providerUserId');
    }, 30000);

    it('should not double-prefix Authorization header when token already has Bearer', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'Bearer preformatted-token' });

        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: { 'x-ms-blob-type': 'BlockBlob' }
        });
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'test-workout-key' });

        const fileContent = Buffer.from('fake-fit-file-content');
        const request = createMockRequest({
            data: { file: fileContent.toString('base64') }
        });

        await importActivityToSuuntoApp(request as any);

        expect(requestMocks.post).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({
                'Authorization': 'Bearer preformatted-token',
            }),
        }));
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
            code: 'failed-precondition',
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

    it('should preserve Suunto rate limiting as resource exhausted for direct uploads', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockRejectedValue(createStatusCodeError('Too Many Requests', 429));
        const request = createMockRequest({
            data: { file: Buffer.from('rate-limited').toString('base64') },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'resource-exhausted',
            message: 'Suunto activity upload is temporarily unavailable. Please retry.',
        });
        expect(requestMocks.put).not.toHaveBeenCalled();
    });

    it('should normalize a status-less transport failure as temporarily unavailable', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockRejectedValue(Object.assign(
            new Error('socket closed before a response'),
            { code: 'ECONNRESET' },
        ));

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                code: 'unavailable',
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
            } satisfies Partial<ProviderOperationError>);
        expect(requestMocks.post).toHaveBeenCalledTimes(3);
    });

    it.each([
        ['HTTP 408', () => createStatusCodeError('Request Timeout', 408)],
        ['HTTP 503', () => createStatusCodeError('Service Unavailable', 503)],
        ['transport reset', () => Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })],
    ])('should resume the issued upload after an ambiguous blob PUT failure: %s', async (_name, createError) => {
        vi.useFakeTimers();
        try {
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.post.mockResolvedValue({
                id: 'ambiguous-blob-upload-id',
                url: 'https://storage.suunto.com/ambiguous-blob-upload-url',
                headers: {},
            });
            requestMocks.put.mockRejectedValue(createError());

            const rejection = expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
                .rejects.toMatchObject({
                    name: 'ProviderOperationError',
                    disposition: 'retryable',
                    retryMode: 'resume',
                    operation: 'activity_upload_blob',
                    providerUserId: 'token1',
                    providerOperationId: 'ambiguous-blob-upload-id',
                    dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
                } satisfies Partial<ProviderOperationError>);

            await vi.runAllTimersAsync();
            await rejection;
            expect(requestMocks.post).toHaveBeenCalledTimes(1);
            expect(requestMocks.put).toHaveBeenCalledTimes(3);
            expect(requestMocks.get).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([401, 403])('should not classify a signed blob HTTP %s as an OAuth failure', async (statusCode) => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'rejected-continuation-upload-id',
            url: 'https://storage.suunto.com/rejected-continuation-upload-url',
            headers: {},
        });
        requestMocks.put.mockRejectedValue(createStatusCodeError('Signed URL rejected', statusCode));

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                operation: 'activity_upload_blob',
                disposition: 'permanent',
                retryMode: 'none',
                code: 'failed-precondition',
                providerOperationId: 'rejected-continuation-upload-id',
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_CONTINUATION_REJECTED',
            } satisfies Partial<ProviderOperationError>);

        expect(requestMocks.post).toHaveBeenCalledTimes(1);
        expect(requestMocks.put).toHaveBeenCalledTimes(1);
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should persist issued upload identifiers before sending the activity blob', async () => {
        vi.useFakeTimers();
        try {
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.post.mockResolvedValue({
                id: 'pre-blob-state-upload-id',
                url: 'https://storage.suunto.com/pre-blob-state-upload-url',
                headers: {},
            });
            const persistUploadStateBeforeBlob = vi.fn().mockResolvedValue(true);
            requestMocks.put.mockImplementation(async () => {
                expect(persistUploadStateBeforeBlob).toHaveBeenCalledWith({
                    uploadId: 'pre-blob-state-upload-id',
                    providerUserId: 'token1',
                    blobContinuation: {
                        uploadUrl: 'https://storage.suunto.com/pre-blob-state-upload-url',
                        uploadHeaders: {},
                    },
                });
                return {};
            });
            requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'workout-key' });

            const uploadPromise = uploadActivityFileToSuunto('test-user-id', Buffer.from('data'), {
                persistUploadStateBeforeBlob,
            });
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'pre-blob-state-upload-id',
            });

            expect(persistUploadStateBeforeBlob).toHaveBeenCalledTimes(1);
            expect(requestMocks.put).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should refresh only the status poll after a 401 without initializing or sending the blob again', async () => {
        vi.useFakeTimers();
        try {
            tokensMocks.getTokenData
                .mockResolvedValueOnce({ accessToken: 'initial-access-token' })
                .mockResolvedValueOnce({ accessToken: 'initial-access-token' })
                .mockResolvedValueOnce({ accessToken: 'refreshed-access-token' });
            requestMocks.post.mockResolvedValue({
                id: 'status-refresh-upload-id',
                url: 'https://storage.suunto.com/status-refresh-upload-url',
                headers: {},
            });
            requestMocks.put.mockResolvedValue({});
            requestMocks.get
                .mockRejectedValueOnce(createStatusCodeError('Unauthorized', 401))
                .mockResolvedValueOnce({ status: 'PROCESSED', workoutKey: 'workout-key' });

            const uploadPromise = uploadActivityFileToSuunto('test-user-id', Buffer.from('data'));
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'status-refresh-upload-id',
            });

            expect(requestMocks.post).toHaveBeenCalledTimes(1);
            expect(requestMocks.put).toHaveBeenCalledTimes(1);
            expect(requestMocks.get).toHaveBeenCalledTimes(2);
            expect(tokensMocks.getTokenData).toHaveBeenNthCalledWith(3, expect.anything(), 'suuntoApp', true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should not replay the persisted signed blob when the existing upload is already processed', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            tokenDocumentGet.mockResolvedValueOnce({
                exists: true,
                id: 'token1',
                data: () => ({}),
            });
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.put.mockResolvedValue({});
            requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'resumed-workout-key' });

            const loadFile = vi.fn().mockResolvedValue(Buffer.from('data'));
            const uploadPromise = resumeSuuntoActivityBlobUpload('test-user-id', loadFile, {
                uploadId: 'persisted-upload-id',
                providerUserId: 'token1',
                blobContinuation: {
                    uploadUrl: 'https://storage.suunto.com/persisted-upload?signature=keep%2Bexact',
                    uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
                },
            });
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'persisted-upload-id',
            });

            expect(requestMocks.post).not.toHaveBeenCalled();
            expect(requestMocks.put).not.toHaveBeenCalled();
            expect(loadFile).not.toHaveBeenCalled();
            expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://cloudapi.suunto.com/v2/upload/persisted-upload-id',
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('should replay the exact persisted signed blob when the existing upload is still new', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            tokenDocumentGet
                .mockResolvedValueOnce({
                    exists: true,
                    id: 'token1',
                    data: () => ({}),
                })
                .mockResolvedValueOnce({
                    exists: true,
                    id: 'token1',
                    data: () => ({}),
                });
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.put.mockResolvedValue({});
            requestMocks.get
                .mockResolvedValueOnce({ status: 'NEW' })
                .mockResolvedValueOnce({ status: 'PROCESSED', workoutKey: 'resumed-workout-key' });

            const loadFile = vi.fn().mockResolvedValue(Buffer.from('data'));
            const uploadPromise = resumeSuuntoActivityBlobUpload('test-user-id', loadFile, {
                uploadId: 'persisted-upload-id',
                providerUserId: 'token1',
                blobContinuation: {
                    uploadUrl: 'https://storage.suunto.com/persisted-upload?signature=keep%2Bexact',
                    uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
                },
            });
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'persisted-upload-id',
            });

            expect(requestMocks.put).toHaveBeenCalledWith({
                headers: { 'x-ms-blob-type': 'BlockBlob' },
                json: false,
                url: 'https://storage.suunto.com/persisted-upload?signature=keep%2Bexact',
                body: Buffer.from('data'),
            });
            expect(loadFile).toHaveBeenCalledTimes(1);
            expect(requestMocks.get).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should preserve status resume identifiers when forced token refresh hits temporary invalid_grant', async () => {
        vi.useFakeTimers();
        try {
            const temporaryInvalidGrant = Object.assign(new Error('invalid_grant during Suunto outage'), {
                statusCode: 400,
                error: {
                    error: 'invalid_grant',
                    error_description: 'Temporary provider outage',
                },
            });
            tokensMocks.getTokenData
                .mockResolvedValueOnce({ accessToken: 'initial-access-token' })
                .mockResolvedValueOnce({ accessToken: 'initial-access-token' })
                .mockRejectedValueOnce(temporaryInvalidGrant);
            requestMocks.post.mockResolvedValue({
                id: 'post-blob-refresh-upload-id',
                url: 'https://storage.suunto.com/post-blob-refresh-upload',
                headers: {},
            });
            requestMocks.put.mockResolvedValue({});
            requestMocks.get.mockRejectedValueOnce(createStatusCodeError('Unauthorized', 401));

            const uploadPromise = uploadActivityFileToSuunto('test-user-id', Buffer.from('data'))
                .catch(error => error);
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                name: 'ProviderOperationError',
                operation: 'activity_upload_status',
                disposition: 'retryable',
                retryMode: 'resume',
                providerOperationId: 'post-blob-refresh-upload-id',
                providerUserId: 'token1',
            });

            expect(requestMocks.post).toHaveBeenCalledTimes(1);
            expect(requestMocks.put).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should normalize terminal token refresh cleanup as auth required', async () => {
        const terminalAuthError = Object.assign(new Error('Suunto connection requires reconnect'), {
            name: 'TerminalServiceAuthError',
            statusCode: 401,
            providerErrorCode: 'invalid_token',
            providerErrorMessage: 'Refresh token revoked',
            providerUserId: 'token1',
            dlqContext: 'AUTH_RECONNECT_REQUIRED',
        });
        tokensMocks.getTokenData.mockRejectedValueOnce(terminalAuthError);
        const request = createMockRequest({
            data: { file: Buffer.from('terminal-auth-data').toString('base64') },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'unauthenticated',
            details: { retryMode: 'none' },
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
    });

    it('should preserve direct resume identifiers when authentication interrupts status polling', async () => {
        const admin = await import('firebase-admin');
        const tokenDocumentGet = (admin.firestore() as any)
            .collection('suuntoAppAccessTokens')
            .doc('test-user-id')
            .collection('tokens')
            .doc('token1')
            .get;
        tokenDocumentGet.mockResolvedValueOnce({
            exists: true,
            id: 'token1',
            data: () => ({}),
        });
        tokensMocks.getTokenData.mockRejectedValueOnce(Object.assign(new Error('Refresh token revoked'), {
            name: 'TerminalServiceAuthError',
            statusCode: 401,
            providerErrorCode: 'invalid_token',
            providerUserId: 'token1',
            dlqContext: 'AUTH_RECONNECT_REQUIRED',
        }));
        const request = createMockRequest({
            data: {
                resumeUploadId: 'direct-resume-upload-id',
                resumeProviderUserId: 'token1',
            },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'unauthenticated',
            details: {
                retryMode: 'resume',
                resumeUploadId: 'direct-resume-upload-id',
                resumeProviderUserId: 'token1',
            },
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should not send the activity blob when issued upload identifiers cannot be persisted', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'unpersisted-upload-id',
            url: 'https://storage.suunto.com/unpersisted-upload-url',
            headers: {},
        });
        const persistenceError = Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' });

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data'), {
            persistUploadStateBeforeBlob: vi.fn().mockRejectedValue(persistenceError),
        })).rejects.toMatchObject({
            name: 'SuuntoActivityUploadStatePersistenceError',
            code: 'unavailable',
            uploadId: 'unpersisted-upload-id',
            providerUserId: 'token1',
        });

        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should stop before the activity blob when guarded upload-state persistence removes the queue item', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'deleted-user-upload-id',
            url: 'https://storage.suunto.com/deleted-user-upload-url',
            headers: {},
        });

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data'), {
            persistUploadStateBeforeBlob: vi.fn().mockResolvedValue(false),
        })).rejects.toMatchObject({
            name: 'SuuntoActivityUploadStatePersistenceSkippedError',
            code: 'user_deleted_or_deleting',
            uploadId: 'deleted-user-upload-id',
        });

        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should return resumable identifiers when a direct blob upload has an ambiguous outcome', async () => {
        vi.useFakeTimers();
        try {
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.post.mockResolvedValue({
                id: 'direct-resume-upload-id',
                url: 'https://storage.suunto.com/direct-resume-upload-url',
                headers: {},
            });
            requestMocks.put.mockRejectedValue(createStatusCodeError('Gateway Timeout', 504));
            const request = createMockRequest({
                data: { file: Buffer.from('direct-resume-data').toString('base64') },
            });

            const rejection = expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
                code: 'unavailable',
                details: {
                    retryMode: 'resume',
                    resumeUploadId: 'direct-resume-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });
            await vi.runAllTimersAsync();
            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });

    it('should resume a direct upload from callable identifiers without initializing or sending the blob again', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            tokenDocumentGet.mockResolvedValueOnce({
                exists: true,
                id: 'token1',
                data: () => ({}),
            });
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'resumed-workout-key' });
            const request = createMockRequest({
                data: {
                    resumeUploadId: 'direct-resume-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });

            const uploadPromise = importActivityToSuuntoApp(request as any);
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'direct-resume-upload-id',
                workoutKey: 'resumed-workout-key',
            });

            expect(requestMocks.post).not.toHaveBeenCalled();
            expect(requestMocks.put).not.toHaveBeenCalled();
            expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://cloudapi.suunto.com/v2/upload/direct-resume-upload-id',
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('should replace a resumed direct upload only after Suunto confirms the original job is still empty', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            tokenDocumentGet.mockResolvedValueOnce({
                exists: true,
                id: 'token1',
                data: () => ({}),
            });
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.get.mockImplementation(({ url }: { url: string }) => Promise.resolve(
                url.endsWith('/direct-empty-upload-id')
                    ? { status: 'NEW' }
                    : { status: 'PROCESSED', workoutKey: 'replacement-workout-key' },
            ));
            requestMocks.post.mockResolvedValue({
                id: 'replacement-upload-id',
                url: 'https://storage.suunto.com/replacement-upload-url',
                headers: {},
            });
            requestMocks.put.mockResolvedValue({});
            const request = createMockRequest({
                data: {
                    file: Buffer.from('direct-resume-data').toString('base64'),
                    resumeUploadId: 'direct-empty-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });

            const uploadPromise = importActivityToSuuntoApp(request as any);
            await vi.runAllTimersAsync();
            await expect(uploadPromise).resolves.toMatchObject({
                status: 'success',
                uploadId: 'replacement-upload-id',
                workoutKey: 'replacement-workout-key',
            });

            expect(requestMocks.get).toHaveBeenCalledTimes(11);
            expect(requestMocks.post).toHaveBeenCalledTimes(1);
            expect(requestMocks.put).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://storage.suunto.com/replacement-upload-url',
                body: Buffer.from('direct-resume-data'),
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('should not replace a resumed direct upload when Suunto omits the provider status', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            tokenDocumentGet.mockResolvedValueOnce({
                exists: true,
                id: 'token1',
                data: () => ({}),
            });
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.get.mockResolvedValue({});
            const request = createMockRequest({
                data: {
                    file: Buffer.from('direct-resume-data').toString('base64'),
                    resumeUploadId: 'direct-unknown-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });

            const uploadPromise = importActivityToSuuntoApp(request as any);
            const rejection = expect(uploadPromise).rejects.toMatchObject({
                code: 'unavailable',
                details: {
                    retryMode: 'resume',
                    resumeUploadId: 'direct-unknown-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });
            await vi.runAllTimersAsync();
            await rejection;

            expect(requestMocks.get).toHaveBeenCalledTimes(10);
            expect(requestMocks.post).not.toHaveBeenCalled();
            expect(requestMocks.put).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should reject malformed direct-upload base64 before any provider request', async () => {
        const request = createMockRequest({
            data: { file: 'not-base64!' },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'invalid-argument',
            message: 'File content is not valid base64.',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should reject incomplete direct-upload resume identifiers before any provider request', async () => {
        const request = createMockRequest({
            data: {
                file: Buffer.from('direct-resume-data').toString('base64'),
                resumeUploadId: 'direct-resume-upload-id',
            },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'invalid-argument',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it.each(['..\\routes', '../routes', 'upload%2Froutes'])('should reject unsafe Suunto upload identifier %s', async (resumeUploadId) => {
        const request = createMockRequest({
            data: {
                file: Buffer.from('direct-resume-data').toString('base64'),
                resumeUploadId,
                resumeProviderUserId: 'token1',
            },
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'invalid-argument',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should keep the temporary Suunto invalid_grant outage failure retryable', async () => {
        const refreshError: any = new Error('Response Error: 400 Bad Request');
        refreshError.statusCode = 400;
        refreshError.data = {
            payload: {
                error: 'invalid_grant',
                error_description: 'User no longer active/connected with the partner',
            },
        };
        tokensMocks.getTokenData.mockRejectedValue(refreshError);

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                code: 'unavailable',
                statusCode: 400,
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
            } satisfies Partial<ProviderOperationError>);
        expect(requestMocks.post).not.toHaveBeenCalled();
    });

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

    it('returns a callable-safe pending-disconnect error before starting an upload', async () => {
        disconnectPendingMocks.isServiceDisconnectPendingForUser.mockResolvedValue(true);

        await expect(importActivityToSuuntoApp(createMockRequest({
            data: { file: Buffer.from('FIT').toString('base64') },
        }) as any)).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'Suunto disconnect is pending.',
        });

        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
    });

    it('should surface a vague provider processing error as temporarily unavailable', async () => {
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
            expect(e.code).toBe('unavailable');
            expect(e.message).toBe('Suunto activity upload is temporarily unavailable. Please retry.');
        }
        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'unavailable',
        });
    });

    it('should expose a typed restart decision for a vague provider processing error', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'typed-error-upload-id',
            url: 'https://storage.suunto.com/typed-error-upload-url',
            headers: {},
        });
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'ERROR', message: 'Internal error' });

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                operation: 'activity_upload_status',
                providerUserId: 'token1',
                providerOperationId: 'typed-error-upload-id',
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
            } satisfies Partial<ProviderOperationError>);
    });

    it('should expose an explicit permanent decision for rejected FIT content', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'permanent-error-upload-id',
            url: 'https://storage.suunto.com/permanent-error-upload-url',
            headers: {},
        });
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'ERROR', message: 'Unsupported FIT file format' });

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'permanent',
                retryMode: 'none',
                providerOperationId: 'permanent-error-upload-id',
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_REJECTED',
            } satisfies Partial<ProviderOperationError>);
    });

    it('should not treat an ambiguous invalid-token processing message as a permanent FIT rejection', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'invalid-token-upload-id',
            url: 'https://storage.suunto.com/invalid-token-upload-url',
            headers: {},
        });
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'ERROR', message: 'Invalid token state' });

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'ProviderOperationError',
                disposition: 'retryable',
                retryMode: 'restart',
                providerOperationId: 'invalid-token-upload-id',
                dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
            } satisfies Partial<ProviderOperationError>);
    });

    it('should resume an existing upload without initializing or uploading the FIT again', async () => {
        const admin = await import('firebase-admin');
        const tokenDocumentGet = (admin.firestore() as any)
            .collection('suuntoAppAccessTokens')
            .doc('test-user-id')
            .collection('tokens')
            .doc('token1')
            .get;
        tokenDocumentGet.mockResolvedValueOnce({
            exists: true,
            id: 'token1',
            data: () => ({}),
        });
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'resumed-workout-key' });

        const result = await getSuuntoActivityUploadStatus(
            'test-user-id',
            'existing-upload-id',
            'token1',
        );

        expect(result).toMatchObject({
            status: 'success',
            uploadId: 'existing-upload-id',
            providerUserId: 'token1',
            workoutKey: 'resumed-workout-key',
        });
        expect(requestMocks.get).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/v2/upload/existing-upload-id',
        }));
        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect((admin.firestore() as any).runTransaction).not.toHaveBeenCalled();
    });

    it('should count a resumed queue upload only once for the same upload ID', async () => {
        const admin = await import('firebase-admin');
        const queueItemRef = {} as any;
        const queueItemData: Record<string, unknown> = {
            destinationUploadID: 'existing-upload-id',
        };
        const transaction = {
            get: vi.fn(async () => ({
                exists: true,
                data: () => ({ ...queueItemData }),
            })),
            set: vi.fn(),
            update: vi.fn((_ref: unknown, updateData: Record<string, unknown>) => {
                Object.assign(queueItemData, updateData);
            }),
        };
        (admin.firestore() as any).runTransaction.mockImplementation(
            async (runner: (transactionArg: typeof transaction) => unknown) => runner(transaction),
        );

        await recordSuccessfulSuuntoActivityUploadForQueueItem(
            'test-user-id',
            queueItemRef,
            'existing-upload-id',
        );
        await recordSuccessfulSuuntoActivityUploadForQueueItem(
            'test-user-id',
            queueItemRef,
            'existing-upload-id',
        );

        expect(transaction.set).toHaveBeenCalledTimes(1);
        expect(transaction.update).toHaveBeenCalledTimes(1);
        expect(transaction.update).toHaveBeenCalledWith(queueItemRef, expect.objectContaining({
            destinationUploadCountedID: 'existing-upload-id',
            destinationUploadCountedAt: expect.any(Number),
        }));
    });

    it('should not count a completed upload after the queue item has been replaced with another upload', async () => {
        const admin = await import('firebase-admin');
        const queueItemRef = {} as any;
        const transaction = {
            get: vi.fn(async () => ({
                exists: true,
                data: () => ({ destinationUploadID: 'newer-upload-id' }),
            })),
            set: vi.fn(),
            update: vi.fn(),
        };
        (admin.firestore() as any).runTransaction.mockImplementation(
            async (runner: (transactionArg: typeof transaction) => unknown) => runner(transaction),
        );

        await recordSuccessfulSuuntoActivityUploadForQueueItem(
            'test-user-id',
            queueItemRef,
            'older-upload-id',
        );

        expect(transaction.set).not.toHaveBeenCalled();
        expect(transaction.update).not.toHaveBeenCalled();
    });

    it('should count a resumed direct upload only once for the same upload ID', async () => {
        vi.useFakeTimers();
        try {
            const admin = await import('firebase-admin');
            const tokenDocumentGet = (admin.firestore() as any)
                .collection('suuntoAppAccessTokens')
                .doc('test-user-id')
                .collection('tokens')
                .doc('token1')
                .get;
            const tokenDocumentSnapshot = {
                exists: true,
                id: 'token1',
                data: () => ({}),
            };
            tokenDocumentGet
                .mockResolvedValueOnce(tokenDocumentSnapshot)
                .mockResolvedValueOnce(tokenDocumentSnapshot);
            tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
            requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'resumed-workout-key' });

            const serviceMetaData: Record<string, unknown> = {};
            const transaction = {
                get: vi.fn(async () => ({
                    exists: true,
                    data: () => ({ ...serviceMetaData }),
                })),
                set: vi.fn((_ref: unknown, updateData: Record<string, unknown>) => {
                    Object.assign(serviceMetaData, updateData);
                }),
            };
            (admin.firestore() as any).runTransaction.mockImplementation(
                async (runner: (transactionArg: typeof transaction) => unknown) => runner(transaction),
            );
            const request = createMockRequest({
                data: {
                    file: Buffer.from('direct-resume-data').toString('base64'),
                    resumeUploadId: 'direct-resume-upload-id',
                    resumeProviderUserId: 'token1',
                },
            });

            const firstUpload = importActivityToSuuntoApp(request as any);
            await vi.runAllTimersAsync();
            await firstUpload;
            const secondUpload = importActivityToSuuntoApp(request as any);
            await vi.runAllTimersAsync();
            await secondUpload;

            expect(transaction.set).toHaveBeenCalledTimes(1);
            expect(transaction.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                recentDirectActivityUploadCountedIDs: ['direct-resume-upload-id'],
                uploadedActivitiesCount: expect.any(Object),
            }), { merge: true });
        } finally {
            vi.useRealTimers();
        }
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

    it('should reject files larger than 20MB before uploading to Suunto', async () => {
        const request = createMockRequest({
            data: { file: Buffer.alloc((20 * 1024 * 1024) + 1).toString('base64') }
        });

        await expect(importActivityToSuuntoApp(request as any)).rejects.toMatchObject({
            code: 'invalid-argument',
            message: 'Cannot upload activity because the size is greater than 20MB'
        });
        expect(requestMocks.post).not.toHaveBeenCalled();
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
        expect(setMock).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            uploadedActivitiesCount: expect.any(Object)
        }), expect.objectContaining({ merge: true }));
    }, 30000);

    it('should not increment uploadedActivitiesCount when deletion starts after upload success', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: {}
        });
        requestMocks.put.mockResolvedValue({});
        requestMocks.get.mockResolvedValue({ status: 'PROCESSED', workoutKey: 'test-workout-key' });
        deletionGuardMocks.getUserDeletionGuardState.mockResolvedValue(activeUserGuard);
        deletionGuardMocks.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce(deletedUserGuard);

        const result = await uploadActivityFileToSuunto('test-user-id', Buffer.from('data'));

        expect(result).toEqual(expect.objectContaining({
            status: 'success',
            workoutKey: 'test-workout-key',
        }));
        const admin = await import('firebase-admin');
        const setMock = admin.firestore().collection('users').doc('test-user-id').collection('meta').doc('SuuntoApp').set;
        expect(setMock).not.toHaveBeenCalled();
    }, 30000);

    it('should skip Suunto upload before token lookup when account deletion is active', async () => {
        deletionGuardMocks.getUserDeletionGuardState.mockResolvedValueOnce(deletedUserGuard);

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'SuuntoActivityUploadSkippedForDeletedUserError',
                code: 'user_deleted_or_deleting',
                phase: 'before_token_lookup',
            });

        expect(tokensMocks.getTokenData).not.toHaveBeenCalled();
        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should skip Suunto upload before remote initialization when account deletion starts after token lookup', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        deletionGuardMocks.getUserDeletionGuardState
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(deletedUserGuard);

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'SuuntoActivityUploadSkippedForDeletedUserError',
                phase: 'before_init_upload',
            });

        expect(tokensMocks.getTokenData).toHaveBeenCalled();
        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should preserve deletion guard read failures as retryable errors during upload', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        deletionGuardMocks.getUserDeletionGuardState
            .mockResolvedValueOnce(activeUserGuard)
            .mockRejectedValueOnce(new Error('guard unavailable'));

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'UserDeletionGuardReadError',
                code: 'unavailable',
                statusCode: 503,
            });

        expect(tokensMocks.getTokenData).toHaveBeenCalled();
        expect(requestMocks.post).not.toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    });

    it('should skip Suunto upload before blob upload when account deletion starts after init', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: {}
        });
        deletionGuardMocks.getUserDeletionGuardState
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(deletedUserGuard);

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'SuuntoActivityUploadSkippedForDeletedUserError',
                phase: 'before_blob_upload',
            });

        expect(requestMocks.post).toHaveBeenCalled();
        expect(requestMocks.put).not.toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    }, 30000);

    it('should skip Suunto upload before status polling when account deletion starts after blob upload', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'fake-access-token' });
        requestMocks.post.mockResolvedValue({
            id: 'test-upload-id',
            url: 'https://storage.suunto.com/upload-url',
            headers: {}
        });
        requestMocks.put.mockResolvedValue({});
        deletionGuardMocks.getUserDeletionGuardState
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(activeUserGuard)
            .mockResolvedValueOnce(deletedUserGuard);

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'SuuntoActivityUploadSkippedForDeletedUserError',
                phase: 'before_status_poll',
            });

        expect(requestMocks.post).toHaveBeenCalled();
        expect(requestMocks.put).toHaveBeenCalled();
        expect(requestMocks.get).not.toHaveBeenCalled();
    }, 30000);

    it('should propagate account-deletion token refresh skips from destination upload', async () => {
        tokensMocks.getTokenData.mockRejectedValueOnce(Object.assign(new Error('deleted'), {
            name: 'TokenRefreshSkippedForDeletedUserError',
        }));

        await expect(uploadActivityFileToSuunto('test-user-id', Buffer.from('data')))
            .rejects.toMatchObject({
                name: 'TokenRefreshSkippedForDeletedUserError',
            });

        expect(requestMocks.post).not.toHaveBeenCalled();
    });
});
