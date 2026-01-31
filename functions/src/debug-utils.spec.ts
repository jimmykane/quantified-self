import { vi, describe, it, expect, beforeEach } from 'vitest';

// Hoisted mocks
const { mockBucket, mockFile, mockSave, mockBucketFn } = vi.hoisted(() => {
    const mockSave = vi.fn();
    const mockFile = vi.fn().mockReturnValue({ save: mockSave });
    const mockBucket = {
        file: mockFile,
        name: 'test-bucket'
    };
    const mockBucketFn = vi.fn().mockReturnValue(mockBucket);
    return { mockBucket, mockFile, mockSave, mockBucketFn };
});

vi.mock('firebase-admin', () => ({
    storage: () => ({
        bucket: mockBucketFn
    }),
}));

const mockLoggerError = vi.fn();
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: (...args: any[]) => mockLoggerError(...args),
}));

vi.mock('./config', () => ({
    config: {
        debug: {
            bucketName: 'quantified-self-io-debug-files'
        }
    }
}));

// Import system under test
import { uploadDebugFile } from './debug-utils';

describe('uploadDebugFile', () => {
    const fileData = Buffer.from('test data');
    const extension = 'fit';
    const queueItemId = 'item-123';
    const serviceName = 'suunto';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should upload file to specific debug path', async () => {
        await uploadDebugFile(fileData, extension, queueItemId, serviceName, 'test-user-id');

        expect(mockBucketFn).toHaveBeenCalledWith('quantified-self-io-debug-files');
        expect(mockBucket.file).toHaveBeenCalledWith('suunto/test-user-id/item-123.fit');
        expect(mockSave).toHaveBeenCalledWith(fileData);
    });

    it('should handle string data', async () => {
        const stringData = 'some text content';
        await uploadDebugFile(stringData, 'json', queueItemId, 'coros', 'test-user-id');

        expect(mockBucket.file).toHaveBeenCalledWith('coros/test-user-id/item-123.json');
        expect(mockSave).toHaveBeenCalledWith(stringData);
    });

    it('should swallow errors to not interrupt main flow', async () => {
        mockSave.mockRejectedValue(new Error('Storage failure'));

        // Should not throw
        await uploadDebugFile('data', 'fit', 'id', 'garmin', 'test-user-id');

        expect(mockLoggerError).toHaveBeenCalled();
    });
});
