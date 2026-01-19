import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock dependencies
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onCall: (handler: any) => handler
        }
    }),
    runWith: () => ({
        region: () => ({
            https: {
                onCall: (handler: any) => handler
            }
        })
    }),
    https: {
        HttpsError: class HttpsError extends Error {
            constructor(public code: string, message: string) {
                super(message);
                this.name = 'HttpsError';
            }
        }
    }
}));

vi.mock('../../utils', () => ({
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

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

describe('Suunto Auth Wrapper', () => {
    let context: any;
    let data: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);

        context = {
            app: { appId: 'test-app' },
            auth: { uid: 'testUserID' }
        };
        data = {
            redirectUri: 'https://app.com/callback'
        };
    });

    describe('getSuuntoAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            const result = await getSuuntoAPIAuthRequestTokenRedirectURI(data, context);

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

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('Service sync is a Pro feature.');
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            context.auth = null;

            await expect(getSuuntoAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('User must be authenticated.');
        });
    });

    describe('requestAndSetSuuntoAPIAccessToken', () => {
        beforeEach(() => {
            data = {
                state: 'validState',
                code: 'validCode',
                redirectUri: 'https://app.com/callback'
            };
        });

        it('should validate state and set tokens', async () => {
            await requestAndSetSuuntoAPIAccessToken(data, context);

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

            await expect(requestAndSetSuuntoAPIAccessToken(data, context))
                .rejects.toThrow('Invalid OAuth state');
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(requestAndSetSuuntoAPIAccessToken(data, context))
                .rejects.toThrow('App Check verification failed.');
        });
    });

    describe('deauthorizeSuuntoApp', () => {
        it('should call deauthorize and return result', async () => {
            const result = await deauthorizeSuuntoApp({}, context);

            expect(oauth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
            expect(result).toEqual({ result: 'Deauthorized' });
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(deauthorizeSuuntoApp({}, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error on deauthorization failure', async () => {
            (oauth2.deauthorizeServiceForUser as any).mockRejectedValue(new Error('API Error'));

            await expect(deauthorizeSuuntoApp({}, context))
                .rejects.toThrow('Deauthorization Error');
        });
    });
});
