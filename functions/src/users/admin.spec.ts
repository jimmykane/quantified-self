
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

const {
    mockListUsers,
    mockAuth,
    mockOnCall,
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockCollection,
    mockDoc,
    mockGet,
    mockFirestore
} = vi.hoisted(() => {
    const mockListUsers = vi.fn();
    const mockAuth = { listUsers: mockListUsers };
    const mockOnCall = vi.fn((options, handler) => handler);

    // Mock Firestore Chain
    const mockLimit = vi.fn();
    const mockOrderBy = vi.fn();
    const mockWhere = vi.fn();
    const mockCollection = vi.fn();
    const mockDoc = vi.fn();
    const mockGet = vi.fn();

    // Setup Chain Structure (circular refs handled by function wrappers or direct assignment if careful)
    // We can't use vars before declaration in the hoist block either.
    // Just define them. The chaining logic can be set up in the test body or here if simple.
    // Let's set up the return values in the test body or a setup block to avoid circular issues during hoist.
    // But we need to export them to spy on them.

    const mockFirestore = vi.fn(() => ({
        collection: mockCollection,
    }));

    return {
        mockListUsers,
        mockAuth,
        mockOnCall,
        mockLimit,
        mockOrderBy,
        mockWhere,
        mockCollection,
        mockDoc,
        mockGet,
        mockFirestore
    };
});

mockAuth.listUsers = mockListUsers;

// Setup Chain Returns (Global Setup)
mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere });
mockDoc.mockReturnValue({ collection: mockCollection, get: mockGet });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
mockOrderBy.mockReturnValue({ limit: mockLimit });
mockLimit.mockReturnValue({ get: mockGet });

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    initializeApp: vi.fn(),
    apps: { length: 1 },
    firestore: mockFirestore
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

// Mock utils
vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: ['*']
}));

import { listUsers } from './admin';

describe('listUsers Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chain
        mockCollection.mockClear();
        mockDoc.mockClear();
        mockWhere.mockClear();
        mockOrderBy.mockClear();
        mockLimit.mockClear();
        mockGet.mockClear();

        // Default: Empty results
        mockGet.mockResolvedValue({ empty: true, docs: [], exists: false, data: () => ({}) });

        // Re-setup chain returns because clearAllMocks clears them? 
        // No, clearAllMocks clears calls/instances, not implementation if setup outside.
        // But let's ensure stability.
        mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere });
        mockDoc.mockReturnValue({ collection: mockCollection, get: mockGet });
        mockWhere.mockReturnValue({ orderBy: mockOrderBy });
        mockOrderBy.mockReturnValue({ limit: mockLimit });
        mockLimit.mockReturnValue({ get: mockGet });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as any;
        await expect(listUsers(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } }
        } as any;
        await expect(listUsers(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should successfully list users and enrich with data', async () => {
        const mockAuthUsers = [{ uid: 'user1', email: 'u1@e.com', disabled: false }];
        mockListUsers.mockResolvedValue({ users: mockAuthUsers, pageToken: 'token1' });

        // Mock Subscription Data (Active)
        const mockSubData = { status: 'active', current_period_end: { seconds: 123 }, stripeLink: 'http://stripe' };
        // We need to match specific calls to return different data.
        // Simplified: We make get() return data if it's a subscription query?
        // Hard to distinguish mocks in this simple chain setup without implementation based.
        // Let's use mockImplementation to check path.

        mockCollection.mockImplementation((path) => {
            const chainMethods = {
                doc: vi.fn(),
                where: vi.fn(),
            };

            // Handle 'customers/{uid}/subscriptions'
            if (path === 'customers') {
                chainMethods.doc.mockImplementation((uid) => ({
                    collection: vi.fn((sub) => {
                        if (sub === 'subscriptions') {
                            return {
                                where: vi.fn(() => ({
                                    orderBy: vi.fn(() => ({
                                        limit: vi.fn(() => ({
                                            get: vi.fn().mockResolvedValue({
                                                empty: false,
                                                docs: [{ data: () => mockSubData }]
                                            })
                                        }))
                                    }))
                                }))
                            }
                        }
                        return {};
                    })
                }));
            }
            // Handle 'garminHealthAPITokens'
            else if (path === 'garminHealthAPITokens') {
                chainMethods.doc.mockReturnValue({
                    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ created: 1000 }) })
                });
            }
            // Handle 'suuntoAppAccessTokens'
            else if (path === 'suuntoAppAccessTokens') {
                chainMethods.doc.mockReturnValue({
                    collection: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            get: vi.fn().mockResolvedValue({ empty: true }) // Not connected
                        }))
                    }))
                });
            }
            // Handle 'COROSAPIAccessTokens'
            else if (path === 'COROSAPIAccessTokens') {
                chainMethods.doc.mockReturnValue({
                    collection: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            get: vi.fn().mockResolvedValue({ empty: false, docs: [{ data: () => ({ created: 2000 }) }] })
                        }))
                    }))
                });
            }

            return chainMethods;
        });

        const request = {
            data: { pageSize: 50 },
            auth: { uid: 'admin-uid', token: { admin: true } }
        } as any;

        const result = await listUsers(request);

        // Verify Auth Call
        expect(mockListUsers).toHaveBeenCalledWith(50, undefined);

        // Verify Result Structure
        expect(result.users).toHaveLength(1);
        const user = result.users[0];
        expect(user.uid).toBe('user1');

        // Check Subscriptions
        expect(user.subscription).toEqual({
            status: 'active',
            current_period_end: { seconds: 123 },
            stripeLink: 'http://stripe',
            cancel_at_period_end: undefined
        });

        // Check Connected Services (Garmin & COROS present, Suunto missing)
        expect(user.connectedServices).toHaveLength(2);
        expect(user.connectedServices).toEqual(expect.arrayContaining([
            { provider: 'Garmin', connectedAt: 1000 },
            { provider: 'COROS', connectedAt: 2000 }
        ]));

        expect(result.nextPageToken).toBe('token1');
    });

    it('should handle pagination parameters', async () => {
        mockListUsers.mockResolvedValue({ users: [], pageToken: 'nextKey' });
        // Assume empty firestore results for simplicity (default from beforeEach?)
        // Wait, I overrode mockCollection in previous test. Need to ensure default behavior in beforeEach logic or simple tests.
        // My beforeEach clearAllMocks handles the spy history, but mockImplementation overrides persist?
        // vi.clearAllMocks() clears return values? No, vi.resetAllMocks() does.
        // I should use default mockImplementation in beforeEach or manual mocks.

        // Simple Reset for this test
        mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere });
        // ... (Using the simple chain from top of file which returns empty)

        const request = {
            data: { pageSize: '25', nextPageToken: 'prevKey' },
            auth: { uid: 'admin', token: { admin: true } }
        } as any;

        await listUsers(request);

        expect(mockListUsers).toHaveBeenCalledWith(25, 'prevKey');
    });

    it('should throw "internal" if listUsers fails', async () => {
        mockListUsers.mockRejectedValue(new Error('Auth Error'));
        const request = { auth: { uid: 'admin', token: { admin: true } } } as any;
        await expect(listUsers(request)).rejects.toThrow('Auth Error');
    });
});
