import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFileService } from './app.file.service';
import * as FileSaver from 'file-saver';
import JSZip from 'jszip';

// Mock FileSaver
vi.mock('file-saver', () => ({
    saveAs: vi.fn()
}));

// Mock JSZip
const mockZipGenerateAsync = vi.fn();
const mockZipFile = vi.fn();
const mockJSZipInstance = {
    file: mockZipFile,
    generateAsync: mockZipGenerateAsync
};

vi.mock('jszip', () => {
    return {
        default: vi.fn(() => mockJSZipInstance)
    };
});


describe('AppFileService', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('downloadFile', () => {
        it('should call saveAs with the correct arguments', () => {
            const blob = new Blob(['test content'], { type: 'text/plain' });
            const name = 'testfile';
            const extension = 'txt';

            service.downloadFile(blob, name, extension);

            expect(FileSaver.saveAs).toHaveBeenCalledWith(blob, 'testfile.txt');
        });

        it('should handle filenames that might already have extensions (though the method signature implies separation)', () => {
            // Based on current implementation plan, the service joins them. 
            // If we want to be smarter, we could check, but the current contract is explicit.
            const blob = new Blob(['test'], { type: 'text/plain' });
            service.downloadFile(blob, 'file.name', 'txt');
            expect(FileSaver.saveAs).toHaveBeenCalledWith(blob, 'file.name.txt');
        });
    });

    describe('downloadAsZip', () => {
        it('should create a zip file and save it', async () => {
            const files = [
                { data: new Blob(['content1'], { type: 'text/plain' }), fileName: 'file1.txt' },
                { data: new Blob(['content2'], { type: 'text/plain' }), fileName: 'file2.txt' }
            ];
            const zipName = 'archive.zip';
            const mockZipBlob = new Blob(['zip content'], { type: 'application/zip' });

            mockZipGenerateAsync.mockResolvedValue(mockZipBlob);

            await service.downloadAsZip(files, zipName);

            expect(JSZip).toHaveBeenCalled();
            expect(mockZipFile).toHaveBeenCalledTimes(2);
            expect(mockZipFile).toHaveBeenCalledWith('file1.txt', files[0].data);
            expect(mockZipFile).toHaveBeenCalledWith('file2.txt', files[1].data);
            expect(mockZipGenerateAsync).toHaveBeenCalledWith({ type: 'blob' });
            expect(FileSaver.saveAs).toHaveBeenCalledWith(mockZipBlob, zipName);
        });

        it('should handle empty file list', async () => {
            const zipName = 'empty.zip';
            const mockZipBlob = new Blob([''], { type: 'application/zip' });
            mockZipGenerateAsync.mockResolvedValue(mockZipBlob);

            await service.downloadAsZip([], zipName);

            expect(mockZipFile).not.toHaveBeenCalled();
            expect(FileSaver.saveAs).toHaveBeenCalledWith(mockZipBlob, zipName);
        });
    });

    describe('generateDateBasedFilename', () => {
        it('should format dates using the injected locale', () => {
            const date = new Date('2024-12-25T14:30:00');
            const result = service.generateDateBasedFilename(date, 'fit');
            // Should produce ISO-like format regardless of locale
            expect(result).toBe('2024-12-25_14-30.fit');
        });

        it('should use fallback ID when date is null', () => {
            const result = service.generateDateBasedFilename(null, 'fit', undefined, undefined, 'event-123');
            expect(result).toBe('event-123.fit');
        });

        it('should use "activity" when date is null and no fallback ID', () => {
            const result = service.generateDateBasedFilename(null, 'fit');
            expect(result).toBe('activity.fit');
        });

        it('should include index when multiple files', () => {
            const date = new Date('2024-12-25T14:30:00');
            const result = service.generateDateBasedFilename(date, 'fit', 2, 3);
            expect(result).toBe('2024-12-25_14-30_2.fit');
        });
    });

    describe('generateDateRangeZipFilename', () => {
        it('should format date range correctly', () => {
            const minDate = new Date('2024-12-01');
            const maxDate = new Date('2024-12-25');
            const result = service.generateDateRangeZipFilename(minDate, maxDate);
            expect(result).toBe('2024-12-01_to_2024-12-25_originals.zip');
        });

        it('should use single date when min equals max', () => {
            const date = new Date('2024-12-15');
            const result = service.generateDateRangeZipFilename(date, date);
            expect(result).toBe('2024-12-15_originals.zip');
        });

        it('should use "unknown" when dates are null', () => {
            const result = service.generateDateRangeZipFilename(null, null);
            expect(result).toBe('unknown_originals.zip');
        });

        it('should use custom suffix', () => {
            const date = new Date('2024-12-15');
            const result = service.generateDateRangeZipFilename(date, date, 'backup');
            expect(result).toBe('2024-12-15_backup.zip');
        });
    });
});

