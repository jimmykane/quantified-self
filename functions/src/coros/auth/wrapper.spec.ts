import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as oauth2 from '../../OAuth2';
import { SERVICE_NAME } from '../constants';

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
    getCOROSAPIAuthRequestTokenRedirectURI,
    requestAndSetCOROSAPIAccessToken,
    deauthorizeCOROSAPI
} from './wrapper';

describe('COROS Auth Wrapper', () => {
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

    describe('getCOROSAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI for pro user', async () => {
            const result = await getCOROSAPIAuthRequestTokenRedirectURI(data, context);

            expect(utils.isProUser).toHaveBeenCalledWith('testUserID');
            expect(oauth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                'https://app.com/callback'
            );
            expect(result).toEqual({ redirect_uri: 'https://mock-redirect.com' });
        });

        it('should throw error for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await expect(getCOROSAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('Service sync is a Pro feature.');
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(getCOROSAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error if not authenticated', async () => {
            context.auth = null;

            await expect(getCOROSAPIAuthRequestTokenRedirectURI(data, context))
                .rejects.toThrow('User must be authenticated.');
        });
    });

    describe('requestAndSetCOROSAPIAccessToken', () => {
        beforeEach(() => {
            data = {
                state: 'validState',
                code: 'validCode',
                redirectUri: 'https://app.com/callback'
            };
        });

        it('should validate state and set tokens', async () => {
            await requestAndSetCOROSAPIAccessToken(data, context);

            expect(oauth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', SERVICE_NAME, 'validState');
            expect(oauth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
                'testUserID',
                SERVICE_NAME,
                'https://app.com/callback',
                'validCode'
            );
        });

        it('should throw error if state is invalid', async () => {
            (oauth2.validateOAuth2State as any).mockResolvedValue(false);

            await expect(requestAndSetCOROSAPIAccessToken(data, context))
                .rejects.toThrow('Invalid OAuth state');
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(requestAndSetCOROSAPIAccessToken(data, context))
                .rejects.toThrow('App Check verification failed.');
        });
    });

    describe('deauthorizeCOROSAPI', () => {
        it('should call deauthorize and return result', async () => {
            const result = await deauthorizeCOROSAPI({}, context);

            expect(oauth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', SERVICE_NAME);
            expect(result).toEqual({ result: 'Deauthorized' });
        });

        it('should throw error if App Check fails', async () => {
            context.app = null;

            await expect(deauthorizeCOROSAPI({}, context))
                .rejects.toThrow('App Check verification failed.');
        });

        it('should throw error on deauthorization failure', async () => {
            (oauth2.deauthorizeServiceForUser as any).mockRejectedValue(new Error('API Error'));

            await expect(deauthorizeCOROSAPI({}, context))
                .rejects.toThrow('Deauthorization Error');
        });
    });
});
