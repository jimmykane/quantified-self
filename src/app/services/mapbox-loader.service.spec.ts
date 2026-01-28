import { MapboxLoaderService } from './mapbox-loader.service';
import { NgZone } from '@angular/core';
import { ɵPLATFORM_BROWSER_ID as PLATFORM_BROWSER_ID, ɵPLATFORM_SERVER_ID as PLATFORM_SERVER_ID } from '@angular/common';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('MapboxLoaderService', () => {
    let service: MapboxLoaderService;
    let zone: NgZone;

    const mockMapbox: any = {
        Map: class {
            constructor(_options: any) { }
        },
        accessToken: ''
    };

    beforeEach(() => {
        // Mock NgZone
        zone = {
            runOutsideAngular: (fn: () => void) => fn()
        } as any;

        service = new MapboxLoaderService(zone, PLATFORM_BROWSER_ID as any);

        // Reset static/global mocks
        (window as any).mapboxgl = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('loadMapbox', () => {
        it('should return cached instance if already loaded', async () => {
            (service as any).mapboxgl = mockMapbox;
            const result = await service.loadMapbox();
            expect(result).toBe(mockMapbox);
        });
    });

    describe('createMap', () => {
        it('should run outside angular zone', async () => {
            const zoneSpy = vi.spyOn(zone, 'runOutsideAngular'); // Use vi.spyOn
            (service as any).mapboxgl = mockMapbox; // Mock loaded state

            const container = document.createElement('div');
            await service.createMap(container, { zoom: 10 });

            expect(zoneSpy).toHaveBeenCalled();
        });

        it('should load mapbox before creating map', async () => {
            const loadSpy = vi.spyOn(service, 'loadMapbox').mockResolvedValue(mockMapbox);

            const container = document.createElement('div');
            await service.createMap(container);

            expect(loadSpy).toHaveBeenCalled();
        });

        it('should initialize map with provided options', async () => {
            const mapSpy = vi.fn();
            const mockMb = {
                Map: mapSpy,
                accessToken: ''
            };
            (service as any).mapboxgl = mockMb;

            const container = document.createElement('div');
            const options = { zoom: 5, pitch: 45 };

            await service.createMap(container, options);

            expect(mapSpy).toHaveBeenCalledWith(expect.objectContaining({
                container: container,
                style: 'mapbox://styles/mapbox/dark-v11', // default check
                zoom: 5,
                pitch: 45
            }));
        });
    });

    // Test for Server Platform separately
    describe('SSR Guard', () => {
        it('should throw error if not in browser', async () => {
            const serverService = new MapboxLoaderService(zone, PLATFORM_SERVER_ID as any);
            await expect(serverService.loadMapbox()).rejects.toThrow('Mapbox GL JS can only be loaded in the browser.');
        });
    });
});