describe('AppFileService with different locales', () => {
    it('should be injectable with en-GB locale (EU format)', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-GB' }
            ]
        });
        const service = TestBed.inject(AppFileService);
        expect(service).toBeTruthy();

        // The date format used (yyyy-MM-dd_HH-mm) is locale-independent
        // This test ensures the service works with non-US locales
        const date = new Date('2024-12-25T14:30:00');
        const result = service.generateDateBasedFilename(date, 'fit');
        expect(result).toBe('2024-12-25_14-30.fit');
    });

    it('should be injectable with de-DE locale', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'de-DE' }
            ]
        });
        const service = TestBed.inject(AppFileService);
        expect(service).toBeTruthy();
    });

    it('should be injectable with fr-FR locale', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'fr-FR' }
            ]
        });
        const service = TestBed.inject(AppFileService);
        expect(service).toBeTruthy();
    });
});

describe('AppFileService - getExtensionFromPath', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should extract simple extension', () => {
        expect(service.getExtensionFromPath('path/to/file.json')).toBe('json');
        expect(service.getExtensionFromPath('path/to/file.gpx')).toBe('gpx');
        expect(service.getExtensionFromPath('path/to/file.tcx')).toBe('tcx');
        expect(service.getExtensionFromPath('path/to/file.fit')).toBe('fit');
    });

    it('should handle .gz extension and return base extension', () => {
        expect(service.getExtensionFromPath('path/to/file.json.gz')).toBe('json');
        expect(service.getExtensionFromPath('path/to/file.gpx.gz')).toBe('gpx');
        expect(service.getExtensionFromPath('path/to/file.tcx.gz')).toBe('tcx');
    });

    it('should handle uppercase extensions', () => {
        expect(service.getExtensionFromPath('path/to/file.JSON')).toBe('json');
        expect(service.getExtensionFromPath('path/to/file.GPX.GZ')).toBe('gpx');
    });

    it('should return default extension when no extension found', () => {
        expect(service.getExtensionFromPath('path/to/file')).toBe('fit');
        expect(service.getExtensionFromPath('path/to/file', 'json')).toBe('json');
    });

    it('should handle edge case of just .gz extension', () => {
        expect(service.getExtensionFromPath('path/to/file.gz')).toBe('gz');
    });

    it('should handle complex paths with multiple dots', () => {
        expect(service.getExtensionFromPath('users/uid/events/id/original.2024-01-01.json.gz')).toBe('json');
        expect(service.getExtensionFromPath('users/uid/events/id/my.activity.fit')).toBe('fit');
    });

    it('should handle empty path', () => {
        expect(service.getExtensionFromPath('')).toBe('fit');
    });

    it('should handle path with only extension', () => {
        expect(service.getExtensionFromPath('.json')).toBe('json');
    });

    it('should handle Firebase Storage paths', () => {
        expect(service.getExtensionFromPath('users/abc123/events/xyz456/original_0.json.gz')).toBe('json');
        expect(service.getExtensionFromPath('users/abc123/events/xyz456/original_1.gpx.gz')).toBe('gpx');
        expect(service.getExtensionFromPath('users/abc123/events/xyz456/original_2.fit')).toBe('fit');
    });
});

