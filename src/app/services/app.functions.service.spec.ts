import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFunctionsService } from './app.functions.service';
import { Functions, connectFunctionsEmulator, getFunctions, httpsCallable } from 'app/firebase/functions';
import { FirebaseApp } from 'app/firebase/app';
import { AppCheckReadinessService } from './app-check-readiness.service';

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
        'aiInsights': { name: 'aiInsights', region: 'europe-west2' },
        'getAiInsightsQuotaStatus': { name: 'getAiInsightsQuotaStatus', region: 'europe-west2' },
        'defaultRegionFunc': { name: 'func1', region: 'europe-west2' },
        'otherRegionFunc': { name: 'func2', region: 'europe-west3' }
    }
}));

describe('AppFunctionsService', () => {
    let service: AppFunctionsService;
    let mockApp: any;
    let appCheckReadinessMock: Pick<AppCheckReadinessService, 'ensureReady' | 'isConfigured'>;

    function configureTestingModule(): AppFunctionsService {
        const providers: any[] = [
            AppFunctionsService,
            { provide: Functions, useValue: { region: 'europe-west2-instance' } },
            { provide: FirebaseApp, useValue: mockApp },
            { provide: AppCheckReadinessService, useValue: appCheckReadinessMock }
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
        mocks.callableSpy.mockClear();
        mocks.ensureReadyMock.mockClear();
        mocks.ensureReadyMock.mockResolvedValue(undefined);
        mocks.isConfiguredMock.mockClear();
        mocks.isConfiguredMock.mockReturnValue(true);
        mocks.setLocalhost(false);
        mocks.setUseFunctionsEmulator(false);

        mockApp = { name: '[DEFAULT]' };
        appCheckReadinessMock = {
            ensureReady: mocks.ensureReadyMock,
            isConfigured: mocks.isConfiguredMock,
        };

        service = configureTestingModule();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize all functions from manifest in constructor and reuse region instances', () => {
        // Service is created in beforeEach
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west3');
        expect(getFunctions).toHaveBeenCalledTimes(2);
        expect(mocks.httpsCallableMock).toHaveBeenCalledTimes(4);
        expect(connectFunctionsEmulator).not.toHaveBeenCalled();
    });

    it('should call the pre-initialized callable', async () => {
        // Call the service method
        await service.call('defaultRegionFunc' as any);

        // Check our stable spy
        expect(mocks.ensureReadyMock).toHaveBeenCalledWith();
        expect(mocks.callableSpy).toHaveBeenCalled();
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

    it('should not retry non App Check callable failures', async () => {
        mocks.callableSpy.mockRejectedValueOnce({
            code: 'functions/internal',
            message: 'Unexpected failure'
        });

        await expect(service.call('defaultRegionFunc' as any)).rejects.toMatchObject({
            code: 'functions/internal',
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
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'aiInsights');
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getAiInsightsQuotaStatus');
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'func1');
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
        expect(httpsCallable).toHaveBeenCalledTimes(4);
        expect(localProdFunctionsService).toBeTruthy();
    });
});
