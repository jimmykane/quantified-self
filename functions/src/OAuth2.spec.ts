import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';

// Mock firebase-functions first
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
        garminhealth: {
            consumer_key: 'test-garmin-consumer-key',
            consumer_secret: 'test-garmin-consumer-secret',
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

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class MockAuthorizationCode {
        constructor(public config: any) { }
        authorizeURL(params: any) {
            return `https://mock-auth-url.com?redirect_uri=${params.redirect_uri}&scope=${params.scope}&state=${params.state}`;
        }
        getToken(params: any) {
            return Promise.resolve({
                token: {
                    access_token: 'mock-access-token',
                    refresh_token: 'mock-refresh-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'workout',
                    user: 'test-user',
                    openId: 'test-open-id',
                },
            });
        }
        createToken(token: any) {
            return {
                expired: () => false,
                refresh: () => Promise.resolve({ token: {} }),
                token,
            };
        }
    },
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const mockDocRef = {
        collection: vi.fn(() => ({
            doc: vi.fn(() => mockDocRef),
        })),
        set: vi.fn(() => Promise.resolve()),
        get: vi.fn(() => Promise.resolve({
            data: () => ({ state: 'valid-state' }),
            exists: true,
        })),
    };

    const mockCollection = {
        doc: vi.fn(() => mockDocRef),
        get: vi.fn(() => Promise.resolve({
            docs: [],
            size: 0,
        })),
        where: vi.fn(function() {
 return this;
}),
        limit: vi.fn(function() {
 return this;
}),
    };

    const mockFirestore = () => ({
        collection: vi.fn(() => mockCollection),
        collectionGroup: vi.fn(() => mockCollection),
    });

    return {
        default: {
            firestore: mockFirestore,
            initializeApp: vi.fn(),
            credential: { cert: vi.fn() },
        },
        firestore: mockFirestore,
    };
});

// Mock request-helper
vi.mock('./request-helper', () => ({
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
}));

// Import AFTER mocks
import {
    getServiceConfig,
    convertAccessTokenResponseToServiceToken,
} from './OAuth2';

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
});
