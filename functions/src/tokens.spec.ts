import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData, refreshTokens, refreshStaleTokens, TerminalServiceAuthError } from './tokens';

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

const firestoreMock = {
    collectionGroup: vi.fn(),
};

vi.mock('firebase-admin', () => {
    const firestoreFn = () => firestoreMock;
    (firestoreFn as any).QueryDocumentSnapshot = class { };
    (firestoreFn as any).QuerySnapshot = class { };

    return {
        default: {
            firestore: firestoreFn,
        },
        firestore: firestoreFn,
    };
});

vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class { },
}));

vi.mock('./auth/factory', () => ({
    getServiceAdapter: vi.fn(),
}));

vi.mock('./service-auth-lifecycle', () => {
    class MockTerminalServiceAuthError extends Error {
        readonly name = 'TerminalServiceAuthError';
        readonly dlqContext: 'INVALID_GRANT' | 'AUTH_RECONNECT_REQUIRED';

        constructor(
            public readonly serviceName: ServiceNames,
            public readonly firebaseUserID: string | null,
            public readonly providerUserId: string,
            public readonly statusCode: number | null,
            public readonly providerErrorCode: string | null,
            public readonly providerErrorMessage: string | null,
            public readonly originalError: unknown,
        ) {
            super(`${serviceName} connection requires reconnect`);
            this.dlqContext = `${providerErrorCode || ''} ${providerErrorMessage || ''}`.toLowerCase().includes('invalid_grant')
                ? 'INVALID_GRANT'
                : 'AUTH_RECONNECT_REQUIRED';
        }
    }

    const normalize = (value: unknown): string | null => {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    };

    return {
        TerminalServiceAuthError: MockTerminalServiceAuthError,
        extractRefreshFailureDetails: vi.fn((error: any) => {
            const statusCode = error?.statusCode || error?.output?.statusCode || null;
            const providerErrorCode = normalize(
                error?.data?.payload?.error
                || error?.data?.error
                || error?.error?.error,
            );
            const providerErrorMessage = normalize(
                error?.data?.payload?.error_description
                || error?.data?.payload?.message
                || error?.data?.error_description
                || error?.error?.error_description
                || error?.message
                || providerErrorCode,
            );
            const fragments = [providerErrorCode, providerErrorMessage, normalize(error?.message)]
                .filter((value): value is string => !!value)
                .map((value) => value.toLowerCase());
            const isInvalidGrant = fragments.some((value) => value.includes('invalid_grant'));
            return {
                statusCode,
                providerErrorCode,
                providerErrorMessage,
                isInvalidGrant,
                isTerminalAuthFailure: statusCode === 401 || isInvalidGrant,
                isTransientError: statusCode === 400
                    || statusCode === 401
                    || statusCode === 500
                    || statusCode === 502
                    || (statusCode === 406 && fragments.some((value) => value.includes('json compatible'))),
                logMessage: providerErrorMessage || providerErrorCode || 'Unknown token refresh failure',
            };
        }),
        handleTerminalServiceAuthFailure: vi.fn(async (doc: any, serviceName: ServiceNames, serviceTokenData: any, failure: any, originalError: unknown) => ({
            kind: 'terminal_error',
            error: new MockTerminalServiceAuthError(
                serviceName,
                doc.ref.parent.parent?.id || null,
                serviceTokenData.userName || serviceTokenData.openId || serviceTokenData.userID || doc.id,
                failure.statusCode,
                failure.providerErrorCode,
                failure.providerErrorMessage,
                originalError,
            ),
        })),
    };
});

import { getServiceAdapter } from './auth/factory';
import { handleTerminalServiceAuthFailure } from './service-auth-lifecycle';

