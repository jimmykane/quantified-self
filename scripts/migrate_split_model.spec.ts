
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateUser } from './migrate_split_model';

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    return {
        firestore: {
            FieldValue: {
                delete: vi.fn().mockReturnValue('DELETE_SENTINEL')
            }
        }
    };
});

describe('Migration Script (Split Model)', () => {
    let mockBatch: any;
    let mockDb: any;
    let mockUserDoc: any;

    beforeEach(() => {
        // Mock Batch
        mockBatch = {
            set: vi.fn(),
            update: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        };

        // Mock DB
        mockDb = {
            batch: vi.fn().mockReturnValue(mockBatch),
            doc: vi.fn().mockImplementation((path) => ({ path })), // Pseudo-ref
        };

        // Mock User Doc default
        mockUserDoc = {
            id: 'test-uid',
            ref: { path: 'users/test-uid' },
            data: vi.fn().mockReturnValue({}),
        };
    });

    it('should migrate system, legal, and settings fields correctly', async () => {
        // 1. Setup Data
        const inputData = {
            displayName: 'Test User',
            email: 'test@example.com',
            // System
            gracePeriodUntil: '2025-01-01',
            lastDowngradedAt: '2024-01-01',
            stripeRole: 'pro',
            isPro: true,
            // Legal
            acceptedPrivacyPolicy: true,
            acceptedTos: true,
            // Settings
            settings: {
                theme: 'dark',
                units: 'metric'
            },
        };

        mockUserDoc.data.mockReturnValue(inputData);

        // 2. Execute Migration
        await migrateUser(mockUserDoc, mockDb);

        // 3. Verify System Data Write
        expect(mockDb.doc).toHaveBeenCalledWith('users/test-uid/system/status');
        expect(mockBatch.set).toHaveBeenCalledWith(
            { path: 'users/test-uid/system/status' },
            {
                gracePeriodUntil: '2025-01-01',
                lastDowngradedAt: '2024-01-01',
                stripeRole: 'pro',
                isPro: true,
            },
            { merge: true }
        );

        // 4. Verify Legal Data Write
        expect(mockDb.doc).toHaveBeenCalledWith('users/test-uid/legal/agreements');
        expect(mockBatch.set).toHaveBeenCalledWith(
            { path: 'users/test-uid/legal/agreements' },
            {
                acceptedPrivacyPolicy: true,
                acceptedTos: true,
            },
            { merge: true }
        );

        // 5. Verify Settings Data Write
        expect(mockDb.doc).toHaveBeenCalledWith('users/test-uid/config/settings');
        expect(mockBatch.set).toHaveBeenCalledWith(
            { path: 'users/test-uid/config/settings' },
            {
                theme: 'dark',
                units: 'metric'
            },
            { merge: true }
        );

        // 6. Verify Cleanup
        // We can't easily check for FieldValue.delete() since it's an object/symbol
        // But we can check that update was called on the user ref
        expect(mockBatch.update).toHaveBeenCalledWith(
            mockUserDoc.ref,
            expect.objectContaining({
                gracePeriodUntil: 'DELETE_SENTINEL',
                lastDowngradedAt: 'DELETE_SENTINEL',
                isPro: 'DELETE_SENTINEL',
                acceptedTos: 'DELETE_SENTINEL',
                settings: 'DELETE_SENTINEL',
            })
        );

        expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('should ignore users with no relevant fields', async () => {
        const inputData = {
            displayName: 'Clean User',
            email: 'clean@example.com'
        };
        mockUserDoc.data.mockReturnValue(inputData);

        await migrateUser(mockUserDoc, mockDb);

        // Expect no batch operations
        expect(mockDb.batch).not.toHaveBeenCalled();
    });
});
