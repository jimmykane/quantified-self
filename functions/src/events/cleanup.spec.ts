
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const functionsTest = require('firebase-functions-test');
const testEnv = functionsTest();

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const deleteMock = vi.fn().mockResolvedValue([{}]);
    const fileMock = vi.fn(() => ({
        delete: deleteMock
    }));
    const bucketMock = vi.fn(() => ({
        file: fileMock
    }));
    const storageMock = vi.fn(() => ({
        bucket: bucketMock
    }));

    return {
        storage: storageMock,
        initializeApp: vi.fn(),
        credential: {
            cert: vi.fn(),
        },
    };
});

// function-under-test variable
let cleanupEventFile: any;

// Mock firebase-functions to return the handler directly
vi.mock('firebase-functions', () => {
    return {
        firestore: {
            document: vi.fn(() => ({
                onDelete: vi.fn((handler) => handler)
            }))
        },
        https: {
            onRequest: vi.fn()
        }
    };
});

describe('cleanupEventFile', () => {
    let adminStorageMock: any;

    beforeEach(async () => {
        // Reset mocks
        vi.clearAllMocks();
        adminStorageMock = admin.storage();

        // Import dynamically to ensure testEnv is initialized first
        const module = await import('./cleanup');
        cleanupEventFile = module.cleanupEventFile;
    });

    afterEach(() => {
        testEnv.cleanup();
    });

    it('should delete the original file if it exists in the deleted document', async () => {
        // No wrap needed, cleanupEventFile is the handler

        // Mock data representing the deleted document
        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/test-user/events/test-event/original.fit'
            }
        }, 'users/test-user/events/test-event');

        const context = {
            params: {
                userId: 'test-user',
                eventId: 'test-event'
            }
        };

        await cleanupEventFile(snap, context);

        // Verify storage calls
        expect(adminStorageMock.bucket).toHaveBeenCalledWith(); // Expect no args now (default bucket)
        expect(adminStorageMock.bucket().file).toHaveBeenCalledWith('users/test-user/events/test-event/original.fit');
        expect(adminStorageMock.bucket().file().delete).toHaveBeenCalled();
    });

    it('should NOT attempt deletion if originalFile is missing', async () => {
        // No wrap

        // Mock data WITHOUT originalFile
        const snap = testEnv.firestore.makeDocumentSnapshot({
            someOtherField: 'value'
        }, 'users/test-user/events/test-event');

        const context = {
            params: {
                userId: 'test-user',
                eventId: 'test-event'
            }
        };

        await cleanupEventFile(snap, context);

        // Verify storage calls were NOT made
        expect(adminStorageMock.bucket().file().delete).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during deletion', async () => {
        // No wrap

        // Make delete throw an error
        const deleteMock = adminStorageMock.bucket().file().delete;
        deleteMock.mockRejectedValue(new Error('Storage error'));

        const snap = testEnv.firestore.makeDocumentSnapshot({
            originalFile: {
                path: 'users/test-user/events/test-event/original.fit'
            }
        }, 'users/test-user/events/test-event');

        const context = {
            params: {
                userId: 'test-user',
                eventId: 'test-event'
            }
        };

        // Should not throw
        await expect(cleanupEventFile(snap, context)).resolves.not.toThrow();

        // But should have tried to delete
        expect(deleteMock).toHaveBeenCalled();
    });
});
