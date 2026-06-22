import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../utils';
import * as OAuth2 from '../../OAuth2';
import * as functions from 'firebase-functions/v1';

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
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue([]);
const mockBatch = {
    update: mockBatchUpdate,
    commit: mockBatchCommit
};

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    return {
        firestore: vi.fn(() => ({
            collection: mockCollection,
            collectionGroup: mockCollectionGroup,
            batch: vi.fn().mockReturnValue(mockBatch)
        })),
    };
});

vi.mock('firebase-functions/v1', async () => {
    const actual = await vi.importActual('firebase-functions/v1');
    return {
        ...actual,
        region: () => ({
            https: {
                onCall: (handler: any) => handler,
                onRequest: (handler: any) => handler
            }
        })
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../utils', () => ({
    isCorsAllowed: vi.fn(),
    setAccessControlHeadersOnResponse: vi.fn().mockImplementation((req, res) => res),
    getUserIDFromFirebaseToken: vi.fn(),
    hasProAccess: vi.fn(),
    determineRedirectURI: vi.fn((req) => req.body?.redirectUri || req.query?.redirect_uri),
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
}));

vi.mock('../../OAuth2', () => ({
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn(),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn(),
    deauthorizeServiceForUser: vi.fn(),
    disconnectServiceForUser: vi.fn(),
    validateOAuth2State: vi.fn(),
}));

vi.mock('../../service-auth-lifecycle', () => ({
    cleanupServiceTokenById: vi.fn().mockResolvedValue({}),
    SERVICE_AUTH_CLEANUP_REASONS: {
        PartnerDisconnect: 'partner_disconnect',
    },
}));

vi.mock('../../service-oauth-access', () => ({
    hasServiceOAuthConnectAccess: vi.fn(),
}));

import {
    getGarminAPIAuthRequestTokenRedirectURI,
    requestAndSetGarminAPIAccessToken,
    deauthorizeGarminAPI,
    receiveGarminAPIDeregistration,
    receiveGarminAPIUserPermissions,
} from './wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as serviceAuthLifecycle from '../../service-auth-lifecycle';
import * as serviceOAuthAccess from '../../service-oauth-access';
import * as logger from 'firebase-functions/logger';

