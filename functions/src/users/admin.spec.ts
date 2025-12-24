
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

const { mockListUsers, mockAuth, mockOnCall } = vi.hoisted(() => ({
    mockListUsers: vi.fn(),
    mockAuth: {
        listUsers: vi.fn(),
    },
    mockOnCall: vi.fn((options, handler) => handler),
}));

mockAuth.listUsers = mockListUsers;

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    initializeApp: vi.fn(),
    apps: { length: 1 },
    firestore: vi.fn(() => ({
        settings: vi.fn()
    }))
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
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        const request = { auth: null } as any;
        await expect(listUsers(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: {
                uid: 'user1',
                token: { admin: false }
            }
        } as any;
        await expect(listUsers(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should successfully list users if called by an admin', async () => {
        const mockUsers = [
            {
                uid: 'user1',
                email: 'user1@example.com',
                displayName: 'User One',
                photoURL: 'url1',
                customClaims: { stripeRole: 'pro' },
                metadata: {
                    lastSignInTime: '2023-01-01',
                    creationTime: '2022-01-01',
                },
                disabled: false,
            }
        ];

        mockListUsers.mockResolvedValue({
            users: mockUsers,
            pageToken: null
        });

        const request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            }
        } as any;

        const result = await listUsers(request);

        expect(mockListUsers).toHaveBeenCalledWith(1000, undefined);
        expect(result.users).toHaveLength(1);
        expect(result.users[0].uid).toBe('user1');
        expect(result.users[0].customClaims).toEqual({ stripeRole: 'pro' });
    });

    it('should handle pagination', async () => {
        mockListUsers
            .mockResolvedValueOnce({
                users: [{ uid: 'user1' }],
                pageToken: 'next-token'
            })
            .mockResolvedValueOnce({
                users: [{ uid: 'user2' }],
                pageToken: null
            });

        const request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            }
        } as any;

        const result = await listUsers(request);

        expect(mockListUsers).toHaveBeenCalledTimes(2);
        expect(result.users).toHaveLength(2);
        expect(result.users[0].uid).toBe('user1');
        expect(result.users[1].uid).toBe('user2');
    });

    it('should throw "internal" if listUsers fails', async () => {
        mockListUsers.mockRejectedValue(new Error('Auth Error'));

        const request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            }
        } as any;

        await expect(listUsers(request)).rejects.toThrow('Auth Error');
    });
});
