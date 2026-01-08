import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFileService } from './app.file.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import * as FileSaver from 'file-saver';
import JSZip from 'jszip';
import { LoggerService } from './logger.service';

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
    const mockLogger = { log: vi.fn(), error: vi.fn() };
    const mockCompatibility = { checkCompressionSupport: vi.fn().mockReturnValue(true) };
    const originalDecompressionStream = globalThis.DecompressionStream;
    const originalResponse = globalThis.Response;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: LOCALE_ID, useValue: 'en-US' },
                { provide: LoggerService, useValue: mockLogger },
                { provide: BrowserCompatibilityService, useValue: mockCompatibility }
            ]
        });
        service = TestBed.inject(AppFileService);
        vi.clearAllMocks();

        // Mock native APIs
        // @ts-ignore
        globalThis.DecompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        // @ts-ignore
        globalThis.Response = vi.fn().mockImplementation((data) => ({
            body: {
                pipeThrough: vi.fn().mockReturnValue({}),
            },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
        }));
    });

    afterEach(() => {
        // @ts-ignore
        globalThis.DecompressionStream = originalDecompressionStream;
        // @ts-ignore
        globalThis.Response = originalResponse;
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
            expect(FileSaver.saveAs).toHaveBeenCalledWith(mockZipBlob, zipName);
        });
    });

    describe('getExtensionFromPath', () => {
        it('should extract simple extension', () => {
            expect(service.getExtensionFromPath('path/to/file.json')).toBe('json');
        });

        it('should handle .gz extension and return base extension', () => {
            expect(service.getExtensionFromPath('path/to/file.json.gz')).toBe('json');
        });
    });

    describe('decompressIfNeeded', () => {
        it('should decompress gzipped data with magic bytes', async () => {
            const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
            await service.decompressIfNeeded(gzippedData, 'test.json.gz');
            expect(globalThis.DecompressionStream).toHaveBeenCalledWith('gzip');
        });

        it('should NOT decompress if compatibility check fails', async () => {
            mockCompatibility.checkCompressionSupport.mockReturnValue(false);
            const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
            const result = await service.decompressIfNeeded(gzippedData, 'test.json.gz');
            expect(globalThis.DecompressionStream).not.toHaveBeenCalled();
            expect(result).toBe(gzippedData);
        });

        it('should NOT decompress non-gzipped data', async () => {
            const plainData = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
            const result = await service.decompressIfNeeded(plainData, 'test.json');
            expect(globalThis.DecompressionStream).not.toHaveBeenCalled();
            expect(result).toBe(plainData);
        });
    });
});
