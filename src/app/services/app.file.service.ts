import { Inject, Injectable, LOCALE_ID } from '@angular/core';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { DatePipe } from '@angular/common';


@Injectable({
  providedIn: 'root',
})
export class AppFileService {
  private datePipe: DatePipe;

  constructor(@Inject(LOCALE_ID) private locale: string) {
    this.datePipe = new DatePipe(this.locale);
  }

  public downloadFile(blob: Blob, name: string, extension: string): void {
    saveAs(blob, [name, extension].join('.'));
  }

  public async downloadAsZip(files: { data: Blob | ArrayBuffer, fileName: string }[], zipFileName: string): Promise<void> {
    const zip = new JSZip();
    files.forEach(file => {
      zip.file(file.fileName, file.data);
    });

    const content = await zip.generateAsync({ type: 'blob' });
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
    return parts.length > 1 ? parts[parts.length - 1] : defaultExt;
  }
}
