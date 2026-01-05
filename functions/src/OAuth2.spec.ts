import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    const firestore = () => ({
        collection: mockCollection,
        collectionGroup: mockCollection,
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
        getToken() { return Promise.resolve({ token: {} }); }
        createToken() { return { expired: () => false, token: {} }; }
    },
}));

import {
    getServiceConfig,
    convertAccessTokenResponseToServiceToken,
    deauthorizeServiceForUser,
} from './OAuth2';
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

        it('should throw for unsupported service', () => {
            expect(() => getServiceConfig(ServiceNames.GarminHealthAPI))
                .toThrow('Not implemented');
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

            // Default: 1 token found
            const mockTokenDoc = {
                id: 'token-doc-id',
                ref: {
                    delete: mockDelete, // Use the shared mockDelete
                },
            };

            mockGet.mockResolvedValue({
                empty: false,
                size: 1,
                docs: [mockTokenDoc],
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
            (getTokenData as any).mockRejectedValue(error500);

            // Partial Success: Should NOT throw, but also NOT delete the token
            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.not.toThrow();

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should still delete local records if Suunto API deauthorization fails', async () => {
            (requestPromise.get as any).mockRejectedValue(new Error('API Failure'));

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

            mockGet.mockResolvedValue({
                empty: false,
                size: 2,
                docs: [token1, token2],
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

            mockGet.mockResolvedValue({
                empty: false,
                size: 2,
                docs: [token1, token2],
            });

            (getTokenData as any).mockResolvedValue({ accessToken: 'valid' });
            (requestPromise.get as any).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, serviceName);

            // Expect 3 deletions: token1, token2, and parent user doc
            expect(mockDelete).toHaveBeenCalledTimes(3);
        });
    });
});
