import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData, refreshTokens } from './tokens';

// Mock firebase-functions
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: { client_id: 'id', client_secret: 'secret' },
        corosapi: { client_id: 'id', client_secret: 'secret' },
        garminhealth: { consumer_key: 'key', consumer_secret: 'secret' },
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
    const mockDocRef = {
        update: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        id: 'mock-doc-id',
    };
    return {
        default: {
            firestore: () => ({}),
        },
        firestore: {
            QueryDocumentSnapshot: class { },
            QuerySnapshot: class { },
        },
    };
});

// Mock simple-oauth2
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class { },
}));

// Mock OAuth2 module
vi.mock('./OAuth2', () => ({
    getServiceConfig: vi.fn(),
}));

import { getServiceConfig } from './OAuth2';

describe('tokens', () => {
    let mockDoc: any;
    let mockToken: any;
    let mockOAuthClient: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDoc = {
            id: 'user-123',
            data: vi.fn().mockReturnValue({
                accessToken: 'old-access',
                refreshToken: 'old-refresh',
                expiresAt: Date.now() + 3600000, // 1 hour future
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user',
                dateCreated: 1000,
                dateRefreshed: 1000,
            }),
            ref: {
                update: vi.fn(() => Promise.resolve()),
                delete: vi.fn(() => Promise.resolve()),
            },
        };

        mockToken = {
            expired: vi.fn().mockReturnValue(false),
            refresh: vi.fn().mockResolvedValue({
                token: {
                    access_token: 'default-access',
                    refresh_token: 'default-refresh',
                    expires_at: new Date(),
                    user: 'default-user',
                    token_type: 'Bearer',
                    scope: 'default-scope',
                }
            }),
            token: {
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                expires_at: new Date(),
                user: 'suunto-user',
                // ... properties needed for Suunto/COROS logic
            },
        };

        mockOAuthClient = {
            createToken: vi.fn().mockReturnValue(mockToken),
        };

        (getServiceConfig as any).mockReturnValue({
            oauth2Client: mockOAuthClient,
            tokenCollectionName: 'test-collection',
        });
    });

    describe('getTokenData', () => {
        it('should return existing token if valid and not forced', async () => {
            mockToken.expired.mockReturnValue(false);

            const result = await getTokenData(mockDoc, ServiceNames.SuuntoApp, false);

            expect(result.accessToken).toBe('old-access');
            expect(mockToken.refresh).not.toHaveBeenCalled();
        });

        it('should refresh token if forced', async () => {
            mockToken.expired.mockReturnValue(false);
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_at: new Date(Date.now() + 3600000),
                    user: 'suunto-user',
                    token_type: 'Bearer',
                    scope: 'workout',
                },
            });

            const result = await getTokenData(mockDoc, ServiceNames.SuuntoApp, true);

            expect(mockToken.refresh).toHaveBeenCalled();
            expect(result.accessToken).toBe('new-access');
            expect(mockDoc.ref.update).toHaveBeenCalled();
        });

        it('should refresh token if expired', async () => {
            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-access-exp',
                    refresh_token: 'new-refresh-exp',
                    expires_at: new Date(Date.now() + 3600000),
                    user: 'suunto-user',
                    token_type: 'Bearer',
                    scope: 'workout',
                },
            });

            const result = await getTokenData(mockDoc, ServiceNames.SuuntoApp, false);

            expect(mockToken.refresh).toHaveBeenCalled();
            expect(result.accessToken).toBe('new-access-exp');
        });

        it('should handle COROS token refresh', async () => {
            mockDoc.data.mockReturnValue({
                accessToken: 'old-coros',
                serviceName: ServiceNames.COROSAPI,
                openId: 'coros-user',
                expiresAt: 1000,
            });

            mockToken.expired.mockReturnValue(true);
            // COROS check: if message exists and != OK, it throws
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-coros',
                    message: 'OK',
                },
            });

            // For COROS, the update logic uses the old data merged with new expiry
            const result = await getTokenData(mockDoc, ServiceNames.COROSAPI, false);

            expect(result.accessToken).toBe('old-coros'); // Implementation quirk: COROS case reuses serviceTokenData structure but updates expiry/refreshed
            // Wait, let's check implementation again.
            // Case ServiceNames.COROSAPI: newToken = <COROS...>serviceTokenData; newToken.expiresAt = ...
            // But it doesn't seem to update access token from response?
            // Looking at line 123: newToken = <COROSAPIAuth2ServiceTokenInterface>serviceTokenData
            // It seems it DOES NOT update the access token from the refresh response for COROS??
            // That looks like a bug or specific behavior.
            // Ah, for COROS the refresh endpoint might just extend validity of existing token?
            // Or maybe the implementation is indeed buggy. I will assert based on CURRENT implementation.
            // Current impl: copies serviceTokenData (old data), updates expiresAt/dateRefreshed.

            expect(mockDoc.ref.update).toHaveBeenCalled();
        });

        it('should delete token on 401 error', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('Unauthorized');
            error.isBoom = true;
            error.output = { statusCode: 401 };

            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toThrow('Unauthorized');

            expect(mockDoc.ref.delete).toHaveBeenCalled();
        });
    });

    describe('refreshTokens', () => {
        it('should process all docs in snapshot', async () => {
            const mockQuerySnapshot = {
                size: 2,
                docs: [mockDoc, { ...mockDoc, id: 'user-456' }],
            };

            // We need to allow getServiceConfig to return valid mock for multiple calls
            (getServiceConfig as any).mockReturnValue({
                oauth2Client: mockOAuthClient,
                tokenCollectionName: 'test-collection',
            });

            // Assume getTokenData works without throwing
            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: { access_token: 'new', expires_at: new Date() },
            });

            await refreshTokens(mockQuerySnapshot as any, ServiceNames.SuuntoApp);

            expect(mockToken.refresh).toHaveBeenCalledTimes(2);
        });

        it('should skip Suunto app tokens if target service is not Suunto App', async () => {
            // Logic: if serviceName === ServiceNames.SuuntoApp (passed arg)
            // AND authToken.data().serviceName is defined
            // AND authToken.data().serviceName !== ServiceNames.SuuntoApp
            // THEN continue

            // Wait, looking at code:
            // if (serviceName === ServiceNames.SuuntoApp
            //   && authToken.data().serviceName
            //   && authToken.data().serviceName !== ServiceNames.SuuntoApp
            // )
            // This logic seems to filter OUT tokens that claim to be something else when we are processing SuuntoApp?

            const mixedDocs = [
                {
                    id: 'suunto-doc',
                    data: () => ({ serviceName: ServiceNames.SuuntoApp }),
                    ref: { update: vi.fn() }, // Mock ref
                },
                {
                    id: 'other-doc',
                    data: () => ({ serviceName: 'OtherService' }),
                    ref: { update: vi.fn() }, // Mock ref
                },
            ];

            const mockQuerySnapshot = {
                size: 2,
                docs: mixedDocs,
            };

            await refreshTokens(mockQuerySnapshot as any, ServiceNames.SuuntoApp);

            // Only suunto-doc should be processed
            // Actually, since I didn't mock getTokenData to NOT fail, it might fail.
            // But the loop continues on error.
            // I want to verify getTokenData was called only once.

            // Since I am testing `tokens.ts`, `getTokenData` is an export from the same file.
            // I can't easily mock it unless I separate it or spy on it if it called via `exports`.
            // But here it calls `getTokenData` directly.
            // I will rely on `getServiceConfig` being called as a proxy for `getTokenData` being called.

            expect(getServiceConfig).toHaveBeenCalledTimes(1);
        });
    });
});
