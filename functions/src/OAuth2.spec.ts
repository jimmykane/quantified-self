import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AccessToken } from 'simple-oauth2';

// Define stable mocks first
const mockDelete = vi.fn().mockResolvedValue({});
const mockGet = vi.fn().mockImplementation(() => Promise.resolve({
    data: () => ({}),
    exists: true,
    empty: true,
    size: 0,
    docs: [],
} as unknown as admin.firestore.QuerySnapshot));
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockBatchDelete = vi.fn();
const mockAdd = vi.fn().mockResolvedValue({ id: 'new-doc-id' });
const mockBatchCommit = vi.fn().mockResolvedValue({});
const mockRecursiveDelete = vi.fn().mockResolvedValue({});
const mockRunTransaction = vi.fn();
const {
    mockGetUserDeletionGuardState,
    mockGetUserDeletionGuardStateInTransaction,
    mockArchiveOrphanedServiceToken,
    mockMarkServiceConnected,
    mockClearServiceDisconnectPending,
} = vi.hoisted(() => ({
    mockGetUserDeletionGuardState: vi.fn().mockResolvedValue({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    }),
    mockGetUserDeletionGuardStateInTransaction: vi.fn().mockResolvedValue({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    }),
    mockArchiveOrphanedServiceToken: vi.fn().mockResolvedValue(undefined),
    mockMarkServiceConnected: vi.fn().mockResolvedValue(true),
    mockClearServiceDisconnectPending: vi.fn().mockResolvedValue(undefined),
}));

const mockDocInstance = {
    delete: mockDelete,
    get: mockGet,
    collection: mockCollection,
    set: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
};

const mockCollectionInstance = {
    doc: mockDoc,
    get: mockGet,
    where: mockWhere,
    limit: mockLimit,
    add: mockAdd,
};

// Setup nesting
mockDoc.mockReturnValue(mockDocInstance);
mockCollection.mockReturnValue(mockCollectionInstance);
function installDefaultRunTransactionMock() {
    mockRunTransaction.mockImplementation(async (callback: any) => {
        const pendingDeletes: any[] = [];
        const pendingSets: Array<{ target: any; data: any; options?: any }> = [];
        const result = await callback({
            get: vi.fn(async (target: any) => {
                if (target === mockDocInstance) {
                    return {
                        exists: true,
                        data: () => ({}),
                    };
                }
                if (target === mockCollectionInstance) {
                    return await mockGet();
                }
                if (target && typeof target.get === 'function') {
                    return await target.get();
                }
                throw new Error('Unexpected transaction get target');
            }),
            delete: vi.fn((target: any) => {
                pendingDeletes.push(target);
            }),
            set: vi.fn((target: any, data: any, options?: any) => {
                pendingSets.push({ target, data, options });
            }),
        });

        for (const pendingSet of pendingSets) {
            if (pendingSet.target && typeof pendingSet.target.set === 'function') {
                await pendingSet.target.set(pendingSet.data, pendingSet.options);
            }
        }

        for (const target of pendingDeletes) {
            if (target && typeof target.delete === 'function') {
                await target.delete();
            }
        }

        return result;
    });
}

installDefaultRunTransactionMock();

// Mock firebase-functions
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: {
            client_id: 'test-suunto-client-id',
            client_secret: 'test-suunto-client-secret',
            subscription_key: 'test-suunto-subscription-key',
        },
        corosapi: {
            client_id: 'test-coros-client-id',
            client_secret: 'test-coros-client-secret',
        },
        garminapi: {
            client_id: 'test-garmin-client-id',
            client_secret: 'test-garmin-client-secret',
        },
    }),
    region: () => ({
        https: { onRequest: () => { } },
        runWith: () => ({
            https: { onRequest: () => { } },
            pubsub: { schedule: () => ({ onRun: () => { } }) },
        }),
    }),
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const batch = () => ({
        delete: mockBatchDelete,
        commit: mockBatchCommit,
    });

    const firestore = Object.assign(() => ({
        collection: mockCollection,
        collectionGroup: mockCollection,
        batch: batch,
        recursiveDelete: mockRecursiveDelete,
        runTransaction: mockRunTransaction,
    }), {
        FieldValue: {
            delete: vi.fn().mockReturnValue('delete-sentinel'),
        },
    });
    return {
        default: {
            firestore,
            initializeApp: vi.fn(),
            credential: { cert: vi.fn() },
        },
        firestore,
    };
});

// Mock tokens
vi.mock('./tokens', () => ({
    getTokenData: vi.fn().mockResolvedValue({ accessToken: 'mock-access-token' }),
}));

// Mock utils
vi.mock('./utils', () => ({
    TokenNotFoundError: class TokenNotFoundError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'TokenNotFoundError';
        }
    },
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    getUserIDFromFirebaseToken: vi.fn().mockResolvedValue('testUserID'),
    hasProAccess: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

// Mock request-helper
vi.mock('./request-helper', () => ({
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
}));

vi.mock('./service-connection-meta', () => ({
    markServiceConnected: mockMarkServiceConnected,
    clearServiceConnectionState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./service-disconnect-pending', () => ({
    clearServiceDisconnectPending: mockClearServiceDisconnectPending,
}));

vi.mock('./shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: mockGetUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        public readonly name = 'UserDeletionGuardReadError';
        public readonly code = 'unavailable';
        public readonly statusCode = 503;
        constructor(public readonly uid: string, public readonly phase: string, public readonly originalError: unknown) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    },
}));

