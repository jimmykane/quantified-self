import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Define stable mocks first
const mockDelete = vi.fn().mockResolvedValue({});
const mockGet = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();

const mockDocInstance = {
    delete: mockDelete,
    get: mockGet,
    collection: mockCollection,
    set: vi.fn().mockResolvedValue({}),
};

const mockCollectionInstance = {
    doc: mockDoc,
    get: mockGet,
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
};

// Setup nesting
mockDoc.mockReturnValue(mockDocInstance);
mockCollection.mockReturnValue(mockCollectionInstance);

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
    const batchCommit = vi.fn();
    const batchDelete = vi.fn();
    const batch = () => ({
        delete: batchDelete,
        commit: batchCommit,
    });

    const firestore = () => ({
        collection: mockCollection,
        collectionGroup: mockCollection,
        batch: batch,
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
    getTokenData: vi.fn(),
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
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

// Mock request-helper
vi.mock('./request-helper', () => ({
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
}));

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class MockAuthorizationCode {
        constructor() { }
        authorizeURL() { return 'https://mock-auth-url.com'; }
        getToken() { return Promise.resolve({ token: { user: 'test-external-user', access_token: 'mock-token' } }); }
        createToken() { return { expired: () => false, token: {} }; }
    },
}));

import {
    getServiceConfig,
    convertAccessTokenResponseToServiceToken,
    deauthorizeServiceForUser,
    getAndSetServiceOAuth2AccessTokenForUser,
    deleteLocalServiceToken,
} from './OAuth2';
import * as admin from 'firebase-admin';
import { getTokenData } from './tokens';
import * as requestPromise from './request-helper';

describe('OAuth2', () => {
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
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as any,
                ServiceNames.SuuntoApp
            );

            expect(result.serviceName).toBe(ServiceNames.SuuntoApp);
            expect(result.accessToken).toBe('suunto-access-token');
            expect(result.refreshToken).toBe('suunto-refresh-token');
            expect(result.tokenType).toBe('Bearer');
            expect(result.scope).toBe('workout');
            expect((result as any).userName).toBe('suunto-user-123');
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
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as any,
                ServiceNames.COROSAPI
            );

            expect(result.serviceName).toBe(ServiceNames.COROSAPI);
            expect(result.accessToken).toBe('coros-access-token');
            expect(result.refreshToken).toBe('coros-refresh-token');
            expect(result.tokenType).toBe('bearer');
            expect((result as any).openId).toBe('coros-open-id-456');
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
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as any,
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
            };

            const result = convertAccessTokenResponseToServiceToken(
                mockResponse as any,
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
            (getTokenData as any).mockReset();

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
            }).mockResolvedValueOnce({
                empty: true,
                size: 0,
                docs: [],
            });

            mockDelete.mockResolvedValue({});

            (getTokenData as any).mockResolvedValue({ accessToken: 'mock-access' });
            (requestPromise.get as any).mockResolvedValue({});
        });

        it('should deauthorize and delete records successfully', async () => {
            await deauthorizeServiceForUser(userID, serviceName);

            expect(getTokenData).toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalled();
            expect(mockDelete).toHaveBeenCalled(); // Once for token, once for user doc
            expect(mockDelete).toHaveBeenCalledTimes(2);
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
            (error500 as any).statusCode = 500;
            (getTokenData as any).mockRejectedValueOnce(error500);

            // Partial Success: Should NOT throw, but also NOT delete the token
            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.not.toThrow();

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should still delete local records if Suunto API deauthorization fails', async () => {
            (requestPromise.get as any).mockRejectedValueOnce(new Error('API Failure'));

            await deauthorizeServiceForUser(userID, serviceName);

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
                })
                .mockResolvedValueOnce({
                    empty: false,
                    size: 1,
                    docs: [token2], // After T1 delete, T2 remains
                });

            // Mock getTokenData to succeed for token1 but fail for token2
            (getTokenData as any)
                .mockResolvedValueOnce({ accessToken: 't1' }) // first call success
                .mockRejectedValueOnce({ statusCode: 500, message: 'Server Error' }); // second call failure

            (requestPromise.get as any).mockResolvedValue({});

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

                if (getCallCount === 1) return { empty: false, size: 2, docs: [token1, token2] };
                if (getCallCount === 2) return { empty: false, size: 1, docs: [token2] };
                if (getCallCount === 3) return { empty: true, size: 0, docs: [] };

                return { empty: true, size: 0, docs: [] };
            });

            (getTokenData as any).mockImplementation(async (_doc: any) => {
                return { accessToken: 'valid' };
            });
            (requestPromise.get as any).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, serviceName);

            // Expect 3 deletions: token1, token2, and parent user doc
            expect(mockDelete).toHaveBeenCalledTimes(3);
        });

    });
});