describe('tokens', () => {
    let mockDoc: any;
    let mockToken: any;
    let mockOAuthClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        firestoreMock.collectionGroup.mockReset();
        (handleTerminalServiceAuthFailure as any).mockReset().mockImplementation(async (doc: any, serviceName: ServiceNames, serviceTokenData: any, failure: any, originalError: unknown) => ({
            kind: 'terminal_error',
            error: new TerminalServiceAuthError(
                serviceName,
                doc.ref.parent.parent?.id || null,
                serviceTokenData.userName || serviceTokenData.openId || serviceTokenData.userID || doc.id,
                failure.statusCode,
                failure.providerErrorCode,
                failure.providerErrorMessage,
                originalError,
            ),
        }));

        mockDoc = {
            id: 'user-123',
            data: vi.fn().mockReturnValue({
                accessToken: 'old-access',
                refreshToken: 'old-refresh',
                expiresAt: Date.now() + 3600000,
                serviceName: ServiceNames.SuuntoApp,
                userName: 'suunto-user',
                dateCreated: 1000,
                dateRefreshed: 1000,
            }),
            ref: {
                update: vi.fn(() => Promise.resolve()),
                delete: vi.fn(() => Promise.resolve()),
                parent: { parent: { id: 'firebase-user-123' } },
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
            },
        };

        mockOAuthClient = {
            createToken: vi.fn().mockReturnValue(mockToken),
        };

        (getServiceAdapter as any).mockReturnValue({
            getOAuth2Client: vi.fn().mockReturnValue(mockOAuthClient),
            tokenCollectionName: 'test-collection',
        });
    });

    describe('refreshStaleTokens', () => {
        it('should query for stale and missing date tokens and refresh them', async () => {
            const mockSnapshot = {
                size: 1,
                docs: [mockDoc],
            };

            const getMock = vi.fn().mockResolvedValue(mockSnapshot);
            const limitMock = vi.fn().mockReturnValue({ get: getMock });
            const whereMock = vi.fn();
            whereMock.mockReturnValue({ where: whereMock, limit: limitMock });

            firestoreMock.collectionGroup.mockReturnValue({ where: whereMock });
            mockToken.expired.mockReturnValue(true);

            await refreshStaleTokens(ServiceNames.SuuntoApp, 123456);

            expect(firestoreMock.collectionGroup).toHaveBeenCalledWith('tokens');
            expect(whereMock).toHaveBeenCalledTimes(4);
            expect(whereMock).toHaveBeenCalledWith('serviceName', '==', ServiceNames.SuuntoApp);
            expect(whereMock).toHaveBeenCalledWith('dateRefreshed', '<=', 123456);
            expect(whereMock).toHaveBeenCalledWith('dateRefreshed', '==', null);
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

        it('should apply 600s buffer to expiresAt for Suunto tokens', async () => {
            const mockExpiresAt = new Date(Date.now() + 86400000);
            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_at: mockExpiresAt,
                    user: 'suunto-user',
                    token_type: 'Bearer',
                    scope: 'workout',
                },
            });

            await getTokenData(mockDoc, ServiceNames.SuuntoApp, false);

            const updateArg = mockDoc.ref.update.mock.calls[0][0];
            expect(updateArg.expiresAt).toBe(mockExpiresAt.getTime() - 600000);
        });

        it('should apply 600s buffer to expiresAt for Garmin tokens', async () => {
            mockDoc.data.mockReturnValue({
                accessToken: 'old-garmin',
                refreshToken: 'old-garmin-refresh',
                expiresAt: Date.now() + 3600000,
                serviceName: ServiceNames.GarminAPI,
                userID: 'garmin-user-id',
                dateCreated: 1000,
                dateRefreshed: 1000,
            });

            const mockExpiresAt = new Date(Date.now() + 86400000);
            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-garmin-access',
                    refresh_token: 'new-garmin-refresh',
                    expires_at: mockExpiresAt,
                    token_type: 'Bearer',
                    scope: 'workout',
                },
            });

            await getTokenData(mockDoc, ServiceNames.GarminAPI, false);

            const updateArg = mockDoc.ref.update.mock.calls[0][0];
            expect(updateArg.expiresAt).toBe(mockExpiresAt.getTime() - 600000);
        });

        it('should include permissions in the returned Garmin token data', async () => {
            const permissions = ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'];
            mockDoc.data.mockReturnValue({
                accessToken: 'old-garmin',
                refreshToken: 'old-garmin-refresh',
                expiresAt: Date.now() + 3600000,
                serviceName: ServiceNames.GarminAPI,
                userID: 'garmin-user-id',
                permissions,
                dateCreated: 1000,
                dateRefreshed: 1000,
            });

            mockToken.expired.mockReturnValue(false);

            const result: any = await getTokenData(mockDoc, ServiceNames.GarminAPI, false);

            expect(result.permissions).toEqual(permissions);
        });

        it('should handle COROS token refresh', async () => {
            mockDoc.data.mockReturnValue({
                accessToken: 'old-coros',
                serviceName: ServiceNames.COROSAPI,
                openId: 'coros-user',
                expiresAt: 1000,
            });

            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: {
                    access_token: 'new-coros',
                    message: 'OK',
                },
            });

            const result = await getTokenData(mockDoc, ServiceNames.COROSAPI, false);

            expect(result.accessToken).toBe('old-coros');
            expect(mockDoc.ref.update).toHaveBeenCalled();
        });

        it('should delegate 401 Boom errors to the terminal auth lifecycle', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('Unauthorized');
            error.output = { statusCode: 401 };
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toBeInstanceOf(TerminalServiceAuthError);

            expect(handleTerminalServiceAuthFailure).toHaveBeenCalled();
        });

        it('should delegate standard 401 errors to the terminal auth lifecycle', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('Unauthorized');
            error.statusCode = 401;
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toBeInstanceOf(TerminalServiceAuthError);

            expect(handleTerminalServiceAuthFailure).toHaveBeenCalled();
        });

        it('should delegate invalid_grant errors to the terminal auth lifecycle', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('invalid_grant');
            error.statusCode = 400;
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toMatchObject({
                    name: 'TerminalServiceAuthError',
                    dlqContext: 'INVALID_GRANT',
                });

            expect(handleTerminalServiceAuthFailure).toHaveBeenCalled();
        });

        it('should retry once with a newer stored snapshot when terminal auth cleanup reports the token was superseded', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('invalid_grant');
            error.statusCode = 400;

            const replacementDoc = {
                id: 'user-123',
                data: vi.fn().mockReturnValue({
                    accessToken: 'replacement-access',
                    refreshToken: 'replacement-refresh',
                    expiresAt: Date.now() + 3600000,
                    serviceName: ServiceNames.SuuntoApp,
                    userName: 'suunto-user',
                    dateCreated: 1000,
                    dateRefreshed: 2000,
                }),
                ref: {
                    update: vi.fn(() => Promise.resolve()),
                    delete: vi.fn(() => Promise.resolve()),
                    parent: { parent: { id: 'firebase-user-123' } },
                },
            };

            mockToken.refresh
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce({
                    token: {
                        access_token: 'recovered-access',
                        refresh_token: 'recovered-refresh',
                        expires_at: new Date(Date.now() + 3600000),
                        user: 'suunto-user',
                        token_type: 'Bearer',
                        scope: 'workout',
                    },
                });
            (handleTerminalServiceAuthFailure as any).mockResolvedValueOnce({
                kind: 'retry_with_latest_snapshot',
                latestSnapshot: replacementDoc,
            });

            const result = await getTokenData(mockDoc, ServiceNames.SuuntoApp, false);

            expect(handleTerminalServiceAuthFailure).toHaveBeenCalledTimes(1);
            expect(mockToken.refresh).toHaveBeenCalledTimes(2);
            expect(result.accessToken).toBe('recovered-access');
            expect(replacementDoc.ref.update).toHaveBeenCalled();
        });

        it('should detect invalid_grant from nested provider payloads', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('Response Error: 400 Bad Request');
            error.statusCode = 400;
            error.data = {
                payload: {
                    error: 'invalid_grant',
                    error_description: 'User no longer active/connected with the partner',
                },
            };
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toMatchObject({
                    name: 'TerminalServiceAuthError',
                    providerErrorCode: 'invalid_grant',
                    providerErrorMessage: 'User no longer active/connected with the partner',
                    dlqContext: 'INVALID_GRANT',
                });

            expect(handleTerminalServiceAuthFailure).toHaveBeenCalled();
        });

        it('should NOT trigger terminal cleanup on generic 500 error', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('Server Error');
            error.statusCode = 500;
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toThrow('Server Error');

            expect(mockDoc.ref.delete).not.toHaveBeenCalled();
            expect(handleTerminalServiceAuthFailure).not.toHaveBeenCalled();
        });

        it('should NOT trigger terminal cleanup on 406 JSON compatibility errors', async () => {
            mockToken.expired.mockReturnValue(true);
            const error: any = new Error('The content-type is not JSON compatible');
            error.statusCode = 406;
            mockToken.refresh.mockRejectedValue(error);

            await expect(getTokenData(mockDoc, ServiceNames.SuuntoApp, false))
                .rejects.toThrow('The content-type is not JSON compatible');

            expect(mockDoc.ref.delete).not.toHaveBeenCalled();
            expect(handleTerminalServiceAuthFailure).not.toHaveBeenCalled();
        });
    });

    describe('refreshTokens', () => {
        it('should process all docs in snapshot', async () => {
            const mockQuerySnapshot = {
                size: 2,
                docs: [mockDoc, { ...mockDoc, id: 'user-456' }],
            };

            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: { access_token: 'new', expires_at: new Date() },
            });

            await refreshTokens(mockQuerySnapshot as any, ServiceNames.SuuntoApp);

            expect(mockToken.refresh).toHaveBeenCalledTimes(2);
        });

        it('should process the provided snapshot without Suunto-specific serviceName exceptions', async () => {
            const mixedDocs = [
                {
                    id: 'suunto-doc',
                    data: () => ({ serviceName: ServiceNames.SuuntoApp, accessToken: 'a', refreshToken: 'b', expiresAt: Date.now() - 1 }),
                    ref: { update: vi.fn(), parent: { parent: { id: 'user-a' } } },
                },
                {
                    id: 'other-doc',
                    data: () => ({ serviceName: 'OtherService', accessToken: 'a', refreshToken: 'b', expiresAt: Date.now() - 1 }),
                    ref: { update: vi.fn(), parent: { parent: { id: 'user-b' } } },
                },
            ];

            const mockQuerySnapshot = {
                size: 2,
                docs: mixedDocs,
            };

            mockToken.expired.mockReturnValue(true);
            mockToken.refresh.mockResolvedValue({
                token: { access_token: 'new', refresh_token: 'next', expires_at: new Date(), user: 'u', token_type: 'Bearer', scope: 'workout' },
            });

            await refreshTokens(mockQuerySnapshot as any, ServiceNames.SuuntoApp);

            expect(getServiceAdapter).toHaveBeenCalledTimes(2);
        });
    });
});
