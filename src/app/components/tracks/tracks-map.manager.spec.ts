import { TracksMapManager } from './tracks-map.manager';
import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { MapStyleService } from '../../services/map-style.service';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapboxHeatmapLayerService } from '../../services/map/mapbox-heatmap-layer.service';
import { JumpHeatmapWeightingService } from '../../services/map/jump-heatmap-weighting.service';
import { MapboxStartPointLayerService } from '../../services/map/mapbox-start-point-layer.service';

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
    moveLayer: vi.fn(),
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
    setLayoutProperty: vi.fn(),
    getStyle: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    queryRenderedFeatures: vi.fn().mockReturnValue([]),
    getCanvas: vi.fn().mockReturnValue({ style: { cursor: '' } }),
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

const mockLoggerService = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    captureMessage: vi.fn()
};

describe('TracksMapManager', () => {
    let manager: TracksMapManager;
    let zone: NgZone;
    let mapEventHandlers: Record<string, Array<(...args: any[]) => void>>;
    let mapboxHeatmapLayerService: MapboxHeatmapLayerService;
    let jumpHeatmapWeightingService: JumpHeatmapWeightingService;
    let mapboxStartPointLayerService: MapboxStartPointLayerService;

    beforeEach(() => {
        mapEventHandlers = {};
        mockMap.on.mockImplementation((event: string, layerOrHandler: any, maybeHandler?: (...args: any[]) => void) => {
            const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
            if (typeof handler !== 'function') return;
            mapEventHandlers[event] = mapEventHandlers[event] || [];
            mapEventHandlers[event].push(handler);
        });
        mockMap.off.mockImplementation((event: string, layerOrHandler: any, maybeHandler?: (...args: any[]) => void) => {
            const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
            if (typeof handler !== 'function') return;
            mapEventHandlers[event] = (mapEventHandlers[event] || []).filter(h => h !== handler);
        });

        zone = new MockNgZone();
        mapboxHeatmapLayerService = new MapboxHeatmapLayerService(mockLoggerService as any);
        jumpHeatmapWeightingService = new JumpHeatmapWeightingService();
        mapboxStartPointLayerService = new MapboxStartPointLayerService(mockLoggerService as any);
        manager = new TracksMapManager(
            zone,
            mockEventColorService,
            mockMapStyleService,
            mapboxHeatmapLayerService,
            jumpHeatmapWeightingService,
            mapboxStartPointLayerService,
            mockLoggerService as any
        );
        manager.setMap(mockMap, mockMapboxGL);

        // Reset mocks
        vi.clearAllMocks();
        mockMap.getSource.mockReset();
        mockMap.getLayer.mockReset();
        mockMap.getStyle.mockReturnValue({ layers: [] });
        // Reset default return values that might be cleared
        mockEventColorService.getColorForActivityTypeByActivityTypeGroup = vi.fn().mockReturnValue('#ff0000');
        mockMapStyleService.adjustColorForTheme = vi.fn().mockReturnValue('#adjustedColor');
    });

    const emitMapEvent = (event: string) => {
        const handlers = mapEventHandlers[event] || [];
        handlers.forEach(handler => handler());
    };

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
            expect(mockMap.addLayer).toHaveBeenCalledTimes(3); // Glow + Casing + Line
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

        it('should restore track layers after style reload', () => {
            const mockActivity = {
                getID: () => '123',
                type: 'running'
            };
            const coordinates = [[0, 0], [1, 1]];
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.addTrackFromActivity(mockActivity, coordinates);
            expect(mockMap.addSource).toHaveBeenCalledTimes(1);
            expect(mockMap.addLayer).toHaveBeenCalledTimes(3);

            emitMapEvent('style.load');

            expect(mockMap.addSource).toHaveBeenCalledTimes(2);
            expect(mockMap.addLayer).toHaveBeenCalledTimes(6);
        });
    });

    describe('jump heatmap', () => {
        it('should create jump heat source/layer with computed weights', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            mockMap.getStyle.mockReturnValue({ layers: [{ id: 'track-layer-glow-123' }] });

            manager.setJumpHeatPoints([
                { lng: 10, lat: 20, hangTime: 1.2, distance: 2.5 },
                { lng: 10.1, lat: 20.1, hangTime: 2.4, distance: 5.0 },
            ]);

            const sourceCall = mockMap.addSource.mock.calls.find((call) => call[0] === 'jump-heat-source');
            expect(sourceCall).toBeDefined();
            const features = sourceCall?.[1]?.data?.features || [];
            expect(features.length).toBe(2);
            expect(features.some((feature: any) => feature.properties.heatWeight > 0)).toBe(true);

            const heatLayerCall = mockMap.addLayer.mock.calls.find((call) => call[0]?.id === 'jump-heat-layer');
            expect(heatLayerCall?.[0]?.type).toBe('heatmap');
            expect(heatLayerCall?.[1]).toBe('track-layer-glow-123');
        });

        it('should toggle jump heatmap layer visibility', () => {
            mockMap.getLayer.mockImplementation((id: string) => id === 'jump-heat-layer');
            manager.setJumpHeatPoints([{ lng: 10, lat: 20, hangTime: 1.2, distance: 3.1 }]);

            manager.setJumpHeatmapVisible(false);
            expect(mockMap.setLayoutProperty).toHaveBeenCalledWith('jump-heat-layer', 'visibility', 'none');

            manager.setJumpHeatmapVisible(true);
            expect(mockMap.setLayoutProperty).toHaveBeenCalledWith('jump-heat-layer', 'visibility', 'visible');
        });

        it('should restore jump heatmap after style reload', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setJumpHeatPoints([{ lng: 10, lat: 20, hangTime: 1.1, distance: 3.2 }]);
            const beforeStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'jump-heat-layer').length;

            emitMapEvent('style.load');

            const afterStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'jump-heat-layer').length;
            expect(afterStyleReload).toBeGreaterThan(beforeStyleReload);
        });
    });

    describe('activity start points', () => {
        it('should create start-point source and layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            mockMapStyleService.adjustColorForTheme = vi.fn().mockReturnValue('#00ff00');

            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            const sourceCall = mockMap.addSource.mock.calls.find((call) => call[0] === 'track-start-source');
            expect(sourceCall).toBeDefined();
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'track-start-layer')).toBe(true);
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'track-start-hit-layer')).toBe(false);
            const markerColor = sourceCall?.[1]?.data?.features?.[0]?.properties?.markerColor;
            expect(markerColor).toBe('#00ff00');
        });

        it('should use whitish marker border color', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            manager.setIsDarkTheme(true);

            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            const markerLayerCall = mockMap.addLayer.mock.calls.find((call) => call[0]?.id === 'track-start-layer');
            expect(markerLayerCall?.[0]?.paint?.['circle-stroke-color']).toBe('#f5f8ff');
        });

        it('should color markers using per-feature activity color expression', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            manager.setIsDarkTheme(true);
            manager.setMapStyle('satellite');

            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            const markerLayerCall = mockMap.addLayer.mock.calls.find((call) => call[0]?.id === 'track-start-layer');
            expect(markerLayerCall?.[0]?.paint?.['circle-color']).toEqual(
                expect.arrayContaining(['coalesce'])
            );
        });

        it('should re-render start markers when map style changes', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            manager.setIsDarkTheme(true);
            manager.setMapStyle('default');
            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            vi.clearAllMocks();
            mockMap.getSource.mockReturnValue({ setData: vi.fn() });
            mockMap.getLayer.mockReturnValue(true);
            manager.setMapStyle('satellite');

            expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
                'track-start-layer',
                'circle-color',
                expect.arrayContaining(['coalesce'])
            );
        });

        it('should forward start-point selection through handler', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            const selectionSpy = vi.fn();
            manager.setStartMarkerSelectionHandler(selectionSpy);

            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            const sourceCall = mockMap.addSource.mock.calls.find((call) => call[0] === 'track-start-source');
            const pointId = sourceCall?.[1]?.data?.features?.[0]?.properties?.pointId;
            mockMap.queryRenderedFeatures.mockReturnValue([{}]);

            const clickHandlers = mapEventHandlers['click'] || [];
            clickHandlers.forEach((handler) => handler({
                features: [{
                    properties: { pointId },
                    geometry: { coordinates: [10, 20] }
                }],
                point: { x: 15, y: 16 }
            }));

            expect(selectionSpy).toHaveBeenCalledWith(expect.objectContaining({
                eventId: 'event-1',
                activityId: 'activity-1',
                lng: 10,
                lat: 20
            }));
        });

        it('should clear start-point source and layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);

            mockMap.getLayer.mockImplementation((id: string) => id === 'track-start-layer' || id === 'track-start-hit-layer');
            mockMap.getSource.mockImplementation((id: string) => id === 'track-start-source');
            manager.clearActivityStartPoints();

            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-start-hit-layer');
            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-start-layer');
            expect(mockMap.removeSource).toHaveBeenCalledWith('track-start-source');
        });

        it('should restore start-point layers after style reload', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setActivityStartPoints([{
                eventId: 'event-1',
                activityId: 'activity-1',
                activityType: 'Running',
                activityTypeValue: ActivityTypes.Running,
                startDate: 1731062400000,
                durationLabel: '1:02:03',
                distanceLabel: '10 km',
                lng: 10,
                lat: 20
            }]);
            const beforeStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'track-start-layer').length;

            emitMapEvent('style.load');

            const afterStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'track-start-layer').length;
            expect(afterStyleReload).toBeGreaterThan(beforeStyleReload);
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
            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-layer-casing-123');
            expect(mockMap.removeLayer).toHaveBeenCalledWith('track-layer-glow-123');
            expect(mockMap.removeSource).toHaveBeenCalledWith('track-source-123');
        });
    });

    describe('track styling modes', () => {
        it('should use casing instead of glow on satellite even in dark theme', () => {
            const mockActivity = {
                getID: () => '123',
                type: 'running'
            };
            const coordinates = [[0, 0], [1, 1]];

            manager.setIsDarkTheme(true);
            manager.setMapStyle('satellite' as any);
            manager.addTrackFromActivity(mockActivity, coordinates);

            const glowCall = mockMap.addLayer.mock.calls.find(call => call[0]?.id === 'track-layer-glow-123');
            const casingCall = mockMap.addLayer.mock.calls.find(call => call[0]?.id === 'track-layer-casing-123');

            expect(glowCall?.[0]?.paint?.['line-opacity']).toBe(0);
            expect(casingCall?.[0]?.paint?.['line-opacity']).toBeGreaterThan(0);
        });

        it('should keep glow and hide casing for dark default theme', () => {
            const mockActivity = {
                getID: () => '123',
                type: 'running'
            };
            const coordinates = [[0, 0], [1, 1]];

            manager.setIsDarkTheme(true);
            manager.setMapStyle('default' as any);
            manager.addTrackFromActivity(mockActivity, coordinates);

            const glowCall = mockMap.addLayer.mock.calls.find(call => call[0]?.id === 'track-layer-glow-123');
            const casingCall = mockMap.addLayer.mock.calls.find(call => call[0]?.id === 'track-layer-casing-123');

            expect(glowCall?.[0]?.paint?.['line-opacity']).toBeGreaterThan(0);
            expect(casingCall?.[0]?.paint?.['line-opacity']).toBe(0);
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
