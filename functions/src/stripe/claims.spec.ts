import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockSetCustomUserClaims = vi.fn();
const mockAuth = {
    setCustomUserClaims: mockSetCustomUserClaims
};

const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ get: mockGet });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockCollection = vi.fn().mockReturnValue({ where: mockWhere });
const mockFirestore = {
    collection: mockCollection
};

vi.mock('firebase-admin', () => ({
    auth: () => mockAuth,
    firestore: () => mockFirestore,
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn(),
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

import { reconcileClaims } from './claims';

describe('reconcileClaims', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset chain
        mockWhere.mockReturnValue({ orderBy: mockOrderBy });
        mockOrderBy.mockReturnValue({ limit: mockLimit });
        mockLimit.mockReturnValue({ get: mockGet });
    });

    it('should throw "not-found" if no active subscription exists', async () => {
        mockGet.mockResolvedValue({ empty: true });

        await expect(reconcileClaims('user1')).rejects.toThrow('No active subscription found');
    });

    it('should set claims based on role field', async () => {
        const expectedRole = 'pro';

        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    role: 'pro'
                })
            }]
        });

        const result = await reconcileClaims('user1');

        expect(result.role).toBe(expectedRole);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: expectedRole });
    });



    it('should throw failed-precondition if no firebaseRole OR role found', async () => {
        mockGet.mockResolvedValue({
            empty: false,
            docs: [{
                data: () => ({
                    status: 'active',
                    items: [{ price: { id: 'unknown_price' } }],
                    // No firebaseRole AND no role
                })
            }]
        });

        await expect(reconcileClaims('user1')).rejects.toThrow('Subscription found but no role defined in document');
    });
});
