import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { createOAuthFirestoreHarness, type OAuthFirestoreHarness } from './test-support/oauth-firestore-harness';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { AccessToken } from 'simple-oauth2';
import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';

vi.mock('firebase-functions/logger', () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
}));

const mockFirestore = vi.hoisted(() => vi.fn());
const { mockFieldValueDelete } = vi.hoisted(() => ({
    mockFieldValueDelete: vi.fn().mockReturnValue('delete-sentinel'),
}));
const {
    mockGetUserDeletionGuardState,
    mockGetUserDeletionGuardStateInTransaction,
    mockArchiveOrphanedServiceToken,
    mockGetWahooUserID,
    mockMarkServiceConnected,
    mockClearServiceDisconnectPending,
    mockResumeServiceDisconnectRetryAfterRecoveryFailure,
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
    mockGetWahooUserID: vi.fn().mockResolvedValue('60462'),
    mockMarkServiceConnected: vi.fn().mockResolvedValue(true),
    mockClearServiceDisconnectPending: vi.fn().mockResolvedValue('no_pending'),
    mockResumeServiceDisconnectRetryAfterRecoveryFailure: vi.fn().mockResolvedValue(true),
}));

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
        wahooapi: {
            client_id: 'test-wahoo-client-id',
            client_secret: 'test-wahoo-client-secret',
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

vi.mock('firebase-admin', () => ({
    default: { firestore: mockFirestore, initializeApp: vi.fn(), credential: { cert: vi.fn() } },
    firestore: mockFirestore,
}));

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        delete: mockFieldValueDelete,
        increment: vi.fn((value: number) => ({ __increment: value })),
        serverTimestamp: vi.fn(() => 'server-timestamp-sentinel'),
    },
}));

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

vi.mock('./wahoo/auth/api', () => ({
    getWahooUserID: mockGetWahooUserID,
    deauthorizeWahooUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./wahoo/account', () => ({
    assertWahooOAuthAccountCompatible: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./service-connection-meta', () => ({
    markServiceConnected: mockMarkServiceConnected,
    clearServiceConnectionState: vi.fn().mockResolvedValue(true),
}));

