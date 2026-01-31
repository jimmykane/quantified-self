import { TestBed } from '@angular/core/testing';
import { AppCacheService } from './app.cache.service';
import * as idb from 'idb-keyval';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock idb-keyval
vi.mock('idb-keyval', () => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    clear: vi.fn(),
}));

describe('AppCacheService', () => {
    let service: AppCacheService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(AppCacheService);
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should get file from cache', async () => {
        const mockFile = { buffer: new ArrayBuffer(8), generation: '123' };
        vi.mocked(idb.get).mockResolvedValue(mockFile);

        const result = await service.getFile('test-key');
        expect(idb.get).toHaveBeenCalledWith('test-key');
        expect(result).toEqual(mockFile);
    });

    it('should return undefined if get fails', async () => {
        vi.mocked(idb.get).mockRejectedValue(new Error('DB Error'));
        const result = await service.getFile('test-key');
        expect(result).toBeUndefined();
    });

    it('should set file in cache', async () => {
        const mockFile = { buffer: new ArrayBuffer(8), generation: '123' };
        await service.setFile('test-key', mockFile);
        expect(idb.set).toHaveBeenCalledWith('test-key', mockFile);
    });

    it('should remove file from cache', async () => {
        await service.removeFile('test-key');
        expect(idb.del).toHaveBeenCalledWith('test-key');
    });

    it('should clear cache', async () => {
        await service.clearCache();
        expect(idb.clear).toHaveBeenCalled();
    });
    it('should handle error when setting file', async () => {
        vi.mocked(idb.set).mockRejectedValue(new Error('DB Error'));
        await expect(service.setFile('test-key', {} as any)).resolves.not.toThrow();
    });

    it('should ignore error when removing file', async () => {
        vi.mocked(idb.del).mockRejectedValue(new Error('DB Error'));
        await expect(service.removeFile('test-key')).resolves.not.toThrow();
    });

    it('should ignore error when clearing cache', async () => {
        vi.mocked(idb.clear).mockRejectedValue(new Error('DB Error'));
        await expect(service.clearCache()).resolves.not.toThrow();
    });
});
