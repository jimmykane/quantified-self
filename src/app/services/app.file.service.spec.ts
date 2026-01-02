import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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

