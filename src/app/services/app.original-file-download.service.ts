import { Injectable, inject } from '@angular/core';
import { AppFileService } from './app.file.service';

export interface OriginalFileDownloadSource {
  path: string;
  startDate?: unknown;
  fallbackDate?: unknown;
  originalFilename?: string;
  extension?: string;
}

export interface OriginalFileDownloadProgress<TSource extends OriginalFileDownloadSource = OriginalFileDownloadSource> {
  completed: number;
  total: number;
  downloadedCount: number;
  failedCount: number;
  source: TSource;
}

export interface OriginalFileDownloadOptions<TSource extends OriginalFileDownloadSource = OriginalFileDownloadSource> {
  sources: TSource[];
  downloadFile: (path: string) => Promise<ArrayBuffer>;
  zipSuffix?: string;
  fallbackFileName?: string;
  zipSingleFile?: boolean;
  continueOnFailure?: boolean;
  onFileProcessed?: (progress: OriginalFileDownloadProgress<TSource>) => void;
  onFileFailed?: (source: TSource, error: unknown) => void;
}

export interface OriginalFileDownloadResult {
  mode: 'none' | 'single' | 'zip';
  downloadedCount: number;
  failedCount: number;
  minDate: Date | null;
  maxDate: Date | null;
  zipFileName: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AppOriginalFileDownloadService {
  private fileService = inject(AppFileService);

  public async downloadOriginalFiles<TSource extends OriginalFileDownloadSource>(
    options: OriginalFileDownloadOptions<TSource>,
  ): Promise<OriginalFileDownloadResult> {
    const sourceEntries = (options.sources ?? [])
      .map(source => ({
        source: {
          ...source,
          path: typeof source.path === 'string' ? source.path.trim() : '',
        } as TSource,
      }))
      .filter(entry => entry.source.path.length > 0);

    if (sourceEntries.length === 0) {
      return {
        mode: 'none',
        downloadedCount: 0,
        failedCount: 0,
        minDate: null,
        maxDate: null,
        zipFileName: null,
      };
    }

    const downloadedFiles: { data: ArrayBuffer; fileName: string; fileDate: Date | null }[] = [];
    const usedFileNames = new Set<string>();
    let failedCount = 0;
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (let index = 0; index < sourceEntries.length; index++) {
      const source = sourceEntries[index].source;
      const extension = this.fileService.getExtensionFromPath(source.path, source.extension || 'bin');
      const fileDate = this.fileService.toDate(source.startDate) || this.fileService.toDate(source.fallbackDate);
      const fileName = this.fileService.getUniqueFileName(
        this.fileService.resolveOriginalSourceFileName(
          source,
          source.extension || extension,
          options.fallbackFileName || 'original-file',
        ),
        usedFileNames,
      );

      try {
        const data = await options.downloadFile(source.path);
        downloadedFiles.push({ data, fileName, fileDate });
        if (fileDate) {
          if (!minDate || fileDate < minDate) minDate = fileDate;
          if (!maxDate || fileDate > maxDate) maxDate = fileDate;
        }
      } catch (error) {
        failedCount++;
        options.onFileFailed?.(source, error);
        if (!options.continueOnFailure) {
          throw error;
        }
      } finally {
        options.onFileProcessed?.({
          completed: index + 1,
          total: sourceEntries.length,
          downloadedCount: downloadedFiles.length,
          failedCount,
          source,
        });
      }
    }

    if (downloadedFiles.length === 0) {
      return {
        mode: 'none',
        downloadedCount: 0,
        failedCount,
        minDate,
        maxDate,
        zipFileName: null,
      };
    }

    if (downloadedFiles.length === 1 && !options.zipSingleFile) {
      const file = downloadedFiles[0];
      const extension = this.fileService.getExtensionFromPath(file.fileName, 'bin');
      this.fileService.downloadNamedFile(new Blob([file.data]), file.fileName, extension);
      return {
        mode: 'single',
        downloadedCount: 1,
        failedCount,
        minDate,
        maxDate,
        zipFileName: null,
      };
    }

    const zipFileName = this.fileService.generateDateRangeZipFilename(
      minDate,
      maxDate,
      options.zipSuffix || 'originals',
    );
    await this.fileService.downloadAsZip(
      downloadedFiles.map(({ data, fileName }) => ({ data, fileName })),
      zipFileName,
    );

    return {
      mode: 'zip',
      downloadedCount: downloadedFiles.length,
      failedCount,
      minDate,
      maxDate,
      zipFileName,
    };
  }
}