describe('Garmin Auth Wrapper', () => {
    let context: any;

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(utils.isCorsAllowed).mockReturnValue(true);
        vi.mocked(utils.getUserIDFromFirebaseToken).mockResolvedValue('testUserID');
        vi.mocked(utils.hasProAccess).mockResolvedValue(true);
        vi.mocked(utils.determineRedirectURI).mockReturnValue('https://callback');
        vi.mocked(serviceOAuthAccess.hasServiceOAuthConnectAccess).mockResolvedValue(true);

        context = {
            auth: { uid: 'testUserID' },
            app: { appId: 'testAppId' }
        };
    });

    describe('getGarminAPIAuthRequestTokenRedirectURI', () => {
        it('should return redirect URI from OAuth2 helper', async () => {
            vi.mocked(OAuth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).mockResolvedValue('https://garmin.com/oauth');
            const data = { redirectUri: 'https://callback' };

            const result = await (getGarminAPIAuthRequestTokenRedirectURI as any)(data, context);

            expect(serviceOAuthAccess.hasServiceOAuthConnectAccess).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI);
            expect(OAuth2.getServiceOAuth2CodeRedirectAndSaveStateToUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'https://callback');
            expect(result).toEqual({ redirect_uri: 'https://garmin.com/oauth' });
        });

        it('should throw permission-denied when OAuth connect access is denied', async () => {
            vi.mocked(serviceOAuthAccess.hasServiceOAuthConnectAccess).mockResolvedValue(false);
            const data = { redirectUri: 'https://callback' };

            await expect((getGarminAPIAuthRequestTokenRedirectURI as any)(data, context)).rejects.toThrow('Service sync is a Pro feature.');
        });

        it('should throw failed-precondition if app is undefined', async () => {
            context.app = undefined;
            const data = { redirectUri: 'https://callback' };
            await expect((getGarminAPIAuthRequestTokenRedirectURI as any)(data, context)).rejects.toThrow('The function must be called from an App Check verified app.');
        });

        it('should throw unauthenticated if auth is undefined', async () => {
            context.auth = undefined;
            const data = { redirectUri: 'https://callback' };
            await expect((getGarminAPIAuthRequestTokenRedirectURI as any)(data, context)).rejects.toThrow('The function must be called while authenticated.');
        });
    });

    describe('requestAndSetGarminAPIAccessToken', () => {
        it('should exchange tokens if state is valid', async () => {
            const data = { state: 'validState', code: 'validCode', redirectUri: 'https://callback' };
            vi.mocked(OAuth2.validateOAuth2State).mockResolvedValue(true);
            vi.mocked(OAuth2.getAndSetServiceOAuth2AccessTokenForUser).mockResolvedValue(undefined);

            await (requestAndSetGarminAPIAccessToken as any)(data, context);

            expect(serviceOAuthAccess.hasServiceOAuthConnectAccess).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI);
            expect(OAuth2.validateOAuth2State).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'validState');
            expect(OAuth2.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI, 'https://callback', 'validCode');
        });

        it('should throw permission-denied if state is invalid', async () => {
            const data = { state: 'invalidState', code: 'validCode', redirectUri: 'https://cb' };
            vi.mocked(OAuth2.validateOAuth2State).mockResolvedValue(false);

            await expect((requestAndSetGarminAPIAccessToken as any)(data, context)).rejects.toThrow('Invalid state');
        });
    });

    describe('deauthorizeGarminAPI', () => {
        it('should call deauthorize service', async () => {
            const data = {};
            const result = await (deauthorizeGarminAPI as any)(data, context);

            expect(OAuth2.disconnectServiceForUser).toHaveBeenCalledWith('testUserID', ServiceNames.GarminAPI);
            expect(result).toEqual({ success: true });
        });

        it('should surface unexpected deauthorize failures as internal errors', async () => {
            const data = {};
            const error = new Error('Partner unavailable');
            vi.mocked(OAuth2.disconnectServiceForUser).mockRejectedValue(error);

            await expect((deauthorizeGarminAPI as any)(data, context)).rejects.toThrow('Bad request or internal error');
        });
    });

    // These remain as onRequest, so we keep using req/res mocks for them
    describe('receiveGarminAPIDeregistration', () => {
        let req: any;
        let res: any;

        beforeEach(() => {
            req = {
                method: 'POST',
                body: {},
                headers: {},
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

        it('should clean up users by reverse lookup using the shared lifecycle cleanup', async () => {
            req.body = { deregistrations: [{ userId: 'garminUser123' }] };

            // Mock Collection Group Query
            const mockTokenDoc = {
                id: 'tokenDoc123',
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

            const mockWhere = vi.fn().mockReturnThis();
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) });

            await receiveGarminAPIDeregistration(req, res);

            // Verify logic
            expect(mockCollectionGroup).toHaveBeenCalledWith('tokens');
            expect(mockWhere).toHaveBeenCalledWith('userID', '==', 'garminUser123');
            expect(mockWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.GarminAPI);

            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledWith(
                'firebaseUserXYZ',
                ServiceNames.GarminAPI,
                'tokenDoc123',
                'partner_disconnect',
            );
            expect(OAuth2.deauthorizeServiceForUser).not.toHaveBeenCalled();

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should count lifecycle cleanup failures as failed deregistrations', async () => {
            req.body = { deregistrations: [{ userId: 'garminUser123' }] };

            const mockTokenDoc = {
                id: 'tokenDoc123',
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

            const mockWhere = vi.fn().mockReturnThis();
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) });
            vi.mocked(serviceAuthLifecycle.cleanupServiceTokenById).mockRejectedValueOnce(new Error('delete failed'));

            await receiveGarminAPIDeregistration(req, res);

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to process deregistration for Firebase User firebaseUserXYZ (Garmin ID: garminUser123)',
                expect.any(Error),
            );
            expect(logger.info).toHaveBeenCalledWith(
                'Garmin deregistration batch complete. Summary: 0 processed, 1 failed, 0 skipped/not found.',
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should handle multiple Firebase users connected to the same Garmin ID', async () => {
            req.body = { deregistrations: [{ userId: 'sharedGarminID' }] };

            const mockTokenDoc1 = { id: 'doc1', ref: { parent: { parent: { id: 'userA' } } } };
            const mockTokenDoc2 = { id: 'doc2', ref: { parent: { parent: { id: 'userB' } } } };

            const mockQuerySnapshot = {
                empty: false,
                docs: [mockTokenDoc1, mockTokenDoc2]
            };

            const mockWhere = vi.fn().mockReturnThis();
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) });

            await receiveGarminAPIDeregistration(req, res);

            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledTimes(2);
            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledWith('userA', ServiceNames.GarminAPI, 'doc1', 'partner_disconnect');
            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledWith('userB', ServiceNames.GarminAPI, 'doc2', 'partner_disconnect');
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should process multiple deregistrations in one payload', async () => {
            req.body = {
                deregistrations: [
                    { userId: 'user1' },
                    { userId: 'user2' }
                ]
            };

            const mockTokenDoc1 = { id: 'doc1', ref: { parent: { parent: { id: 'fb1' } } } };
            const mockTokenDoc2 = { id: 'doc2', ref: { parent: { parent: { id: 'fb2' } } } };

            const mockWhere = vi.fn().mockReturnThis();
            const mockGet = vi.fn()
                .mockResolvedValueOnce({ empty: false, docs: [mockTokenDoc1] })
                .mockResolvedValueOnce({ empty: false, docs: [mockTokenDoc2] });

            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: mockGet
            });

            await receiveGarminAPIDeregistration(req, res);

            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledTimes(2);
            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledWith('fb1', ServiceNames.GarminAPI, 'doc1', 'partner_disconnect');
            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledWith('fb2', ServiceNames.GarminAPI, 'doc2', 'partner_disconnect');
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should continue processing if one deauthorization fails', async () => {
            req.body = {
                deregistrations: [
                    { userId: 'failUser' },
                    { userId: 'successUser' }
                ]
            };

            const mockTokenDocFail = { id: 'docFail', ref: { parent: { parent: { id: 'fbFail' } } } };
            const mockTokenDocSuccess = { id: 'docSuccess', ref: { parent: { parent: { id: 'fbSuccess' } } } };

            const mockWhere = vi.fn().mockReturnThis();
            const mockGet = vi.fn()
                .mockResolvedValueOnce({ empty: false, docs: [mockTokenDocFail] })
                .mockResolvedValueOnce({ empty: false, docs: [mockTokenDocSuccess] });

            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: mockGet
            });

            vi.mocked(serviceAuthLifecycle.cleanupServiceTokenById)
                .mockRejectedValueOnce(new Error('Firestore error'))
                .mockResolvedValueOnce({});

            await receiveGarminAPIDeregistration(req, res);

            expect(serviceAuthLifecycle.cleanupServiceTokenById).toHaveBeenCalledTimes(2);
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

            await receiveGarminAPIDeregistration(req, res);

            expect(serviceAuthLifecycle.cleanupServiceTokenById).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('receiveGarminAPIUserPermissions', () => {
        let req: any;
        let res: any;

        beforeEach(() => {
            req = {
                method: 'POST',
                body: {},
                headers: {},
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

        it('should process valid permission change payload and update token', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            const permissions = ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'];
            req.body = {
                userPermissionsChange: [{
                    userId: 'garminUser456',
                    permissions: permissions,
                    summaryId: 'x120d383-60256e84',
                    changeTimeInSeconds: 1613065860
                }]
            };

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

            const mockWhere = vi.fn().mockReturnThis();
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) });

            await receiveGarminAPIUserPermissions(req, res);

            // Verify logic
            // 1. collectionGroup called to find token
            expect(mockCollectionGroup).toHaveBeenCalledWith('tokens');
            expect(mockWhere).toHaveBeenCalledWith('userID', '==', 'garminUser456');
            expect(mockWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.GarminAPI);

            // 2. batch update called
            expect(mockBatchUpdate).toHaveBeenCalledWith(mockTokenDoc.ref, {
                permissions: permissions,
                permissionsLastChangedAt: 1613065860
            });
            expect(mockBatchCommit).toHaveBeenCalled();

            // Should return 200
            expect(res.status).toHaveBeenCalledWith(200);
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

        it('should handle empty permissions array (user revoked all) by updating token', async () => {
            const { receiveGarminAPIUserPermissions } = await import('./wrapper');

            req.body = {
                userPermissionsChange: [{
                    userId: 'garminUser789',
                    permissions: [],
                    changeTimeInSeconds: 1613065860
                }]
            };

            const mockTokenDoc = { ref: { path: 'tokens/doc1' } };
            const mockQuerySnapshot = {
                empty: false,
                docs: [mockTokenDoc]
            };
            const mockWhere = vi.fn().mockReturnThis();
            mockCollectionGroup.mockReturnValue({
                where: mockWhere,
                get: vi.fn().mockResolvedValue(mockQuerySnapshot)
            });
            mockWhere.mockReturnValue({ where: mockWhere, get: vi.fn().mockResolvedValue(mockQuerySnapshot) });


            await receiveGarminAPIUserPermissions(req, res);

            // Should return 200
            expect(res.status).toHaveBeenCalledWith(200);
            // Verify batch update with empty permissions
            expect(mockBatchUpdate).toHaveBeenCalledWith(mockTokenDoc.ref, {
                permissions: [],
                permissionsLastChangedAt: 1613065860
            });
            expect(mockBatchCommit).toHaveBeenCalled();
        });
    });
});
