import { Inject, Injectable, LOCALE_ID, inject } from '@angular/core';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { DatePipe } from '@angular/common';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { LoggerService } from './logger.service';


@Injectable({
  providedIn: 'root',
})
export class AppFileService {
  private datePipe: DatePipe;
  private compatibilityService = inject(BrowserCompatibilityService);
  private logger = inject(LoggerService);

  constructor(@Inject(LOCALE_ID) private locale: string) {
    this.datePipe = new DatePipe(this.locale);
  }

  public downloadFile(blob: Blob, name: string, extension: string): void {
    const normalizedExtension = this.normalizeExtension(extension);
    this.downloadNamedFile(blob, `${name}.${normalizedExtension}`, normalizedExtension);
  }

  public downloadNamedFile(blob: Blob, fileName: string, fallbackExtension: string = 'bin'): void {
    const normalizedFileName = this.ensureFilenameHasExtension(fileName, fallbackExtension);
    const mimeType = this.resolveDownloadMimeType(
      this.getTrailingExtension(normalizedFileName, fallbackExtension),
      blob.type,
    );
    const normalizedBlob = blob.type === mimeType
      ? blob
      : new Blob([blob], { type: mimeType });
    const namedFile = this.createNamedFile(normalizedBlob, normalizedFileName, mimeType);

    if (namedFile) {
      saveAs(namedFile);
      return;
    }

    saveAs(normalizedBlob, normalizedFileName);
  }