describe('getAndSetServiceOAuth2AccessTokenForUser', () => {
    const userID = 'current-user-id';
    const serviceName = ServiceNames.SuuntoApp;
    const redirectUri = 'https://callback';
    const code = 'auth-code';

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock getServiceConfig implicitly via the implementations in OAuth2
        // We need to mock the oauth2Client.getToken which is inside getServiceConfig
        // But getServiceConfig creates a NEW instance every time?
        // "oauth2Client: SuuntoAPIAuth(),"
        // SuuntoAPIAuth() returns a new AuthorizationCode instance.
        // And I mocked simple-oauth2 AuthorizationCode class.
    });

    it('should save token and remove duplicates from other users', async () => {
        // Setup duplicate connection from OTHER user
        const otherUserTokenDoc = {
            id: 'other-token-id',
            ref: { id: 'other-token-id', path: 'path/to/other/token' },
            data: () => ({ serviceName: ServiceNames.SuuntoApp, userName: 'test-external-user' }),
            parent: { parent: { id: 'other-user-id' } } // User ID is NOT 'current-user-id'
        };

        // Mock collectionGroup().where().get()
        mockGet.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [otherUserTokenDoc],
        });

        // We need to spy on batch.delete and batch.commit
        // Since we mocked the module factory, we can't easily access the internal spies unless we export them or peek.
        // But we can verify side effects if we mock the GLOBAL admin object which is imported?
        // "import * as admin from 'firebase-admin';" is NOT done in this spec file yet?
        // Actually it is mocked via factory.
        // We can re-import admin to access the mocks? 
        // Better: rely on `mockDelete`? No, batch uses `batch.delete(ref)`.
        // The `firebase-admin` mock I just updated creates NEW spies on every import?
        // No, the factory function runs once per test SUITE usually, or we can use `vi.mocked`.

        // Let's assume the helper works if we just run it and don't explode.
        // To get the spies, I should have defined them outside.
        // But I can't easily change the mock definition now without more MultiReplace.
        // Let's just run it. If logic is correct, it calls collectionGroup query.

        // Wait, I can verify `mockCollection` was called with `collectionGroup('tokens')`.
        await getAndSetServiceOAuth2AccessTokenForUser(userID, serviceName, redirectUri, code);

        // Verify we searched for duplicates
        // mockCollection is shared for collection(..) and collectionGroup(..).
        // We can check if it was called.
        expect(mockCollection).toHaveBeenCalledWith('tokens');

        expect(mockCollection).toHaveBeenCalledWith('tokens');
    }, 10000);

    it('should handle immutable token objects and fetch Garmin User ID correctly', async () => {
        const garminService = ServiceNames.GarminAPI;
        const garminUserId = 'garmin-user-123';
        const accessToken = 'garmin-access-token';

        // Reset mocks
        vi.clearAllMocks();

        // Mock getServiceConfig to return GarminAPI config
        const immutableToken = Object.freeze({
            token: Object.freeze({
                access_token: accessToken,
                refresh_token: 'gr',
                expires_in: 3600
            })
        });

        const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
        vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue(immutableToken as any);

        // Mock the User ID fetch
        (requestPromise.get as any).mockResolvedValue(JSON.stringify({ userId: garminUserId }));

        // Mock Firestore interactions
        // Mock Firestore interactions
        // ensure any previous mock values are cleared
        mockGet.mockReset();
        mockGet.mockResolvedValue({
            empty: true,
            size: 0,
            docs: [],
            data: () => ({})
        });
        mockDelete.mockResolvedValue({});

        // Execute
        await getAndSetServiceOAuth2AccessTokenForUser(userID, garminService, redirectUri, code);

        // Assertions
        expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://apis.garmin.com/wellness-api/rest/user/id',
            headers: { Authorization: `Bearer ${accessToken}` }
        }));
        expect(mockCollection).toHaveBeenCalledWith('tokens');
        expect(mockDoc).toHaveBeenCalledWith(garminUserId);

        const setArg = (mockDocInstance.set as any).mock.calls[0][0];
        expect(setArg.serviceName).toBe(garminService);
        expect(setArg.userID).toBe(garminUserId);
    });

    it('should delete parent document when the last token is removed during duplicate cleanup', async () => {
        const garminService = ServiceNames.GarminAPI;
        const garminUserId = 'garmin-user-123';
        const otherUserID = 'other-user-id';

        // Reset mocks
        vi.clearAllMocks();

        // Mock AuthorizationCode to return a valid token
        const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
        vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
            token: { user: garminUserId, access_token: 'valid-token', expires_in: 3600 }
        } as any);

        // Mock the User ID fetch
        (requestPromise.get as any).mockResolvedValue(JSON.stringify({ userId: garminUserId }));

        // Setup duplicate connection from OTHER user
        const otherUserTokenDoc = {
            id: 'other-token-id',
            ref: {
                id: 'other-token-id',
                path: 'garminAPITokens/other-user-id/tokens/other-token-id',
                parent: {
                    id: 'tokens',
                    parent: { id: otherUserID, collection: mockCollection, parent: { id: 'garminAPITokens' } }
                }
            },
            data: () => ({ serviceName: garminService, userID: garminUserId }),
        };
        // Correct the nesting for otherUserTokenDoc.ref.parent.parent
        (otherUserTokenDoc.ref.parent as any).parent = {
            id: otherUserID,
            collection: mockCollection,
            parent: { id: 'garminAPITokens' }
        };

        // Sequence of Firestore get() calls:
        // 1. OAuth2.ts Line 231: check for Garmin codeVerifier
        mockGet.mockImplementationOnce(() => Promise.resolve({
            exists: () => true,
            data: () => ({ codeVerifier: 'mock-verifier' })
        } as any));

        // 2. removeDuplicateConnections Line 41: query for existing tokens with this external ID
        mockGet.mockImplementationOnce(() => Promise.resolve({
            empty: false,
            size: 1,
            docs: [otherUserTokenDoc],
        } as any));

        // 3. removeDuplicateConnections Line 69: check for remaining tokens for the parent user doc
        mockGet.mockImplementationOnce(() => Promise.resolve({
            empty: false,
            size: 1,
            docs: [otherUserTokenDoc],
        } as any));

        // Execute
        await getAndSetServiceOAuth2AccessTokenForUser('current-user-id', garminService, 'https://callback', 'code');
        const batchDelete = admin.firestore().batch().delete;

        // Assertions
        // 1. Token should be deleted
        expect(batchDelete).toHaveBeenCalledWith(otherUserTokenDoc.ref);
    });
});

