import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { environment } from '../../environments/environment';

export interface UploadRouteResponse {
    routeId: string;
    routesCount: number;
    routeCount: number;
    duplicate?: boolean;
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

function mapFallbackRouteUploadErrorMessage(statusCode: number): string {
    if (statusCode >= 500) {
        return 'Route upload service is temporarily unavailable. Please try again shortly.';
    }
    if (statusCode === 429) {
        return 'Route upload limit reached for your current plan.';
    }
    if (statusCode === 401) {
        return 'Route upload is not authorized. Please sign in again.';
    }
    if (statusCode === 400) {
        return 'Could not read this route file. Upload a FIT course/route or GPX route/track file and try again.';
    }
    return `Route upload failed (${statusCode}).`;
}

function getPayloadTextValue(payload: unknown, key: 'error' | 'message'): string {
    if (!payload || typeof payload !== 'object' || !(key in payload)) {
        return '';
    }

    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string') {
        return value.trim();
    }
    if (value && typeof value === 'object' && 'message' in value) {
        const nestedMessage = (value as { message?: unknown }).message;
        return typeof nestedMessage === 'string' ? nestedMessage.trim() : '';
    }
    return '';
}

function getRouteUploadBackendErrorMessage(payload: unknown): string {
    return getPayloadTextValue(payload, 'error') || getPayloadTextValue(payload, 'message');
}

@Injectable({
    providedIn: 'root'
})
export class AppRouteUploadService {
    private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = 'localhost';
    private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;
    private app = inject(FirebaseApp);
    private auth = inject(Auth);
    private appCheckReadiness = inject(AppCheckReadinessService);

    async uploadRouteFile(
        fileBytes: ArrayBuffer,
        fileExtension: string,
        originalFilename?: string,
    ): Promise<UploadRouteResponse> {
        if (!this.auth.currentUser) {
            throw new Error('User must be authenticated to upload routes.');
        }

        const idToken = await this.auth.currentUser.getIdToken(true);
        const appCheckToken = await this.appCheckReadiness.getToken();

        const projectID = this.app.options.projectId;
        if (!projectID) {
            throw new Error('Firebase project ID is not configured.');
        }

        const normalizedExtension = fileExtension.trim().toLowerCase().replace(/^\./, '');
        if (!normalizedExtension) {
            throw new Error('Route file extension is required.');
        }

        const config = FUNCTIONS_MANIFEST.uploadRoute;
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
        });

        let payload: unknown = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const backendMessage = getRouteUploadBackendErrorMessage(payload);
            throw new Error(backendMessage || mapFallbackRouteUploadErrorMessage(response.status));
        }

        return payload as UploadRouteResponse;
    }

    async uploadFitRouteFile(fileBytes: ArrayBuffer, originalFilename?: string): Promise<UploadRouteResponse> {
        return this.uploadRouteFile(fileBytes, 'fit', originalFilename);
    }

    async uploadGPXRouteFile(fileBytes: ArrayBuffer, originalFilename?: string): Promise<UploadRouteResponse> {
        return this.uploadRouteFile(fileBytes, 'gpx', originalFilename);
    }

    private resolveUploadFunctionUrl(region: string, functionName: string, projectID: string): string {
        if (this.shouldUseFunctionsEmulator()) {
            return `http://${AppRouteUploadService.LOCAL_FUNCTIONS_EMULATOR_HOST}:${AppRouteUploadService.LOCAL_FUNCTIONS_EMULATOR_PORT}/${projectID}/${region}/${functionName}`;
        }

        return `https://${region}-${projectID}.cloudfunctions.net/${functionName}`;
    }

    private shouldUseFunctionsEmulator(): boolean {
        return environment.localhost === true && environment.useFunctionsEmulator === true;
    }
}
