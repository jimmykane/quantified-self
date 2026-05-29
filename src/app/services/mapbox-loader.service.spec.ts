import {
    MAPBOX_ESM_WORKER_ASSET_PATH,
    MapboxLoaderService,
    resolveMapboxEsmWorkerUrl
} from './mapbox-loader.service';
import { NgZone } from '@angular/core';
import { ɵPLATFORM_BROWSER_ID as PLATFORM_BROWSER_ID, ɵPLATFORM_SERVER_ID as PLATFORM_SERVER_ID } from '@angular/common';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { environment } from '../../environments/environment';

const mapboxEsmMock = vi.hoisted(() => ({
    runtime: {
        Map: class {
            constructor(_options: unknown) { }
        },
        accessToken: '',
        workerUrl: ''
    }
}));

vi.mock('mapbox-gl/dist/esm/mapbox-gl.js', () => ({
    default: mapboxEsmMock.runtime
}));

describe('MapboxLoaderService', () => {
    let service: MapboxLoaderService;
    let zone: NgZone;

    const mockMapbox: any = {
        Map: class {
            constructor(_options: any) { }
        },
        accessToken: '',
        workerUrl: ''
    };

    beforeEach(() => {
        // Mock NgZone
        zone = {
            runOutsideAngular: (fn: () => void) => fn()
        } as any;

        service = new MapboxLoaderService(zone, PLATFORM_BROWSER_ID as any);
        mapboxEsmMock.runtime.accessToken = '';
        mapboxEsmMock.runtime.workerUrl = '';

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

        it('should resolve the ESM worker from the document base URI', () => {
            expect(resolveMapboxEsmWorkerUrl('https://quantified-self.io/app/')).toBe(
                `https://quantified-self.io/app/${MAPBOX_ESM_WORKER_ASSET_PATH}`
            );
        });

        it('should load the ESM Mapbox runtime and configure the module worker', async () => {
            const result = await service.loadMapbox();

            expect(result).toBe(mapboxEsmMock.runtime);
            expect(result.workerUrl).toBe(resolveMapboxEsmWorkerUrl(document.baseURI));
            expect(result.accessToken).toBe(environment.mapboxAccessToken);
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
                style: 'mapbox://styles/mapbox/standard', // default check
                zoom: 5,
                pitch: 45
            }));
        });

        it('should enable cooperative gestures by default', async () => {
            const mapSpy = vi.fn();
            const mockMb = {
                Map: mapSpy,
                accessToken: ''
            };
            (service as any).mapboxgl = mockMb;

            const container = document.createElement('div');
            await service.createMap(container);

            expect(mapSpy).toHaveBeenCalledWith(expect.objectContaining({
                container,
                cooperativeGestures: true
            }));
        });

        it('should allow cooperative gestures override when explicitly provided', async () => {
            const mapSpy = vi.fn();
            const mockMb = {
                Map: mapSpy,
                accessToken: ''
            };
            (service as any).mapboxgl = mockMb;

            const container = document.createElement('div');
            await service.createMap(container, { cooperativeGestures: false });

            expect(mapSpy).toHaveBeenCalledWith(expect.objectContaining({
                container,
                cooperativeGestures: false
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
