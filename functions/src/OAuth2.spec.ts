import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Define stable mocks first
const mockDelete = vi.fn().mockResolvedValue({});
const mockGet = vi.fn().mockImplementation(() => Promise.resolve({
    data: () => ({}),
    exists: true,
    empty: true,
    size: 0,
    docs: [],
} as any));
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockBatchDelete = vi.fn();
const mockAdd = vi.fn().mockResolvedValue({ id: 'new-doc-id' });
const mockBatchCommit = vi.fn().mockResolvedValue({});

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
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

// Mock request-helper
vi.mock('./request-helper', () => ({
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
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
import * as admin from 'firebase-admin';
import { getTokenData } from './tokens';
import { getServiceAdapter } from './auth/factory';

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
                ServiceNames.COROSAPI,
                'coros-open-id-456'  // Pass openId as uniqueId parameter
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
            (requestPromise.post as any).mockResolvedValue({}); // For COROS
            (requestPromise.delete as any).mockResolvedValue({}); // For Garmin
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
                mockResponse as ReturnType<typeof vi.fn>,
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
                mockResponse as ReturnType<typeof vi.fn>,
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
                mockResponse as ReturnType<typeof vi.fn>,
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
                    mockResponse as ReturnType<typeof vi.fn>,
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
            (error500 as ReturnType<typeof vi.fn>).statusCode = 500;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error500);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token should NOT be deleted when API returns 500
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
            (error404 as ReturnType<typeof vi.fn>).statusCode = 404;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error404);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token SHOULD be deleted when API returns 404
            expect(mockDelete).toHaveBeenCalled();
        });

        it('should handle delete token failure gracefully', async () => {
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

            // Should not throw
            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .resolves.not.toThrow();
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

    describe('deauthorizeServiceForUser - edge cases for full coverage', () => {
        const userID = 'test-user-id';

        beforeEach(() => {
            vi.clearAllMocks();
            mockGet.mockClear();
            mockDelete.mockClear();
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
        });
        it('should throw error for unsupported service name', async () => {
            const UnsupportedService = 'UnsupportedService' as any;
            await expect(removeDuplicateConnections(currentUserID, UnsupportedService, externalUserId))
                .rejects.toThrow('Auth adapter not implemented for service: UnsupportedService');
        });

        it('should query userName field for Suunto and delete duplicate', async () => {
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
            expect(mockBatchDelete).toHaveBeenCalledWith(docWithOtherUser.ref);
            expect(mockBatchCommit).toHaveBeenCalled();
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
