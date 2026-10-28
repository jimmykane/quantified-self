import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFunctionsService } from './app.functions.service';
import { Functions, connectFunctionsEmulator, getFunctions, httpsCallable } from 'app/firebase/functions';
import { FirebaseApp } from 'app/firebase/app';
import { Auth } from 'app/firebase/auth';
import { AppCheckReadinessService } from './app-check-readiness.service';
import { LoggerService } from './logger.service';
import { AppCheckDiagnosticsService } from './app-check-diagnostics.service';

const mocks = vi.hoisted(() => {
    const callableSpy = vi.fn().mockResolvedValue({ data: 'success' });
    const httpsCallableMock = vi.fn(() => callableSpy);
    const connectFunctionsEmulatorMock = vi.fn();
    const getFunctionsMock = vi.fn((_app: any, region: string) => ({ region }));
    const ensureReadyMock = vi.fn().mockResolvedValue(undefined);
    const isConfiguredMock = vi.fn().mockReturnValue(true);
    let localhost = false;
    let useFunctionsEmulator = false;
    return {
        callableSpy,
        httpsCallableMock,
        connectFunctionsEmulatorMock,
        getFunctionsMock,
        ensureReadyMock,
        isConfiguredMock,
        getLocalhost: () => localhost,
        getUseFunctionsEmulator: () => useFunctionsEmulator,
        setLocalhost: (value: boolean) => {
            localhost = value;
        },
        setUseFunctionsEmulator: (value: boolean) => {
            useFunctionsEmulator = value;
        },
    };
});

// Mock getFunctions/connectFunctionsEmulator/httpsCallable
vi.mock('app/firebase/functions', () => ({
    Functions: class { },
    getFunctions: mocks.getFunctionsMock,
    connectFunctionsEmulator: mocks.connectFunctionsEmulatorMock,
    httpsCallable: mocks.httpsCallableMock,
}));

vi.mock('../../environments/environment', () => ({
    environment: {
        get localhost() {
            return mocks.getLocalhost();
        },
        get useFunctionsEmulator() {
            return mocks.getUseFunctionsEmulator();
        },
    },
}));

// Mock the manifest
vi.mock('@shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        'getAssistantQuotaStatus': { name: 'getAssistantQuotaStatus', region: 'europe-west2' },
        'assistantChat': {
            name: 'assistantChat',
            region: 'europe-west2',
            clientTimeoutMs: 190_000,
        },
        'getAssistantConversation': {
            name: 'getAssistantConversation',
            region: 'europe-west2',
        },
        'resetAssistantConversation': {
            name: 'resetAssistantConversation',
            region: 'europe-west2',
        },
        'defaultRegionFunc': {
            name: 'func1',
            region: 'europe-west2',
            clientTimeoutMs: 3_660_000,
        },
        'otherRegionFunc': { name: 'func2', region: 'europe-west3' },
        'ensureDerivedMetrics': { name: 'ensureDerivedMetrics', region: 'europe-west2' },
    }
}));

