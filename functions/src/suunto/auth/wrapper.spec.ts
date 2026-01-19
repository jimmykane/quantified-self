'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock firebase-functions/v2/https
vi.mock('firebase-functions/v2/https', () => {
    return {
        onCall: (options: any, handler: any) => {
            return handler;
        },
        HttpsError: class HttpsError extends Error {
            code: string;
            constructor(code: string, message: string) {
                super(message);
                this.code = code;
                this.name = 'HttpsError';
            }
        }
    };
});

vi.mock('../../utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils')>();
    return {
        ...actual,
        isProUser: vi.fn().mockResolvedValue(true),
    };
});

vi.mock('../../OAuth2', () => ({
    deauthorizeServiceForUser: vi.fn().mockResolvedValue({}),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn().mockResolvedValue({}),
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn().mockResolvedValue('https://mock-redirect.com'),
    validateOAuth2State: vi.fn().mockResolvedValue(true)
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
        (utils.isProUser as any).mockResolvedValue(true);
    });

    describe('getSuuntoAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            const request = createMockRequest({
                data: { redirectUri: 'https://app.com/callback' }
            });

            const result = await getSuuntoAPIAuthRequestTokenRedirectURI(request as any);

            expect(utils.isProUser).toHaveBeenCalledWith('testUserID');
            expect(oauth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback'
            );
            expect(result).toEqual({ redirect_uri: 'https://mock-redirect.com' });
        });

        it('should throw error for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);
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

            expect(oauth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp, 'validState');
            expect(oauth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback',
                'validCode'
            );
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

            expect(oauth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
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
            (oauth2.deauthorizeServiceForUser as any).mockRejectedValue(new Error('API Error'));
            const request = createMockRequest({
                data: {}
            });

            await expect(deauthorizeSuuntoApp(request as any))
                .rejects.toThrow('Deauthorization Error');
        });
    });
});
