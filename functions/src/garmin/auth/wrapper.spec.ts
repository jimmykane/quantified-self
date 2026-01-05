import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as requestHelper from '../../request-helper';
import * as utils from '../../utils';

// Define stable mocks
const mockDelete = vi.fn().mockResolvedValue({});
const mockSet = vi.fn().mockResolvedValue({});
const mockGet = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();

const mockDocInstance = {
    delete: mockDelete,
    set: mockSet,
    get: mockGet,
};

const mockCollectionInstance = {
    doc: mockDoc,
    where: vi.fn().mockReturnThis(),
};

mockDoc.mockReturnValue(mockDocInstance);
mockCollection.mockReturnValue(mockCollectionInstance);

// Mock dependencies
vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({
        collection: mockCollection,
    })),
}));

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
    isCorsAllowed: vi.fn(),
    setAccessControlHeadersOnResponse: vi.fn().mockImplementation((req, res) => res),
    getUserIDFromFirebaseToken: vi.fn(),
    isProUser: vi.fn(),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
    TokenNotFoundError: class TokenNotFoundError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'TokenNotFoundError';
        }
    }
}));

import {
    getGarminHealthAPIAuthRequestTokenRedirectURI,
    requestAndSetGarminHealthAPIAccessToken,
    deauthorizeGarminHealthAPI,
    deauthorizeGarminHealthAPIForUser,
} from './wrapper';

describe('Garmin Auth Wrapper', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(utils.isCorsAllowed).mockReturnValue(true);
        vi.mocked(utils.getUserIDFromFirebaseToken).mockResolvedValue('testUserID');
        vi.mocked(utils.isProUser).mockResolvedValue(true);

        req = {
            method: 'POST', // Crucial for passing the check in wrapper.ts
            query: { userID: 'testUserID' },
            body: {},
            headers: { authorization: 'Bearer mock-token' },
            get: vi.fn().mockReturnValue('localhost')
        };
        res = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            write: vi.fn().mockReturnThis()
        };

        // Default: Document exists and has data
        mockGet.mockResolvedValue({
            exists: true,
            data: () => ({
                accessToken: 'mock-token',
                accessTokenSecret: 'mock-secret',
                state: 'mockState',
                oauthToken: 'token',
                oauthTokenSecret: 'secret'
            }),
        });
        mockDelete.mockResolvedValue({});
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
            expect(mockCollection).toHaveBeenCalled();
        });

        it('should return 403 for non-pro user', async () => {
            vi.mocked(utils.isProUser).mockResolvedValue(false);

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
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
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

        it('should return 500 if deauthorization fails', async () => {
            // Force the internal deauthorize function to throw a 500 error
            (requestHelper.delete as any).mockRejectedValue({ statusCode: 500, message: 'Server Error' });

            await deauthorizeGarminHealthAPI(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('deauthorizeGarminHealthAPIForUser', () => {
        const userID = 'testUserID';

        it('should deauthorize and delete records successfully', async () => {
            (requestHelper.delete as any).mockResolvedValue({});

            await deauthorizeGarminHealthAPIForUser(userID);

            expect(requestHelper.delete).toHaveBeenCalled();
            expect(mockDelete).toHaveBeenCalled();
        });

        it('should make correct Garmin API call for deauthorization', async () => {
            (requestHelper.delete as any).mockResolvedValue({});

            await deauthorizeGarminHealthAPIForUser(userID);

            expect(requestHelper.delete).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://healthapi.garmin.com/wellness-api/rest/user/registration',
            }));
        });

        it('should NOT delete local records if Garmin API returns 500', async () => {
            const error500 = new Error('Server error');
            (error500 as any).statusCode = 500;
            (requestHelper.delete as any).mockRejectedValue(error500);

            await expect(deauthorizeGarminHealthAPIForUser(userID)).rejects.toThrow('Server error');

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('should delete record if no tokens are found (hollow document)', async () => {
            mockGet.mockResolvedValue({
                exists: false, // This triggers the deletion block in wrapper.ts
                data: () => null
            });

            await expect(deauthorizeGarminHealthAPIForUser(userID))
                .rejects.toThrow('No token found');

            expect(mockDelete).toHaveBeenCalled();
        });
    });
});