describe('AppFunctionsService', () => {
    let service: AppFunctionsService;
    let mockApp: any;
    let auth: { currentUser: { uid: string } | null };
    let appCheckReadinessMock: Pick<AppCheckReadinessService, 'ensureReady' | 'isConfigured'>;
    let loggerMock: { getUser: ReturnType<typeof vi.fn>; captureMessage: ReturnType<typeof vi.fn> };
    let diagnostics: { authRevision: number; beginOperation: ReturnType<typeof vi.fn>; reportOperationBlocked: ReturnType<typeof vi.fn>;
        reportOperationSucceeded: ReturnType<typeof vi.fn> };

    function configureTestingModule(useRealDiagnostics = false): AppFunctionsService {
        const providers: any[] = [
            AppFunctionsService,
            { provide: Functions, useValue: { region: 'europe-west2-instance' } },
            { provide: FirebaseApp, useValue: mockApp },
            { provide: Auth, useValue: auth },
            { provide: AppCheckReadinessService, useValue: appCheckReadinessMock },
            { provide: LoggerService, useValue: loggerMock },
            useRealDiagnostics ? AppCheckDiagnosticsService : { provide: AppCheckDiagnosticsService, useValue: diagnostics },
        ];

        TestBed.configureTestingModule({
            providers
        });
        return TestBed.inject(AppFunctionsService);
    }

    beforeEach(() => {
        mocks.getFunctionsMock.mockClear();
        mocks.connectFunctionsEmulatorMock.mockClear();
        mocks.httpsCallableMock.mockClear();
        mocks.callableSpy.mockReset().mockResolvedValue({ data: 'success' });
        mocks.ensureReadyMock.mockReset();
        mocks.ensureReadyMock.mockResolvedValue(undefined);
        mocks.isConfiguredMock.mockClear();
        mocks.isConfiguredMock.mockReturnValue(true);
        mocks.setLocalhost(false);
        mocks.setUseFunctionsEmulator(false);

        mockApp = { name: '[DEFAULT]' };
        auth = { currentUser: { uid: 'account-a' } };
        appCheckReadinessMock = {
            ensureReady: mocks.ensureReadyMock,
            isConfigured: mocks.isConfiguredMock,
        };
        loggerMock = {
            getUser: vi.fn().mockReturnValue({ id: 'account-a' }),
            captureMessage: vi.fn(),
        };
        let sequence = 0;
        diagnostics = { authRevision: 1, beginOperation: vi.fn(() => ({ authRevision: diagnostics.authRevision, sequence: ++sequence })),
            reportOperationBlocked: vi.fn(), reportOperationSucceeded: vi.fn() };

        service = configureTestingModule();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    describe('metrics refresh transport recovery', () => {
        beforeEach(() => vi.useFakeTimers());

        it.each(['internal', 'unavailable', 'deadline-exceeded', 'functions/internal',
            'functions/unavailable', 'functions/deadline-exceeded'])('recovers a transient %s without reporting a failure', async code => {
            const request = { metricKinds: ['form'] };
            mocks.callableSpy.mockRejectedValueOnce({ code });
            const result = service.call('ensureDerivedMetrics', request);
            await vi.advanceTimersByTimeAsync(999);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await expect(result).resolves.toEqual({ data: 'success' });
            expect(mocks.callableSpy.mock.calls).toEqual([[request], [request]]);
            expect(mocks.ensureReadyMock).toHaveBeenCalledTimes(1);
            expect(diagnostics.reportOperationBlocked).not.toHaveBeenCalled();
            expect(diagnostics.reportOperationSucceeded).toHaveBeenCalledTimes(1);
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it('backs off twice, then exposes and reports the final original failure', async () => {
            const failure = { code: 'functions/internal', message: 'private-details' };
            mocks.callableSpy.mockRejectedValue(failure);
            const result = expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            await vi.advanceTimersByTimeAsync(1000);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1999);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            await result;
            expect(mocks.callableSpy).toHaveBeenCalledTimes(3);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(1);
            expect(diagnostics.reportOperationBlocked).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each(['functions/unauthenticated', 'functions/permission-denied', 'functions/invalid-argument',
            'functions/resource-exhausted', 'functions/failed-precondition'])('does not replay a permanent %s', async code => {
            const failure = { code };
            mocks.callableSpy.mockRejectedValue(failure);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('keeps one transport retry budget across App Check recovery', async () => {
            const failure = { code: 'functions/internal' };
            mocks.callableSpy.mockRejectedValueOnce(failure)
                .mockRejectedValueOnce({ code: 'functions/failed-precondition', message: 'App Check verification failed.' })
                .mockRejectedValue(failure);
            const result = expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            await vi.runAllTimersAsync();
            await result;
            expect(mocks.callableSpy).toHaveBeenCalledTimes(4);
            expect(mocks.ensureReadyMock.mock.calls).toEqual([[], [true]]);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(1);
        });

        it.each(['sign-out', 'account switch', 'caller cancellation'])('stops before a delayed retry after %s', async change => {
            mocks.callableSpy.mockRejectedValueOnce({ code: 'functions/internal' });
            let current = true;
            const result = expect(service.call('ensureDerivedMetrics', undefined, { canExecute: () => current }))
                .rejects.toThrow('Operation cancelled');
            await vi.advanceTimersByTimeAsync(0);
            if (change === 'sign-out') auth.currentUser = null;
            else if (change === 'account switch') auth.currentUser = { uid: 'account-b' };
            else current = false;
            await vi.runAllTimersAsync();
            await result;
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
            expect(diagnostics.reportOperationBlocked).not.toHaveBeenCalled();
        });

        it('does not retry without an authenticated starting owner', async () => {
            auth.currentUser = null;
            mocks.callableSpy.mockRejectedValue({ code: 'functions/internal' });
            await expect(service.call('ensureDerivedMetrics')).rejects.toMatchObject({ code: 'functions/internal' });
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
        });

        it('preserves an unclassified failure without coercing its error code', async () => {
            const failure = { code: { toString: () => { throw new Error('must not coerce'); } } };
            mocks.callableSpy.mockRejectedValue(failure);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each(['defaultRegionFunc', 'resetAssistantConversation'])('does not replay another action: %s', async key => {
            const failure = { code: 'functions/internal' };
            mocks.callableSpy.mockRejectedValue(failure);
            await expect(service.call(key as never)).rejects.toBe(failure);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('cancels an old metrics request when the account changes during App Check readiness', async () => {
            mocks.ensureReadyMock.mockImplementationOnce(async () => { auth.currentUser = { uid: 'account-b' }; });
            await expect(service.call('ensureDerivedMetrics')).rejects.toThrow('Operation cancelled');
            expect(mocks.callableSpy).not.toHaveBeenCalled();
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it('does not continue an old request after signing back into the same account', async () => {
            mocks.callableSpy.mockRejectedValueOnce({ code: 'functions/internal' });
            const result = expect(service.call('ensureDerivedMetrics')).rejects.toThrow('Operation cancelled');
            await vi.advanceTimersByTimeAsync(0);
            auth.currentUser = { uid: 'account-a' };
            await vi.runAllTimersAsync();
            await result;
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });
    });

    it('should initialize all functions from manifest in constructor and reuse region instances', () => {
        // Service is created in beforeEach
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west3');
        expect(getFunctions).toHaveBeenCalledTimes(2);
        expect(mocks.httpsCallableMock).toHaveBeenCalledTimes(7);
        expect(httpsCallable).toHaveBeenCalledWith(
            expect.anything(),
            'func1',
            { timeout: 3_660_000 },
        );
        expect(connectFunctionsEmulator).not.toHaveBeenCalled();
    });

    it('should keep the production merge callable deadline beyond the server runtime budget', async () => {
        const actualManifest = await vi.importActual<typeof import('@shared/functions-manifest')>(
            '@shared/functions-manifest',
        );

        expect(actualManifest.FUNCTIONS_MANIFEST.mergeEvents.clientTimeoutMs)
            .toBe(actualManifest.MERGE_EVENTS_CLIENT_TIMEOUT_MS);
        expect(actualManifest.MERGE_EVENTS_CLIENT_TIMEOUT_MS).toBeGreaterThan(60 * 60 * 1000);
    });

    it('should keep the Assistant client deadline beyond its server runtime budget', async () => {
        const actualManifest = await vi.importActual<typeof import('@shared/functions-manifest')>(
            '@shared/functions-manifest',
        );

        expect(actualManifest.FUNCTIONS_MANIFEST.assistantChat.clientTimeoutMs)
            .toBeGreaterThan(180_000);
    });

    it('should keep the COROS history client deadline beyond its server runtime budget', async () => {
        const actualManifest = await vi.importActual<typeof import('@shared/functions-manifest')>(
            '@shared/functions-manifest',
        );

        expect(actualManifest.FUNCTIONS_MANIFEST.addCOROSAPIHistoryToQueue.clientTimeoutMs)
            .toBe(actualManifest.COROS_HISTORY_IMPORT_CLIENT_TIMEOUT_MS);
        expect(actualManifest.COROS_HISTORY_IMPORT_CLIENT_TIMEOUT_MS).toBeGreaterThan(300_000);
    });

    it('should call the pre-initialized callable', async () => {
        // Call the service method
        await service.call('defaultRegionFunc' as any);

        // Check our stable spy
        expect(mocks.ensureReadyMock).toHaveBeenCalledWith();
        expect(mocks.callableSpy).toHaveBeenCalled();
    });

    it('observes final readiness failures without dispatching or adding retries', async () => {
        const failure = { code: 'appCheck/recaptcha-error' };
        mocks.ensureReadyMock.mockRejectedValueOnce(failure);
        await expect(service.call('defaultRegionFunc' as never)).rejects.toBe(failure);
        expect(diagnostics.reportOperationBlocked).toHaveBeenCalledExactlyOnceWith(failure, 'callable', { authRevision: 1, sequence: 1 }, 'defaultRegionFunc');
        expect(mocks.ensureReadyMock).toHaveBeenCalledTimes(1);
        expect(mocks.callableSpy).not.toHaveBeenCalled();
    });

    it('records a successful existing retry and never marks the recovered operation as blocked', async () => {
        mocks.callableSpy.mockRejectedValueOnce({ code: 'functions/failed-precondition', message: 'App Check verification failed.' });
        await expect(service.call('defaultRegionFunc' as never)).resolves.toEqual({ data: 'success' });
        expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
        expect(mocks.ensureReadyMock.mock.calls).toEqual([[], [true]]);
        expect(diagnostics.reportOperationBlocked).not.toHaveBeenCalled();
        expect(diagnostics.reportOperationSucceeded).toHaveBeenCalledExactlyOnceWith('callable', { authRevision: 1, sequence: 1 }, 'defaultRegionFunc');
    });

    it('never lets outcome telemetry replace a result or an original rejection', async () => {
        diagnostics.reportOperationSucceeded.mockImplementation(() => { throw new Error('telemetry failed'); });
        await expect(service.call('defaultRegionFunc' as never)).resolves.toEqual({ data: 'success' });
        const failure = { code: 'appCheck/recaptcha-error' };
        mocks.ensureReadyMock.mockRejectedValueOnce(failure);
        diagnostics.reportOperationBlocked.mockImplementation(() => { throw new Error('telemetry failed'); });
        await expect(service.call('defaultRegionFunc' as never)).rejects.toBe(failure);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
    });

    it('preserves callable results and rejections when starting diagnostics fails', async () => {
        diagnostics.beginOperation.mockImplementation(() => { throw new Error('telemetry failed'); });
        await expect(service.call('defaultRegionFunc' as never)).resolves.toEqual({ data: 'success' });
        const failure = { code: 'appCheck/recaptcha-error' };
        mocks.ensureReadyMock.mockRejectedValueOnce(failure);
        await expect(service.call('defaultRegionFunc' as never)).rejects.toBe(failure);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
        expect(mocks.ensureReadyMock.mock.calls).toEqual([[], []]);
        expect(diagnostics.reportOperationBlocked).not.toHaveBeenCalled();
        expect(diagnostics.reportOperationSucceeded).not.toHaveBeenCalled();
    });

    it('keeps the starting Auth generation for asynchronous operation outcomes', async () => {
        mocks.callableSpy.mockImplementationOnce(async () => {
            diagnostics.authRevision = 2;
            return { data: 'success' };
        });
        await service.call('defaultRegionFunc' as never);
        expect(diagnostics.reportOperationSucceeded).toHaveBeenCalledExactlyOnceWith('callable', { authRevision: 1, sequence: 1 }, 'defaultRegionFunc');
    });

    it('does not let an older in-flight callable clear a newer App Check failure', async () => {
        TestBed.resetTestingModule();
        service = configureTestingModule(true);
        let finishOlder!: (response: { data: string }) => void;
        mocks.callableSpy.mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }));
        const older = service.call('defaultRegionFunc' as never);
        await vi.waitFor(() => expect(mocks.callableSpy).toHaveBeenCalledTimes(1));

        const failure = { code: 'appCheck/recaptcha-error' };
        mocks.ensureReadyMock.mockRejectedValueOnce(failure);
        await expect(service.call('defaultRegionFunc' as never)).rejects.toBe(failure);
        const outcomes = () => loggerMock.captureMessage.mock.calls
            .filter(call => call[0] === 'App Check verification outcome')
            .map(call => call[1].contexts.appCheck.outcome);
        expect(outcomes()).toEqual(['operation-blocked']);

        finishOlder({ data: 'older' });
        await expect(older).resolves.toEqual({ data: 'older' });
        expect(outcomes()).toEqual(['operation-blocked']);

        await expect(service.call('defaultRegionFunc' as never)).resolves.toEqual({ data: 'success' });
        expect(outcomes()).toEqual(['operation-blocked', 'operation-succeeded']);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
        expect(mocks.ensureReadyMock.mock.calls).toEqual([[], [], []]);
    });

    it('does not report a failure after the caller becomes stale while awaiting a response', async () => {
        let current = true;
        mocks.callableSpy.mockImplementationOnce(async () => { current = false; throw { code: 'appCheck/recaptcha-error' }; });
        await expect(service.call('defaultRegionFunc' as never, undefined, { canExecute: () => current })).rejects.toMatchObject({ code: 'appCheck/recaptcha-error' });
        expect(diagnostics.reportOperationBlocked).not.toHaveBeenCalled();
    });

    it('contains exceptions from the outcome-only cancellation check without changing a successful response', async () => {
        let responseReturned = false;
        mocks.callableSpy.mockImplementationOnce(async () => { responseReturned = true; return { data: 'success' }; });
        const canExecute = () => { if (responseReturned) throw new Error('view destroyed'); return true; };
        await expect(service.call('defaultRegionFunc' as never, undefined, { canExecute })).resolves.toEqual({ data: 'success' });
        expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
        expect(diagnostics.reportOperationSucceeded).not.toHaveBeenCalled();
    });

    it('should wait for App Check readiness only once across successful calls', async () => {
        await service.call('defaultRegionFunc' as any);
        await service.call('defaultRegionFunc' as any);

        expect(mocks.ensureReadyMock).toHaveBeenCalledTimes(2);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
    });

    it('should not issue the callable when App Check readiness fails', async () => {
        mocks.ensureReadyMock.mockRejectedValueOnce({ message: 'App Check bootstrap failed' });

        await expect(service.call('defaultRegionFunc' as any)).rejects.toMatchObject({ message: 'App Check bootstrap failed' });
        expect(mocks.callableSpy).not.toHaveBeenCalled();
    });

    it('does not dispatch a cancelled operation, including on the emulator', async () => {
        mocks.setLocalhost(true); mocks.setUseFunctionsEmulator(true);
        await expect(service.call('defaultRegionFunc' as any, undefined, { canExecute: () => false }))
            .rejects.toThrow('Operation cancelled');
        expect(mocks.callableSpy).not.toHaveBeenCalled();
        expect(mocks.ensureReadyMock).not.toHaveBeenCalled();
    });

    it.each([false, true])('rechecks local cancellation after App Check (retry: %s)', async retry => {
        let current = true;
        if (retry) mocks.callableSpy.mockRejectedValueOnce({
            code: 'functions/failed-precondition', message: 'App Check verification failed.',
        });
        mocks.ensureReadyMock.mockImplementation(async (refresh?: boolean) => {
            if (!retry || refresh) current = false;
        });
        await expect(service.call('defaultRegionFunc' as any, { value: 1 }, { canExecute: () => current }))
            .rejects.toThrow('Operation cancelled');
        expect(mocks.callableSpy).toHaveBeenCalledTimes(retry ? 1 : 0);
        if (retry) expect(mocks.callableSpy).toHaveBeenCalledWith({ value: 1 });
    });

    it('does not gate an emulated callable on hosted App Check readiness', async () => {
        TestBed.resetTestingModule();
        mocks.setLocalhost(true);
        mocks.setUseFunctionsEmulator(true);
        mocks.ensureReadyMock.mockImplementation(() => {
            throw new Error('App Check debug token exchange failed');
        });

        const localService = configureTestingModule();

        try {
            await expect(localService.call('defaultRegionFunc' as any)).resolves.toEqual({ data: 'success' });
            expect(mocks.ensureReadyMock).not.toHaveBeenCalled();
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
        } finally {
            mocks.ensureReadyMock.mockReset();
            mocks.ensureReadyMock.mockResolvedValue(undefined);
        }
    });

    it('should retry once after an App Check verification failure', async () => {
        mocks.callableSpy
            .mockRejectedValueOnce({
                code: 'functions/failed-precondition',
                message: 'App Check verification failed.'
            })
            .mockResolvedValueOnce({ data: 'retried-success' });

        await expect(service.call('defaultRegionFunc' as any)).resolves.toEqual({ data: 'retried-success' });

        expect(mocks.ensureReadyMock).toHaveBeenNthCalledWith(1);
        expect(mocks.ensureReadyMock).toHaveBeenNthCalledWith(2, true);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
    });

    it.each(['functions/internal', 'functions/already-exists'])('should not retry non App Check callable failures (%s)', async code => {
        mocks.callableSpy.mockRejectedValueOnce({
            code,
            message: 'Unexpected failure'
        });

        await expect(service.call('defaultRegionFunc' as any)).rejects.toMatchObject({
            code,
            message: 'Unexpected failure'
        });

        expect(mocks.ensureReadyMock).toHaveBeenCalledTimes(1);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip App Check coordination when the provider is unavailable', async () => {
        mocks.isConfiguredMock.mockReturnValue(false);

        await service.call('defaultRegionFunc' as any);

        expect(mocks.ensureReadyMock).toHaveBeenCalledTimes(1);
        expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
    });

    describe('derived-metric failure diagnostics', () => {
        // Backoff timing and cancellation are exercised above; keep this suite focused on redaction/budgets.
        beforeEach(() => vi.spyOn(service as unknown as { waitForDerivedMetricsRetry(attempt: number): Promise<void> },
            'waitForDerivedMetricsRetry').mockResolvedValue(undefined));
        const appCheckRejection = {
            code: 'functions/failed-precondition',
            message: 'App Check verification failed. private-details',
            details: { token: 'private-token' },
        };

        it('reports only the final failed retry without serializing the request or raw error', async () => {
            mocks.callableSpy.mockRejectedValue(appCheckRejection);

            await expect(service.call('ensureDerivedMetrics', { privateRequest: 'activity-data' }))
                .rejects.toBe(appCheckRejection);

            expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
            expect(mocks.ensureReadyMock.mock.calls).toEqual([[], [true]]);
            expect(loggerMock.captureMessage).toHaveBeenCalledExactlyOnceWith('ensureDerivedMetrics request failed', {
                level: 'warning',
                user: { id: 'account-a' },
                fingerprint: ['ensureDerivedMetrics', 'callable_retry', 'functions/failed-precondition'],
                tags: { operation: 'ensureDerivedMetrics', stage: 'callable_retry', errorCode: 'functions/failed-precondition' },
                contexts: { callable: { appCheckConfigured: true, recoveryAttempted: true } },
            });
        });

        it.each([false, true])('does not report a successful request (recovery: %s)', async recovery => {
            if (recovery) mocks.callableSpy.mockRejectedValueOnce(appCheckRejection);
            await expect(service.call('ensureDerivedMetrics')).resolves.toEqual({ data: 'success' });
            expect(mocks.callableSpy).toHaveBeenCalledTimes(recovery ? 2 : 1);
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it.each([false, true])('identifies token acquisition failures (forced refresh: %s)', async refresh => {
            const failure = { code: 'appCheck/recaptcha-error', message: 'private-provider-message' };
            if (refresh) {
                mocks.callableSpy.mockRejectedValueOnce(appCheckRejection);
                mocks.ensureReadyMock.mockResolvedValueOnce(undefined);
            }
            mocks.ensureReadyMock.mockRejectedValueOnce(failure);

            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(refresh ? 1 : 0);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(1);
            expect(loggerMock.captureMessage.mock.calls[0][1]).toMatchObject({
                tags: { stage: refresh ? 'app_check_refresh' : 'app_check_readiness', errorCode: 'appCheck/recaptcha-error' },
                contexts: { callable: { recoveryAttempted: refresh } },
            });
        });

        it.each([
            new Error('private-timeout-message'),
            { code: 'functions/private-error-with-token', details: 'private-details' },
            'private-failure',
            null,
        ])('redacts unknown errors and preserves the rejection value', async failure => {
            mocks.callableSpy.mockRejectedValue(failure);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(loggerMock.captureMessage.mock.calls[0][1].tags).toEqual({
                operation: 'ensureDerivedMetrics', stage: 'callable', errorCode: 'unknown',
            });
            expect(JSON.stringify(loggerMock.captureMessage.mock.calls)).not.toContain('private');
        });

        it('records when App Check is unavailable without adding a retry', async () => {
            mocks.isConfiguredMock.mockReturnValue(false);
            mocks.callableSpy.mockRejectedValue(appCheckRejection);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(appCheckRejection);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(1);
            expect(loggerMock.captureMessage.mock.calls[0][1]).toMatchObject({
                tags: { stage: 'callable' },
                contexts: { callable: { appCheckConfigured: false, recoveryAttempted: false } },
            });
        });

        it('deduplicates concurrent scopes, keeps the cooldown across successes and expires after five minutes', async () => {
            const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
            const failure = { code: 'functions/unavailable' };
            mocks.callableSpy.mockRejectedValue(failure);
            await Promise.allSettled([
                service.call('ensureDerivedMetrics', { metricKinds: ['form'] }),
                service.call('ensureDerivedMetrics', { metricKinds: ['trainingSummary'] }),
            ]);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(1);
            mocks.callableSpy.mockResolvedValueOnce({ data: 'success' });
            await service.call('ensureDerivedMetrics');
            clock.mockReturnValue(1_299_999);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(1);
            clock.mockReturnValue(1_300_000);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(failure);
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(2);
        });

        it('keeps different error categories and accounts reportable', async () => {
            for (const [id, code] of [['account-a', 'functions/internal'], ['account-a', 'functions/unavailable'],
                ['account-b', 'functions/unavailable']]) {
                loggerMock.getUser.mockReturnValue({ id });
                mocks.callableSpy.mockRejectedValue({ code });
                await expect(service.call('ensureDerivedMetrics')).rejects.toEqual({ code });
            }
            expect(loggerMock.captureMessage).toHaveBeenCalledTimes(3);
            expect(service['reportedEnsureFailures'].size).toBe(3);
        });

        it('bounds diagnostic memory across account switches', async () => {
            mocks.callableSpy.mockRejectedValue({ code: 'functions/internal' });
            for (let index = 0; index < 70; index++) {
                loggerMock.getUser.mockReturnValue({ id: `account-${index}` });
                await expect(service.call('ensureDerivedMetrics')).rejects.toMatchObject({ code: 'functions/internal' });
            }
            expect(service['reportedEnsureFailures'].size).toBe(64);
        });

        it.each([{ id: 'account-a' }, {}])('does not misattribute a failure after Sentry identity changes: %j', async user => {
            loggerMock.getUser.mockReturnValue(user);
            mocks.ensureReadyMock.mockImplementation(async () => {
                loggerMock.getUser.mockReturnValue({ id: 'account-b' });
            });
            mocks.callableSpy.mockRejectedValue({ code: 'functions/internal' });
            await expect(service.call('ensureDerivedMetrics')).rejects.toMatchObject({ code: 'functions/internal' });
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it('preserves an anonymous Sentry context without inferring identity from request data', async () => {
            loggerMock.getUser.mockReturnValue({});
            mocks.callableSpy.mockRejectedValueOnce({ code: 'functions/unauthenticated' });
            await expect(service.call('ensureDerivedMetrics', { uid: 'private-uid' }))
                .rejects.toMatchObject({ code: 'functions/unauthenticated' });
            expect(loggerMock.captureMessage.mock.calls[0][1].user).toEqual({});
            expect(JSON.stringify(loggerMock.captureMessage.mock.calls)).not.toContain('private-uid');
        });

        it.each([false, true])('does not report a local cancellation after readiness (recovery: %s)', async recovery => {
            let current = true;
            if (recovery) mocks.callableSpy.mockRejectedValueOnce(appCheckRejection);
            mocks.ensureReadyMock.mockImplementation(async refresh => {
                if (!recovery || refresh) current = false;
            });
            await expect(service.call('ensureDerivedMetrics', undefined, { canExecute: () => current }))
                .rejects.toThrow('Operation cancelled');
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it.each([false, true])('does not report localhost failures (Functions emulator: %s)', async emulator => {
            mocks.setLocalhost(true);
            mocks.setUseFunctionsEmulator(emulator);
            mocks.callableSpy.mockRejectedValue({ code: 'functions/internal' });
            await expect(service.call('ensureDerivedMetrics')).rejects.toMatchObject({ code: 'functions/internal' });
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it('leaves diagnostics for other callables unchanged', async () => {
            mocks.callableSpy.mockRejectedValue(appCheckRejection);
            await expect(service.call('defaultRegionFunc' as any)).rejects.toBe(appCheckRejection);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
            expect(loggerMock.getUser).not.toHaveBeenCalled();
            expect(loggerMock.captureMessage).not.toHaveBeenCalled();
        });

        it.each(['getUser', 'captureMessage'] as const)('preserves the request and original error if %s fails', async method => {
            loggerMock[method].mockImplementation(() => { throw new Error('Sentry failure'); });
            mocks.callableSpy.mockRejectedValue(appCheckRejection);
            await expect(service.call('ensureDerivedMetrics')).rejects.toBe(appCheckRejection);
            expect(mocks.callableSpy).toHaveBeenCalledTimes(2);
        });
    });

    it('should throw error for invalid function key', async () => {
        await expect(service.call('invalidFunc' as any)).rejects.toThrow('Function invalidFunc not initialized');
    });

    it('should connect all regions to the functions emulator on localhost when enabled', () => {
        TestBed.resetTestingModule();
        mocks.setLocalhost(true);
        mocks.setUseFunctionsEmulator(true);
        mocks.getFunctionsMock.mockClear();
        mocks.connectFunctionsEmulatorMock.mockClear();
        mocks.httpsCallableMock.mockClear();
        mocks.callableSpy.mockClear();

        const localService = configureTestingModule();

        const europeWest2Functions = mocks.getFunctionsMock.mock.results[0]?.value;
        const europeWest3Functions = mocks.getFunctionsMock.mock.results[1]?.value;

        expect(getFunctions).toHaveBeenCalledTimes(2);
        expect(connectFunctionsEmulator).toHaveBeenCalledTimes(2);
        expect(connectFunctionsEmulator).toHaveBeenCalledWith(europeWest2Functions, '127.0.0.1', 5001);
        expect(connectFunctionsEmulator).toHaveBeenCalledWith(europeWest3Functions, '127.0.0.1', 5001);
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getAssistantQuotaStatus');
        expect(httpsCallable).toHaveBeenCalledWith(
            expect.anything(),
            'assistantChat',
            { timeout: 190_000 },
        );
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getAssistantConversation');
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'resetAssistantConversation');
        expect(httpsCallable).toHaveBeenCalledWith(
            expect.anything(),
            'func1',
            { timeout: 3_660_000 },
        );
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'func2');
        expect(localService).toBeTruthy();
    });

    it('should not connect emulator when localhost is true but functions emulator is disabled', () => {
        TestBed.resetTestingModule();
        mocks.setLocalhost(true);
        mocks.setUseFunctionsEmulator(false);
        mocks.getFunctionsMock.mockClear();
        mocks.connectFunctionsEmulatorMock.mockClear();
        mocks.httpsCallableMock.mockClear();

        const localProdFunctionsService = configureTestingModule();

        expect(getFunctions).toHaveBeenCalledTimes(2);
        expect(connectFunctionsEmulator).not.toHaveBeenCalled();
        expect(httpsCallable).toHaveBeenCalledTimes(7);
        expect(localProdFunctionsService).toBeTruthy();
    });
});