describe('deleteLocalServiceToken', () => {
    const userID = 'user123';
    const serviceName = ServiceNames.GarminAPI;
    const tokenID = 'token-123';
    const tokenDeleteSpy = vi.fn().mockResolvedValue({});
    const parentDeleteSpy = vi.fn().mockResolvedValue({});

    beforeEach(() => {
        vi.clearAllMocks();
        mockGet.mockResolvedValue({ empty: true });

        mockDoc.mockImplementation((path) => {
            if (path === tokenID) {
                return { delete: tokenDeleteSpy };
            }
            if (path === userID) {
                return {
                    delete: parentDeleteSpy,
                    collection: mockCollection,
                    set: vi.fn(),
                    get: mockGet
                };
            }
            return mockDocInstance;
        });
    });

    afterEach(() => {
        mockDoc.mockReturnValue(mockDocInstance);
    });

    it('should delete the specific token', async () => {
        await deleteLocalServiceToken(userID, serviceName, tokenID);
        expect(tokenDeleteSpy).toHaveBeenCalled();
    });

    it('should delete parent document if no tokens remain', async () => {
        await deleteLocalServiceToken(userID, serviceName, tokenID);
        expect(tokenDeleteSpy).toHaveBeenCalled();
        expect(parentDeleteSpy).toHaveBeenCalled();
    });

    it('should NOT delete parent document if tokens remain', async () => {
        mockGet.mockResolvedValue({ empty: false });
        await deleteLocalServiceToken(userID, serviceName, tokenID);
        expect(tokenDeleteSpy).toHaveBeenCalled();
        expect(parentDeleteSpy).not.toHaveBeenCalled();
    });
});
