import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { Functions, getFunctions, httpsCallable, httpsCallableFromURL } from '@angular/fire/functions';
import { environment } from '../../environments/environment';
import { FunctionName, FUNCTIONS_MANIFEST } from '@shared/functions-manifest';

@Injectable({
    providedIn: 'root'
})
export class AppFunctionsService {
    private app = inject(FirebaseApp);
    private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
    private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;
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
            const functionsInstance = getFunctions(this.app, config.region);
            const callable = this.shouldUseLocalAiInsightsEmulator(key as FunctionName)
                ? httpsCallableFromURL(
                    functionsInstance,
                    this.buildLocalCallableUrl(config.region, config.name),
                )
                : httpsCallable(functionsInstance, config.name);
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
        return callable(data);
    }

    private shouldUseLocalAiInsightsEmulator(functionKey: FunctionName): boolean {
        return environment.localhost === true
            && (functionKey === 'aiInsights' || functionKey === 'getAiInsightsQuotaStatus');
    }

    private buildLocalCallableUrl(region: string, functionName: string): string {
        return `http://${AppFunctionsService.LOCAL_FUNCTIONS_EMULATOR_HOST}:${AppFunctionsService.LOCAL_FUNCTIONS_EMULATOR_PORT}/${environment.firebase.projectId}/${region}/${functionName}`;
    }
}
