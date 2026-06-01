import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import { FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { environment } from '../../environments/environment';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppEventService } from './app.event.service';

export interface ToolComparisonUploadResponse {
  eventId: string;
  mergeType: 'benchmark';
  sourceFilesCount: number;
  activitiesCount: number;
  uploadLimit: number | null;
  uploadCountAfterWrite: number | null;
  alreadyExists?: boolean;
}

interface PreparedComparisonFile {
  file: File;
  bytes: ArrayBuffer;
  extension: string;
}

const SUPPORTED_COMPARISON_EXTENSIONS = new Set(['fit', 'gpx', 'tcx']);
const MIN_COMPARISON_FILES = 2;
const MAX_COMPARISON_FILES = 10;
const MAX_COMPARISON_FILE_BYTES = 20 * 1024 * 1024;
const MAX_COMPARISON_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_COMPARISON_TITLE_LENGTH = 120;
const SAVED_BENCHMARK_COMPARISONS_LIMIT = 100;

function mapFallbackComparisonErrorMessage(statusCode: number): string {
  if (statusCode >= 500) {
    return 'Comparison service is temporarily unavailable. Please try again shortly.';
  }
  if (statusCode === 429) {
    return 'Upload limit reached for your current plan.';
  }
  if (statusCode === 409) {
    return 'Selected files include duplicate source data.';
  }
  if (statusCode === 401) {
    return 'Comparison is not authorized. Please sign in again.';
  }
  if (statusCode === 400) {
    return 'Could not process selected files. Check file formats and try again.';
  }
  return `Comparison failed (${statusCode}).`;
}

function resolveExtensionFromFilename(filename: string): string {
  const normalized = filename.trim().toLowerCase();
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 2) {
    return '';
  }

  const last = parts[parts.length - 1];
  if (last === 'gz' && parts.length >= 3) {
    return `${parts[parts.length - 2]}.gz`;
  }
  return last;
}

function getBaseExtension(extension: string): string {
  return extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Could not read ${file.name || 'selected file'}.`));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name || 'selected file'}.`));
    reader.readAsArrayBuffer(file);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getNullableNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseComparisonUploadResponse(payload: unknown): ToolComparisonUploadResponse {
  const eventId = isRecord(payload) && typeof payload.eventId === 'string'
    ? payload.eventId.trim()
    : '';
  if (!isRecord(payload) || !eventId || payload.mergeType !== 'benchmark') {
    throw new Error('Comparison service returned an invalid response.');
  }

  return {
    eventId,
    mergeType: 'benchmark',
    sourceFilesCount: getNullableNonNegativeInteger(payload.sourceFilesCount) ?? 0,
    activitiesCount: getNullableNonNegativeInteger(payload.activitiesCount) ?? 0,
    uploadLimit: getNullableNonNegativeInteger(payload.uploadLimit),
    uploadCountAfterWrite: getNullableNonNegativeInteger(payload.uploadCountAfterWrite),
    alreadyExists: payload.alreadyExists === true,
  };
}

@Injectable({
  providedIn: 'root',
})
export class AppToolsComparisonService {
  private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = 'localhost';
  private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;

  private app = inject(FirebaseApp);
  private auth = inject(Auth);
  private appCheckReadiness = inject(AppCheckReadinessService);
  private eventService = inject(AppEventService);

  validateFiles(files: File[]): string | null {
    if (files.length < MIN_COMPARISON_FILES) {
      return `Select at least ${MIN_COMPARISON_FILES} files to compare.`;
    }
    if (files.length > MAX_COMPARISON_FILES) {
      return `You can compare up to ${MAX_COMPARISON_FILES} files at once.`;
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_COMPARISON_TOTAL_BYTES) {
      return 'Selected files are too large together. Keep the combined upload under 30MB.';
    }

    for (const file of files) {
      const extension = resolveExtensionFromFilename(file.name);
      const baseExtension = getBaseExtension(extension);
      if (!SUPPORTED_COMPARISON_EXTENSIONS.has(baseExtension)) {
        return 'Only FIT, GPX, and TCX files are supported for comparisons.';
      }
      if (file.size <= 0) {
        return `${file.name || 'Selected file'} is empty.`;
      }
      if (file.size > MAX_COMPARISON_FILE_BYTES) {
        return `${file.name || 'Selected file'} is larger than 20MB.`;
      }
    }

    return null;
  }

