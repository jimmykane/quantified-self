import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLimitExceededError, checkEventUsageLimit, hasBasicAccess, hasProAccess, getUserRoleAndGracePeriod, setEvent, determineRedirectURI, setAccessControlHeadersOnResponse } from './utils';
import { HttpsError } from 'firebase-functions/v2/https';
import { SPORTS_LIB_VERSION } from './shared/sports-lib-version.node';
import { USAGE_LIMITS } from '../../shared/limits';

// Hoisted shared/id-generator mock
vi.mock('./shared/id-generator', () => ({
    generateIDFromParts: vi.fn(async () => 'gen-part-id'),
    generateEventID: vi.fn(async () => 'event-id'),
}));

// Mock firebase-functions/logger to no-op
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

// Mock EventWriter to avoid heavy behavior
const writeAllEventDataMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./shared/event-writer', () => ({
    EventWriter: vi.fn().mockImplementation(() => ({
        writeAllEventData: writeAllEventDataMock,
    })),
    FirestoreAdapter: class { },
    StorageAdapter: class { },
    LogAdapter: class { },
}));

// firebase-functions/v2/https mock (provide HttpsError already imported)
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

// Hoisted firebase-admin mock
const hoisted = vi.hoisted(() => {
    let countValue = 0;
    const setCount = (v: number) => { countValue = v; };
    const serverTimestamp = vi.fn().mockReturnValue('SERVER_TIMESTAMP');

    const makeCollection = (name: string) => ({
        _name: name,
        doc: (id: string) => makeDoc(`${name}/${id}`),
        count: () => ({
            get: async () => ({ data: () => ({ count: countValue }) })
        }),
    });

    const makeDoc = (path: string) => ({
        _path: path,
        collection: (name: string) => makeCollection(`${path}/${name}`),
        set: vi.fn(),
        update: vi.fn(),
    });

    const firestore = () => ({
        collection: (name: string) => makeCollection(name),
        doc: (id: string) => makeDoc(id),
        batch: vi.fn(),
    });
    (firestore as any).FieldValue = { serverTimestamp };

    const bucketSave = vi.fn();
    const storage = () => ({
        bucket: () => ({
            name: 'mock-bucket',
            file: (path: string) => ({
                path,
                save: bucketSave,
            }),
        }),
    });

    const getUser = vi.fn();
    const createCustomToken = vi.fn(async () => 'custom-token');
    const auth = () => ({
        getUser,
        updateUser: vi.fn(),
        createUser: vi.fn(),
        createCustomToken,
    });

    return { firestore, storage, auth, getUser, setCount, bucketSave, serverTimestamp };
});

vi.mock('firebase-admin', () => ({
    default: {
        firestore: hoisted.firestore,
        storage: hoisted.storage,
        auth: hoisted.auth,
    },
    firestore: hoisted.firestore,
    storage: hoisted.storage,
    auth: hoisted.auth,
}));

describe('utils higher-level helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.setCount(0);
    });

    describe('checkEventUsageLimit', () => {
        it('bypasses limit for pro users', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            await expect(checkEventUsageLimit('u1')).resolves.toBeUndefined();
            expect(hoisted.getUser).toHaveBeenCalled();
        });

        it('bypasses limit during grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 10000 } });
            await expect(checkEventUsageLimit('u1')).resolves.toBeUndefined();
        });

        it('throws UsageLimitExceededError when over limit including pending writes', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            hoisted.setCount(USAGE_LIMITS.free - 1);
            const pending = new Map<string, number>([['u1', 2]]); // total exceeds free-tier limit

            await expect(checkEventUsageLimit('u1', undefined, pending)).rejects.toBeInstanceOf(UsageLimitExceededError);
        });

        it('uses cache to avoid duplicate Firestore count calls', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            hoisted.setCount(1);
            const cache = new Map();

            await checkEventUsageLimit('u1', cache);
            await checkEventUsageLimit('u1', cache); // should use cached promise

            // count() should have been invoked once (via first call)
            expect(cache.size).toBe(1);
        });

        it('throws for unsupported roles instead of silently using the free-tier limit', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'enterprise' } });

            await expect(checkEventUsageLimit('u1')).rejects.toThrow("Unsupported subscription role 'enterprise'");
        });
    });

    describe('hasProAccess', () => {
        it('returns true for pro role', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            await expect(hasProAccess('u1')).resolves.toBe(true);
        });

        it('returns true for active grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 5000 } });
            await expect(hasProAccess('u1')).resolves.toBe(true);
        });
    });

    describe('hasBasicAccess', () => {
        it('returns true for basic role', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'basic' } });
            await expect(hasBasicAccess('u1')).resolves.toBe(true);
        });

        it('returns true for active grace period', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free', gracePeriodUntil: Date.now() + 5000 } });
            await expect(hasBasicAccess('u1')).resolves.toBe(true);
        });

        it('returns false for free users without grace', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'free' } });
            await expect(hasBasicAccess('u1')).resolves.toBe(false);
        });
    });

    describe('getUserRoleAndGracePeriod', () => {
        it('throws UserNotFoundError for missing user', async () => {
            const err: any = new Error('not found');
            err.code = 'auth/user-not-found';
            hoisted.getUser.mockRejectedValue(err);

            await expect(getUserRoleAndGracePeriod('missing')).rejects.toThrow('User missing not found in Auth');
        });
    });

    describe('setEvent', () => {
        it('writes activities, meta data, and uses bulkWriter when provided', async () => {
            hoisted.getUser.mockResolvedValue({ customClaims: { stripeRole: 'pro' } });
            const bulkWriter = { set: vi.fn() };
            const event = {
                getID: () => null,
                setID: vi.fn(),
                getActivities: () => [{
                    getID: () => null,
                    setID: vi.fn(),
                    toJSON: () => ({ id: 'act' }),
                    getAllExportableStreams: () => [],
                }],
            };
            const metaData = {
                serviceName: 'GARMINAPI',
                toJSON: () => ({ meta: true }),
            } as any;
            const originalFile = {
                data: Buffer.from('file'),
                extension: 'fit',
                startDate: new Date(),
            };

            await setEvent('user-1', 'event-1', event as any, metaData, originalFile as any, bulkWriter as any);

            expect(writeAllEventDataMock).toHaveBeenCalled();
            expect(bulkWriter.set).toHaveBeenCalled(); // called at least for metaData/processing

            const processingCall = (bulkWriter.set as any).mock.calls.find((call: any[]) => call[1]?.sportsLibVersion);
            expect(processingCall).toBeTruthy();
            expect(processingCall[1]).toEqual(expect.objectContaining({
                sportsLibVersion: SPORTS_LIB_VERSION,
                sportsLibVersionCode: expect.any(Number),
                processedAt: 'SERVER_TIMESTAMP',
            }));
        });
    });

    describe('determineRedirectURI and headers', () => {
        it('returns empty string for disallowed redirect', () => {
            const req = { body: { redirectUri: 'https://evil.com' } } as any;
            expect(determineRedirectURI(req)).toBe('');
        });

        it('sets access control headers from origin', () => {
            const res = { set: vi.fn(), get: vi.fn() } as any;
            const req = { get: vi.fn().mockReturnValue('http://localhost:4200') } as any;
            setAccessControlHeadersOnResponse(req, res);
            expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:4200');
        });
    });
});
