import { TestBed } from '@angular/core/testing';
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
        TestBed.configureTestingModule({});
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
});
