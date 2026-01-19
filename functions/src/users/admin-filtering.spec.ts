
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';

const {
    mockListUsers,
    mockAuth,
    mockCollection,
    mockFirestore,
    mockOnCall
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockAuth = { listUsers: mockListUsers };
    const mockOnCall = vi.fn((_options: unknown, handler: unknown) => handler);

    // Mock Collection
    const mockCollection = vi.fn() as any;
    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
        collectionGroup: mockCollection
    }));

    return {
        mockListUsers,
        mockAuth,
        mockOnCall,
        mockCollection,
        mockFirestore,
    };
});

mockAuth.listUsers = mockListUsers;

// Mocks needed to import admin.ts successfully
vi.mock('../stripe/client', () => ({ getStripe: vi.fn() }));
vi.mock('@google-cloud/billing', () => ({ CloudBillingClient: vi.fn() }));
vi.mock('@google-cloud/billing-budgets', () => ({ BudgetServiceClient: vi.fn() }));
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: vi.fn() }));
vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['*'],
    getCloudTaskQueueDepth: vi.fn(),
    enforceAppCheck: vi.fn() // No-op for tests
}));

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    initializeApp: vi.fn(),
    apps: { length: 1 },
    firestore: mockFirestore,
    remoteConfig: vi.fn()
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: mockOnCall,
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));


import { listUsers } from './admin';

describe('listUsers Cloud Function - Service Filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: Return mocked users from Auth
        mockListUsers.mockResolvedValue({
            users: [
                { uid: 'u_garmin', email: 'g@test.com', providerData: [] },
                { uid: 'u_suunto', email: 's@test.com', providerData: [] },
                { uid: 'u_coros', email: 'c@test.com', providerData: [] },
                { uid: 'u_none', email: 'n@test.com', providerData: [] },
            ],
            pageToken: undefined
        });

        // Default Firestore behavior: return empty
        mockCollection.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs: [] }),
            // Mock standard query methods to avoid crashes if accessed
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis()
        });
    });

    it('should filter users by Garmin service', async () => {
        // Mock garmin tokens
        mockCollection.mockImplementation((name) => {
            if (name === 'garminAPITokens') {
                return {
                    select: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        docs: [{ id: 'u_garmin' }]
                    })
                };
            }
            return {};
        });

        const request = {
            data: { filterService: 'garmin' },
            auth: { uid: 'admin', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.users).toHaveLength(1);
        expect(result.users[0].uid).toBe('u_garmin');
        expect(mockCollection).toHaveBeenCalledWith('garminAPITokens');
    });

    it('should filter users by Suunto service', async () => {
        mockCollection.mockImplementation((name) => {
            if (name === 'suuntoAppAccessTokens') {
                return {
                    select: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        docs: [{ id: 'u_suunto' }]
                    })
                };
            }
            return {};
        });

        const request = {
            data: { filterService: 'suunto' },
            auth: { uid: 'admin', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.users).toHaveLength(1);
        expect(result.users[0].uid).toBe('u_suunto');
    });

    it('should filter users by Coros service', async () => {
        mockCollection.mockImplementation((name) => {
            if (name === 'COROSAPIAccessTokens') {
                return {
                    select: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        docs: [{ id: 'u_coros' }]
                    })
                };
            }
            return {};
        });

        const request = {
            data: { filterService: 'coros' },
            auth: { uid: 'admin', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.users).toHaveLength(1);
        expect(result.users[0].uid).toBe('u_coros');
    });

    it('should return empty list if no users satisfy the service filter', async () => {
        // Firestore returns empty for garmin
        mockCollection.mockImplementation((name) => {
            if (name === 'garminAPITokens') {
                return {
                    select: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        docs: []
                    })
                };
            }
            return {};
        });

        const request = {
            data: { filterService: 'garmin' },
            auth: { uid: 'admin', token: { admin: true } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;

        const result: any = await (listUsers as any)(request);

        expect(result.users).toHaveLength(0);
        expect(result.totalCount).toBe(0);
    });
});