  async createComparison(files: File[], title?: string): Promise<ToolComparisonUploadResponse> {
    const validationError = this.validateFiles(files);
    if (validationError) {
      throw new Error(validationError);
    }

    if (!this.auth.currentUser) {
      throw new Error('User must be authenticated to compare files.');
    }

    const idToken = await this.auth.currentUser.getIdToken(true);
    const appCheckToken = await this.appCheckReadiness.getToken();
    const projectID = this.app.options.projectId;
    if (!projectID) {
      throw new Error('Firebase project ID is not configured.');
    }

    const preparedFiles = await Promise.all(files.map(async (file): Promise<PreparedComparisonFile> => ({
      file,
      bytes: await readFileAsArrayBuffer(file),
      extension: resolveExtensionFromFilename(file.name),
    })));

    const body = this.concatenateFileBytes(preparedFiles);
    const requestBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const manifest = preparedFiles.map(preparedFile => ({
      originalFilename: preparedFile.file.name,
      extension: preparedFile.extension,
      byteLength: preparedFile.bytes.byteLength,
    }));

    const config = FUNCTIONS_MANIFEST.createToolComparisonEvent;
    const functionURL = this.resolveFunctionUrl(config.region, config.name, projectID);
    const headers = new Headers({
      'Authorization': `Bearer ${idToken}`,
      'X-Firebase-AppCheck': appCheckToken,
      'X-Tool-Comparison-Files-Encoded': encodeURIComponent(JSON.stringify(manifest)),
      'Content-Type': 'application/octet-stream',
    });

    const trimmedTitle = title?.trim().slice(0, MAX_COMPARISON_TITLE_LENGTH);
    if (trimmedTitle) {
      headers.set('X-Tool-Comparison-Title-Encoded', encodeURIComponent(trimmedTitle));
    }

    const response = await fetch(functionURL, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const backendMessage = isRecord(payload) && payload.error ? `${payload.error}` : '';
      throw new Error(backendMessage || mapFallbackComparisonErrorMessage(response.status));
    }

    return parseComparisonUploadResponse(payload);
  }

  getBenchmarkComparisons(
    user: User,
    limitCount = SAVED_BENCHMARK_COMPARISONS_LIMIT,
  ): Observable<AppEventInterface[]> {
    return this.eventService.getEventsBy(
      user,
      [{ fieldPath: 'mergeType', opStr: '==', value: 'benchmark' }],
      'startDate',
      false,
      limitCount,
    ).pipe(
      map(events => events as AppEventInterface[]),
    );
  }

  private concatenateFileBytes(files: PreparedComparisonFile[]): Uint8Array {
    const totalLength = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;

    for (const file of files) {
      body.set(new Uint8Array(file.bytes), offset);
      offset += file.bytes.byteLength;
    }

    return body;
  }

  private resolveFunctionUrl(region: string, functionName: string, projectID: string): string {
    if (this.shouldUseFunctionsEmulator()) {
      return `http://${AppToolsComparisonService.LOCAL_FUNCTIONS_EMULATOR_HOST}:${AppToolsComparisonService.LOCAL_FUNCTIONS_EMULATOR_PORT}/${projectID}/${region}/${functionName}`;
    }

    return `https://${region}-${projectID}.cloudfunctions.net/${functionName}`;
  }

  private shouldUseFunctionsEmulator(): boolean {
    return environment.localhost === true && environment.useFunctionsEmulator === true;
  }
}