vi.mock('./service-disconnect-pending', () => ({
    clearServiceDisconnectPending: mockClearServiceDisconnectPending,
    getServiceDisconnectLifecycleGuardFromRootData: (data: Record<string, unknown> | null | undefined) => ({
        disconnectGeneration: data?.disconnectState === 'disconnect_pending'
            ? `${data.disconnectGeneration || ''}`.trim() || null
            : null,
        oauthCredentialGeneration: `${data?.activeOAuthCredentialGeneration || ''}`.trim() || null,
        oauthFlowGeneration: `${data?.oauthFlowGeneration || ''}`.trim() || null,
        disconnectOperationGeneration: `${data?.disconnectOperationGeneration || ''}`.trim() || null,
    }),
    isRetryableSubscriptionEnforcementDisconnectStatus: (statusCode: number | null) => statusCode === null
        || statusCode === 408
        || statusCode === 429
        || (statusCode >= 500 && statusCode <= 599),
    resumeServiceDisconnectRetryAfterRecoveryFailure: mockResumeServiceDisconnectRetryAfterRecoveryFailure,
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
    deauthorizeServiceForSubscriptionEnforcement,
    deauthorizeServiceForUser,
    getAndSetServiceOAuth2AccessTokenForUser,
    deleteLocalServiceToken,
    getServiceOAuth2CodeRedirectAndSaveStateToUser,
    validateOAuth2State,
    removeDuplicateConnections,
} from './OAuth2';
import { TokenNotFoundError, hasProAccess } from './utils';
import { getTokenData } from './tokens';
import { clearServiceConnectionState } from './service-connection-meta';
import { OAUTH_FLOW_TTL_MS } from './service-token-store';

describe('OAuth2', () => {
    let firestore: OAuthFirestoreHarness;
    beforeEach(() => {
        firestore = createOAuthFirestoreHarness();
        mockFirestore.mockReturnValue(firestore.db);
        mockGetUserDeletionGuardState.mockReset().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockGetUserDeletionGuardStateInTransaction.mockReset().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockArchiveOrphanedServiceToken.mockReset().mockResolvedValue(undefined);
        mockGetWahooUserID.mockReset().mockResolvedValue('60462');
        mockMarkServiceConnected.mockReset().mockResolvedValue(true);
        mockClearServiceDisconnectPending.mockReset().mockResolvedValue('no_pending');
        (clearServiceConnectionState as Mock).mockReset().mockResolvedValue(true);
        mockResumeServiceDisconnectRetryAfterRecoveryFailure.mockReset().mockResolvedValue(true);
        (hasProAccess as Mock).mockReset().mockResolvedValue(true);
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

        it('should return config for WahooAPI', () => {
            const config = getServiceConfig(ServiceNames.WahooAPI);

            expect(config).toBeDefined();
            expect(config.tokenCollectionName).toBe('wahooAPIAccessTokens');
            expect(config.oAuthScopes).toBe('user_read workouts_read workouts_write routes_read routes_write plans_read plans_write offline_data');
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
            (getTokenData as Mock).mockReset();
            (clearServiceConnectionState as Mock).mockReset().mockResolvedValue(true);

            (getTokenData as Mock).mockResolvedValue({ accessToken: 'mock-access' });
            (requestPromise.get as Mock).mockResolvedValue({});
            (requestPromise.post as Mock).mockResolvedValue({}); // For COROS
            (requestPromise.delete as Mock).mockResolvedValue({}); // For Garmin
        });

        it('should deauthorize and delete records successfully', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            await deauthorizeServiceForUser(userID, serviceName);

            expect(getTokenData).toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalled();
            expect(firestore.deleteDocument).toHaveBeenCalledTimes(2); // token + root cleanup
            expect(logger.info).toHaveBeenCalledWith(
                '[OAuthDisconnect] Lifecycle transition.',
                expect.objectContaining({
                    lifecycleEvent: 'disconnect_operation_claimed',
                    serviceName,
                    operationCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
                    tokenCount: 1,
                }),
            );
            expect(logger.info).toHaveBeenCalledWith(
                '[OAuthDisconnect] Lifecycle transition.',
                expect.objectContaining({
                    lifecycleEvent: 'disconnect_cleanup_completed',
                    serviceName,
                    deletedTokenCount: 1,
                }),
            );
            expect(logger.info).toHaveBeenCalledWith(
                '[OAuthDisconnect] Lifecycle transition.',
                expect.objectContaining({
                    lifecycleEvent: 'disconnect_finalization_completed',
                    serviceName,
                    finalizationStatus: expect.stringMatching(/^(cleared|root_missing)$/),
                }),
            );
        });

        it('does not let an observability failure interrupt disconnect cleanup', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            vi.mocked(logger.info).mockImplementationOnce(() => {
                throw new Error('logger unavailable');
            });

            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.toEqual(
                expect.objectContaining({ reason: 'user_disconnect' }),
            );

            expect(getTokenData).toHaveBeenCalled();
            expect(firestore.deleteDocument).toHaveBeenCalledTimes(2);
        });

        it('invalidates claimed OAuth flow context before explicit disconnect cleanup', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            await deauthorizeServiceForUser(userID, serviceName);

            expect(connection.root.writes.set).toHaveBeenCalledWith(expect.objectContaining({
                oauthFlowGeneration: expect.any(String),
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }), { merge: true });
        });

        it('does not start explicit disconnect while a token refresh lease is active', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const tokenData = {
                accessToken: 'mock-access',
                refreshToken: 'mock-refresh',
                expiresAt: Date.now() + 60_000,
                tokenRefreshLeaseOwner: 'refresh-owner-1',
                tokenRefreshLeaseExpiresAt: Date.now() + 60_000,
            };
            connection.replaceProviderToken('token-doc-id', tokenData);

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
                code: 'unavailable',
                statusCode: 503,
                details: {
                    reason: 'service_disconnect_in_progress',
                    blocker: 'token_refresh',
                    retryAt: expect.any(Number),
                    retryDeadlineAt: tokenData.tokenRefreshLeaseExpiresAt,
                },
            });

            expect(getTokenData).not.toHaveBeenCalled();
            expect(connection.root.writes.set).not.toHaveBeenCalled();
        });

        it('does not replace an explicit disconnect operation already in progress', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            connection.seedRoot({
                oauthFlowGeneration: 'disconnect-flow-generation-1',
                disconnectOperationGeneration: 'disconnect-operation-1',
                disconnectOperationLeaseExpiresAt: Date.now() + 60_000,
            });

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
                code: 'unavailable',
                statusCode: 503,
                details: {
                    reason: 'service_disconnect_in_progress',
                    blocker: 'disconnect_operation',
                    retryAt: expect.any(Number),
                    retryDeadlineAt: connection.readRoot().disconnectOperationLeaseExpiresAt,
                },
            });

            expect(getTokenData).not.toHaveBeenCalled();
            expect(connection.root.writes.set).not.toHaveBeenCalled();
            expect(connection.readRoot()).toMatchObject({
                disconnectOperationGeneration: 'disconnect-operation-1',
            });
        });

        it('reclaims an expired explicit disconnect operation lease', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            connection.seedRoot({
                oauthFlowGeneration: 'abandoned-disconnect-flow',
                disconnectOperationGeneration: 'abandoned-disconnect-operation',
                disconnectOperationLeaseExpiresAt: Date.now() - 1,
            });

            await expect(deauthorizeServiceForUser(userID, serviceName)).resolves.toEqual(
                expect.objectContaining({ reason: 'user_disconnect' }),
            );

            expect(getTokenData).toHaveBeenCalled();
            expect(connection.root.writes.set).toHaveBeenCalledWith(expect.objectContaining({
                disconnectOperationGeneration: expect.any(String),
                disconnectOperationLeaseExpiresAt: expect.any(Number),
            }), { merge: true });
        });

        it('should fail explicit disconnect when local token cleanup fails', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            firestore.deleteDocument.mockRejectedValueOnce(new Error('firestore delete failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(
                'Failed to fully clean up Suunto app connection for user test-user-id',
            );

            expect(clearServiceConnectionState).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
                '[OAuthDisconnect] Lifecycle transition.',
                expect.objectContaining({
                    lifecycleEvent: 'disconnect_cleanup_failed',
                    serviceName,
                    operationCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
                    errorName: 'ServiceConnectionCleanupError',
                }),
            );
        });

        it('records a privacy-safe diagnostic when final lease cleanup fails', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            // Token/root deletion succeeds; the final lease read then fails.
            connection.root.get.mockImplementation(async () => {
                if (!connection.readRoot()) {
                    throw Object.assign(new Error('sensitive firestore failure detail'), {
                        code: 'unavailable',
                    });
                }
                return firestore.snapshot(connection.root);
            });

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(
                'sensitive firestore failure detail',
            );

            const finalizationFailure = vi.mocked(logger.error).mock.calls.find(
                ([message, fields]) => message === '[OAuthDisconnect] Lifecycle transition.'
                    && (fields as { lifecycleEvent?: unknown })?.lifecycleEvent === 'disconnect_finalization_failed',
            );
            expect(finalizationFailure?.[1]).toEqual(expect.objectContaining({
                lifecycleEvent: 'disconnect_finalization_failed',
                serviceName,
                operationCorrelationId: expect.stringMatching(/^[a-f0-9]{16}$/),
                errorName: 'Error',
                errorCode: 'unavailable',
            }));
            expect(finalizationFailure?.[1]).not.toHaveProperty('errorMessage');
        });

        it('drops untrusted error labels from disconnect diagnostics', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            // Token/root deletion succeeds; the final lease read then fails.
            connection.root.get.mockImplementation(async () => {
                if (!connection.readRoot()) {
                    throw Object.assign(new Error('sensitive failure detail'), {
                        name: 'Invalid name with credential-shaped text',
                        code: 'invalid code with credential-shaped text',
                    });
                }
                return firestore.snapshot(connection.root);
            });

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(
                'sensitive failure detail',
            );

            const finalizationFailure = vi.mocked(logger.error).mock.calls.find(
                ([message, fields]) => message === '[OAuthDisconnect] Lifecycle transition.'
                    && (fields as { lifecycleEvent?: unknown })?.lifecycleEvent === 'disconnect_finalization_failed',
            );
            expect(finalizationFailure?.[1]).toEqual(expect.objectContaining({
                errorName: 'UnknownError',
            }));
            expect(finalizationFailure?.[1]).not.toHaveProperty('errorCode');
            expect(JSON.stringify(finalizationFailure?.[1])).not.toContain('credential-shaped');
        });

        it('should make correct Suunto API call for deauthorization', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            await deauthorizeServiceForUser(userID, serviceName);

            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('https://cloudapi-oauth.suunto.com/oauth/deauthorize'),
                headers: expect.objectContaining({ 'Authorization': 'Bearer mock-access' })
            }));
        });

        it('should make correct COROS API call for deauthorization', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            await deauthorizeServiceForUser(userID, ServiceNames.COROSAPI);

            expect(requestPromise.post).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('https://open.coros.com/oauth2/deauthorize?token=mock-access')
            }));
        });

        it('subscription enforcement revokes an inactive COROS child through the guarded stored-token fallback', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const inactiveCredential = new Error('inactive credential') as Error & { reason: string };
            inactiveCredential.name = 'TokenUseSkippedForPendingDisconnectError';
            inactiveCredential.reason = 'inactive_oauth_credential';
            (getTokenData as Mock).mockRejectedValueOnce(inactiveCredential);

            const outcome = await deauthorizeServiceForSubscriptionEnforcement(
                userID,
                ServiceNames.COROSAPI,
            );

            expect(requestPromise.post).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('https://open.coros.com/oauth2/deauthorize?token=mock-access'),
            }));
            expect(outcome.partnerDeauthorizeAttempted).toBe(1);
            expect(outcome.preservedTokenCount).toBe(0);
        });

        it('should NOT delete local records if getTokenData fails with 500', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const error500 = new Error('Server error');
            (error500 as unknown as { statusCode: number }).statusCode = 500;
            (getTokenData as Mock).mockRejectedValueOnce(error500);

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
            });
            expect(connection.readRoot()?.disconnectOperationGeneration).toEqual(expect.any(String));

            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('should NOT delete local records if getTokenData fails with 502', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const error502 = new Error('Bad Gateway');
            (error502 as unknown as { statusCode: number }).statusCode = 502;
            (getTokenData as Mock).mockRejectedValueOnce(error502);

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
            });
            expect(connection.readRoot()?.disconnectOperationGeneration).toEqual(expect.any(String));

            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('should still delete local records if Suunto API deauthorization fails', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            (requestPromise.get as Mock).mockRejectedValueOnce(new Error('API Failure'));

            await deauthorizeServiceForUser(userID, serviceName);

            // Should still delete token and parent doc even if API fails
            expect(firestore.deleteDocument).toHaveBeenCalledTimes(2);
        });

        it.each([
            ['token-1', ['token-1', 'token-2']],
            ['token-2', ['token-1', 'token-2']],
            ['token-1', ['token-2', 'token-1']],
            ['token-2', ['token-2', 'token-1']],
        ])('should delete successful tokens but PRESERVE failed (500) tokens and parent doc (%s fails; order %j)', async (failedTokenID, tokenOrder) => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            for (const tokenID of tokenOrder) {
                connection.replaceProviderToken(tokenID, { accessToken: `synthetic-${tokenID}` });
            }

            // Bind outcomes to identity so concurrent cleanup can finish in either order.
            (getTokenData as Mock).mockImplementation(async token => {
                if (token.id === failedTokenID) throw Object.assign(new Error('Server Error'), { statusCode: 500 });
                return token.data();
            });

            (requestPromise.get as Mock).mockResolvedValue({});

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
            });

            expect(firestore.deleteDocument).toHaveBeenCalledTimes(1);
            expect(connection.readToken(failedTokenID)).toEqual({ accessToken: `synthetic-${failedTokenID}` });
            const successfulTokenID = tokenOrder.find(tokenID => tokenID !== failedTokenID)!;
            expect(connection.readToken(successfulTokenID)).toBeUndefined();
            expect(connection.readRoot()).toBeDefined();
        });

        it('should delete ALL local records if multiple tokens succeed', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-1', { accessToken: 't1' });
            connection.replaceProviderToken('token-2', { accessToken: 't2' });

            (getTokenData as Mock).mockImplementation(async token => token.data());
            (requestPromise.get as Mock).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, serviceName);

            // Expect 2 token deletes plus the final root delete.
            expect(firestore.deleteDocument).toHaveBeenCalledTimes(3);
            expect(connection.readToken('token-1')).toBeUndefined();
            expect(connection.readToken('token-2')).toBeUndefined();
            expect(connection.readRoot()).toBeUndefined();
        });

        it('should transactionally clean up an orphaned root when no tokens exist', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            firestore.db.recursiveDelete.mockReset();
            firestore.db.recursiveDelete.mockResolvedValue({});

            await expect(deauthorizeServiceForUser(userID, serviceName)).rejects.toThrow(TokenNotFoundError);

            expect(firestore.deleteDocument).toHaveBeenCalledTimes(1);
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
        });

        it('should clear service connection state after explicit disconnect when no tokens remain', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const tokenData = { accessToken: 'mock-access' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            await deauthorizeServiceForUser(userID, serviceName, {
            });

            expect(clearServiceConnectionState).toHaveBeenCalledWith(
                userID,
                serviceName,
                expect.objectContaining({ expectedDisconnectLifecycleGuard: expect.any(Object) }),
            );
        });

        it('keeps explicit disconnect pending if clearing connection state fails after cleanup', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', { accessToken: 'mock-access', refreshToken: undefined, expiresAt: 0 });
            const tokenData = { accessToken: 'mock-access' };
            connection.replaceProviderToken('token-doc-id', tokenData);
            (clearServiceConnectionState as Mock).mockRejectedValueOnce(new Error('meta write failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName, {
            })).rejects.toMatchObject({ name: 'ServiceDisconnectInProgressError' });
            expect(connection.readRoot()?.disconnectOperationGeneration).toEqual(expect.any(String));

            expect(firestore.deleteDocument).toHaveBeenCalledTimes(1);
            expect(clearServiceConnectionState).toHaveBeenCalledWith(
                userID,
                serviceName,
                expect.objectContaining({ expectedDisconnectLifecycleGuard: expect.any(Object) }),
            );
        });

        it('should clear service connection state when explicit disconnect finds no token docs', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});

            await expect(deauthorizeServiceForUser(userID, serviceName, {
                missingTokensBehavior: 'ignore',
            })).resolves.not.toThrow();

            expect(clearServiceConnectionState).toHaveBeenCalledWith(
                userID,
                serviceName,
                expect.objectContaining({ expectedDisconnectLifecycleGuard: expect.any(Object) }),
            );
        });

        it('keeps an empty root pending if clearing connection state fails', async () => {
            const connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            (clearServiceConnectionState as Mock).mockRejectedValueOnce(new Error('meta write failed'));

            await expect(deauthorizeServiceForUser(userID, serviceName, {
                missingTokensBehavior: 'ignore',
            })).rejects.toMatchObject({ name: 'ServiceDisconnectInProgressError' });
            expect(connection.readRoot()?.disconnectOperationGeneration).toEqual(expect.any(String));

            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(clearServiceConnectionState).toHaveBeenCalledWith(
                userID,
                serviceName,
                expect.objectContaining({ expectedDisconnectLifecycleGuard: expect.any(Object) }),
            );
        });

    });

    describe('deleteLocalServiceToken', () => {
        const userID = 'user123';
        const serviceName = ServiceNames.GarminAPI;
        const tokenID = 'token-123';
        let connection: ReturnType<OAuthFirestoreHarness['connection']>;
        beforeEach(() => {
            connection = firestore.connection(getServiceConfig(serviceName).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken(tokenID, { accessToken: 'synthetic-token' });
        });
        it('should delete the specific token', async () => {
            await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(connection.readToken(tokenID)).toBeUndefined();
        });
        it('should delete parent document if no tokens remain', async () => {
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.root);
            expect(firestore.db.collection).not.toHaveBeenCalledWith('users');
            expect(connection.readRoot()).toBeUndefined();
            expect(result).toEqual({ tokenRootDeleted: true, tokenRootPreservedForOAuthFlow: false, remainingTokenCount: 0, skippedByCondition: false });
        });
        it('should NOT delete parent document if tokens remain', async () => {
            connection.replaceProviderToken('token-456', { accessToken: 'retained' });
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).not.toHaveBeenCalledWith(connection.root);
            expect(firestore.db.collection).not.toHaveBeenCalledWith('users');
            expect(connection.readToken('token-456')).toEqual({ accessToken: 'retained' });
            expect(result).toEqual({ tokenRootDeleted: false, tokenRootPreservedForOAuthFlow: false, remainingTokenCount: 1, skippedByCondition: false });
        });
        it('should preserve the token root when an OAuth reconnect flow is already in progress', async () => {
            connection.setOAuthFlow({ state: 'pending-state', codeVerifier: 'pending-verifier' });
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).not.toHaveBeenCalledWith(connection.root);
            expect(connection.readRoot()).toMatchObject({ state: 'pending-state' });
            expect(result).toEqual({ tokenRootDeleted: false, tokenRootPreservedForOAuthFlow: true, remainingTokenCount: 0, skippedByCondition: false });
        });
        it('should delete the token root with pending OAuth state when preservation is disabled', async () => {
            connection.setOAuthFlow({ state: 'pending-state', codeVerifier: 'pending-verifier' });
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID, { preserveOAuthFlowContext: false });
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.root);
            expect(result).toEqual({ tokenRootDeleted: true, tokenRootPreservedForOAuthFlow: false, remainingTokenCount: 0, skippedByCondition: false });
        });
        it('should preserve an empty token root for a later generation-guarded lifecycle transition', async () => {
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID, { preserveOAuthFlowContext: false, preserveTokenRootWhenEmpty: true });
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).not.toHaveBeenCalledWith(connection.root);
            expect(result).toEqual({ tokenRootDeleted: false, tokenRootPreservedForOAuthFlow: false, remainingTokenCount: 0, skippedByCondition: false });
        });
        it('does not delete a token when the transaction-owned identity cleanup guard is stale', async () => {
            const guard = vi.fn().mockResolvedValue(false);
            const result = await deleteLocalServiceToken(userID, serviceName, tokenID, { shouldDeleteInTransaction: guard });
            expect(guard).toHaveBeenCalledTimes(1);
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(connection.readToken(tokenID)).toBeDefined();
            expect(result).toEqual({ tokenRootDeleted: false, tokenRootPreservedForOAuthFlow: false, remainingTokenCount: 0, skippedByCondition: true });
        });
        it('should keep local token cleanup low-level and not touch service connection state', async () => {
            await expect(deleteLocalServiceToken(userID, serviceName, tokenID)).resolves.not.toThrow();
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(clearServiceConnectionState).not.toHaveBeenCalled();
        });
        it('deletes the current Suunto webhook account binding with the local token', async () => {
            connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken(tokenID, { accessToken: 'synthetic' });
            const { getSuuntoHealthWebhookAccountBindingRef } = await import('./suunto/health-webhook-binding');
            const binding = getSuuntoHealthWebhookAccountBindingRef(firestore.db as any, tokenID, userID) as any;
            firestore.seed(binding, {
                schemaVersion: 3, authorizationSource: 'oauth_callback', userID,
                providerAccountDigest: createHash('sha256').update(tokenID).digest('hex'),
                tokenCredentialGeneration: 'credential-generation-1',
            });
            await deleteLocalServiceToken(userID, ServiceNames.SuuntoApp, tokenID);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token(tokenID));
            expect(firestore.deleteDocument).toHaveBeenCalledWith(binding);
            expect(firestore.read(binding)).toBeUndefined();
        });
    });

    describe('getServiceOAuth2CodeRedirectAndSaveStateToUser', () => {
        const userID = 'test-user-id';
        const redirectUri = 'https://callback.url';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should generate state and save to Firestore for SuuntoApp', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const startedAfterMs = Date.now();
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(firestore.db.collection).toHaveBeenCalledWith('suuntoAppAccessTokens');
            expect(connection.root.id).toBe(userID);
            expect(connection.root.writes.set).toHaveBeenCalled();
            expect(connection.readRoot()).toEqual(expect.objectContaining({
                oauthFlowCreatedAt: expect.any(Number),
                oauthFlowExpiresAt: expect.any(Number),
            }));
            expect(Number(connection.readRoot()?.oauthFlowCreatedAt)).toBeGreaterThanOrEqual(startedAfterMs);
            expect(Number(connection.readRoot()?.oauthFlowExpiresAt)
                - Number(connection.readRoot()?.oauthFlowCreatedAt)).toBe(OAUTH_FLOW_TTL_MS);
        });

        it.each([true, false, undefined])('binds history consent %s to the expiring OAuth flow', async consent => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, ServiceNames.SuuntoApp, redirectUri, consent);
            expect(connection.readRoot()).toMatchObject({
                oauthImportRecentHistory: consent === true,
                oauthImportRouteHistory: false,
                oauthImportHistoryRange: '30_days',
                oauthFlowGeneration: expect.any(String),
                oauthFlowExpiresAt: expect.any(Number),
            });
        });

        it.each([true, false])('binds route consent to a selected history import (%s)', async history => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            await getServiceOAuth2CodeRedirectAndSaveStateToUser(userID, ServiceNames.SuuntoApp, redirectUri, history, '30_days', true);
            expect(connection.readRoot()).toMatchObject({ oauthImportRouteHistory: history });
        });

        it('should not save OAuth state when account deletion is active', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
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

            expect(connection.root.writes.set).not.toHaveBeenCalled();
        });

        it('starts OAuth after reclaiming an expired explicit disconnect operation lease', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.seedRoot({
                oauthFlowGeneration: 'abandoned-disconnect-flow',
                disconnectOperationGeneration: 'abandoned-disconnect-operation',
                disconnectOperationLeaseExpiresAt: Date.now() - 1,
            });

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
            )).resolves.toContain('https://');

            expect(connection.readRoot()).toEqual(expect.objectContaining({
                state: expect.any(String),
                oauthFlowGeneration: expect.any(String),
            }));
            expect(connection.readRoot()).not.toHaveProperty('disconnectOperationGeneration');
            expect(connection.readRoot()).not.toHaveProperty('disconnectOperationLeaseExpiresAt');
        });

        it('clears a failed OAuth preparation without deleting unrelated root fields', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const { SuuntoAuthAdapter } = await import('./suunto/auth/adapter');
            connection.seedRoot({ retainedLifecycleMarker: 'keep-me' });
            vi.spyOn(SuuntoAuthAdapter.prototype, 'getAuthorizationData')
                .mockRejectedValueOnce(new Error('provider preparation failed'));

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
            )).rejects.toThrow('provider preparation failed');

            expect(connection.readRoot()).toEqual({
                retainedLifecycleMarker: 'keep-me',
            });
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('keeps the COROS orphan-token fence when missing-root preparation fails', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            const { COROSAuthAdapter } = await import('./coros/auth/adapter');
            connection.removeRoot();
            vi.spyOn(COROSAuthAdapter.prototype, 'getAuthorizationData')
                .mockRejectedValueOnce(new Error('provider preparation failed'));

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.COROSAPI,
                redirectUri,
            )).rejects.toThrow('provider preparation failed');

            expect(connection.readRoot()).toEqual({
                activeOAuthCredentialGeneration: expect.any(String),
            });
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('keeps OAuth blocked while an active disconnect operation has no tokens left', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const leaseExpiresAt = Date.now() + 60_000;
            connection.seedRoot({
                oauthFlowGeneration: 'disconnect-flow',
                disconnectOperationGeneration: 'disconnect-operation',
                disconnectOperationLeaseExpiresAt: leaseExpiresAt,
            });

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
            )).rejects.toMatchObject({
                name: 'ServiceDisconnectInProgressError',
                code: 'unavailable',
                details: {
                    reason: 'service_disconnect_in_progress',
                    blocker: 'disconnect_operation',
                    retryDeadlineAt: leaseExpiresAt,
                },
            });

            expect(connection.readRoot()).toMatchObject({
                disconnectOperationGeneration: 'disconnect-operation',
                disconnectOperationLeaseExpiresAt: leaseExpiresAt,
            });
            expect(connection.tokens.get).not.toHaveBeenCalled();
        });

        it('does not publish delayed OAuth preparation after an explicit disconnect invalidates the flow', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const { SuuntoAuthAdapter } = await import('./suunto/auth/adapter');
            const originalGetAuthorizationData = SuuntoAuthAdapter.prototype.getAuthorizationData;
            let markPreparationStarted!: () => void;
            let releasePreparation!: () => void;
            const preparationStarted = new Promise<void>((resolve) => {
                markPreparationStarted = resolve;
            });
            const preparationGate = new Promise<void>((resolve) => {
                releasePreparation = resolve;
            });
            vi.spyOn(SuuntoAuthAdapter.prototype, 'getAuthorizationData')
                .mockImplementationOnce(async function (redirect, state) {
                    markPreparationStarted();
                    await preparationGate;
                    return originalGetAuthorizationData.call(this, redirect, state);
                });

            const authorizationPromise = getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
            );
            await preparationStarted;
            connection.setDisconnectGeneration({
                oauthFlowGeneration: 'disconnect-fence-generation',
                disconnectOperationGeneration: 'disconnect-operation-generation',
                disconnectOperationLeaseExpiresAt: Date.now() + 60_000,
            });
            releasePreparation();

            await expect(authorizationPromise).rejects.toMatchObject({
                name: 'OAuthFlowContextMismatchError',
            });
            expect(connection.readRoot()).toMatchObject({
                oauthFlowGeneration: 'disconnect-fence-generation',
                disconnectOperationGeneration: 'disconnect-operation-generation',
            });
        });

        it('does not publish delayed OAuth preparation after the flow expires', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const { SuuntoAuthAdapter } = await import('./suunto/auth/adapter');
            const originalGetAuthorizationData = SuuntoAuthAdapter.prototype.getAuthorizationData;
            let markPreparationStarted!: () => void;
            let releasePreparation!: () => void;
            const preparationStarted = new Promise<void>((resolve) => {
                markPreparationStarted = resolve;
            });
            const preparationGate = new Promise<void>((resolve) => {
                releasePreparation = resolve;
            });
            vi.spyOn(SuuntoAuthAdapter.prototype, 'getAuthorizationData')
                .mockImplementationOnce(async function (redirect, state) {
                    markPreparationStarted();
                    await preparationGate;
                    return originalGetAuthorizationData.call(this, redirect, state);
                });
            const flowStartedAt = 10_000;
            const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(flowStartedAt);

            try {
                const authorizationPromise = getServiceOAuth2CodeRedirectAndSaveStateToUser(
                    userID,
                    ServiceNames.SuuntoApp,
                    redirectUri,
                );
                await preparationStarted;
                dateNowSpy.mockReturnValue(flowStartedAt + OAUTH_FLOW_TTL_MS + 1);
                releasePreparation();

                await expect(authorizationPromise).rejects.toMatchObject({
                    name: 'OAuthFlowContextMismatchError',
                });
                expect(connection.readRoot()).not.toHaveProperty('state');
                expect(connection.readRoot()).not.toHaveProperty('codeVerifier');
                expect(connection.readRoot()).not.toHaveProperty('oauthFlowGeneration');
                expect(connection.readRoot()).not.toHaveProperty('oauthFlowCreatedAt');
                expect(connection.readRoot()).not.toHaveProperty('oauthFlowExpiresAt');
            } finally {
                dateNowSpy.mockRestore();
            }
        });

        it('should generate state and save to Firestore for COROSAPI', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.COROSAPI,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(firestore.db.collection).toHaveBeenCalledWith('COROSAPIAccessTokens');
        });

        it('fences a legacy COROS token child when OAuth recreates a missing root', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.removeRoot();

            await expect(getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.COROSAPI,
                redirectUri,
            )).resolves.toContain('https://');

            expect(connection.readRoot()).toEqual(expect.objectContaining({
                oauthFlowGeneration: expect.any(String),
                activeOAuthCredentialGeneration: expect.any(String),
            }));
            expect(connection.readRoot()?.activeOAuthCredentialGeneration)
                .toBe(connection.readRoot()?.oauthFlowGeneration);
        });

        it('should include PKCE codeVerifier for GarminAPI', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            const result = await getServiceOAuth2CodeRedirectAndSaveStateToUser(
                userID,
                ServiceNames.GarminAPI,
                redirectUri
            );

            expect(result).toContain('https://mock-auth-url.com');
            expect(firestore.db.collection).toHaveBeenCalledWith('garminAPITokens');

            expect(result).toContain('https://mock-auth-url.com');
            expect(firestore.db.collection).toHaveBeenCalledWith('garminAPITokens');

            // Verify state and codeVerifier were saved
            const setCall = connection.root.writes.set.mock.calls[0][0];
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
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: correctState });

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBe(true);
        });

        it('should return false when state does not match', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'different-state' });

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBe(false);
        });

        it('should return false when no data exists', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.removeRoot();

            const result = await validateOAuth2State(userID, ServiceNames.SuuntoApp, correctState);

            expect(result).toBeFalsy();
        });

        it('should return false when state field is missing', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ codeVerifier: 'some-verifier' });

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
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockClear();
        });

        it('should throw TokenNotFoundError when no tokens exist', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toThrow('No tokens found');
        });

        it('should call Garmin DELETE deauthorization API', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            const tokenData = { accessToken: 'garmin-access' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            firestore.deleteDocument.mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'garmin-access' });
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

            await deauthorizeServiceForUser(userID, ServiceNames.GarminAPI);

            expect(requestPromise.delete).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://apis.garmin.com/wellness-api/rest/user/registration',
                headers: { Authorization: 'Bearer garmin-access' }
            }));
        });

        it('should preserve token when API deauthorization fails with 500', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const tokenData = { accessToken: 'mock-token' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 500 error from API
            const error500 = new Error('Internal Server Error');
            (error500 as any).statusCode = 500;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error500);

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toMatchObject({ name: 'ServiceDisconnectInProgressError' });

            // Token should NOT be deleted when API returns 500
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('should preserve token when API deauthorization fails with 502', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const tokenData = { accessToken: 'mock-token' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 502 error from API
            const error502 = new Error('Bad Gateway');
            (error502 as any).statusCode = 502;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error502);

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toMatchObject({ name: 'ServiceDisconnectInProgressError' });

            // Token should NOT be deleted when API returns 502
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
        });

        it('should continue cleanup when API fails with non-500 error', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const tokenData = { accessToken: 'mock-token' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            firestore.deleteDocument.mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });

            // Simulate 404 error from API
            const error404 = new Error('Not Found');
            (error404 as any).statusCode = 404;
            (requestPromise.get as ReturnType<typeof vi.fn>).mockRejectedValue(error404);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Token SHOULD be deleted when API returns 404
            expect(firestore.deleteDocument).toHaveBeenCalled();
        });

        it('should fail explicit disconnect when deleting the local token fails', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            const tokenData = { accessToken: 'mock-token' };
            connection.replaceProviderToken('token-doc-id', tokenData);

            (getTokenData as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: 'mock-token' });
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

            // Simulate delete failure
            firestore.deleteDocument.mockRejectedValue(new Error('Delete failed'));

            await expect(deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp))
                .rejects.toThrow('Failed to fully clean up Suunto app connection for user test-user-id');
        });
    });

    describe('getAndSetServiceOAuth2AccessTokenForUser - additional cases', () => {
        const userID = 'test-user';
        const redirectUri = 'https://callback';
        const code = 'auth-code';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should throw error when getToken returns no results', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue(null as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toThrow(/No results when geting token/);
        });

        it('should throw error when getToken returns token without access_token', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({ token: {} } as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toThrow(/No results when geting token/);
        });
    });

    describe('getAndSetServiceOAuth2AccessTokenForUser - cleanup', () => {
        const userID = 'test-user';
        const redirectUri = 'https://callback';
        const code = 'auth-code';

        beforeEach(async () => {
            vi.clearAllMocks();
            (getTokenData as Mock).mockReset().mockResolvedValue({ accessToken: 'mock-access-token' });
            (requestPromise.get as Mock).mockReset().mockResolvedValue({});
            (requestPromise.post as Mock).mockReset().mockResolvedValue({});
            (requestPromise.delete as Mock).mockReset().mockResolvedValue({});

            // Explicitly restore any spies from previous tests if they weren't cleaned up
            const simpleOAuth2 = await import('simple-oauth2');
            vi.spyOn(simpleOAuth2.AuthorizationCode.prototype, 'getToken').mockRestore();
        });

        it('should cleanup state and codeVerifier after successful token exchange', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            // Mock Garmin User ID fetch
            (requestPromise.get as any).mockResolvedValueOnce({ userId: 'mock-garmin-user' });
            // Mock permissions fetch (non-fatal but good to have)
            (requestPromise.get as any).mockResolvedValueOnce({ permissions: [] });

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.GarminAPI, redirectUri, code, 'some-state');

            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
            expect(mockMarkServiceConnected).toHaveBeenCalledWith(
                userID,
                ServiceNames.GarminAPI,
                'mock-garmin-user',
                expect.objectContaining({
                    fieldName: 'activeOAuthCredentialGeneration',
                    expectedGeneration: expect.any(String),
                }),
                expect.objectContaining({
                    fieldName: 'oauthFlowGeneration',
                    expectedGeneration: 'oauth-flow-generation',
                }),
                expect.objectContaining({ requested: false, runId: expect.any(String) }),
            );
        });

        it.each([true, false, undefined])('preserves explicit Suunto route consent (%s) through the claimed OAuth flow', async consent => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            connection.patchRoot({ oauthImportRecentHistory: true });
            connection.patchRoot({ oauthImportRouteHistory: consent });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' }, expired: () => false,
            } as any);
            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state');
            expect(mockMarkServiceConnected.mock.calls[0][5]).toMatchObject({ requested: true, importRouteHistory: consent === true });
        });

        it.each([true, false])('returns durable acceptance only when consent and admission are enabled (%s)', async enabled => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            vi.stubEnv('CONNECTION_HISTORY_IMPORT_ENABLED', String(enabled));
            try {
                connection.patchRoot({ oauthImportRecentHistory: true });
                const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
                vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                    token: { user: 'test-external-user', access_token: 'mock-token' }, expired: () => false,
                } as any);
                (requestPromise.get as any).mockResolvedValueOnce({ userId: 'mock-garmin-user' });
                (requestPromise.get as any).mockResolvedValueOnce({ permissions: [] });
                const result = await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.GarminAPI, redirectUri, code, 'some-state');
                expect(result.connected).toBe(true);
                expect(mockMarkServiceConnected.mock.calls[0][5]).toMatchObject({
                    requested: enabled, rangePreset: '30_days', runId: expect.any(String), providerUserId: 'mock-garmin-user', credentialGeneration: expect.any(String),
                });
                if (enabled) {
                    expect(result.historyImport?.runId).toMatch(/^[0-9a-f-]{36}$/);
                    expect(result.historyImport?.runId).toBe(mockMarkServiceConnected.mock.calls[0][5].runId);
                }
                else expect(result).not.toHaveProperty('historyImport');
                expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                    oauthImportRecentHistory: 'delete-sentinel',
                    oauthImportHistoryRange: 'delete-sentinel',
                    oauthImportRouteHistory: 'delete-sentinel',
                }));
            } finally { vi.unstubAllEnvs(); }
        });

        it('clears pending disconnect root fields before marking an OAuth reconnect as connected', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({
                connected: true,
                outcome: 'connected',
            });

            expect(mockClearServiceDisconnectPending).toHaveBeenCalledWith(
                userID,
                ServiceNames.SuuntoApp,
                expect.objectContaining({
                    fieldName: 'activeOAuthCredentialGeneration',
                    expectedGeneration: expect.any(String),
                }),
                expect.objectContaining({
                    fieldName: 'oauthFlowGeneration',
                    expectedGeneration: 'oauth-flow-generation',
                }),
            );
            expect(mockMarkServiceConnected).toHaveBeenCalledWith(
                userID,
                ServiceNames.SuuntoApp,
                'test-external-user',
                expect.objectContaining({
                    fieldName: 'activeOAuthCredentialGeneration',
                    expectedGeneration: expect.any(String),
                }),
                expect.objectContaining({
                    fieldName: 'oauthFlowGeneration',
                    expectedGeneration: 'oauth-flow-generation',
                }),
                expect.objectContaining({ requested: false, runId: expect.any(String) }),
            );
            expect(mockClearServiceDisconnectPending.mock.invocationCallOrder[0])
                .toBeLessThan(mockMarkServiceConnected.mock.invocationCallOrder[0]);
        });

        it.each([false, true])('passes the verified Suunto account to the guarded connection write with history consent=%s', async consent => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            connection.patchRoot({ oauthImportRecentHistory: consent });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'replacement-suunto-account', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state');

            expect(mockMarkServiceConnected).toHaveBeenCalledOnce();
            const [, , providerUserId, credentialGuard, flowGuard, historyContext] = mockMarkServiceConnected.mock.calls[0];
            expect(providerUserId).toBe('replacement-suunto-account');
            expect(credentialGuard).toMatchObject({
                fieldName: 'activeOAuthCredentialGeneration', expectedGeneration: historyContext.credentialGeneration,
            });
            expect(flowGuard).toMatchObject({ fieldName: 'oauthFlowGeneration', expectedGeneration: 'oauth-flow-generation' });
            expect(historyContext).toMatchObject({ requested: consent, providerUserId });
        });

        it('does not mark connected when pending-disconnect clearing loses its lifecycle guard', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockClearServiceDisconnectPending.mockResolvedValueOnce('stale_lifecycle');

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({
                phase: `oauth_clear_disconnect_pending:${ServiceNames.SuuntoApp}`,
            });

            expect(mockMarkServiceConnected).not.toHaveBeenCalled();
        });

        it('stores the Wahoo provider account ID in safe connection metadata after OAuth', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.WahooAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            firestore.deleteDocument.mockResolvedValue({});
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'mock-token', refresh_token: 'mock-refresh-token' },
                expired: () => false,
            } as any);
            mockGetWahooUserID.mockResolvedValueOnce('60462');

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.WahooAPI,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({ connected: true, outcome: 'connected' });

            expect(mockMarkServiceConnected).toHaveBeenCalledWith(
                userID,
                ServiceNames.WahooAPI,
                '60462',
                expect.objectContaining({
                    fieldName: 'activeOAuthCredentialGeneration',
                    expectedGeneration: expect.any(String),
                }),
                expect.objectContaining({
                    fieldName: 'oauthFlowGeneration',
                    expectedGeneration: 'oauth-flow-generation',
                }),
                expect.objectContaining({ requested: false, runId: expect.any(String) }),
            );
        });

        it('atomically assigns a new credential generation when OAuth replaces a token', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({
                connected: true,
                outcome: 'connected',
            });

            expect(connection.token('test-external-user').writes.set).toHaveBeenCalledWith(expect.objectContaining({
                accessToken: 'mock-token',
                tokenCredentialGeneration: expect.any(String),
            }), undefined);
            expect(connection.root.writes.set).toHaveBeenCalledWith(expect.objectContaining({
                activeOAuthCredentialGeneration: expect.any(String),
            }), { merge: true });
            expect(firestore.setDocument).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('suuntoHealthWebhookAccountBindings/') }), {
                schemaVersion: 3,
                authorizationSource: 'oauth_callback',
                userID,
                providerAccountDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
                tokenCredentialGeneration: expect.any(String),
            }, undefined);
            expect(firestore.where).not.toHaveBeenCalled();
            expect(connection.readRoot()?.activeOAuthCredentialGeneration)
                .toBe(connection.readToken('test-external-user')?.tokenCredentialGeneration);
        });

        it('deletes only the stale token document when a newer OAuth callback wins', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.WahooAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'stale-access-token', refresh_token: 'stale-refresh-token' },
                expired: () => false,
            } as any);
            mockGetWahooUserID.mockResolvedValueOnce('stale-wahoo-account');
            mockMarkServiceConnected.mockImplementationOnce(async () => {
                connection.setOAuthFlow({ oauthFlowGeneration: 'winning-flow' });
                connection.persistCredentials('winning-wahoo-account', {
                    accessToken: 'winning-access-token', tokenCredentialGeneration: 'winning-generation',
                });
                return false;
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.WahooAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({
                phase: `oauth_mark_connected:${ServiceNames.WahooAPI}`,
            });

            expect(firestore.deleteDocument).toHaveBeenCalledTimes(1);
            expect(firestore.deleteDocument).toHaveBeenCalledWith(connection.token('stale-wahoo-account'));
            expect(connection.readToken('stale-wahoo-account')).toBeUndefined();
            expect(connection.readToken('winning-wahoo-account')).toMatchObject({ accessToken: 'winning-access-token' });
            expect(connection.readRoot()).toMatchObject({
                oauthFlowGeneration: 'winning-flow', activeOAuthCredentialGeneration: 'winning-generation',
            });
        });

        it('leaves the persisted token for an explicit disconnect that won before connected-state promotion', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.WahooAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'disconnect-owned-token', refresh_token: 'disconnect-owned-refresh' },
                expired: () => false,
            } as unknown as AccessToken);
            mockGetWahooUserID.mockResolvedValueOnce('wahoo-account');

            mockMarkServiceConnected.mockImplementationOnce(async () => {
                connection.setDisconnectGeneration({
                    oauthFlowGeneration: 'disconnect-flow-generation',
                    disconnectOperationGeneration: 'disconnect-operation-generation',
                    disconnectOperationLeaseExpiresAt: Date.now() + 60_000,
                });
                return false;
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.WahooAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({
                phase: `oauth_mark_connected:${ServiceNames.WahooAPI}`,
            });

            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(connection.readToken('wahoo-account')).toMatchObject({ accessToken: 'disconnect-owned-token' });
            expect(connection.readRoot()).toMatchObject({ disconnectOperationGeneration: 'disconnect-operation-generation' });
        });

        it('preserves the winning credential when the same token document was replaced', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.WahooAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'stale-access-token', refresh_token: 'stale-refresh-token' },
                expired: () => false,
            } as any);
            mockGetWahooUserID.mockResolvedValueOnce('shared-wahoo-account');

            mockMarkServiceConnected.mockImplementationOnce(async () => {
                connection.replaceProviderToken('shared-wahoo-account', {
                    ...connection.readToken('shared-wahoo-account'),
                    accessToken: 'winning-access-token',
                    tokenCredentialGeneration: 'winning-generation',
                });
                return false;
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.WahooAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({
                phase: `oauth_mark_connected:${ServiceNames.WahooAPI}`,
            });

            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(connection.readToken('shared-wahoo-account')).toMatchObject({
                accessToken: 'winning-access-token', tokenCredentialGeneration: 'winning-generation',
            });
        });

        it('immediately deauthorizes manual-review OAuth recovery for non-Pro users without marking connected', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            (hasProAccess as Mock).mockResolvedValue(false);
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: {
                    user: 'test-external-user',
                    access_token: 'mock-token',
                    refresh_token: 'mock-refresh-token',
                    expires_in: 3600,
                    scope: 'workout',
                },
                expired: () => false,
            } as any);
            // Return the exact credential that OAuth just persisted. The
            // cleanup guard intentionally rejects a resolver result whose
            // credential fields differ from that stored token.
            (getTokenData as Mock).mockImplementationOnce(async () => ({
                ...connection.readToken('test-external-user'),
            }));
            (requestPromise.get as Mock).mockResolvedValueOnce({});

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({
                connected: false,
                outcome: 'disconnect_recovery_completed',
            });

            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalled();
            expect(mockMarkServiceConnected).not.toHaveBeenCalled();
            expect(getTokenData).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'test-external-user', ref: connection.token('test-external-user') }),
                ServiceNames.SuuntoApp,
                false,
                expect.objectContaining({
                    recoverTerminalAuthFailure: false,
                    allowDisconnectPendingTokenUse: true,
                }),
            );
            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/oauth/deauthorize'),
            }));
            expect(clearServiceConnectionState).toHaveBeenCalledWith(
                userID,
                ServiceNames.SuuntoApp,
                expect.objectContaining({
                    expectedDisconnectLifecycleGuard: expect.any(Object),
                }),
            );
        });

        it('keeps non-Pro recovery pending until connection metadata is cleared', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            (hasProAccess as Mock).mockResolvedValue(false);
            (clearServiceConnectionState as Mock).mockResolvedValue(false);
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: {
                    user: 'test-external-user',
                    access_token: 'mock-token',
                    refresh_token: 'mock-refresh-token',
                    expires_in: 3600,
                    scope: 'workout',
                },
                expired: () => false,
            } as any);
            (getTokenData as Mock).mockImplementationOnce(async () => ({
                ...connection.readToken('test-external-user'),
            }));
            (requestPromise.get as Mock).mockResolvedValueOnce({});

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({
                connected: false,
                outcome: 'disconnect_recovery_pending',
            });
        });

        it('resumes pending disconnect retries when non-Pro OAuth recovery deauthorization fails retryably', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            (hasProAccess as Mock).mockResolvedValue(false);
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: {
                    user: 'test-external-user',
                    access_token: 'mock-token',
                    refresh_token: 'mock-refresh-token',
                    expires_in: 3600,
                    scope: 'workout',
                },
                expired: () => false,
            } as any);
            (getTokenData as Mock).mockImplementationOnce(async () => connection.readToken('test-external-user'));
            (requestPromise.get as Mock).mockRejectedValueOnce(Object.assign(new Error('gateway timeout'), {
                statusCode: 504,
            }));

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            )).resolves.toEqual({
                connected: false,
                outcome: 'disconnect_recovery_pending',
            });

            expect(mockClearServiceDisconnectPending).not.toHaveBeenCalled();
            expect(mockMarkServiceConnected).not.toHaveBeenCalled();
            expect(mockResumeServiceDisconnectRetryAfterRecoveryFailure).toHaveBeenCalledWith(
                userID,
                ServiceNames.SuuntoApp,
                {
                    tokenID: 'test-external-user',
                    statusCode: 504,
                    errorMessage: 'gateway timeout',
                    lifecycleGuard: {
                        disconnectGeneration: null,
                        oauthCredentialGeneration: connection.readRoot()?.activeOAuthCredentialGeneration,
                        oauthFlowGeneration: 'oauth-flow-generation',
                        disconnectOperationGeneration: null,
                    },
                },
            );
            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
        });

        it('should cleanup state and codeVerifier even if token exchange fails', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockRejectedValue(new Error('Exchange failed'));

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.GarminAPI, redirectUri, code, 'some-state'))
                .rejects.toThrow('Exchange failed');

            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
        });

        it('rejects an older callback before it can consume a newer OAuth context', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken')
                .mockRejectedValue(new Error('Exchange should not run'));
            connection.seedRoot({
                state: 'newer-state',
                codeVerifier: 'newer-verifier',
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.GarminAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({ name: 'OAuthFlowContextMismatchError' });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(connection.root.writes.update).not.toHaveBeenCalled();
        });

        it('rejects an expired OAuth callback before exchanging its authorization code', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken')
                .mockRejectedValue(new Error('Exchange should not run'));
            connection.seedRoot({
                state: 'some-state',
                codeVerifier: 'some-verifier',
                oauthFlowGeneration: 'oauth-flow-generation',
                oauthFlowCreatedAt: Date.now() - OAUTH_FLOW_TTL_MS - 1,
                oauthFlowExpiresAt: Date.now() - 1,
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.GarminAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({ name: 'OAuthFlowContextMismatchError' });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(connection.root.writes.update).not.toHaveBeenCalled();
        });

        it.each([
            ['missing', undefined],
            ['malformed', 'not-a-timestamp'],
            ['future numeric string', `${Date.now() + OAUTH_FLOW_TTL_MS}`],
            ['coercible object', { valueOf: () => Date.now() + OAUTH_FLOW_TTL_MS }],
            ['infinite', Number.POSITIVE_INFINITY],
        ])('rejects a callback with a %s OAuth expiry', async (_label, oauthFlowExpiresAt) => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken')
                .mockRejectedValue(new Error('Exchange should not run'));
            connection.seedRoot({
                state: 'some-state',
                codeVerifier: 'some-verifier',
                oauthFlowGeneration: 'oauth-flow-generation',
                oauthFlowExpiresAt,
            });

            await expect(getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.GarminAPI,
                redirectUri,
                code,
                'some-state',
            )).rejects.toMatchObject({ name: 'OAuthFlowContextMismatchError' });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(connection.root.writes.update).not.toHaveBeenCalled();
        });

        it('rejects a claimed callback when disconnect invalidates its OAuth generation during exchange', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            let releaseExchange!: () => void;
            let exchangeStarted!: () => void;
            const exchangeStartedPromise = new Promise<void>((resolve) => {
                exchangeStarted = resolve;
            });
            const exchangeGate = new Promise<void>((resolve) => {
                releaseExchange = resolve;
            });
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockImplementation(async () => {
                exchangeStarted();
                await exchangeGate;
                return {
                    token: { user: 'test-external-user', access_token: 'exchanged-token' },
                    expired: () => false,
                } as any;
            });

            const callbackPromise = getAndSetServiceOAuth2AccessTokenForUser(
                userID,
                ServiceNames.SuuntoApp,
                redirectUri,
                code,
                'some-state',
            );
            await exchangeStartedPromise;
            connection.setDisconnectGeneration({
                oauthFlowGeneration: 'disconnect-invalidated-generation',
            });
            releaseExchange();

            await expect(callbackPromise).rejects.toMatchObject({
                name: 'OAuthFlowContextMismatchError',
            });
            expect(mockMarkServiceConnected).not.toHaveBeenCalled();
        });

        it('should not exchange OAuth code when account deletion is active before token exchange', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(connection.root.writes.set).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
        });

        it('does not touch token documents when deletion begins after the callback context claim', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            const getTokenSpy = vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            connection.replaceProviderToken('existing-token', { accessToken: 'retained-token' });
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(connection.root.writes.set).not.toHaveBeenCalled();
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
            expect(connection.readToken('existing-token')).toEqual({ accessToken: 'retained-token' });
            expect(connection.readToken('test-external-user')).toBeUndefined();
        });

        it('consumes the callback context without attempting recursive cleanup when deletion starts', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(getTokenSpy).not.toHaveBeenCalled();
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalledWith(expect.objectContaining({
                state: 'delete-sentinel',
                codeVerifier: 'delete-sentinel',
            }));
        });

        it('should deauthorize exchanged OAuth token when account deletion starts before token persistence', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            mockGetUserDeletionGuardStateInTransaction
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(connection.root.writes.set).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer mock-token',
                }),
                url: expect.stringContaining('/oauth/deauthorize'),
            }));
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
        });

        it('should preserve existing service tokens when account deletion starts before new OAuth token persistence', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { user: 'test-external-user', access_token: 'mock-token' },
                expired: () => false,
            } as any);
            connection.replaceProviderToken('existing-token', { accessToken: 'retained-token' });
            mockGetUserDeletionGuardStateInTransaction
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                });

            expect(connection.root.writes.set).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalled();
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(requestPromise.get).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer mock-token',
                }),
                url: expect.stringContaining('/oauth/deauthorize'),
            }));
            expect(connection.readToken('existing-token')).toEqual({ accessToken: 'retained-token' });
            expect(connection.readToken('test-external-user')).toBeUndefined();
        });

        it('should archive exchanged OAuth token when unpersisted deauthorization fails', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
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
            mockGetUserDeletionGuardStateInTransaction
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
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

        it('does not perform a later context cleanup after the callback was claimed', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
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

            await getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state');

            expect(connection.root.writes.set).toHaveBeenCalled();
            expect(connection.token('test-external-user').writes.set).toHaveBeenCalled();
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalledTimes(1);
        });

        it('should not remove duplicate connections if account deletion blocks connected-state write after token persistence', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'some-state', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });
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

            await expect(getAndSetServiceOAuth2AccessTokenForUser(userID, ServiceNames.SuuntoApp, redirectUri, code, 'some-state'))
                .rejects.toMatchObject({
                    name: 'OAuthServiceConnectionSkippedForDeletedUserError',
                    userID,
                    serviceName: ServiceNames.SuuntoApp,
                    phase: `oauth_mark_connected:${ServiceNames.SuuntoApp}`,
                });

            expect(connection.root.writes.set).toHaveBeenCalled();
            expect(connection.token('test-external-user').writes.set).toHaveBeenCalled();
            expect(firestore.where).not.toHaveBeenCalled();
            expect(firestore.db.recursiveDelete).not.toHaveBeenCalled();
            expect(connection.root.writes.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('deauthorizeServiceForUser - edge cases for full coverage', () => {
        const userID = 'test-user-id';

        beforeEach(() => {
            vi.clearAllMocks();
            (requestPromise.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.post as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (requestPromise.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (getTokenData as ReturnType<typeof vi.fn>).mockClear();
        });

        it('should proceed with cleanup when getTokenData fails with non-500 error (e.output.statusCode)', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', {});

            firestore.deleteDocument.mockResolvedValue({});

            // Simulate error with output.statusCode format (e.g., from boom errors)
            const error401 = new Error('Unauthorized');
            (error401 as any).output = { statusCode: 401 };
            (getTokenData as ReturnType<typeof vi.fn>).mockRejectedValue(error401);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Should still proceed with local cleanup even when getTokenData fails with 401
            expect(firestore.deleteDocument).toHaveBeenCalled();
        });

        it('should proceed with cleanup when getTokenData fails with unknown error (no statusCode)', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, userID);
            connection.seedRoot({});
            connection.replaceProviderToken('token-doc-id', {});

            firestore.deleteDocument.mockResolvedValue({});

            // Simulate error without statusCode
            const unknownError = new Error('Unknown failure');
            (getTokenData as ReturnType<typeof vi.fn>).mockRejectedValue(unknownError);

            await deauthorizeServiceForUser(userID, ServiceNames.SuuntoApp);

            // Should still proceed with local cleanup
            expect(firestore.deleteDocument).toHaveBeenCalled();
        });
    });

    describe('removeDuplicateConnections', () => {
        const currentUserID = 'current-user-id';
        const otherUserID = 'other-user-id';
        const externalUserId = 'external-user-123';
        it('should throw error for unsupported service name', async () => {
            await expect(removeDuplicateConnections(currentUserID, 'UnsupportedService' as ServiceNames, externalUserId))
                .rejects.toThrow('Auth adapter not implemented for service: UnsupportedService');
        });
        it('preserves another users matching Suunto token for shared-account fan-out', async () => {
            const other = firestore.connection(getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName, otherUserID);
            other.replaceProviderToken(externalUserId, { serviceName: ServiceNames.SuuntoApp, userName: externalUserId });
            await removeDuplicateConnections(currentUserID, ServiceNames.SuuntoApp, externalUserId);
            expect(firestore.where).not.toHaveBeenCalled();
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(other.readToken(externalUserId)).toBeDefined();
        });
        it('should propagate duplicate cleanup failure for a single-owner provider', async () => {
            const other = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, otherUserID);
            other.seedRoot({});
            other.replaceProviderToken('token-id-other-user', { serviceName: ServiceNames.COROSAPI, openId: externalUserId });
            firestore.deleteDocument.mockRejectedValueOnce(new Error('firestore delete failed'));
            await expect(removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId))
                .rejects.toThrow('Failed to delete local COROS API token token-id-other-user for user other-user-id');
            expect(other.readToken('token-id-other-user')).toBeDefined();
        });
        it('should query openId field for COROS', async () => {
            await removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId);
            expect(firestore.where).toHaveBeenCalledWith('openId', '==', externalUserId);
        });
        it('should query userID field for Garmin', async () => {
            await removeDuplicateConnections(currentUserID, ServiceNames.GarminAPI, externalUserId);
            expect(firestore.where).toHaveBeenCalledWith('userID', '==', externalUserId);
        });
        it('should query Wahoo tokens by stable user ID and service name', async () => {
            await removeDuplicateConnections(currentUserID, ServiceNames.WahooAPI, externalUserId);
            expect(firestore.where).toHaveBeenCalledWith('wahooUserID', '==', externalUserId);
            expect(firestore.where).toHaveBeenCalledWith('serviceName', '==', ServiceNames.WahooAPI);
        });
        it('should skip tokens with mismatched serviceName', async () => {
            const other = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, otherUserID);
            other.replaceProviderToken('account', { serviceName: ServiceNames.WahooAPI, openId: externalUserId });
            await removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId);
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(other.readToken('account')).toBeDefined();
        });
        it('should skip tokens belonging to current user', async () => {
            const own = firestore.connection(getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName, currentUserID);
            own.replaceProviderToken('account', { serviceName: ServiceNames.COROSAPI, openId: externalUserId });
            await removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId);
            expect(firestore.deleteDocument).not.toHaveBeenCalled();
            expect(own.readToken('account')).toBeDefined();
        });
        it('should handle doc with null parent.parent', async () => {
            const { COROSAuthAdapter } = await import('./coros/auth/adapter');
            const querySpy = vi.spyOn(COROSAuthAdapter.prototype, 'getDuplicateConnectionQuery').mockReturnValue({
                get: vi.fn().mockResolvedValue({ docs: [{
                    id: 'token-id', ref: { parent: { parent: null } },
                    data: () => ({ serviceName: ServiceNames.COROSAPI }),
                }] }),
            } as any);
            try {
                await removeDuplicateConnections(currentUserID, ServiceNames.COROSAPI, externalUserId);
                expect(firestore.deleteDocument).not.toHaveBeenCalled();
            } finally {
                querySpy.mockRestore();
            }
        });
    });

    describe('OAuth2 - Final Coverage Gaps', () => {
        const userID = 'testUserID';

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should throw error when Garmin User ID fetch fails', async () => {
            const connection = firestore.connection(getServiceConfig(ServiceNames.GarminAPI).tokenCollectionName, 'u1');
            connection.seedRoot({});
            connection.setOAuthFlow({ state: 'matches', codeVerifier: 'some-verifier', oauthFlowGeneration: 'oauth-flow-generation', oauthFlowExpiresAt: Date.now() + OAUTH_FLOW_TTL_MS });

            // Mock token exchange to succeed
            const MockAuthCode = (await import('simple-oauth2')).AuthorizationCode;
            vi.spyOn(MockAuthCode.prototype, 'getToken').mockResolvedValue({
                token: { access_token: 'valid-token' },
                expired: () => false,
            } as any);

            // We mock requestPromise.get to fail, which getGarminUserId uses
            (requestPromise.get as any).mockRejectedValue(new Error('Failed to fetch Garmin User ID'));

            await expect(getAndSetServiceOAuth2AccessTokenForUser('u1', ServiceNames.GarminAPI, 'uri', 'code', 'matches'))
                .rejects.toThrow(/Failed to fetch Garmin User ID/);
        });

        it('should handle default case in deauthorizeServiceForUser switch', async () => {
            await expect(deauthorizeServiceForUser(userID, 'UnknownService' as ServiceNames))
                .rejects.toThrow('Auth adapter not implemented for service: UnknownService');
            expect(firestore.db.runTransaction).not.toHaveBeenCalled();
        });
    });
});
