import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { SERVICE_NAME } from '../constants';

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
    assertProServiceAccess: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../OAuth2', () => ({
    deauthorizeServiceForUser: vi.fn().mockResolvedValue({}),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn().mockResolvedValue({}),
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn().mockResolvedValue('https://mock-redirect.com'),
    validateOAuth2State: vi.fn().mockResolvedValue(true)
}));

// Import AFTER mocks
import {
    getCOROSAPIAuthRequestTokenRedirectURI,
    requestAndSetCOROSAPIAccessToken,
    deauthorizeCOROSAPI
} from './wrapper';

describe('COROS Auth Wrapper', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.assertProServiceAccess as any).mockResolvedValue(true);
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

    describe('getCOROSAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            await getCOROSAPIAuthRequestTokenRedirectURI(req, res);

            expect(utils.assertProServiceAccess).toHaveBeenCalledWith('testUserID');
            expect(oauth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                'https://app.com/callback'
            );
            expect(res.send).toHaveBeenCalledWith({ redirect_uri: 'https://mock-redirect.com' });
        });

        it('should return 403 for non-pro user', async () => {
            (utils.assertProServiceAccess as any).mockRejectedValue(new Error('Pro required'));

            await getCOROSAPIAuthRequestTokenRedirectURI(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Pro required');
        });
    });

    describe('requestAndSetCOROSAPIAccessToken', () => {
        it('should validate state and set tokens', async () => {
            req.body = {
                state: 'validState',
                code: 'validCode',
                redirectUri: 'https://app.com/callback'
            };

            await requestAndSetCOROSAPIAccessToken(req, res);

            expect(oauth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', SERVICE_NAME, 'validState');
            expect(oauth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                'https://app.com/callback',
                'validCode'
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should return 403 if state is invalid', async () => {
            (oauth2.validateOAuth2State as any).mockResolvedValue(false);
            req.body = { state: 'invalid', code: 'c', redirectUri: 'r' };

            await requestAndSetCOROSAPIAccessToken(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe('deauthorizeCOROSAPI', () => {
        it('should call deauthorize and return 200', async () => {
            await deauthorizeCOROSAPI(req, res);

            expect(oauth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
