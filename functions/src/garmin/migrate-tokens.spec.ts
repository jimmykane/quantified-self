import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as requestHelper from '../request-helper';
import { migrateUserToken } from './migrate-tokens';
import { GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME } from './constants';

// Define robust mock factory
const mockSet = vi.fn().mockResolvedValue({});
const mockGet = vi.fn();
const mockLimit = vi.fn();
const mockCollectionInner = vi.fn();
const mockDoc = vi.fn();
const mockCollectionTop = vi.fn();
const mockWhere = vi.fn();

// Return values
const querySnapshotEmpty = { empty: true, size: 0, docs: [] };
const querySnapshotNotEmpty = {
    empty: false,
    size: 1,
    docs: [{
        id: 'user1',
        data: () => ({ accessToken: 'old_access', accessTokenSecret: 'old_secret', serviceName: 'GarminHealthAPI' })
    }]
};

// Chain setup
// collection().doc().collection().limit().get()
// collection().doc().collection().doc().set()
// collection().where().limit().get()

const docObj = {
    set: mockSet,
    collection: mockCollectionInner // collection('tokens')
};

const collectionObjInner = {
    limit: mockLimit,
    doc: mockDoc, // for set()
    get: mockGet // in case direct get
};

const collectionObjTop = {
    doc: mockDoc,
    where: mockWhere,
    get: mockGet
};

const queryObj = {
    limit: mockLimit,
    get: mockGet
};

// Wiring
mockCollectionTop.mockReturnValue(collectionObjTop);
mockDoc.mockReturnValue(docObj);
mockCollectionInner.mockReturnValue(collectionObjInner);
mockLimit.mockReturnValue(queryObj);
mockWhere.mockReturnValue(queryObj);

// Default behavior
mockGet.mockResolvedValue(querySnapshotEmpty);

vi.mock('firebase-admin', () => ({
    firestore: Object.assign(vi.fn(() => ({
        collection: mockCollectionTop,
    })), {
        Timestamp: { fromDate: (d: any) => d },
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' }
    })
}));

vi.mock('../request-helper', () => ({
    post: vi.fn()
}));

vi.mock('../config', () => ({
    config: {
        garminhealthapi: {
            client_id: 'client_id',
            client_secret: 'client_secret'
        },

    }
}));

// Mock OAuth
vi.mock('oauth-1.0a', () => {
    return {
        default: class {
            toHeader() { return { Authorization: 'OAuth ...' }; }
            authorize() { return {}; }
        },
        __esModule: true,
    };
});

describe('migrateUserToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chain defaults
        mockCollectionTop.mockReturnValue(collectionObjTop);
        mockDoc.mockReturnValue(docObj);
        mockCollectionInner.mockReturnValue(collectionObjInner);
        mockLimit.mockReturnValue(queryObj);
        mockWhere.mockReturnValue(queryObj);
        mockGet.mockResolvedValue(querySnapshotEmpty);
    });

    it('should skip if OAuth1 tokens are missing', async () => {
        const result = await migrateUserToken('u1', {});
        expect(result).toBe(false);
        expect(requestHelper.post).not.toHaveBeenCalled();
    });

    it('should skip if already migrated', async () => {
        // Mock subcollection returning NOT empty
        mockGet.mockResolvedValueOnce({ empty: false });

        const result = await migrateUserToken('u1', { accessToken: '1', accessTokenSecret: '2' });
        expect(result).toBe(true);
        expect(requestHelper.post).not.toHaveBeenCalled();
    });

    it('should exchange tokens and save new ones', async () => {
        const oauth1 = { accessToken: 'otoken', accessTokenSecret: 'osecret' };

        // 1. Subcollection check -> Empty (needs migration)
        mockGet.mockResolvedValueOnce(querySnapshotEmpty);

        (requestHelper.post as any).mockResolvedValue({
            access_token: 'new_access',
            refresh_token: 'new_refresh',
            expires_in: 3600,
            scope: 'scope'
        });

        const result = await migrateUserToken('u1', oauth1);

        expect(result).toBe(true);
        expect(requestHelper.post).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://apis.garmin.com/partner-gateway/rest/user/token-exchange',
        }));

        // Verify write path: collection(GARMIN).doc(u1).collection(tokens).doc(u1).set(...)
        expect(mockCollectionTop).toHaveBeenCalledWith(GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME);
        expect(mockDoc).toHaveBeenCalledWith('u1'); // Parent
        expect(mockCollectionInner).toHaveBeenCalledWith('tokens');
        // mockDoc called again with 'u1'? Yes, reusing mockDoc for simplicity
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'new_access',
            userID: 'u1'
        }));
    });

    it('should return false on API error', async () => {
        const oauth1 = { accessToken: 'otoken', accessTokenSecret: 'osecret' };
        mockGet.mockResolvedValueOnce(querySnapshotEmpty);
        (requestHelper.post as any).mockRejectedValue(new Error('API Fail'));

        const result = await migrateUserToken('u1', oauth1);

        expect(result).toBe(false);
    });
});
