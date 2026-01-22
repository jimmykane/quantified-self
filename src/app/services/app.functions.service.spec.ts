import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFunctionsService } from './app.functions.service';
import { Functions, getFunctions, httpsCallable } from '@angular/fire/functions';
import { FirebaseApp } from '@angular/fire/app';
import { FUNCTIONS_MANIFEST } from '../../shared/functions-manifest';

const mocks = vi.hoisted(() => {
    const callableSpy = vi.fn().mockResolvedValue({ data: 'success' });
    const httpsCallableMock = vi.fn(() => callableSpy);
    return {
        callableSpy,
        httpsCallableMock
    };
});

// Mock getFunctions and httpsCallable
vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    getFunctions: vi.fn(() => ({ region: 'mock-region-instance' })),
    httpsCallable: mocks.httpsCallableMock
}));

// Mock the manifest
vi.mock('../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        'defaultRegionFunc': { name: 'func1', region: 'europe-west2' },
        'otherRegionFunc': { name: 'func2', region: 'europe-west3' }
    }
}));

describe('AppFunctionsService', () => {
    let service: AppFunctionsService;
    let mockDefaultFunctions: any;
    let mockApp: any;

    beforeEach(() => {
        mocks.httpsCallableMock.mockClear();
        mocks.callableSpy.mockClear();

        mockDefaultFunctions = { region: 'europe-west2-instance' };
        mockApp = { name: '[DEFAULT]' };

        TestBed.configureTestingModule({
            providers: [
                AppFunctionsService,
                { provide: Functions, useValue: mockDefaultFunctions },
                { provide: FirebaseApp, useValue: mockApp }
            ]
        });
        service = TestBed.inject(AppFunctionsService);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize all functions from manifest in constructor', () => {
        // Service is created in beforeEach
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west3');
        expect(mocks.httpsCallableMock).toHaveBeenCalledTimes(2);
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
});
