import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFileService } from './app.file.service';
import {
  AppOriginalFileDownloadService,
  OriginalFileDownloadSource,
} from './app.original-file-download.service';

describe('AppOriginalFileDownloadService', () => {
  let service: AppOriginalFileDownloadService;
  let fileServiceMock: any;

  beforeEach(() => {
    fileServiceMock = {
      getExtensionFromPath: vi.fn((path: string, defaultExt = 'bin') => {
        const parts = path.split('.');
        if (parts.length <= 1) {
          return defaultExt;
        }
        let extension = parts[parts.length - 1].toLowerCase();
        if (extension === 'gz' && parts.length > 2) {
          extension = parts[parts.length - 2].toLowerCase();
        }
        return extension;
      }),
      toDate: vi.fn((value: unknown) => value instanceof Date ? value : null),
      resolveOriginalSourceFileName: vi.fn((file: { originalFilename?: string; path?: string }, fallbackExtension = 'bin', fallbackName = 'original-file') => (
        file.originalFilename
          || file.path?.split('/').filter(Boolean).pop()
          || `${fallbackName}.${fallbackExtension}`
      )),
      getUniqueFileName: vi.fn((fileName: string, usedNames: Set<string>) => {
        let candidate = fileName;
        const lastDotIndex = fileName.lastIndexOf('.');
        const stem = lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
        const extension = lastDotIndex > 0 ? fileName.slice(lastDotIndex + 1) : '';
        let suffix = 2;
        while (usedNames.has(candidate.toLowerCase())) {
          candidate = extension ? `${stem}_${suffix}.${extension}` : `${stem}_${suffix}`;
          suffix++;
        }
        usedNames.add(candidate.toLowerCase());
        return candidate;
      }),
      generateDateRangeZipFilename: vi.fn((_minDate: Date | null, _maxDate: Date | null, suffix = 'originals') => `archive_${suffix}.zip`),
      downloadNamedFile: vi.fn(),
      downloadAsZip: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        AppOriginalFileDownloadService,
        { provide: AppFileService, useValue: fileServiceMock },
      ],
    });

    service = TestBed.inject(AppOriginalFileDownloadService);
  });

  it('downloads a single source file directly using its original filename', async () => {
    const source: OriginalFileDownloadSource = {
      path: 'users/u/events/e/original.fit',
      originalFilename: 'watch.fit',
    };
    const downloadFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    const result = await service.downloadOriginalFiles({
      sources: [source],
      downloadFile,
    });

    expect(downloadFile).toHaveBeenCalledWith('users/u/events/e/original.fit');
    expect(fileServiceMock.downloadNamedFile).toHaveBeenCalledWith(expect.any(Blob), 'watch.fit', 'fit');
    expect(fileServiceMock.downloadAsZip).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: 'single',
      downloadedCount: 1,
      failedCount: 0,
      minDate: null,
      maxDate: null,
      zipFileName: null,
    });
  });

  it('zips multiple files and dedupes colliding original filenames', async () => {
    const sources: OriginalFileDownloadSource[] = [
      { path: 'users/u/routes/r1/one.fit', originalFilename: 'track.fit', startDate: new Date('2026-01-01T00:00:00.000Z') },
      { path: 'users/u/routes/r1/two.fit', originalFilename: 'track.fit', startDate: new Date('2026-01-02T00:00:00.000Z') },
    ];
    const downloadFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    const result = await service.downloadOriginalFiles({
      sources,
      downloadFile,
      zipSuffix: 'route_originals',
    });

    expect(fileServiceMock.downloadAsZip).toHaveBeenCalledWith(
      [
        expect.objectContaining({ fileName: 'track.fit' }),
        expect.objectContaining({ fileName: 'track_2.fit' }),
      ],
      'archive_route_originals.zip',
    );
    expect(result.mode).toBe('zip');
    expect(result.downloadedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('continues after per-file failures when requested and reports progress', async () => {
    const sources: Array<OriginalFileDownloadSource & { id: string }> = [
      { id: 'one', path: 'users/u/events/e/one.fit' },
      { id: 'two', path: 'users/u/events/e/two.fit' },
    ];
    const downloadFile = vi.fn()
      .mockResolvedValueOnce(new ArrayBuffer(8))
      .mockRejectedValueOnce(new Error('boom'));
    const onFileProcessed = vi.fn();
    const onFileFailed = vi.fn();

    const result = await service.downloadOriginalFiles({
      sources,
      downloadFile,
      continueOnFailure: true,
      onFileProcessed,
      onFileFailed,
    });

    expect(onFileFailed).toHaveBeenCalledWith(sources[1], expect.any(Error));
    expect(onFileProcessed).toHaveBeenCalledTimes(2);
    expect(fileServiceMock.downloadNamedFile).toHaveBeenCalledWith(expect.any(Blob), 'one.fit', 'fit');
    expect(result).toMatchObject({
      mode: 'single',
      downloadedCount: 1,
      failedCount: 1,
    });
  });

  it('can zip a single successful file when the caller requests bulk-style behavior', async () => {
    const source: OriginalFileDownloadSource = {
      path: 'users/u/routes/r/original.gpx',
      originalFilename: 'route.gpx',
    };
    const downloadFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    const result = await service.downloadOriginalFiles({
      sources: [source],
      downloadFile,
      zipSingleFile: true,
      zipSuffix: 'route_originals',
    });

    expect(fileServiceMock.downloadNamedFile).not.toHaveBeenCalled();
    expect(fileServiceMock.downloadAsZip).toHaveBeenCalledWith(
      [expect.objectContaining({ fileName: 'route.gpx' })],
      'archive_route_originals.zip',
    );
    expect(result.mode).toBe('zip');
  });

  it('rethrows the first failure when continueOnFailure is disabled', async () => {
    const downloadError = new Error('download failed');
    const downloadFile = vi.fn().mockRejectedValue(downloadError);

    await expect(service.downloadOriginalFiles({
      sources: [{ path: 'users/u/events/e/original.fit' }],
      downloadFile,
    })).rejects.toBe(downloadError);

    expect(fileServiceMock.downloadNamedFile).not.toHaveBeenCalled();
    expect(fileServiceMock.downloadAsZip).not.toHaveBeenCalled();
  });

  it('ignores sources whose paths are blank after trimming', async () => {
    const downloadFile = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    const result = await service.downloadOriginalFiles({
      sources: [
        { path: '   ', originalFilename: 'blank.fit' },
        { path: ' users/u/events/e/original.fit ', originalFilename: 'watch.fit' },
      ],
      downloadFile,
    });

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledWith('users/u/events/e/original.fit');
    expect(result).toMatchObject({
      mode: 'single',
      downloadedCount: 1,
      failedCount: 0,
    });
  });
});
