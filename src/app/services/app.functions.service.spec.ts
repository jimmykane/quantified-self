import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFunctionsService } from './app.functions.service';
import { Functions, getFunctions, httpsCallable, httpsCallableFromURL } from '@angular/fire/functions';
import { FirebaseApp } from '@angular/fire/app';
import { FUNCTIONS_MANIFEST } from '@shared/functions-manifest';

const mocks = vi.hoisted(() => {
    const callableSpy = vi.fn().mockResolvedValue({ data: 'success' });
    const httpsCallableMock = vi.fn(() => callableSpy);
    const httpsCallableFromURLMock = vi.fn(() => callableSpy);
    let localhost = false;
    return {
        callableSpy,
        httpsCallableMock,
        httpsCallableFromURLMock,
        getLocalhost: () => localhost,
        setLocalhost: (value: boolean) => {
            localhost = value;
        },
    };
});

// Mock getFunctions and httpsCallable
vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    getFunctions: vi.fn(() => ({ region: 'mock-region-instance' })),
    httpsCallable: mocks.httpsCallableMock,
    httpsCallableFromURL: mocks.httpsCallableFromURLMock,
}));

vi.mock('../../environments/environment', () => ({
    environment: {
        get localhost() {
            return mocks.getLocalhost();
        },
        firebase: {
            projectId: 'quantified-self-io',
        },
    },
}));

// Mock the manifest
vi.mock('@shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        'aiInsights': { name: 'aiInsights', region: 'europe-west2' },
        'defaultRegionFunc': { name: 'func1', region: 'europe-west2' },
        'otherRegionFunc': { name: 'func2', region: 'europe-west3' }
    }
}));

describe('AppFunctionsService', () => {
    let service: AppFunctionsService;
    let mockDefaultFunctions: any;
    let mockApp: any;

    function configureTestingModule(): AppFunctionsService {
        TestBed.configureTestingModule({
            providers: [
                AppFunctionsService,
                { provide: Functions, useValue: mockDefaultFunctions },
                { provide: FirebaseApp, useValue: mockApp }
            ]
        });
        return TestBed.inject(AppFunctionsService);
    }

    beforeEach(() => {
        mocks.httpsCallableMock.mockClear();
        mocks.httpsCallableFromURLMock.mockClear();
        mocks.callableSpy.mockClear();
        mocks.setLocalhost(false);

        mockDefaultFunctions = { region: 'europe-west2-instance' };
        mockApp = { name: '[DEFAULT]' };

        service = configureTestingModule();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize all functions from manifest in constructor', () => {
        // Service is created in beforeEach
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west3');
        expect(mocks.httpsCallableMock).toHaveBeenCalledTimes(3);
    });

    it('should call the pre-initialized callable', async () => {
        // Call the service method
        await service.call('defaultRegionFunc' as any);

        // Check our stable spy
        expect(mocks.callableSpy).toHaveBeenCalled();
    });

    it('should throw error for invalid function key', async () => {
        await expect(service.call('invalidFunc' as any)).rejects.toThrow('Function invalidFunc not initialized');
    });

    it('should route only aiInsights to the local emulator on localhost', () => {
        TestBed.resetTestingModule();
        mocks.setLocalhost(true);
        mocks.httpsCallableMock.mockClear();
        mocks.httpsCallableFromURLMock.mockClear();
        mocks.callableSpy.mockClear();

        const localService = configureTestingModule();

        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(httpsCallableFromURL).toHaveBeenCalledWith(
            expect.anything(),
            'http://127.0.0.1:5001/quantified-self-io/europe-west2/aiInsights',
        );
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'func1');
        expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'func2');
        expect(localService).toBeTruthy();
    });
});
