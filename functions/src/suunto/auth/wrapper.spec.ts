'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as serviceOAuthAccess from '../../service-oauth-access';

const hoisted = vi.hoisted(() => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('firebase-functions/logger', () => hoisted.logger);

// Mock firebase-functions/v2/https
vi.mock('firebase-functions/v2/https', () => {
    return {
        onCall: (options: any, handler: any) => {
            return handler;
        },
        HttpsError: class HttpsError extends Error {
            code: string;
            details?: unknown;
            constructor(code: string, message: string, details?: unknown) {
                super(message);
                this.code = code;
                this.details = details;
                this.name = 'HttpsError';
            }
        }
    };
});

vi.mock('../../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils')>();
    return {
        ...actual,
        hasProAccess: vi.fn().mockResolvedValue(true),
    };
});

vi.mock('../../OAuth2', () => ({
    disconnectServiceForUser: vi.fn().mockResolvedValue({}),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn().mockResolvedValue({}),
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn().mockResolvedValue('https://mock-redirect.com'),
    isOAuthFlowContextMismatchError: (error: unknown) => (error as { name?: string } | null)?.name === 'OAuthFlowContextMismatchError',
    isServiceDisconnectInProgressError: (error: unknown) => (error as { name?: string } | null)?.name === 'ServiceDisconnectInProgressError',
    validateOAuth2State: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../service-oauth-access', () => ({
    hasServiceOAuthConnectAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../service-auth-lifecycle', () => ({
    extractRefreshFailureDetails: vi.fn((error: any) => {
        const statusCode = error?.statusCode || error?.output?.statusCode || null;
        const providerErrorCode = error?.data?.payload?.error || null;
        const providerErrorMessage = error?.data?.payload?.error_description || error?.message || null;
        const isInvalidGrant = [providerErrorCode, providerErrorMessage, error?.message]
            .filter(Boolean)
            .some(value => `${value}`.toLowerCase().includes('invalid_grant'));
        return {
            statusCode,
            providerErrorCode,
            providerErrorMessage,
            isInvalidGrant,
            isTerminalAuthFailure: statusCode === 401 || isInvalidGrant,
            isTransientError: [400, 401, 500, 502].includes(statusCode),
            logMessage: providerErrorMessage || providerErrorCode || 'Unknown token exchange failure',
        };
    }),
}));

// Import AFTER mocks
import {
    getSuuntoAPIAuthRequestTokenRedirectURI,
    requestAndSetSuuntoAPIAccessToken,
    deauthorizeSuuntoApp
} from './wrapper';

// Helper to create mock request
function createMockRequest(overrides: Partial<{
    auth: { uid: string } | null;
    app: object | null;
    data: any;
}> = {}) {
    return {
        auth: overrides.auth !== undefined ? overrides.auth : { uid: 'testUserID' },
        app: overrides.app !== undefined ? overrides.app : { appId: 'test-app' },
        data: overrides.data ?? {},
    };
}

