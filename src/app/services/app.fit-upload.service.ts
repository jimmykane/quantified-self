import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { environment } from '../../environments/environment';
import { createHttpUploadError, UploadError } from './upload-error';
import { BrowserCompatibilityService } from './browser.compatibility.service';

export interface UploadActivityFromFitResponse {
    eventId: string;
    activitiesCount: number;
    uploadLimit: number | null;
    uploadCountAfterWrite: number | null;
}

function canUsePlainHeaderValue(value: string): boolean {
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0;
        const isControlCharacter = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
        if (isControlCharacter || codePoint > 0xff) {
            return false;
        }
    }

    return true;
}

function mapFallbackUploadErrorMessage(statusCode: number): string {
    if (statusCode >= 500) {
        return 'Upload service is temporarily unavailable. Please try again shortly.';
    }
    if (statusCode === 429) {
        return 'Upload limit reached for your current plan.';
    }
    if (statusCode === 401) {
        return 'Upload is not authorized. Please sign in again.';
    }
    if (statusCode === 400) {
        return 'Could not process uploaded file. Check file format and try again.';
    }
    return `Upload failed (${statusCode}).`;
}

@Injectable({
    providedIn: 'root'
})
export class AppFitUploadService {
    private static readonly UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
    private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = 'localhost';
    private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;
    private app = inject(FirebaseApp);
    private auth = inject(Auth);
    private appCheckReadiness = inject(AppCheckReadinessService);

    async uploadActivityFile(
        fileBytes: ArrayBuffer,
        fileExtension: string,
        originalFilename?: string,
    ): Promise<UploadActivityFromFitResponse> {
        const controller = BrowserCompatibilityService.checkAbortControllerSupport() ? new AbortController() : undefined;
        const timeoutError = new UploadError(
            'Upload timed out. Processing may still finish. Check your activities before uploading this file again.',
            408,
            'upload_timeout',
        );
        let expired = false;
        let timeoutId: ReturnType<typeof setTimeout>;
        const deadline = new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
                expired = true;
                // Settle the deadline before aborting so callers get the recovery guidance,
                // rather than a transport-specific AbortError. Aborting cannot undo a server write.
                reject(timeoutError);
                controller?.abort();
            }, AppFitUploadService.UPLOAD_TIMEOUT_MS);
        });
        const throwIfExpired = () => { if (expired) throw timeoutError; };
        try {
            return await Promise.race([
                this.uploadActivityFileRequest(fileBytes, fileExtension, originalFilename, controller?.signal, throwIfExpired),
                deadline,
            ]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async uploadActivityFileRequest(
        fileBytes: ArrayBuffer,
        fileExtension: string,
        originalFilename: string | undefined,
        signal: AbortSignal | undefined,
        throwIfExpired: () => void,
    ): Promise<UploadActivityFromFitResponse> {
        if (!this.auth.currentUser) {
            throw new UploadError('User must be authenticated to upload activities.', 401, 'unauthenticated');
        }

        const idToken = await this.auth.currentUser.getIdToken();
        throwIfExpired();
        const appCheckToken = await this.appCheckReadiness.getToken();
        throwIfExpired();

        const projectID = this.app.options.projectId;
        if (!projectID) {
            throw new Error('Firebase project ID is not configured.');
        }

        const normalizedExtension = fileExtension.trim().toLowerCase();
        if (!normalizedExtension) {
            throw new UploadError('File extension is required.', 400, 'invalid_extension');
        }

        const config = FUNCTIONS_MANIFEST.uploadActivity;
        const functionURL = this.resolveUploadFunctionUrl(config.region, config.name, projectID);

        const headers = new Headers({
            'Authorization': `Bearer ${idToken}`,
            'X-Firebase-AppCheck': appCheckToken,
            'X-File-Extension': normalizedExtension,
            'Content-Type': 'application/octet-stream',
        });

        const trimmedOriginalFilename = originalFilename?.trim();
        if (trimmedOriginalFilename) {
            headers.set('X-Original-Filename-Encoded', encodeURIComponent(trimmedOriginalFilename));
            if (canUsePlainHeaderValue(trimmedOriginalFilename)) {
                headers.set('X-Original-Filename', trimmedOriginalFilename);
            }
        }

        const response = await fetch(functionURL, {
            method: 'POST',
            headers,
            body: fileBytes,
            signal,
        });

        let payload: any = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        throwIfExpired();

        if (!response.ok) {
            const backendMessage = payload?.error ? `${payload.error}` : '';
            throw createHttpUploadError(
                backendMessage || mapFallbackUploadErrorMessage(response.status),
                response.status,
                payload,
            );
        }

        return payload as UploadActivityFromFitResponse;
    }

    async uploadFitFile(fileBytes: ArrayBuffer, originalFilename?: string): Promise<UploadActivityFromFitResponse> {
        return this.uploadActivityFile(fileBytes, 'fit', originalFilename);
    }

    private resolveUploadFunctionUrl(region: string, functionName: string, projectID: string): string {
        if (this.shouldUseFunctionsEmulator()) {
            return `http://${AppFitUploadService.LOCAL_FUNCTIONS_EMULATOR_HOST}:${AppFitUploadService.LOCAL_FUNCTIONS_EMULATOR_PORT}/${projectID}/${region}/${functionName}`;
        }

        return `https://${region}-${projectID}.cloudfunctions.net/${functionName}`;
    }

    private shouldUseFunctionsEmulator(): boolean {
        return environment.localhost === true && environment.useFunctionsEmulator === true;
    }
}
