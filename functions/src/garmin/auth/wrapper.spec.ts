import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as OAuth2 from '../../OAuth2';
import * as admin from 'firebase-admin';

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
    ref: { delete: mockDelete },
};

const mockCollectionInstance = {
    doc: mockDoc,
    where: vi.fn().mockReturnThis(),
    get: mockGet,
};

mockDoc.mockReturnValue(mockDocInstance);
mockCollection.mockReturnValue(mockCollectionInstance);

const mockCollectionGroup = vi.fn().mockReturnThis();

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    return {
        firestore: vi.fn(() => ({
            collection: mockCollection,
            collectionGroup: mockCollectionGroup,
        })),
    };
});

vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        https: {
            onRequest: (handler: any) => handler
        }
    })
}));

vi.mock('../../utils', () => ({
    isCorsAllowed: vi.fn(),
    setAccessControlHeadersOnResponse: vi.fn().mockImplementation((req, res) => res),
    getUserIDFromFirebaseToken: vi.fn(),
    isProUser: vi.fn(),
    determineRedirectURI: vi.fn(),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
}));

vi.mock('../../OAuth2', () => ({
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn(),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn(),
    deauthorizeServiceForUser: vi.fn(),
    validateOAuth2State: vi.fn(),
}));

import {
    getGarminAPIAuthRequestTokenRedirectURI,
    requestAndSetGarminAPIAccessToken,
    deauthorizeGarminAPI,
    deauthorizeGarminAPIUsers,
} from './wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('Garmin Auth Wrapper', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(utils.isCorsAllowed).mockReturnValue(true);
        vi.mocked(utils.getUserIDFromFirebaseToken).mockResolvedValue('testUserID');
        vi.mocked(utils.isProUser).mockResolvedValue(true);
        vi.mocked(utils.determineRedirectURI).mockReturnValue('https://callback');

        req = {
            method: 'POST',
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
    });

    describe('getGarminAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI from OAuth2 helper', async () => {
            vi.mocked(OAuth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).mockResolvedValue('https://garmin.com/oauth');

            await getGarminAPIAuthRequestTokenRedirectURI(req, res);

            expect(OAuth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'https://callback');
            expect(res.send).toHaveBeenCalledWith({ redirect_uri: 'https://garmin.com/oauth' });
        });

        it('should return 403 for non-pro user', async () => {
            vi.mocked(utils.isProUser).mockResolvedValue(false);

            await getGarminAPIAuthRequestTokenRedirectURI(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Service sync is a Pro feature.');
        });
    });

    describe('requestAndSetGarminAPIAccessToken', () => {
        it('should exchange tokens if state is valid', async () => {
            req.body = { state: 'validState', code: 'validCode', redirectUri: 'https://cb' };
            vi.mocked(OAuth2.validateOAuth2State).mockResolvedValue(true);
            vi.mocked(OAuth2.getAndSetServiceOAuth2AccessTokenForUser).mockResolvedValue(undefined);

            await requestAndSetGarminAPIAccessToken(req, res);

            expect(OAuth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'validState');
            expect(OAuth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'https://cb', 'validCode');
            expect(res.send).toHaveBeenCalled();
        });

        it('should return 403 if state is invalid', async () => {
            req.body = { state: 'invalidState', code: 'validCode', redirectUri: 'https://cb' };
            vi.mocked(OAuth2.validateOAuth2State).mockResolvedValue(false);

            await requestAndSetGarminAPIAccessToken(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.send).toHaveBeenCalledWith('Unauthorized');
        });
    });

    describe('deauthorizeGarminAPI', () => {
        it('should call deauthorize service', async () => {
            await deauthorizeGarminAPI(req, res);

            expect(OAuth2.deauthorizeServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should return 404 if token not found', async () => {
            const error = new Error('Token not found');
            error.name = 'TokenNotFoundError';
            vi.mocked(OAuth2.deauthorizeServiceForUser).mockRejectedValue(error);

            await deauthorizeGarminAPI(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.send).toHaveBeenCalledWith('Token not found');
        });
    });

    describe('receiveGarminAPIDeregistration', () => {
        it('should deauthorize users by reverse lookup', async () => {
            req.body = { deregistrations: [{ userId: 'garminUser123' }] };

            // Mock Collection Group Query
            const mockTokenDoc = {
                ref: {
                    parent: {
                        parent: {
                            id: 'firebaseUserXYZ'
                        }
                    }
                }
            };

            const mockQuerySnapshot = {
                empty: false,
                docs: [mockTokenDoc]
            };

            // Setup mock chain for admin.firestore().collectionGroup().where().where().get()
            const mockWhere = vi.fn().mockReturnThis();

            // Configure GLOBAL mock
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) }); // chain for multiple wheres

            await deauthorizeGarminAPIUsers(req, res);

            // Verify logic
            // 1. collectionGroup called
            expect(mockCollectionGroup).toHaveBeenCalledWith('tokens');
            // 2. where clauses
            expect(mockWhere).toHaveBeenCalledWith('userID', '==', 'garminUser123');
            expect(mockWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.GarminAPI);
            // 3. deauthorizeServiceForUser called with correct Firebase User ID
            expect(OAuth2.deauthorizeServiceForUser).toHaveBeenCalledWith('firebaseUserXYZ', ServiceNames.GarminAPI);

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should handle payload with no matching users', async () => {
            req.body = { deregistrations: [{ userId: 'ghostUser' }] };

            const mockWhere = vi.fn().mockReturnThis();
            const mockGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });

            // Configure GLOBAL mock
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: mockGet
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: mockGet }); // chain

            await deauthorizeGarminAPIUsers(req, res);

            expect(OAuth2.deauthorizeServiceForUser).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('receiveGarminAPIUserPermissions', () => {
        it('should process valid permission change payload', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            req.body = {
                userPermissionsChange: [{
                    userId: 'garminUser456',
                    permissions: ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'],
                    summaryId: 'x120d383-60256e84',
                    changeTimeInSeconds: 1613065860
                }]
            };

            await receiveGarminAPIUserPermissions(req, res);

            // Should return 200 (just logs, doesn't deauthorize)
            expect(res.status).toHaveBeenCalledWith(200);
            // Deauthorize should NOT be called (permissions change doesn't mean disconnect)
            expect(OAuth2.deauthorizeServiceForUser).not.toHaveBeenCalled();
        });

        it('should handle invalid payload gracefully', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            req.body = { invalidKey: 'invalidValue' };

            await receiveGarminAPIUserPermissions(req, res);

            // Should still return 200 to acknowledge receipt
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should reject non-POST methods', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            req.method = 'GET';

            await receiveGarminAPIUserPermissions(req, res);

            expect(res.status).toHaveBeenCalledWith(405);
            expect(res.send).toHaveBeenCalledWith('Method Not Allowed');
        });

        it('should handle empty permissions array (user revoked all)', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            req.body = {
                userPermissionsChange: [{
                    userId: 'garminUser789',
                    permissions: [],
                    changeTimeInSeconds: 1613065860
                }]
            };

            await receiveGarminAPIUserPermissions(req, res);

            // Should return 200 (logs empty permissions, but doesn't deauthorize)
            expect(res.status).toHaveBeenCalledWith(200);
            expect(OAuth2.deauthorizeServiceForUser).not.toHaveBeenCalled();
        });
    });
});