describe('Suunto Auth Wrapper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (utils.hasProAccess as any).mockResolvedValue(true);
        (serviceOAuthAccess.hasServiceOAuthConnectAccess as any).mockResolvedValue(true);
    });

    describe('getSuuntoAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            const request = createMockRequest({
                data: { redirectUri: 'https://app.com/callback' }
            });

            const result = await getSuuntoAPIAuthRequestTokenRedirectURI(request as any);

            expect(serviceOAuthAccess.hasServiceOAuthConnectAccess).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
            expect(oauth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback'
            );
            expect(result).toEqual({ redirect_uri: 'https://mock-redirect.com' });
        });

        it('should throw error when OAuth connect access is denied', async () => {
            (serviceOAuthAccess.hasServiceOAuthConnectAccess as any).mockResolvedValue(false);
            const request = createMockRequest({
                data: { redirectUri: 'https://app.com/callback' }
            });

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(request as any))
                .rejects.toThrow();

            try {
                await getSuuntoAPIAuthRequestTokenRedirectURI(request as any);
            } catch (e: any) {
                expect(e.code).toBe('permission-denied');
            }
        });

        it('should throw error if App Check fails', async () => {
            const request = createMockRequest({
                app: null,
                data: { redirectUri: 'https://app.com/callback' }
            });

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(request as any))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            const request = createMockRequest({
                auth: null,
                data: { redirectUri: 'https://app.com/callback' }
            });

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(request as any))
                .rejects.toThrow('User must be authenticated.');
        });
    });

    describe('requestAndSetSuuntoAPIAccessToken', () => {
        it('should validate state and set tokens', async () => {
            const request = createMockRequest({
                data: {
                    state: 'validState',
                    code: 'validCode',
                    redirectUri: 'https://app.com/callback'
                }
            });

            await requestAndSetSuuntoAPIAccessToken(request as any);

            expect(serviceOAuthAccess.hasServiceOAuthConnectAccess).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
            expect(oauth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp, 'validState');
            expect(oauth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback',
                'validCode',
                'validState',
            );
        });

        it('should report Suunto invalid_grant as non-terminal without logging the authorization code', async () => {
            const error: any = new Error('Response Error: 400 Bad Request');
            error.statusCode = 400;
            error.data = {
                payload: {
                    error: 'invalid_grant',
                    error_description: 'Invalid authorization code: secret-authorization-code',
                },
            };
            (oauth2.getAndSetServiceOAuth2AccessTokenForUser as any).mockRejectedValue(error);
            const request = createMockRequest({
                data: {
                    state: 'validState',
                    code: 'secret-authorization-code',
                    redirectUri: 'https://app.com/callback'
                }
            });

            await expect(requestAndSetSuuntoAPIAccessToken(request as any)).rejects.toMatchObject({
                code: 'failed-precondition',
                message: 'Suunto authorization code expired or was already used. Start the connection again.',
            });

            expect(hoisted.logger.error).not.toHaveBeenCalled();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                '[SuuntoAuth] Authorization code exchange was rejected with a non-terminal invalid_grant.',
                {
                    serviceName: ServiceNames.SuuntoApp,
                    phase: 'authorization_code_exchange',
                    providerStatus: 400,
                    providerErrorCode: 'invalid_grant',
                    terminal: false,
                    outcome: 'restart_oauth',
                },
            );
            expect(JSON.stringify([
                hoisted.logger.warn.mock.calls,
                hoisted.logger.error.mock.calls,
            ])).not.toContain('secret-authorization-code');
        });

        it('should throw error if state is invalid', async () => {
            (oauth2.validateOAuth2State as any).mockResolvedValue(false);
            const request = createMockRequest({
                data: {
                    state: 'invalidState',
                    code: 'validCode',
                    redirectUri: 'https://app.com/callback'
                }
            });

            await expect(requestAndSetSuuntoAPIAccessToken(request as any))
                .rejects.toThrow('Invalid OAuth state');
        });

        it('should throw error if App Check fails', async () => {
            const request = createMockRequest({
                app: null,
                data: {
                    state: 'validState',
                    code: 'validCode',
                    redirectUri: 'https://app.com/callback'
                }
            });

            await expect(requestAndSetSuuntoAPIAccessToken(request as any))
                .rejects.toThrow('App Check verification failed.');
        });
    });

    describe('deauthorizeSuuntoApp', () => {
        it('should call deauthorize and return result', async () => {
            const request = createMockRequest({
                data: {}
            });

            const result = await deauthorizeSuuntoApp(request as any);

            expect(oauth2.disconnectServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
            expect(result).toEqual({ result: 'Deauthorized' });
        });

        it('should throw error if App Check fails', async () => {
            const request = createMockRequest({
                app: null,
                data: {}
            });

            await expect(deauthorizeSuuntoApp(request as any))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error on deauthorization failure', async () => {
            (oauth2.disconnectServiceForUser as any).mockRejectedValue(new Error('API Error'));
            const request = createMockRequest({
                data: {}
            });

            await expect(deauthorizeSuuntoApp(request as any))
                .rejects.toThrow('Deauthorization Error');
        });

        it('returns a retryable error when token refresh blocks disconnect', async () => {
            const details = {
                reason: 'service_disconnect_in_progress',
                blocker: 'token_refresh',
                retryAt: Date.now() + 1_000,
                retryDeadlineAt: Date.now() + 90_000,
            };
            (oauth2.disconnectServiceForUser as any).mockRejectedValue(
                Object.assign(new Error('Suunto credentials are being refreshed.'), {
                    name: 'ServiceDisconnectInProgressError',
                    details,
                }),
            );

            await expect(deauthorizeSuuntoApp(createMockRequest() as any)).rejects.toMatchObject({
                code: 'unavailable',
                details,
            });
        });
    });
});