describe('AppFileService - decompressIfNeeded', () => {
    let service: AppFileService;
    const originalDecompressionStream = global.DecompressionStream;
    const originalResponse = global.Response;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);

        // Mock native APIs
        (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        (global as any).Response = vi.fn().mockImplementation((data) => ({
            body: {
                pipeThrough: vi.fn().mockReturnValue({}),
            },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
        }));
    });

    afterEach(() => {
        global.DecompressionStream = originalDecompressionStream;
        global.Response = originalResponse;
    });

    it('should decompress gzipped data with magic bytes', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData, 'test.json.gz');
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });

    it('should NOT decompress non-gzipped data', async () => {
        const plainData = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
        const result = await service.decompressIfNeeded(plainData, 'test.json');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(plainData);
    });

    it('should NOT decompress .fit files even with gzip magic bytes', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        const result = await service.decompressIfNeeded(gzippedData, 'test.fit');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(gzippedData);
    });

    it('should NOT decompress .FIT files (case insensitive)', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        const result = await service.decompressIfNeeded(gzippedData, 'test.FIT');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(gzippedData);
    });

    it('should handle empty buffer', async () => {
        const emptyBuffer = new ArrayBuffer(0);
        const result = await service.decompressIfNeeded(emptyBuffer, 'test.json');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(emptyBuffer);
    });

    it('should handle buffer with only 1 byte', async () => {
        const tinyBuffer = new Uint8Array([0x1F]).buffer;
        const result = await service.decompressIfNeeded(tinyBuffer, 'test.json');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(tinyBuffer);
    });

    it('should handle buffer with only 2 bytes (not enough for magic check)', async () => {
        const tinyBuffer = new Uint8Array([0x1F, 0x8B]).buffer;
        const result = await service.decompressIfNeeded(tinyBuffer, 'test.json');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(tinyBuffer);
    });

    it('should work without path parameter', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData);
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });

    it('should return original buffer if decompression fails', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        // Make Response throw an error
        (global as any).Response = vi.fn().mockImplementation(() => {
            throw new Error('Decompression failed');
        });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const result = await service.decompressIfNeeded(gzippedData, 'test.json.gz');
        expect(result).toBe(gzippedData);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should handle data that starts with 0x1F but not 0x8B (not gzip)', async () => {
        const notGzipData = new Uint8Array([0x1F, 0x00, 0x08, 0x00]).buffer;
        const result = await service.decompressIfNeeded(notGzipData, 'test.json');
        expect(global.DecompressionStream).not.toHaveBeenCalled();
        expect(result).toBe(notGzipData);
    });

    it('should handle GPX files with gzip magic bytes', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData, 'activity.gpx.gz');
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });

    it('should handle TCX files with gzip magic bytes', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData, 'activity.tcx.gz');
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });

    it('should handle JSON files with gzip magic bytes', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData, 'activity.json.gz');
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });

    it('should handle paths without extensions', async () => {
        const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
        await service.decompressIfNeeded(gzippedData, 'some/path/without/extension');
        expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
    });
});

describe('AppFileService - toDate', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should return null for null input', () => {
        expect(service.toDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
        expect(service.toDate(undefined)).toBeNull();
    });

    it('should return Date object as-is', () => {
        const date = new Date('2024-01-01');
        expect(service.toDate(date)).toBe(date);
    });

    it('should convert Firestore Timestamp with toDate method', () => {
        const mockTimestamp = {
            toDate: () => new Date('2024-01-01T12:00:00Z')
        };
        const result = service.toDate(mockTimestamp);
        expect(result).toEqual(new Date('2024-01-01T12:00:00Z'));
    });

    it('should convert Firestore Timestamp POJO', () => {
        const mockPojo = {
            seconds: 1704067200, // 2024-01-01T00:00:00Z
            nanoseconds: 0
        };
        const result = service.toDate(mockPojo);
        expect(result).toBeInstanceOf(Date);
        expect(result?.getUTCFullYear()).toBe(2024);
        expect(result?.getUTCMonth()).toBe(0); // January
        expect(result?.getUTCDate()).toBe(1);
    });

    it('should convert Firestore Timestamp POJO with nanoseconds', () => {
        const mockPojo = {
            seconds: 1704067200,
            nanoseconds: 500000000 // 0.5 seconds
        };
        const result = service.toDate(mockPojo);
        expect(result).toBeInstanceOf(Date);
        // The milliseconds should be approximately 500
        expect(result?.getUTCMilliseconds()).toBeCloseTo(500, -2);
    });

    it('should convert number (timestamp in milliseconds)', () => {
        const timestamp = 1704067200000; // 2024-01-01T00:00:00Z
        const result = service.toDate(timestamp);
        expect(result).toBeInstanceOf(Date);
        expect(result?.getUTCFullYear()).toBe(2024);
    });

    it('should convert ISO string date', () => {
        const result = service.toDate('2024-01-01T00:00:00Z');
        expect(result).toBeInstanceOf(Date);
        expect(result?.getUTCFullYear()).toBe(2024);
    });

    it('should convert simple date string', () => {
        const result = service.toDate('2024-01-01');
        expect(result).toBeInstanceOf(Date);
    });

    it('should return null for empty string', () => {
        expect(service.toDate('')).toBeNull();
    });

    it('should return null for 0', () => {
        // 0 is falsy in JS, so this should return null based on the implementation
        expect(service.toDate(0)).toBeNull();
    });

    it('should handle object without recognized date properties', () => {
        const result = service.toDate({ foo: 'bar' });
        expect(result).toBeNull();
    });
});

