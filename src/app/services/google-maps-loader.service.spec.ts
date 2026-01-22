import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GoogleMapsLoaderService } from './google-maps-loader.service';
import { NgZone } from '@angular/core';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { AppCheck } from '@angular/fire/app-check';
import { LoggerService } from './logger.service';

// Mock the @googlemaps/js-api-loader
vi.mock('@googlemaps/js-api-loader', () => ({
    setOptions: vi.fn(),
    importLibrary: vi.fn().mockImplementation(() => Promise.resolve({ Map: vi.fn() })),
}));

// Mock environment
vi.mock('../../environments/environment', () => ({
    environment: {
        firebase: {
            apiKey: 'test-api-key'
        }
    }
}));

describe('GoogleMapsLoaderService', () => {
    let service: GoogleMapsLoaderService;
    let mockNgZone: any;
    let mockAppCheck: any;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockAppCheck = {};

        mockLogger = {
            error: vi.fn(),
            log: vi.fn(),
            warn: vi.fn()
        };

        // Mock importLibrary to return Settings for 'core'
        vi.mocked(importLibrary).mockImplementation((name: string) => {
            if (name === 'core') {
                return Promise.resolve({
                    Settings: {
                        getInstance: vi.fn().mockReturnValue({})
                    }
                }) as any;
            }
            return Promise.resolve({ Map: vi.fn() as any }) as any;
        });

        TestBed.configureTestingModule({
            providers: [
                GoogleMapsLoaderService,
                { provide: AppCheck, useValue: mockAppCheck },
                { provide: LoggerService, useValue: mockLogger }
            ]
        });

        service = TestBed.inject(GoogleMapsLoaderService);
        const ngZone = TestBed.inject(NgZone);

        // Spy on runOutsideAngular
        mockNgZone = {
            runOutsideAngular: vi.spyOn(ngZone, 'runOutsideAngular').mockImplementation((fn: any) => fn())
        };
    });

    it('should initialize with official options', () => {
        expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({
            v: 'weekly',
        }));
    });

    it('should call importLibrary when importLibrary is called', async () => {
        const libraryName = 'maps';
        const lib = await service.importLibrary(libraryName);
        expect(lib).toBeDefined();

        expect(importLibrary).toHaveBeenCalledWith(libraryName);
    });

    it('should run outside angular zone when mapping library', async () => {
        await service.importLibrary('visualization');
        expect(mockNgZone.runOutsideAngular).toHaveBeenCalled();
    });

    it('should allow setting app check provider via settings instance', async () => {
        const mockSettingsInstance: any = {};
        const mockSettings = {
            getInstance: vi.fn().mockReturnValue(mockSettingsInstance),
        };

        vi.mocked(importLibrary).mockImplementation((name: string) => {
            if (name === 'core') return Promise.resolve({ Settings: mockSettings }) as any;
            return Promise.resolve({}) as any;
        });

        // Wait for the service initialization to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        // The initializeGoogleMapsAppCheck should have been called during construction
        expect(importLibrary).toHaveBeenCalledWith('core');
    });
});
