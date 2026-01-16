import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppFunctionsService } from './app.functions.service';
import { Functions, getFunctions, httpsCallable } from '@angular/fire/functions';
import { FirebaseApp } from '@angular/fire/app';
import { FUNCTIONS_MANIFEST } from '../../shared/functions-manifest';

// Mock getFunctions and httpsCallable
vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    getFunctions: vi.fn(() => ({ region: 'mock-region-instance' })),
    httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: 'success' }))
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

    it('should use getFunctions for all regions', async () => {
        await service.call('defaultRegionFunc' as any);

        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west2');
        expect(httpsCallable).toHaveBeenCalledWith(expect.objectContaining({ region: 'mock-region-instance' }), 'func1');
    });

    it('should use getFunctions for non-default regions', async () => {
        await service.call('otherRegionFunc' as any);

        expect(getFunctions).toHaveBeenCalledWith(mockApp, 'europe-west3');
        // It should use the result of getFunctions
        const expectedInstance = { region: 'mock-region-instance' };
        // Note: getFunctions mock returns a new object each time unless we fix the return value. 
        // The mock above returns { region: 'mock-region-instance' }.

        expect(httpsCallable).toHaveBeenCalledWith(expect.objectContaining({ region: 'mock-region-instance' }), 'func2');
    });
});
