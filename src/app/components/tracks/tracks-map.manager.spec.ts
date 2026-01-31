import { TracksMapManager } from './tracks-map.manager';
import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { MapStyleService } from '../../services/map-style.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock dependencies
class MockNgZone extends NgZone {
    constructor() {
        super({ enableLongStackTrace: false });
    }
    runOutsideAngular<T>(fn: (...args: any[]) => T): T {
        return fn();
    }
}

// Mock Mapbox GL objects
const mockMap = {
    addSource: vi.fn(),
    getSource: vi.fn(),
    addLayer: vi.fn(),
    getLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    fitBounds: vi.fn(),
    getPitch: vi.fn().mockReturnValue(0),
    getBearing: vi.fn().mockReturnValue(0),
    setTerrain: vi.fn(),
    easeTo: vi.fn(),
    setPitch: vi.fn(),
    addControl: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn(),
    setPaintProperty: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
};

const mockMapboxGL = {
    LngLatBounds: class {
        extend = vi.fn();
    }
};

const mockEventColorService = {
    getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#ff0000')
} as unknown as AppEventColorService;

const mockMapStyleService = {
    adjustColorForTheme: vi.fn().mockReturnValue('#adjustedColor')
} as unknown as MapStyleService;

describe('TracksMapManager', () => {
    let manager: TracksMapManager;
    let zone: NgZone;

    beforeEach(() => {
        zone = new MockNgZone();
        manager = new TracksMapManager(zone, mockEventColorService, mockMapStyleService);
        manager.setMap(mockMap, mockMapboxGL);

        // Reset mocks
        vi.clearAllMocks();
        mockMap.getSource.mockReset();
        mockMap.getLayer.mockReset();
        // Reset default return values that might be cleared
        mockEventColorService.getColorForActivityTypeByActivityTypeGroup = vi.fn().mockReturnValue('#ff0000');
        mockMapStyleService.adjustColorForTheme = vi.fn().mockReturnValue('#adjustedColor');
    });

    it('should be created', () => {
        expect(manager).toBeTruthy();
    });

    describe('addTrackFromActivity', () => {
        it('should add source and layers for a valid track', () => {
            const mockActivity = {
                getID: () => '123',
                type: 'running'
            };
            const coordinates = [[0, 0], [1, 1]];

            manager.addTrackFromActivity(mockActivity, coordinates);

            expect(mockMap.addSource).toHaveBeenCalledWith(
                'track-source-123',
                expect.objectContaining({ type: 'geojson' })
            );
            expect(mockMap.addLayer).toHaveBeenCalledTimes(2); // Glow + Line
            expect(mockEventColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith('running');
            expect(mockMapStyleService.adjustColorForTheme).toHaveBeenCalledWith('#ff0000', AppThemes.Normal);
        });

        it('should use Dark theme when manager is set to dark', () => {
            const mockActivity = {
                getID: () => '1234',
                type: 'cycling'
            };
            const coordinates = [[0, 0], [1, 1]];

            manager.setIsDarkTheme(true);
            manager.addTrackFromActivity(mockActivity, coordinates);

            expect(mockMapStyleService.adjustColorForTheme).toHaveBeenCalledWith('#ff0000', AppThemes.Dark);
        });

        it('should not add track if coordinates are insufficient', () => {
            const mockActivity = { getID: () => '123' };
            const coordinates = [[0, 0]]; // Only 1 point

            manager.addTrackFromActivity(mockActivity, coordinates);

            expect(mockMap.addSource).not.toHaveBeenCalled();
        });

        it('should not add source if it already exists', () => {
            mockMap.getSource.mockReturnValue(true);
            const mockActivity = { getID: () => '123' };
            const coordinates = [[0, 0], [1, 1]];

            manager.addTrackFromActivity(mockActivity, coordinates);

            expect(mockMap.addSource).not.toHaveBeenCalled();
        });
    });

    describe('clearAllTracks', () => {
        it('should remove all tracked layers and sources', () => {
            // Setup some fake state indirectly or by manually modifying the private array if possible, 
            // but better to add a track first to test state.
            // Since 'activeLayerIds' is private, we depend on addTrack side effects.

            const mockActivity = { getID: () => '123' };
            const coordinates = [[0, 0], [1, 1]];
            manager.addTrackFromActivity(mockActivity, coordinates);

            // Setup mocks to return true so removal happens
            mockMap.getLayer.mockReturnValue(true);
            mockMap.getSource.mockReturnValue(true);

            manager.clearAllTracks();

            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-layer-123');
            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-layer-glow-123');
            expect(mockMap.removeSource).toHaveBeenCalledWith('track-source-123');
        });
    });

    describe('fitBoundsToCoordinates', () => {
        it('should call fitBounds with correct padding', () => {
            const coordinates = [[0, 0], [1, 1]];
            manager.fitBoundsToCoordinates(coordinates);

            expect(mockMap.fitBounds).toHaveBeenCalledWith(
                expect.any(Object), // LngLatBounds instance
                expect.objectContaining({ padding: 50, animate: true })
            );
        });
    });

    describe('toggleTerrain', () => {
        it('should enable terrain and add source if missing', () => {
            mockMap.getSource.mockReturnValue(false); // Source missing

            manager.toggleTerrain(true, true);

            expect(mockMap.addSource).toHaveBeenCalledWith('mapbox-dem', expect.any(Object));
            expect(mockMap.setTerrain).toHaveBeenCalledWith(expect.objectContaining({ source: 'mapbox-dem' }));
            expect(mockMap.easeTo).toHaveBeenCalledWith({ pitch: 60 });
        });

        it('should disable terrain', () => {
            manager.toggleTerrain(false, true);

            expect(mockMap.setTerrain).toHaveBeenCalledWith(null);
            expect(mockMap.easeTo).toHaveBeenCalledWith({ pitch: 0 });
        });
    });
});