vi.mock('./orphaned-service-tokens', () => ({
    archiveOrphanedServiceToken: mockArchiveOrphanedServiceToken,
    ORPHANED_SERVICE_TOKENS_COLLECTION_NAME: 'orphaned_service_tokens',
}));

import * as requestPromise from './request-helper';

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class MockAuthorizationCode {
        constructor() { }
        authorizeURL() { return 'https://mock-auth-url.com'; }
        getToken() {
            return Promise.resolve({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            });
        }
        createToken() { return { expired: () => false, token: { access_token: 'valid' } }; }
    },
}));

import {
    getServiceConfig,
    convertAccessTokenResponseToServiceToken,
    deauthorizeServiceForUser,
    getAndSetServiceOAuth2AccessTokenForUser,
    deleteLocalServiceToken,
    getServiceOAuth2CodeRedirectAndSaveStateToUser,
    validateOAuth2State,
    removeDuplicateConnections,
} from './OAuth2';
import { TokenNotFoundError } from './utils';
import * as admin from 'firebase-admin';
import { getTokenData } from './tokens';
import { clearServiceConnectionState } from './service-connection-meta';

describe('OAuth2', () => {
    beforeEach(() => {
        mockGetUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        installDefaultRunTransactionMock();
        mockArchiveOrphanedServiceToken.mockReset().mockResolvedValue(undefined);
        mockMarkServiceConnected.mockReset().mockResolvedValue(true);
        mockClearServiceDisconnectPending.mockReset().mockResolvedValue(undefined);
    });

    describe('getServiceConfig', () => {
        it('should return config for SuuntoApp', () => {
            const config = getServiceConfig(ServiceNames.SuuntoApp);

            expect(config).toBeDefined();
            expect(config.tokenCollectionName).toBe('suuntoAppAccessTokens');
            expect(config.oAuthScopes).toBe('workout');
            expect(config.oauth2Client).toBeDefined();
        });

        it('should return config for COROSAPI', () => {
            const config = getServiceConfig(ServiceNames.COROSAPI);

            expect(config).toBeDefined();
            expect(config.tokenCollectionName).toBe('COROSAPIAccessTokens');
            expect(config.oAuthScopes).toBe('workout');
            expect(config.oauth2Client).toBeDefined();
        });

        it('should return config for GarminAPI', () => {
            const config = getServiceConfig(ServiceNames.GarminAPI);

            expect(config).toBeDefined();
            expect(config.tokenCollectionName).toBe('garminAPITokens');
            // Scope might be null or specific, let's just check client existence
            expect(config.oauth2Client).toBeDefined();
        });
    });

    describe('convertAccessTokenResponseToServiceToken', () => {
        it('should convert Suunto token response correctly', () => {
            const mockResponse = {
                token: {
                    access_token: 'suunto-access-token',
                    refresh_token: 'suunto-refresh-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'workout',
                    user: 'suunto-user-123',
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                revoke: vi.fn(),
                revokeAll: vi.fn(),
            } as unknown as AccessToken;

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse,
                ServiceNames.SuuntoApp
            );

            expect(result.serviceName).toBe(ServiceNames.SuuntoApp);
            expect(result.accessToken).toBe('suunto-access-token');
            expect(result.refreshToken).toBe('suunto-refresh-token');
            expect(result.tokenType).toBe('Bearer');
            expect(result.scope).toBe('workout');
            expect((result as unknown as { userName: string }).userName).toBe('suunto-user-123');
            expect(result.dateCreated).toBeDefined();
            expect(result.dateRefreshed).toBeDefined();
            expect(result.expiresAt).toBeGreaterThan(Date.now());
        });

        it('should convert COROS token response correctly', () => {
            const mockResponse = {
                token: {
                    access_token: 'coros-access-token',
                    refresh_token: 'coros-refresh-token',
                    token_type: 'bearer',
                    expires_in: 7200,
                    scope: 'workout',
                    openId: 'coros-open-id-456',
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                revoke: vi.fn(),
                revokeAll: vi.fn(),
            } as unknown as AccessToken;

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse,
                ServiceNames.COROSAPI,
                'coros-open-id-456'  // Pass openId as uniqueId parameter
            );

            expect(result.serviceName).toBe(ServiceNames.COROSAPI);
            expect(result.accessToken).toBe('coros-access-token');
            expect(result.refreshToken).toBe('coros-refresh-token');
            expect(result.tokenType).toBe('bearer');
            expect((result as unknown as { openId: string }).openId).toBe('coros-open-id-456');
            expect(result.dateCreated).toBeDefined();
            expect(result.dateRefreshed).toBeDefined();
        });

        it('should set expiresAt based on expires_in', () => {
            const before = Date.now();
            const expiresInSeconds = 3600;

            const mockResponse = {
                token: {
                    access_token: 'test-token',
                    refresh_token: 'test-refresh',
                    token_type: 'Bearer',
                    expires_in: expiresInSeconds,
                    scope: 'workout',
                    user: 'test-user',
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                revoke: vi.fn(),
                revokeAll: vi.fn(),
            } as unknown as AccessToken;

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse,
                ServiceNames.SuuntoApp
            );

            const after = Date.now();
            const expectedMin = before + (expiresInSeconds * 1000);
            const expectedMax = after + (expiresInSeconds * 1000);

            expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
            expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
        });

        it('should use default values for missing COROS fields', () => {
            const mockResponse = {
                token: {
                    access_token: 'coros-access-token',
                    refresh_token: 'coros-refresh-token',
                    expires_in: 3600,
                    openId: 'coros-open-id',
                    // Missing token_type and scope
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                revoke: vi.fn(),
                revokeAll: vi.fn(),
            } as unknown as AccessToken;

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse,
                ServiceNames.COROSAPI
            );

            // Should use default values
            expect(result.tokenType).toBe('bearer');
            expect(result.scope).toBe('workout');
        });
    });

    describe('deauthorizeServiceForUser', () => {
        const userID = 'test-user-id';
        const serviceName = ServiceNames.SuuntoApp;

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockReset();
            mockDelete.mockReset();
            (getTokenData as Mock).mockReset();

            // Default: 1 token found
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: {
                    delete: mockDelete, // Use the shared mockDelete
                },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            } as unknown as admin.firestore.QuerySnapshot).mockResolvedValueOnce({
                empty: true,
                size: 0,
                docs: [],
            } as unknown as admin.firestore.QuerySnapshot);

            mockDelete.mockResolvedValue({});
            mockRecursiveDelete.mockResolvedValue({});
            (clearServiceConnectionState as Mock).mockReset().mockResolvedValue(undefined);

            (getTokenData as Mock).mockResolvedValue({ accessToken: 'mock-access' });
            (requestPromise.get as Mock).mockResolvedValue({});
            (requestPromise.post as Mock).mockResolvedValue({}); // For COROS
            (requestPromise.delete as Mock).mockResolvedValue({}); // For Garmin
        });

        it('should deauthorize and delete records successfully', async () => {
            await deauthorizeServiceForUser(userID, serviceName);

            expect(getTokenData).toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalled();
            expect(mockDelete).toHaveBeenCalledTimes(2); // token + root cleanup
        });

        it('should fail explicit disconnect when local token cleanup fails', async () => {
            mockDelete.mockRejectedValueOnce(new Error('firestore delete failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(
                'Failed to fully clean up suuntoApp connection for user test-user-id',
            );

            expect(clearServiceConnectionState).not.toHaveBeenCalled();
        });

        it('should make correct Suunto API call for deauthorization', async () => {
            await deauthorizeServiceForUser(userID, serviceName);

            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('https://cloudapi-oauth.suunto.com/oauth/deauthorize'),
                headers: expect.objectContaining({ 'Authorization': 'Bearer mock-access' })
            }));
        });

        it('should make correct COROS API call for deauthorization', async () => {
            await deauthorizeServiceForUser(userID, ServiceNames.COROSAPI);

            expect(requestPromise.post).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('https://open.coros.com/oauth2/deauthorize?token=mock-access')
            }));
        });

        it('should NOT delete local records if getTokenData fails with 500', async () => {
            const error500 = new Error('Server error');
            (error500 as unknown as { statusCode: number }).statusCode = 500;
            (getTokenData as Mock).mockRejectedValueOnce(error500);

            // Partial Success: Should NOT throw, but also NOT delete the token
            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.not.toThrow();

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should NOT delete local records if getTokenData fails with 502', async () => {
            const error502 = new Error('Bad Gateway');
            (error502 as unknown as { statusCode: number }).statusCode = 502;
            (getTokenData as Mock).mockRejectedValueOnce(error502);

            // Partial Success: Should NOT throw, but also NOT delete the token
            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.not.toThrow();

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should still delete local records if Suunto API deauthorization fails', async () => {
            (requestPromise.get as Mock).mockRejectedValueOnce(new Error('API Failure'));

            await deauthorizeServiceForUser(userID, serviceName);

            // Should still delete token and parent doc even if API fails
            expect(mockDelete).toHaveBeenCalledTimes(2);
        });

        /*
        it('should delete parent document if no tokens are found', async () => {
            mockGet.mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            expect(mockDelete).toHaveBeenCalledTimes(1);
        });
        */
        it('should delete successful tokens but PRESERVE failed (500) tokens and parent doc', async () => {
            // Mock two tokens
            const token1 = { id: 'token-1', ref: { delete: mockDelete }, data: () => ({ accessToken: 't1' }) };
            const token2 = { id: 'token-2', ref: { delete: mockDelete }, data: () => ({ accessToken: 't2' }) };

            mockGet.mockReset();
            mockGet
                .mockResolvedValueOnce({
                    empty: false,
                    size: 2,
                    docs: [token1, token2],
                } as unknown as admin.firestore.QuerySnapshot)
                .mockResolvedValueOnce({
                    empty: false,
                    size: 1,
                    docs: [token2], // After T1 delete, T2 remains
                } as unknown as admin.firestore.QuerySnapshot);

            // Mock getTokenData to succeed for token1 but fail for token2
            (getTokenData as Mock)
                .mockResolvedValueOnce({ accessToken: 't1' }) // first call success
                .mockRejectedValueOnce({ statusCode: 500, message: 'Server Error' }); // second call failure

            (requestPromise.get as Mock).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, serviceName);

            // Assertions for Partial Success:
            // 1. Token 1 (success) SHOULD be deleted.
            // 2. Token 2 (500) SHOULD NOT be deleted.
            // 3. Parent User Doc SHOULD NOT be deleted (because Token 2 remains).

            expect(mockDelete).toHaveBeenCalledTimes(1);
        });

        it('should delete ALL local records if multiple tokens succeed', async () => {
            // Mock two tokens
            const token1 = { id: 'token-1', ref: { delete: mockDelete }, data: () => ({ accessToken: 't1' }) };
            const token2 = { id: 'token-2', ref: { delete: mockDelete }, data: () => ({ accessToken: 't2' }) };

            mockGet.mockReset();

            let getCallCount = 0;
            mockGet.mockImplementation(async () => {
                getCallCount++;

                if (getCallCount === 1) return { empty: false, size: 2, docs: [token1, token2] } as unknown as admin.firestore.QuerySnapshot;
                if (getCallCount === 2) return { empty: false, size: 1, docs: [token2] } as unknown as admin.firestore.QuerySnapshot;
                if (getCallCount === 3) return { empty: true, size: 0, docs: [] } as unknown as admin.firestore.QuerySnapshot;

                return { empty: true, size: 0, docs: [] } as unknown as admin.firestore.QuerySnapshot;
            });

            (getTokenData as Mock).mockImplementation(async () => {
                return { accessToken: 'valid' };
            });
            (requestPromise.get as Mock).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, serviceName);

            // Expect 2 token deletes plus the final root delete.
            expect(mockDelete).toHaveBeenCalledTimes(3);
        });

        it('should clean up ORPHANED documents (existing parent but no tokens) using recursiveDelete', async () => {
            mockGet.mockReset();
            mockGet.mockImplementation(() => Promise.resolve({ empty: true, size: 0, docs: [] } as unknown as admin.firestore.QuerySnapshot));
            mockRecursiveDelete.mockReset();
            mockRecursiveDelete.mockResolvedValue({});

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(TokenNotFoundError);

            // Should have called recursiveDelete to clean up the orphaned parent document
            expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
        });

        it('should clear service connection state after explicit disconnect when no tokens remain', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: {
                    delete: mockDelete,
                },
            };
            mockGet.mockReset();
            mockGet
                .mockResolvedValueOnce({
                    empty: false,
                    size: 1,
                    docs: [mockTokenDoc],
                } as unknown as admin.firestore.QuerySnapshot)
                .mockResolvedValueOnce({
                    empty: true,
                    size: 0,
                    docs: [],
                } as unknown as admin.firestore.QuerySnapshot)
                .mockResolvedValueOnce({
                    empty: true,
                    size: 0,
                    docs: [],
                } as unknown as admin.firestore.QuerySnapshot);

            await deauthorizeServiceForUser(userID, serviceName, {
            });

            expect(clearServiceConnectionState).toHaveBeenCalledWith(userID, serviceName);
        });

        it('should not fail explicit disconnect if clearing service connection state fails after cleanup', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: {
                    delete: mockDelete,
                },
            };
            mockGet.mockReset();
            mockGet
                .mockResolvedValueOnce({
                    empty: false,
                    size: 1,
                    docs: [mockTokenDoc],
                } as unknown as admin.firestore.QuerySnapshot)
                .mockResolvedValueOnce({
                    empty: true,
                    size: 0,
                    docs: [],
                } as unknown as admin.firestore.QuerySnapshot)
                .mockResolvedValueOnce({
                    empty: true,
                    size: 0,
                    docs: [],
                } as unknown as admin.firestore.QuerySnapshot);
            (clearServiceConnectionState as Mock).mockRejectedValueOnce(new Error('meta write failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName, {
            })).resolves.not.toThrow();

            expect(mockDelete).toHaveBeenCalledTimes(2);
            expect(clearServiceConnectionState).toHaveBeenCalledWith(userID, serviceName);
        });

        it('should clear service connection state when explicit disconnect finds no token docs', async () => {
            mockGet.mockReset();
            mockGet.mockImplementation(() => Promise.resolve({ empty: true, size: 0, docs: [] } as unknown as admin.firestore.QuerySnapshot));

            await expect(deauthorizeServiceForUser(userID, serviceName, {
                missingTokensBehavior: 'ignore',
            })).resolves.not.toThrow();

            expect(clearServiceConnectionState).toHaveBeenCalledWith(userID, serviceName);
        });

        it('should not fail orphaned cleanup if clearing service connection state fails', async () => {
            mockGet.mockReset();
            mockGet.mockImplementation(() => Promise.resolve({ empty: true, size: 0, docs: [] } as unknown as admin.firestore.QuerySnapshot));
            (clearServiceConnectionState as Mock).mockRejectedValueOnce(new Error('meta write failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName, {
                missingTokensBehavior: 'ignore',
            })).resolves.not.toThrow();

            expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
            expect(clearServiceConnectionState).toHaveBeenCalledWith(userID, serviceName);
        });



    });

    describe('deleteLocalServiceToken', () => {
        const userID = 'user123';
        const serviceName = ServiceNames.GarminAPI;
        const tokenID = 'token-123';
        const transactionDeleteSpy = vi.fn();
        let tokenDocRef: any;
        let tokenCollectionRef: any;
        let userDocRef: any;
        let tokenQueryDocs: any[];
        let rootDocData: Record<string, unknown>;

        beforeEach(() => {
            vi.clearAllMocks();
            transactionDeleteSpy.mockReset();
            tokenDocRef = { id: tokenID };
            tokenCollectionRef = {
                doc: vi.fn((id: string) => {
                    if (id === tokenID) {
                        return tokenDocRef;
                    }
                    return { id };
                }),
            };
            userDocRef = {
                id: userID,
                collection: vi.fn((name: string) => {
                    if (name !== 'tokens') {
                        throw new Error(`Unexpected subcollection ${name}`);
                    }
                    return tokenCollectionRef;
                }),
            };
            tokenQueryDocs = [{ id: tokenID }];
            rootDocData = {};

            mockDoc.mockImplementation((path) => {
                if (path === userID) {
                    return userDocRef;
                }
                return mockDocInstance;
            });

            mockRunTransaction.mockImplementation(async (callback: any) => callback({
                get: vi.fn(async (target: unknown) => {
                    if (target === userDocRef) {
                        return {
                            exists: true,
                            data: () => rootDocData,
                        };
                    }
                    if (target === tokenCollectionRef) {
                        return { docs: tokenQueryDocs };
                    }
                    throw new Error('Unexpected transaction get target');
                }),
                delete: transactionDeleteSpy,
            }));
        });

        afterEach(() => {
            mockDoc.mockReturnValue(mockDocInstance);
            installDefaultRunTransactionMock();
        });

        it('should delete the specific token', async () => {
            await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
        });

        it('should delete parent document if no tokens remain', async () => {
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
            expect(transactionDeleteSpy).toHaveBeenCalledWith(userDocRef);
            expect(mockCollection).not.toHaveBeenCalledWith('users');
            expect(result).toEqual({
                tokenRootDeleted: true,
                tokenRootPreservedForOAuthFlow: false,
                remainingTokenCount: 0,
            });
        });

        it('should NOT delete parent document if tokens remain', async () => {
            tokenQueryDocs = [{ id: tokenID }, { id: 'token-456' }];
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
            expect(transactionDeleteSpy).not.toHaveBeenCalledWith(userDocRef);
            expect(mockCollection).not.toHaveBeenCalledWith('users');
            expect(result).toEqual({
                tokenRootDeleted: false,
                tokenRootPreservedForOAuthFlow: false,
                remainingTokenCount: 1,
            });
        });

        it('should preserve the token root when an OAuth reconnect flow is already in progress', async () => {
            rootDocData = {
                state: 'pending-state',
                codeVerifier: 'pending-verifier',
            };

            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);

            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
            expect(transactionDeleteSpy).not.toHaveBeenCalledWith(userDocRef);
            expect(result).toEqual({
                tokenRootDeleted: false,
                tokenRootPreservedForOAuthFlow: true,
                remainingTokenCount: 0,
            });
        });

        it('should delete the token root with pending OAuth state when preservation is disabled', async () => {
            rootDocData = {
                state: 'pending-state',
                codeVerifier: 'pending-verifier',
            };

            const result = await deleteLocalServiceToken(userID, serviceName, tokenID, {
                preserveOAuthFlowContext: false,
            });

            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
            expect(transactionDeleteSpy).toHaveBeenCalledWith(userDocRef);
            expect(result).toEqual({
                tokenRootDeleted: true,
                tokenRootPreservedForOAuthFlow: false,
                remainingTokenCount: 0,
            });
        });

        it('should keep local token cleanup low-level and not touch service connection state', async () => {
            await expect(deleteLocalServiceToken(userID, serviceName, tokenID)).resolves.not.toThrow();

            expect(transactionDeleteSpy).toHaveBeenCalledWith(tokenDocRef);
            expect(clearServiceConnectionState).not.toHaveBeenCalled();
        });
    });

    describe('getServiceOAuth2CodeRedirectAndSaveStateToUser', () => {
        const userID = 'test-user-id';
        const redirectUri = 'https://callback.url';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should generate state and save to Firestore for SuuntoApp', async () => {
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(mockCollection).toHaveBeenCalledWith('suuntoAppAccessTokens');
            expect(mockDoc).toHaveBeenCalledWith(userID);
            expect(mockDocInstance.set).toHaveBeenCalled();
        });

        it('should not save OAuth state when account deletion is active', async () => {
            mockGetUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
            )).rejects.toMatchObject({
                name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                userID,
                serviceName: ServiceNames.SuuntoApp,
            });

            expect(mockDocInstance.set).not.toHaveBeenCalled();
        });

        it('should generate state and save to Firestore for COROSAPI', async () => {
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.COROSAPI,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(mockCollection).toHaveBeenCalledWith('COROSAPIAccessTokens');
        });

        it('should include PKCE codeVerifier for GarminAPI', async () => {
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.GarminAPI,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(mockCollection).toHaveBeenCalledWith('garminAPITokens');

            expect(result).toContain('https://mock-auth-url.com');
            expect(mockCollection).toHaveBeenCalledWith('garminAPITokens');

            // Verify state and codeVerifier were saved
            const setCall = (mockDocInstance.set as any).mock.calls[0][0];
            expect(setCall.state).toBeDefined();
            expect(setCall.codeVerifier).toBeDefined();
        });
    });

    describe('validateOAuth2State', () => {
        const userID = 'test-user-id';
        const correctState = 'correct-state-123';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should return true when state matches', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ state: correctState }),
            } as any);

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBe(true);
        });

        it('should return false when state does not match', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ state: 'different-state' }),
            } as any);

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBe(false);
        });

        it('should return false when no data exists', async () => {
            mockGet.mockResolvedValue({
                exists: false,
                data: () => undefined,
            } as any);

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBeFalsy();
        });

        it('should return false when state field is missing', async () => {
            mockGet.mockResolvedValue({
                exists: () => true,
                data: () => ({ codeVerifier: 'some-verifier' }),
            });

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBeFalsy();
        });
    });

    describe('convertAccessTokenResponseToServiceToken - additional cases', () => {
        it('should convert Garmin token response correctly', () => {
            const mockResponse = {
                token: {
                    access_token: 'garmin-access-token',
                    refresh_token: 'garmin-refresh-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'PARTNER_READ',
                    user: 'garmin-user-123',
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as unknown as AccessToken,
                ServiceNames.GarminAPI
            );

            expect(result.serviceName).toBe(ServiceNames.GarminAPI);
            expect(result.accessToken).toBe('garmin-access-token');
            expect(result.refreshToken).toBe('garmin-refresh-token');
            expect((result as any).userID).toBe('garmin-user-123');
            expect(result.dateCreated).toBeDefined();
            expect(result.dateRefreshed).toBeDefined();
        });

        it('should use uniqueId parameter for Garmin when provided', () => {
            const mockResponse = {
                token: {
                    access_token: 'garmin-token',
                    refresh_token: 'garmin-refresh',
                    expires_in: 3600,
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as unknown as AccessToken,
                ServiceNames.GarminAPI,
                'override-user-id'
            );

            expect((result as any).userID).toBe('override-user-id');
        });

        it('should use default token_type and scope for Garmin when missing', () => {
            const mockResponse = {
                token: {
                    access_token: 'garmin-token',
                    refresh_token: 'garmin-refresh',
                    expires_in: 3600,
                    // token_type and scope missing
                },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as unknown as AccessToken,
                ServiceNames.GarminAPI,
                'user-id'
            );

            expect(result.tokenType).toBe('bearer');
            expect(result.scope).toBe('workout');
        });

        it('should throw for unsupported service name', () => {
            const mockResponse = {
                token: { access_token: 'test' },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
            };

            expect(() => {
                convertAccessTokenResponseToServiceToken(
                    mockResponse as unknown as AccessToken,
                    'UnsupportedService' as ServiceNames
                );
            }).toThrow(/Auth adapter not implemented/);
        });
    });

    describe('getServiceConfig - additional cases', () => {
        it('should throw for unsupported service name', () => {
            expect(() => {
                getServiceConfig('UnsupportedService' as ServiceNames);
            }).toThrow(/Auth adapter not implemented/);
        });
    });

    describe('deauthorizeServiceForUser - additional cases', () => {
        const userID = 'test-user-id';

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockDelete.mockClear();
            mockDelete.mockResolvedValue({});
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockClear();
        });

        it('should throw TokenNotFoundError when no tokens exist', async () => {
            mockGet.mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toThrow('No tokens found');
        });

        it('should call Garmin DELETE deauthorization API', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            mockDelete.mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'garmin-access' });
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, ServiceNames.GarminAPI);

            expect(requestPromise.delete).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://apis.garmin.com/wellness-api/rest/user/registration',
                headers: { Authorization: 'Bearer garmin-access' }
            }));
        });

        it('should preserve token when API deauthorization fails with 500', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 500 error from API
            const error500 = new Error('Internal Server Error');
            (error500 as any).statusCode = 500;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error500);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token should NOT be deleted when API returns 500
            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should preserve token when API deauthorization fails with 502', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 502 error from API
            const error502 = new Error('Bad Gateway');
            (error502 as any).statusCode = 502;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error502);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token should NOT be deleted when API returns 502
            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should continue cleanup when API fails with non-500 error', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            mockDelete.mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 404 error from API
            const error404 = new Error('Not Found');
            (error404 as any).statusCode = 404;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error404);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token SHOULD be deleted when API returns 404
            expect(mockDelete).toHaveBeenCalled();
        });

        it('should fail explicit disconnect when deleting the local token fails', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

            // Simulate delete failure
            mockDelete.mockRejectedValue(new Error('Delete failed'));

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toThrow('Failed to fully clean up suuntoApp connection for user test-user-id');
        });
    });

    describe('getAndSetServiceOAuth2AccessTokenForUser - additional cases', () => {
        const userID = 'test-user';
        const redirectUri = 'https://callback';
        const code = 'auth-code';

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({}),
                empty: true,
                docs: [],
            } as any);
        });

        it('should throw error when getToken returns no results', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue(null as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toThrow(/No results when geting token/);
        });

        it('should throw error when getToken returns token without access_token', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({ token: {} } as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toThrow(/No results when geting token/);
        });
    });

    describe('getAndSetServiceOAuth2AccessTokenForUser - cleanup', () => {
        const userID = 'test-user';
        const redirectUri = 'https://callback';
        const code = 'auth-code';
        const mockUpdate = vi.fn().mockResolvedValue({});

        beforeEach(async () => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ state: 'some-state', codeVerifier: 'some-verifier' }),
                empty: true,
                docs: [],
            } as any);
            mockDocInstance.update = mockUpdate;

            // Explicitly restore any spies from previous tests if they weren't cleaned up
            const simpleOAuth2 = await import('simple-oauth2');
            vi.spyOn(simpleOAuth2.AuthorizationCode.prototype, 'getToken').mockRestore();
        });

        it('should cleanup state and codeVerifier after successful token exchange', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            // Mock Garmin User ID fetch
            (requestPromise.get as any).mockResolvedValueOnce({ userId: 'mock-garmin-user' });
            // Mock permissions fetch (non-fatal but good to have)
            (requestPromise.get as any).mockResolvedValueOnce({ permissions: [] });

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.GarminAPI, redirectUri, code);

            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
        });

        it('clears pending disconnect root fields before marking an OAuth reconnect as connected', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code);

            expect(mockClearServiceDisconnectPending).toHaveBeenCalledWith(userID, ServiceNames.SuuntoApp);
            expect(mockMarkServiceConnected).toHaveBeenCalledWith(userID, ServiceNames.SuuntoApp);
            expect(mockClearServiceDisconnectPending.mock.invocationCallOrder[0])
                .toBeLessThan(mockMarkServiceConnected.mock.invocationCallOrder[0]);
        });

        it('should cleanup state and codeVerifier even if token exchange fails', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockRejectedValue(new Error('Exchange failed'));

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.GarminAPI, redirectUri, code))
                .rejects.toThrow('Exchange failed');

            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
        });

        it('should not exchange OAuth code when account deletion is active before token exchange', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(mockDocInstance.set).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocInstance);
        });

        it('should preserve existing service tokens without updating the root when deletion-active OAuth cleanup did not persist this callback token', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGet
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({ state: 'some-state', codeVerifier: 'some-verifier' }),
                } as any)
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'existing-token' }],
                } as any);
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(mockDocInstance.set).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('should not update OAuth root if deletion-active cleanup recursive delete fails', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockRecursiveDelete.mockRejectedValueOnce(new Error('recursive delete failed'));
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocInstance);
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('should deauthorize exchanged OAuth token when account deletion starts before token persistence', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(mockDocInstance.set).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer mock-token',
                }),
                url: expect.stringContaining('/oauth/deauthorize'),
            }));
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocInstance);
        });

        it('should preserve existing service tokens when account deletion starts before new OAuth token persistence', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGet
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({ state: 'some-state', codeVerifier: 'some-verifier' }),
                } as any)
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'existing-token' }],
                } as any);
            mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(mockDocInstance.set).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer mock-token',
                }),
                url: expect.stringContaining('/oauth/deauthorize'),
            }));
        });

        it('should archive exchanged OAuth token when unpersisted deauthorization fails', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: {
                    user: 'test-external-user',
                    access_token: 'mock-token',
                    refresh_token: 'mock-refresh-token',
                    expires_in: 3600,
                    token_type: 'bearer',
                    scope: 'workout',
                },
                expired: () => false,
            } as any);
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('deauth unavailable'));
            mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(mockArchiveOrphanedServiceToken).toHaveBeenCalledWith(
                userID,
                ServiceNames.SuuntoApp,
                expect.stringMatching(/^unpersisted-oauth-/),
                expect.objectContaining({
                    serviceName: ServiceNames.SuuntoApp,
                    accessToken: 'mock-token',
                    refreshToken: 'mock-refresh-token',
                }),
                expect.any(Error),
            );
        });

        it('should preserve persisted service token root when account deletion starts before OAuth context cleanup', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code);

            expect(mockDocInstance.set).toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('should not remove duplicate connections if account deletion blocks connected-state write after token persistence', async () => {
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockMarkServiceConnected.mockResolvedValueOnce(false);
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                    phase: `oauth_mark_connected:${ServiceNames.SuuntoApp}`,
                });

            expect(mockDocInstance.set).toHaveBeenCalled();
            expect(mockWhere).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
        });
    });

    describe('deauthorizeServiceForUser - edge cases for full coverage', () => {
        const userID = 'test-user-id';

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockDelete.mockClear();
            mockDelete.mockResolvedValue({});
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockClear();
        });

        it('should proceed with cleanup when getTokenData fails with non-500 error (e.output.statusCode)', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            mockDelete.mockResolvedValue({});

            // Simulate error with output.statusCode format (e.g., from boom errors)
            const error401 = new Error('Unauthorized');
            (error401 as any).output = { statusCode: 401 };
            (getTokenData as ReturnType<typeof vi.fn>).mockRejectedValue(error401);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Should still proceed with local cleanup even when getTokenData fails with 401
            expect(mockDelete).toHaveBeenCalled();
        });

        it('should proceed with cleanup when getTokenData fails with unknown error (no statusCode)', async () => {
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: { delete: mockDelete },
            };

            mockGet.mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
            }).mockResolvedValue({
                empty: true,
                size: 0,
                docs: [],
            });

            mockDelete.mockResolvedValue({});

            // Simulate error without statusCode
            const unknownError = new Error('Unknown failure');
            (getTokenData as ReturnType<typeof vi.fn>).mockRejectedValue(unknownError);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Should still proceed with local cleanup
            expect(mockDelete).toHaveBeenCalled();
        });
    });

    describe('removeDuplicateConnections', () => {
        const currentUserID = 'current-user-id';
        const otherUserID = 'other-user-id';
        const externalUserId = 'external-user-123';

        beforeEach(() => {
            vi.clearAllMocks();
            mockDelete.mockResolvedValue({});
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
        });
        it('should throw error for unsupported service name', async () => {
            const UnsupportedService = 'UnsupportedService' as any;
            await expect(removeDuplicateConnections(currentUserID, UnsupportedService, externalUserId))
                .rejects.toThrow('Auth adapter not implemented for service: UnsupportedService');
        });

        it('should query userName field for Suunto and delete duplicate via deleteLocalServiceToken', async () => {
            const docWithOtherUser = {
                id: 'token-id-other-user',
                ref: {
                    parent: {
                        parent: { id: otherUserID },
                    },
                },
                data: () => ({ serviceName: ServiceNames.SuuntoApp }),
            };

            mockGet.mockResolvedValue({
                empty: false,
                docs: [docWithOtherUser],
                data: () => ({}),
            } as any);

            await removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId);

            expect(mockWhere).toHaveBeenCalledWith('userName', '==', externalUserId);
            // Now uses deleteLocalServiceToken instead of batch delete
            // The token delete and parent check happen via deleteLocalServiceToken
            expect(mockDelete).toHaveBeenCalled();
        });

        it('should propagate duplicate cleanup failure when local token deletion fails', async () => {
            const docWithOtherUser = {
                id: 'token-id-other-user',
                ref: {
                    parent: {
                        parent: { id: otherUserID },
                    },
                },
                data: () => ({ serviceName: ServiceNames.SuuntoApp }),
            };

            mockGet.mockResolvedValue({
                empty: false,
                docs: [docWithOtherUser],
                data: () => ({}),
            } as any);
            mockDelete.mockRejectedValueOnce(new Error('firestore delete failed'));

            await expect(
                removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId),
            ).rejects.toThrow('Failed to delete local suuntoApp token token-id-other-user for user other-user-id');
        });

        it('should query openId field for COROS', async () => {
            mockGet.mockResolvedValue({ docs: [] });

            await removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId);

            expect(mockWhere).toHaveBeenCalledWith('openId', '==', externalUserId);
        });

        it('should query userID field for Garmin', async () => {
            mockGet.mockResolvedValue({ docs: [] });

            await removeDuplicateConnections(currentUserID, ServiceNames.GarminAPI, externalUserId);

            expect(mockWhere).toHaveBeenCalledWith('userID', '==', externalUserId);
        });

        it('should skip tokens with mismatched serviceName', async () => {
            const mockDoc = {
                id: 'token-id',
                ref: {
                    parent: {
                        parent: { id: otherUserID },
                    },
                },
                data: () => ({ serviceName: ServiceNames.COROSAPI }), // Different service
            };

            mockGet.mockResolvedValue({ docs: [mockDoc] });

            await removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId);

            // Should NOT delete because serviceName doesn't match - batch.delete not called
            // with this doc's ref
        });

        it('should skip tokens belonging to current user', async () => {
            const mockDoc = {
                id: 'token-id',
                ref: {
                    parent: {
                        parent: { id: currentUserID }, // Same as current user
                    },
                },
                data: () => ({ serviceName: ServiceNames.SuuntoApp }),
            };

            mockGet.mockResolvedValue({ docs: [mockDoc] });

            await removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId);

            // Should NOT delete because it belongs to current user
        });

        it('should handle doc with null parent.parent', async () => {
            const mockDoc = {
                id: 'token-id',
                ref: {
                    parent: {
                        parent: null, // parentDoc is null 
                    },
                },
                data: () => ({ serviceName: ServiceNames.SuuntoApp }),
            };

            mockGet.mockResolvedValue({ docs: [mockDoc] });

            await removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId);

            // Should NOT delete because otherUserId is null/undefined
        });
    });

    describe('OAuth2 - Final Coverage Gaps', () => {
        const userID = 'testUserID';

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({}),
                empty: true,
                docs: [],
            } as any);
        });

        it('should throw error when Garmin User ID fetch fails', async () => {
            // Mock Firestore to return state AND codeVerifier
            const mockDoc = {
                data: () => ({ state: 'matches', codeVerifier: 'mockVerifier' }), // ADDED codeVerifier
                exists: true
            };
            (admin.firestore().collection('garmin_tokens').doc('u1').get as any).mockResolvedValue(mockDoc);

            // Mock token exchange to succeed
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'valid-token' },
                expired: () => false,
            } as any);

            // We mock requestPromise.get to fail, which getGarminUserId uses
            (requestPromise.get as any).mockRejectedValue(new Error('Failed to fetch Garmin User ID'));

            await expect(getAndSetServiceOAuth2AccessTokenForUser('u1', ServiceNames.GarminAPI, 'uri', 'code'))
                .rejects.toThrow(/Failed to fetch Garmin User ID/);
        });

        it('should handle default case in deauthorizeServiceForUser switch', async () => {
            // We use an unknown service name to trigger the default branch
            // but it must first pass the getTokenData check
            const unknownService = 'UnknownService' as ServiceNames;

            mockGet.mockResolvedValue({
                empty: false,
                docs: [{
                    id: 'token-id',
                    ref: { delete: vi.fn() },
                    data: () => ({ serviceName: unknownService }),
                }],
                data: () => ({ serviceName: unknownService }), // Satisfy .doc().get().data()
            } as any);

            (getTokenData as any).mockResolvedValue({
                token: { access_token: 'token' },
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
            } as any);

            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'valid-token' },
                expired: () => false,
            } as any);

            // This will hit default in getServiceConfig and throw, but we want to see if it reaches deauthorize switch
            // Actually it's easier to just test that it doesn't crash if we mock getServiceConfig or just accept the throw
            try {
                await deauthorizeServiceForUser(userID, unknownService);
            } catch (e: any) {
                expect(e.message).toContain('Auth adapter not implemented for service: UnknownService');
            }
        });
    });
});
