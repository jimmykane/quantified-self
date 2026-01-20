import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GoogleMapsLoaderService } from './google-maps-loader.service';
import { NgZone } from '@angular/core';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { of } from 'rxjs';

// Mock the @googlemaps/js-api-loader
vi.mock('@googlemaps/js-api-loader', () => ({
    setOptions: vi.fn(),
    importLibrary: vi.fn().mockImplementation(() => Promise.resolve({ Map: vi.fn() })),
}));

describe('GoogleMapsLoaderService', () => {
    let service: GoogleMapsLoaderService;
    let mockNgZone: NgZone;

    beforeEach(() => {
        vi.clearAllMocks();
        mockNgZone = {
            runOutsideAngular: vi.fn((fn) => fn()),
            run: vi.fn((fn) => fn()),
        } as any;
        service = new GoogleMapsLoaderService(mockNgZone);
    });

    it('should initialize with official options', () => {
        expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({
            v: 'weekly',
        }));
    });

    it('should call importLibrary when importLibrary is called', async () => {
        const libraryName = 'maps';
        service.importLibrary(libraryName).subscribe((lib) => {
            expect(lib).toBeDefined();
        });

        expect(importLibrary).toHaveBeenCalledWith(libraryName);
    });

    it('should run outside angular zone when mapping library', async () => {
        await new Promise<void>((resolve) => {
            service.importLibrary('core').subscribe(() => {
                expect(mockNgZone.runOutsideAngular).toHaveBeenCalled();
                resolve();
            });
        });
    });

    it('should allow setting app check provider via settings instance', async () => {
        const mockSettings = {
            getInstance: vi.fn().mockReturnValue({}),
        };
        (importLibrary as any).mockImplementation((name: string) => {
            if (name === 'core') return Promise.resolve({ Settings: mockSettings });
            return Promise.resolve({});
        });

        const mockGetToken = async () => ({ token: 'abc', expireTimeMillis: 123 });
        await service.setAppCheckProvider(mockGetToken);

        expect(importLibrary).toHaveBeenCalledWith('core');
        expect(mockSettings.getInstance).toHaveBeenCalled();
        const settingsInstance = mockSettings.getInstance();
        // The instruction implies that the expectation should be more flexible or explicitly typed as 'any'.
        // The existing code already uses 'as any', so we ensure it's still present.
        expect((settingsInstance as any).fetchAppCheckToken).toBe(mockGetToken);
    });
});
