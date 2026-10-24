import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'app/firebase/functions';
import type { Functions as FirebaseFunctions } from 'firebase/functions';
import { environment } from '../../environments/environment';
import { FunctionName, FUNCTIONS_MANIFEST } from '@shared/functions-manifest';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { LoggerService } from './logger.service';
import { AppCheckDiagnosticsService } from './app-check-diagnostics.service';
import type { AppCheckOperationAttempt } from './app-check-diagnostics.service';

type CallableFailureStage = 'app_check_readiness' | 'callable' | 'app_check_refresh' | 'callable_retry';

// Only SDK-defined codes may enter diagnostics; arbitrary error fields can contain private data.
const CALLABLE_DIAGNOSTIC_CODES = new Set([
    ...['cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found', 'already-exists',
        'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
        'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated']
        .flatMap(code => [code, `functions/${code}`]),
    ...['already-initialized', 'use-before-activation', 'fetch-network-error', 'fetch-parse-error',
        'fetch-status-error', 'storage-open', 'storage-get', 'storage-set', 'recaptcha-error',
        'initial-throttle', 'throttled'].map(code => `appCheck/${code}`),
]);

@Injectable({
    providedIn: 'root'
})
export class AppFunctionsService {
    private app = inject(FirebaseApp);
    private readonly auth = inject(Auth);
    private appCheckReadiness = inject(AppCheckReadinessService);
    private logger = inject(LoggerService);
    private readonly appCheckDiagnostics = inject(AppCheckDiagnosticsService);
    private static readonly LOCAL_FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
    private static readonly LOCAL_FUNCTIONS_EMULATOR_PORT = 5001;
    private functionsByRegion = new Map<string, FirebaseFunctions>();
    private readonly reportedEnsureFailures = new Map<string, number>();
    private static readonly FAILURE_REPORT_COOLDOWN_MS = 5 * 60 * 1000;
    private static readonly MAX_FAILURE_REPORT_KEYS = 64;
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
            const callable = 'clientTimeoutMs' in config
                ? httpsCallable(functionsInstance, config.name, { timeout: config.clientTimeoutMs })
                : httpsCallable(functionsInstance, config.name);
            this.callables.set(key as FunctionName, callable);
        });
    }

    async call<RequestData = any, ResponseData = any>(
        functionKey: FunctionName,
        data?: RequestData,
        options?: { canExecute: () => boolean },
    ): Promise<{ data: ResponseData }> {
        const callable = this.callables.get(functionKey);
        if (!callable) {
            throw new Error(`Function ${functionKey} not initialized`);
        }
        // A local cancellation check, never serialized or used as server authorization.
        let cancelled = false;
        const refreshOwner = functionKey === 'ensureDerivedMetrics' ? this.auth.currentUser : null;
        const assertCurrent = () => {
            if ((refreshOwner && this.auth.currentUser !== refreshOwner) || (options && !options.canExecute())) {
                cancelled = true;
                throw new Error('Operation cancelled because its account or view changed.');
            }
        };
        assertCurrent();

        // Only the idempotent freshness check may be replayed after a lost response.
        // Keep one retry budget across transport recovery and the existing App Check retry.
        let transientRetries = 0;
        const invoke = async () => {
            while (true) {
                assertCurrent();
                try {
                    return await callable(data);
                } catch (error) {
                    const code = (error as { code?: unknown } | null)?.code;
                    if (!refreshOwner || transientRetries >= 2 || typeof code !== 'string'
                        || !['internal', 'unavailable', 'deadline-exceeded',
                            'functions/internal', 'functions/unavailable', 'functions/deadline-exceeded'].includes(code)) {
                        throw error;
                    }
                    assertCurrent();
                    await this.waitForDerivedMetricsRetry(transientRetries++);
                }
            }
        };

        let diagnosticAttempt: AppCheckOperationAttempt | undefined;
        try { diagnosticAttempt = this.appCheckDiagnostics.beginOperation(); } catch { /* Diagnostics must not gate requests. */ }

        const usesFunctionsEmulator = this.shouldUseFunctionsEmulator();
        const reportFailure = functionKey === 'ensureDerivedMetrics' && environment.localhost !== true;
        // Retain only the existing Sentry identity, captured before asynchronous work.
        // Reports are discarded if that identity changes while the request is pending.
        let diagnosticUser: ReturnType<LoggerService['getUser']> = {};
        if (reportFailure) {
            try { diagnosticUser = this.logger.getUser(); } catch { /* Diagnostics must not gate requests. */ }
        }
        let stage: CallableFailureStage = 'app_check_readiness';
        try {
            // The local worker bypasses App Check; never gate it on a hosted token exchange.
            if (!usesFunctionsEmulator) {
                await this.appCheckReadiness.ensureReady();
            }

            try {
                assertCurrent();
                stage = 'callable';
                const response = await invoke();
                this.trackAppCheckOutcome('succeeded', diagnosticAttempt, functionKey, undefined, options);
                return response;
            } catch (error) {
                if (usesFunctionsEmulator || !this.shouldRetryAfterAppCheckFailure(error)) {
                    throw error;
                }

                stage = 'app_check_refresh';
                await this.appCheckReadiness.ensureReady(true);
                assertCurrent();
                stage = 'callable_retry';
                const response = await invoke();
                this.trackAppCheckOutcome('succeeded', diagnosticAttempt, functionKey, undefined, options);
                return response;
            }
        } catch (error) {
            if (!cancelled) this.trackAppCheckOutcome('blocked', diagnosticAttempt, functionKey, error, options);
            if (reportFailure && !cancelled) this.reportEnsureFailure(error, stage, diagnosticUser);
            throw error;
        }
    }

    private waitForDerivedMetricsRetry(attempt: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }

    private trackAppCheckOutcome(
        outcome: 'blocked' | 'succeeded', attempt: AppCheckOperationAttempt | undefined, functionKey: FunctionName,
        error?: unknown, options?: { canExecute: () => boolean },
    ): void {
        try {
            if (!attempt) return;
            if (options && !options.canExecute()) return;
            if (outcome === 'blocked') this.appCheckDiagnostics.reportOperationBlocked(error, 'callable', attempt, functionKey);
            else this.appCheckDiagnostics.reportOperationSucceeded('callable', attempt, functionKey);
        } catch { /* Preserve the callable result, original rejection and retry budget. */ }
    }

    private reportEnsureFailure(
        error: unknown,
        stage: CallableFailureStage,
        user: ReturnType<LoggerService['getUser']>,
    ): void {
        try {
            // Firebase may acquire auth credentials asynchronously. After an account
            // switch, neither the old nor the new identity is reliable for this failure.
            if (this.logger.getUser().id !== user.id) return;
            const code = (error as { code?: unknown } | null)?.code;
            const errorCode = typeof code === 'string' && CALLABLE_DIAGNOSTIC_CODES.has(code) ? code : 'unknown';
            const now = Date.now();
            for (const [key, reportedAt] of this.reportedEnsureFailures) {
                if (now - reportedAt >= AppFunctionsService.FAILURE_REPORT_COOLDOWN_MS) {
                    this.reportedEnsureFailures.delete(key);
                }
            }
            // Independent of metric subsets: Dashboard and Training share this failure budget.
            // Identity is used only locally for deduplication, never in tags or fingerprints.
            const key = JSON.stringify([user.id ?? null, stage, errorCode]);
            if (this.reportedEnsureFailures.has(key)) return;
            if (this.reportedEnsureFailures.size >= AppFunctionsService.MAX_FAILURE_REPORT_KEYS) {
                this.reportedEnsureFailures.delete(this.reportedEnsureFailures.keys().next().value!);
            }
            this.reportedEnsureFailures.set(key, now);
            this.logger.captureMessage('ensureDerivedMetrics request failed', {
                level: 'warning',
                user,
                fingerprint: ['ensureDerivedMetrics', stage, errorCode],
                tags: { operation: 'ensureDerivedMetrics', stage, errorCode },
                contexts: {
                    callable: {
                        appCheckConfigured: this.appCheckReadiness.isConfigured(),
                        recoveryAttempted: stage === 'app_check_refresh' || stage === 'callable_retry',
                    },
                },
            });
        } catch {
            // Keep the original failure and the caller's fallback UI even if Sentry fails.
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
                environment.firebase?.projectId === 'demo-stripe-billing' ? 5101 : AppFunctionsService.LOCAL_FUNCTIONS_EMULATOR_PORT,
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
