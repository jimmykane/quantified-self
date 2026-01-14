import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock dependencies
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onRequest: (handler: any) => handler
        }
    })
}));

vi.mock('../../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    getUserIDFromFirebaseToken: vi.fn().mockResolvedValue('testUserID'),
    isProUser: vi.fn().mockResolvedValue(true),
    determineRedirectURI: vi.fn((req) => req.body?.redirectUri || req.query?.redirect_uri),
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
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');

        req = {
            method: 'POST',
            body: {
                redirectUri: 'https://app.com/callback'
            }
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
        };
    });

    describe('getSuuntoAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            await getSuuntoAPIAuthRequestTokenRedirectURI(req, res);

            expect(utils.isProUser).toHaveBeenCalledWith('testUserID');
            expect(oauth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback'
            );
            expect(res.send).toHaveBeenCalledWith({ redirect_uri: 'https://mock-redirect.com' });
        });

        it('should return 403 for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await getSuuntoAPIAuthRequestTokenRedirectURI(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Service sync is a Pro feature.');
        });
    });

    describe('requestAndSetSuuntoAPIAccessToken', () => {
        it('should validate state and set tokens', async () => {
            req.body = {
                state: 'validState',
                code: 'validCode',
                redirectUri: 'https://app.com/callback'
            };

            await requestAndSetSuuntoAPIAccessToken(req, res);

            expect(oauth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp, 'validState');
            expect(oauth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
                'testUserID',
                ServiceNames.SuuntoApp,
                'https://app.com/callback',
                'validCode'
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should return 403 if state is invalid', async () => {
            (oauth2.validateOAuth2State as any).mockResolvedValue(false);
            req.body = { state: 'invalid', code: 'c', redirectUri: 'r' };

            await requestAndSetSuuntoAPIAccessToken(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe('deauthorizeSuuntoApp', () => {
        it('should call deauthorize and return 200', async () => {
            await deauthorizeSuuntoApp(req, res);

            expect(oauth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.SuuntoApp);
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
