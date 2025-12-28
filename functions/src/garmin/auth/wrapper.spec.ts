import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as GarminAuth from './auth';
import * as requestHelper from '../../request-helper';
import * as utils from '../../utils';

// Mock dependencies
vi.mock('firebase-admin', () => {
    const deleteMock = vi.fn().mockResolvedValue({});
    const setMock = vi.fn().mockResolvedValue({});
    const getMock = vi.fn().mockResolvedValue({
        data: () => ({
            state: 'mockState',
            oauthToken: 'mockToken',
            oauthTokenSecret: 'mockSecret',
            accessToken: 'mockAccessToken',
            accessTokenSecret: 'mockAccessTokenSecret'
        })
    });
    const docMock = vi.fn(() => ({
        set: setMock,
        get: getMock,
        delete: deleteMock
    }));
    const collectionMock = vi.fn(() => ({
        doc: docMock,
        where: vi.fn().mockReturnThis()
    }));
    return {
        firestore: () => ({
            collection: collectionMock
        })
    };
});

vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onRequest: (handler: any) => handler
        }
    })
}));

vi.mock('./auth', () => ({
    GarminHealthAPIAuth: vi.fn(() => ({
        authorize: vi.fn().mockReturnValue({}),
        toHeader: vi.fn().mockReturnValue({})
    }))
}));

vi.mock('../../request-helper', () => ({
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn()
}));

vi.mock('../../utils', () => ({
    isCorsAllowed: vi.fn().mockReturnValue(true),
    setAccessControlHeadersOnResponse: vi.fn(),
    getUserIDFromFirebaseToken: vi.fn().mockResolvedValue('testUserID'),
    isProUser: vi.fn().mockResolvedValue(true),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.'
}));

// Import AFTER mocks
import {
    getGarminHealthAPIAuthRequestTokenRedirectURI,
    requestAndSetGarminHealthAPIAccessToken,
    deauthorizeGarminHealthAPI
} from './wrapper';

describe('Garmin Auth Wrapper', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (utils.isProUser as any).mockResolvedValue(true);
        (utils.getUserIDFromFirebaseToken as any).mockResolvedValue('testUserID');
        (utils.isCorsAllowed as any).mockReturnValue(true);

        req = {
            method: 'POST',
            body: {}
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            write: vi.fn().mockReturnThis()
        };
    });

    describe('getGarminHealthAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI and state for pro user', async () => {
            (requestHelper.post as any).mockResolvedValue('oauth_token=token&oauth_token_secret=secret');

            await getGarminHealthAPIAuthRequestTokenRedirectURI(req, res);

            expect(utils.isProUser).toHaveBeenCalledWith('testUserID');
            expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
                redirect_uri: expect.any(String),
                oauthToken: 'token',
                state: expect.any(String)
            }));
            const firestore = admin.firestore();
            expect(firestore.collection).toHaveBeenCalled();
        });

        it('should return 403 for non-pro user', async () => {
            (utils.isProUser as any).mockResolvedValue(false);

            await getGarminHealthAPIAuthRequestTokenRedirectURI(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Service sync is a Pro feature.');
        });
    });

    describe('requestAndSetGarminHealthAPIAccessToken', () => {
        it('should exchange tokens and save to firestore', async () => {
            req.body = { state: 'mockState', oauthVerifier: 'verifier' };
            (requestHelper.post as any).mockResolvedValue('oauth_token=accessToken&oauth_token_secret=accessSecret');
            (requestHelper.get as any).mockResolvedValue(JSON.stringify({ userId: 'garminUID' }));

            await requestAndSetGarminHealthAPIAccessToken(req, res);

            expect(res.send).toHaveBeenCalled();
            const firestore = admin.firestore();
            expect(firestore.collection('').doc('').set).toHaveBeenCalledWith(expect.objectContaining({
                accessToken: 'accessToken',
                accessTokenSecret: 'accessSecret',
                userID: 'garminUID'
            }));
        });

        it('should return 403 if state is invalid', async () => {
            req.body = { state: 'wrongState', oauthVerifier: 'verifier' };

            await requestAndSetGarminHealthAPIAccessToken(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Unauthorized');
        });
    });

    describe('deauthorizeGarminHealthAPI', () => {
        it('should call deauthorize function and return 200', async () => {
            (requestHelper.delete as any).mockResolvedValue({});

            await deauthorizeGarminHealthAPI(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalled();
        });
    });
});