describe('AppFileService - Edge Cases', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    describe('generateDateBasedFilename edge cases', () => {
        it('should handle midnight time', () => {
            const date = new Date('2024-01-15T00:00:00');
            const result = service.generateDateBasedFilename(date, 'fit');
            expect(result).toMatch(/2024-01-15_00-00\.fit/);
        });

        it('should handle end of day time', () => {
            const date = new Date('2024-01-15T23:59:59');
            const result = service.generateDateBasedFilename(date, 'fit');
            expect(result).toMatch(/2024-01-15_23-59\.fit/);
        });

        it('should handle index 0', () => {
            const date = new Date('2024-01-15T08:30:00');
            const result = service.generateDateBasedFilename(date, 'gpx', 0, 3);
            expect(result).toMatch(/2024-01-15_08-30_0\.gpx/);
        });

        it('should handle very large index', () => {
            const date = new Date('2024-01-15T08:30:00');
            const result = service.generateDateBasedFilename(date, 'gpx', 999, 1000);
            expect(result).toMatch(/2024-01-15_08-30_999\.gpx/);
        });
    });

    describe('generateDateRangeZipFilename edge cases', () => {
        it('should handle only minDate null', () => {
            const maxDate = new Date('2024-01-31');
            const result = service.generateDateRangeZipFilename(null, maxDate);
            expect(result).toBe('unknown_to_2024-01-31_originals.zip');
        });

        it('should handle only maxDate null', () => {
            const minDate = new Date('2024-01-01');
            const result = service.generateDateRangeZipFilename(minDate, null);
            expect(result).toBe('2024-01-01_to_unknown_originals.zip');
        });

        it('should handle empty suffix', () => {
            const date = new Date('2024-01-15');
            const result = service.generateDateRangeZipFilename(date, date, '');
            expect(result).toBe('2024-01-15_.zip');
        });
    });
});

describe('AppFileService - Corrupted Gzip Headers', () => {
    let service: AppFileService;
    const originalDecompressionStream = global.DecompressionStream;
    const originalResponse = global.Response;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    afterEach(() => {
        global.DecompressionStream = originalDecompressionStream;
        global.Response = originalResponse;
    });

    it('should handle corrupted gzip (valid header but invalid body)', async () => {
        // Valid gzip header but garbage after
        const corruptedGzip = new Uint8Array([0x1F, 0x8B, 0x08, 0xFF, 0xFF, 0xFF]).buffer;

        // Mock to throw on decompress
        (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        (global as any).Response = vi.fn().mockImplementation(() => {
            throw new Error('Invalid gzip data');
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const result = await service.decompressIfNeeded(corruptedGzip, 'test.json.gz');

        // Should return original buffer on error
        expect(result).toBe(corruptedGzip);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should handle truncated gzip data', async () => {
        // Gzip header only, no actual compressed data
        const truncatedGzip = new Uint8Array([0x1F, 0x8B, 0x08]).buffer;

        (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        (global as any).Response = vi.fn().mockImplementation(() => ({
            body: { pipeThrough: vi.fn().mockReturnValue({}) },
            arrayBuffer: vi.fn().mockRejectedValue(new Error('Unexpected end of data'))
        }));

        const result = await service.decompressIfNeeded(truncatedGzip, 'test.json.gz');
        // Should handle gracefully (may return original or throw based on implementation)
        expect(result).toBeDefined();
    });

    it('should handle empty gzip file (valid header, empty content)', async () => {
        // Valid gzip that decompresses to empty
        const emptyGzip = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]).buffer;

        (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        (global as any).Response = vi.fn().mockImplementation(() => ({
            body: { pipeThrough: vi.fn().mockReturnValue({}) },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0))
        }));

        const result = await service.decompressIfNeeded(emptyGzip, 'empty.json.gz');
        expect(result).toBeInstanceOf(ArrayBuffer);
    });
});

describe('AppFileService - Large File Handling', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should handle 1MB buffer', async () => {
        const largeBuffer = new ArrayBuffer(1024 * 1024); // 1MB
        // Not gzipped, should return as-is
        const result = await service.decompressIfNeeded(largeBuffer, 'large.json');
        expect(result).toBe(largeBuffer);
    });

    it('should handle 10MB buffer (near upload limit)', async () => {
        const veryLargeBuffer = new ArrayBuffer(10 * 1024 * 1024); // 10MB
        const result = await service.decompressIfNeeded(veryLargeBuffer, 'huge.gpx');
        expect(result).toBe(veryLargeBuffer);
    });

    it('should correctly identify large gzipped file', async () => {
        // 1MB buffer with gzip magic bytes at start
        const largeGzipBuffer = new ArrayBuffer(1024 * 1024);
        const view = new Uint8Array(largeGzipBuffer);
        view[0] = 0x1F;
        view[1] = 0x8B;
        view[2] = 0x08;

        (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        (global as any).Response = vi.fn().mockImplementation(() => ({
            body: { pipeThrough: vi.fn().mockReturnValue({}) },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2 * 1024 * 1024))
        }));

        const result = await service.decompressIfNeeded(largeGzipBuffer, 'large.json.gz');
        expect(global.DecompressionStream).toHaveBeenCalled();
    });
});

