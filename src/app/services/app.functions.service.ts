import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from 'app/firebase/app';
import { Functions, connectFunctionsEmulator, getFunctions, httpsCallable } from 'app/firebase/functions';
import type { Functions as FirebaseFunctions } from 'firebase/functions';
import { environment } from '../../environments/environment';
import { FunctionName, FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { AppCheckReadinessService } from './app-check-readiness.service';

@Injectable({
    providedIn: 'root'
})
export class AppFunctionsService {
    private app = inject(FirebaseApp);
    private appCheckReadiness = inject(AppCheckReadinessService);
    private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
    private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;
    private functionsByRegion = new Map<string, FirebaseFunctions>();
    /**
     * Map of pre-initialized callable functions.
     * We initialize these in the constructor to capture the current Injection Context.
     * Creating them at runtime (lazy-loading) would require wrapping every call in `runInInjectionContext`,
     * which is verbose and prone to errors. Pre-initialization is cleaner and more performant.
     */
    private callables = new Map<FunctionName, (data?: any) => Promise<any>>();

    constructor() {
        // Initialize all functions immediately to bind them to the current injection context.
        Object.entries(FUNCTIONS_MANIFEST).forEach(([key, config]) => {
            const functionsInstance = this.getOrCreateFunctionsForRegion(config.region);
            const callable = httpsCallable(functionsInstance, config.name);
            this.callables.set(key as FunctionName, callable);
        });
    }

    async call<RequestData = any, ResponseData = any>(
        functionKey: FunctionName,
        data?: RequestData
    ): Promise<{ data: ResponseData }> {
        const callable = this.callables.get(functionKey);
        if (!callable) {
            throw new Error(`Function ${functionKey} not initialized`);
        }

        await this.appCheckReadiness.ensureReady();

        try {
            return await callable(data);
        } catch (error) {
            if (!this.shouldRetryAfterAppCheckFailure(error)) {
                throw error;
            }

            await this.appCheckReadiness.ensureReady(true);
            return callable(data);
        }
    }

    private getOrCreateFunctionsForRegion(region: string): FirebaseFunctions {
        const existing = this.functionsByRegion.get(region);
        if (existing) {
            return existing;
        }

        const functions = getFunctions(this.app, region);
        if (this.shouldUseFunctionsEmulator()) {
            connectFunctionsEmulator(
                functions,
                AppFunctionsService.LOCAL_FUNCTIONS_EMULATOR_HOST,
                AppFunctionsService.LOCAL_FUNCTIONS_EMULATOR_PORT,
            );
        }

        this.functionsByRegion.set(region, functions);
        return functions;
    }

    private shouldUseFunctionsEmulator(): boolean {
        return environment.localhost === true && environment.useFunctionsEmulator === true;
    }

    private shouldRetryAfterAppCheckFailure(error: unknown): boolean {
        if (!this.appCheckReadiness.isConfigured()) {
            return false;
        }

        const code = (error as { code?: unknown } | null)?.code;
        const message = (error as { message?: unknown } | null)?.message;

        const normalizedCode = typeof code === 'string' ? code : '';
        const normalizedMessage = typeof message === 'string' ? message : '';

        const isFailedPrecondition = normalizedCode === 'functions/failed-precondition'
            || normalizedCode === 'failed-precondition';

        return isFailedPrecondition && /app check verification failed/i.test(normalizedMessage);
    }
}