  public async downloadAsZip(files: { data: Blob | ArrayBuffer, fileName: string }[], zipFileName: string): Promise<void> {
    const zip = new JSZip();
    files.forEach(file => {
      zip.file(file.fileName, file.data);
    });

    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 } // Good balance between speed and compression
    });
    saveAs(content, zipFileName);
  }

  /**
   * Converts various date formats (Date, Firestore Timestamp, number, string) to a JavaScript Date.
   * Returns null if conversion fails.
   */
  public toDate(rawDate: any): Date | null {
    if (!rawDate) return null;
    if (rawDate instanceof Date) return rawDate;
    if (rawDate.toDate && typeof rawDate.toDate === 'function') {
      // Firestore Timestamp instance
      return rawDate.toDate();
    }
    if (typeof rawDate.seconds === 'number' && typeof rawDate.nanoseconds === 'number') {
      // Firestore Timestamp POJO
      return new Date(rawDate.seconds * 1000 + rawDate.nanoseconds / 1000000);
    }
    if (typeof rawDate === 'number') return new Date(rawDate);
    if (typeof rawDate === 'string') return new Date(rawDate);
    return null;
  }

  /**
   * Generates a date-based filename for a downloaded file.
   * @param date The date to use for the filename
   * @param extension The file extension (without leading dot)
   * @param index Optional index for multiple files (1-based)
   * @param totalFiles Total number of files (used to determine if index should be included)
   * @param fallbackId Fallback ID to use if date is null
   * @returns A filename like "2024-12-25_08-30.fit" or "2024-12-25_08-30_1.fit"
   */
  public generateDateBasedFilename(
    date: Date | null,
    extension: string,
    index?: number,
    totalFiles?: number,
    fallbackId?: string | null
  ): string {
    const dateStr = date ? this.datePipe.transform(date, 'yyyy-MM-dd_HH-mm') : null;
    const baseStr = dateStr || fallbackId || 'activity';

    if (index !== undefined && totalFiles !== undefined && totalFiles > 1) {
      return `${baseStr}_${index}.${extension}`;
    }
    return `${baseStr}.${extension}`;
  }

  /**
   * Generates a date range string for a ZIP filename.
   * @param minDate The earliest date
   * @param maxDate The latest date
   * @param suffix Optional suffix (defaults to "originals")
   * @returns A filename like "2024-12-01_to_2024-12-25_originals.zip"
   */
  public generateDateRangeZipFilename(minDate: Date | null, maxDate: Date | null, suffix: string = 'originals'): string {
    const startStr = minDate ? this.datePipe.transform(minDate, 'yyyy-MM-dd') : 'unknown';
    const endStr = maxDate ? this.datePipe.transform(maxDate, 'yyyy-MM-dd') : 'unknown';
    if (startStr === endStr) {
      return `${startStr}_${suffix}.zip`;
    }
    return `${startStr}_to_${endStr}_${suffix}.zip`;
  }

  /**
   * Extracts file extension from a file path.
   * @param path The file path
   * @param defaultExt Default extension if none found
   * @returns The extension without the leading dot
   */
  public getExtensionFromPath(path: string, defaultExt: string = 'fit'): string {
    const parts = path.split('.');
    // If only one part, there's no extension
    if (parts.length <= 1) {
      return defaultExt;
    }
    let extension = parts.pop()?.toLowerCase();
    // If extension contains a slash, it's actually a path segment, not an extension
    if (extension?.includes('/')) {
      return defaultExt;
    }
    if (extension === 'gz' && parts.length > 1) {
      extension = parts.pop()?.toLowerCase();
    }
    return extension || defaultExt;
  }

  public resolveOriginalSourceFileName(
    file: { originalFilename?: unknown; path?: unknown; extension?: unknown },
    fallbackExtension: string = 'bin',
    fallbackName: string = 'download',
  ): string {
    const normalizedExtension = this.normalizeExtension(
      typeof file.extension === 'string' && file.extension.trim().length > 0
        ? file.extension
        : fallbackExtension,
    );
    const originalFilename = this.normalizeSourceFilename(file.originalFilename);
    if (originalFilename) {
      return this.ensureFilenameHasExtension(originalFilename, normalizedExtension);
    }

    const path = typeof file.path === 'string' ? file.path : '';
    const basename = this.extractPathBasename(path);
    if (basename) {
      return this.ensureFilenameHasExtension(basename, normalizedExtension);
    }

    return this.ensureFilenameHasExtension(fallbackName, normalizedExtension);
  }

  public getUniqueFileName(fileName: string, usedNames: Set<string>): string {
    const normalizedFileName = this.normalizeSourceFilename(fileName) || 'download';
    const { stem, extension } = this.splitFileName(normalizedFileName);
    let candidate = normalizedFileName;
    let suffix = 2;

    while (usedNames.has(candidate.toLowerCase())) {
      candidate = extension ? `${stem}_${suffix}.${extension}` : `${stem}_${suffix}`;
      suffix++;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  public async decompressIfNeeded(buffer: ArrayBuffer, path?: string): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(buffer);
    // Gzip magic number: 0x1F 0x8B
    // We skip .fit files as a safeguard, as requested by the user, even if they somehow start with these bytes
    const isFit = path?.toLowerCase().endsWith('.fit');
    if (!isFit && bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
      try {
        if (path) {
          this.logger.log(`[AppFileService] Decompressing file: ${path}`);
        }
        if (!this.compatibilityService.checkCompressionSupport()) {
          this.logger.warn(`[AppFileService] Decompression skipped: unsupported browser`);
          return buffer;
        }
        const stream = new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).arrayBuffer();
      } catch (e) {
        this.logger.error(`[AppFileService] Decompression failed`, e);
        return buffer;
      }
    }
    return buffer;
  }

  private normalizeExtension(extension: string): string {
    const normalizedExtension = extension?.trim().replace(/^\./, '').toLowerCase();
    return normalizedExtension || 'bin';
  }

  private resolveDownloadMimeType(extension: string, providedType?: string): string {
    if (providedType && providedType.trim()) {
      return providedType;
    }

    switch (extension) {
      case 'fit':
        return 'application/vnd.ant.fit';
      case 'gpx':
        return 'application/gpx+xml';
      case 'tcx':
        return 'application/vnd.garmin.tcx+xml';
      case 'json':
        return 'application/json';
      case 'sml':
        return 'application/xml';
      case 'csv':
        return 'text/csv';
      case 'gz':
        return 'application/gzip';
      case 'zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
  }

  private normalizeSourceFilename(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return null;
    }

    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      decoded = trimmed;
    }

    const basename = this.extractPathBasename(decoded) || decoded;
    return basename.trim() || null;
  }

  private ensureFilenameHasExtension(fileName: string, fallbackExtension: string): string {
    const normalizedFileName = this.normalizeSourceFilename(fileName) || 'download';
    const normalizedFallbackExtension = this.normalizeExtension(fallbackExtension);
    const currentExtension = this.getExtensionFromPath(normalizedFileName, '');
    if (currentExtension) {
      return normalizedFileName;
    }
    return `${normalizedFileName}.${normalizedFallbackExtension}`;
  }

  private extractPathBasename(value: string): string | null {
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }

  private splitFileName(fileName: string): { stem: string; extension: string } {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
      return {
        stem: fileName,
        extension: '',
      };
    }

    return {
      stem: fileName.slice(0, lastDotIndex),
      extension: fileName.slice(lastDotIndex + 1),
    };
  }

  private getTrailingExtension(fileName: string, fallbackExtension: string): string {
    const parts = fileName.split('.');
    if (parts.length <= 1) {
      return this.normalizeExtension(fallbackExtension);
    }

    const extension = parts.pop()?.trim().toLowerCase();
    if (!extension || extension.includes('/')) {
      return this.normalizeExtension(fallbackExtension);
    }

    return extension;
  }

  private createNamedFile(blob: Blob, filename: string, mimeType: string): File | null {
    if (typeof File === 'undefined') {
      return null;
    }

    try {
      return new File([blob], filename, { type: mimeType });
    } catch {
      return null;
    }
  }
}
