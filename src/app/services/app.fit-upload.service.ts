import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { AppCheck, getToken as getAppCheckToken } from '@angular/fire/app-check';
import { Auth } from '@angular/fire/auth';
import { FUNCTIONS_MANIFEST } from '../../shared/functions-manifest';

export interface UploadActivityFromFitResponse {
    eventId: string;
    activitiesCount: number;
    uploadLimit: number | null;
    uploadCountAfterWrite: number | null;
}

@Injectable({
    providedIn: 'root'
})
export class AppFitUploadService {
    private app = inject(FirebaseApp);
    private auth = inject(Auth);
    private appCheck = inject(AppCheck, { optional: true });

    async uploadActivityFile(
        fileBytes: ArrayBuffer,
        fileExtension: string,
        originalFilename?: string,
    ): Promise<UploadActivityFromFitResponse> {
        if (!this.auth.currentUser) {
            throw new Error('User must be authenticated to upload activities.');
        }

        if (!this.appCheck) {
            throw new Error('App Check is not configured for this app.');
        }

        const idToken = await this.auth.currentUser.getIdToken(true);
        const appCheckResult = await getAppCheckToken(this.appCheck, false);
        const appCheckToken = appCheckResult?.token;
        if (!appCheckToken) {
            throw new Error('Could not retrieve App Check token.');
        }

        const projectID = this.app.options.projectId;
        if (!projectID) {
            throw new Error('Firebase project ID is not configured.');
        }

        const normalizedExtension = fileExtension.trim().toLowerCase();
        if (!normalizedExtension) {
            throw new Error('File extension is required.');
        }

        const config = FUNCTIONS_MANIFEST.uploadActivity;
        const functionURL = `https://${config.region}-${projectID}.cloudfunctions.net/${config.name}`;

        const headers = new Headers({
            'Authorization': `Bearer ${idToken}`,
            'X-Firebase-AppCheck': appCheckToken,
            'X-File-Extension': normalizedExtension,
            'Content-Type': 'application/octet-stream',
        });

        if (originalFilename && originalFilename.trim().length > 0) {
            headers.set('X-Original-Filename', originalFilename.trim());
        }

        const response = await fetch(functionURL, {
            method: 'POST',
            headers,
            body: fileBytes,
        });

        let payload: any = null;
        try {
            payload = await response.json();
        } catch (_error) {
            payload = null;
        }

        if (!response.ok) {
            const backendMessage = payload?.error ? `${payload.error}` : '';
            const statusMessage = `Upload failed (${response.status}).`;
            throw new Error(backendMessage || statusMessage);
        }

        return payload as UploadActivityFromFitResponse;
    }

    async uploadFitFile(fileBytes: ArrayBuffer, originalFilename?: string): Promise<UploadActivityFromFitResponse> {
        return this.uploadActivityFile(fileBytes, 'fit', originalFilename);
    }
}