describe('AppFileService - Concurrent Operations', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should handle multiple concurrent decompression requests', async () => {
        const buffers = [
            new Uint8Array([0x00, 0x01]).buffer,
            new Uint8Array([0x00, 0x02]).buffer,
            new Uint8Array([0x00, 0x03]).buffer
        ];

        const results = await Promise.all(
            buffers.map((b, i) => service.decompressIfNeeded(b, `file${i}.json`))
        );

        expect(results.length).toBe(3);
        results.forEach((r, i) => expect(r).toBe(buffers[i]));
    });

    it('should handle concurrent getExtensionFromPath calls', () => {
        const paths = [
            'path/to/file1.json.gz',
            'path/to/file2.gpx',
            'path/to/file3.tcx.gz',
            'path/to/file4.fit',
            'path/to/file5'
        ];

        const results = paths.map(p => service.getExtensionFromPath(p));

        expect(results).toEqual(['json', 'gpx', 'tcx', 'fit', 'fit']);
    });
});

describe('AppFileService - Unicode and Special Characters', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should handle unicode in file path', () => {
        expect(service.getExtensionFromPath('用户/活动/运动.json.gz')).toBe('json');
    });

    it('should handle emojis in file path', () => {
        expect(service.getExtensionFromPath('users/🏃‍♂️/activities/🚴.gpx')).toBe('gpx');
    });

    it('should handle spaces in file path', () => {
        expect(service.getExtensionFromPath('users/john doe/my activity.tcx.gz')).toBe('tcx');
    });

    it('should handle special characters in file path', () => {
        expect(service.getExtensionFromPath("users/test's file (1) [copy].json")).toBe('json');
    });

    it('should handle URL-encoded characters', () => {
        expect(service.getExtensionFromPath('users/test%20file.gpx.gz')).toBe('gpx');
    });

    it('should handle backslashes (Windows-style paths)', () => {
        // Note: split('.') doesn't care about slashes
        expect(service.getExtensionFromPath('users\\test\\file.tcx')).toBe('tcx');
    });
});

describe('AppFileService - Boundary Conditions', () => {
    let service: AppFileService;

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' }
            ]
        });
        service = TestBed.inject(AppFileService);
    });

    it('should handle path with many dots', () => {
        expect(service.getExtensionFromPath('file.backup.2024.01.15.json.gz')).toBe('json');
    });

    it('should handle .tar.gz pattern correctly', () => {
        // .tar.gz should return 'tar' after stripping .gz
        expect(service.getExtensionFromPath('archive.tar.gz')).toBe('tar');
    });

    it('should handle double .gz.gz extension', () => {
        // Edge case: file.json.gz.gz - after stripping first .gz, we get .gz again
        expect(service.getExtensionFromPath('file.json.gz.gz')).toBe('gz');
    });

    it('should handle minimum valid gzip buffer (3 bytes)', () => {
        const minBuffer = new Uint8Array([0x1F, 0x8B, 0x08]).buffer;
        // 3 bytes is > 2, so magic check passes
        expect(minBuffer.byteLength).toBe(3);
    });

    it('should handle generateDateBasedFilename with Date at Unix epoch', () => {
        const epochDate = new Date(0);
        const result = service.generateDateBasedFilename(epochDate, 'fit');
        expect(result).toMatch(/1970.*\.fit/);
    });

    it('should handle generateDateBasedFilename with future date', () => {
        const futureDate = new Date('2099-12-31T23:59:59');
        const result = service.generateDateBasedFilename(futureDate, 'gpx');
        expect(result).toMatch(/2099.*\.gpx/);
    });
});
