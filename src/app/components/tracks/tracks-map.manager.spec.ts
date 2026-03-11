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

    const emitMapEvent = (event: string, payload?: any) => {
        const handlers = mapEventHandlers[event] || [];
        handlers.forEach(handler => handler(payload));
    };

    it('should be created', () => {
        expect(manager).toBeTruthy();
    });

    it('should keep one style.load handler when setMap is called repeatedly', () => {
        manager.setMap(mockMap, mockMapboxGL);
        manager.setMap(mockMap, mockMapboxGL);

        expect((mapEventHandlers['style.load'] || []).length).toBe(1);
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

        it('should ignore deferred style.load track re-add after tracks are cleared', () => {
            const mockActivity = {
                getID: () => '123',
                type: 'running'
            };
            const coordinates = [[0, 0], [1, 1]];

            mockMap.addSource.mockImplementationOnce(() => {
                throw new Error('Style is not done loading');
            });

            manager.addTrackFromActivity(mockActivity, coordinates);
            expect(mockMap.once).toHaveBeenCalledWith('style.load', expect.any(Function));

            const deferredRetry = mockMap.once.mock.calls[0][1] as () => void;
            manager.clearAllTracks();
            deferredRetry();

            expect(mockMap.addSource).toHaveBeenCalledTimes(1);
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

    describe('home area', () => {
        it('should render a home area source with fill and outline layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);
            mockMap.getStyle.mockReturnValue({ layers: [{ id: 'track-layer-glow-123' }] });

            manager.setHomeArea({
                destinationId: 'destination-home',
                pointCount: 6,
                pointShare: 0.58,
                centroidLat: 37.9838,
                centroidLng: 23.7275,
                bounds: {
                    west: 23.71,
                    east: 23.74,
                    south: 37.97,
                    north: 38.0,
                },
                radiusKm: 3.5,
            });

            const sourceCall = mockMap.addSource.mock.calls.find((call) => call[0] === 'home-area-source');
            expect(sourceCall).toBeDefined();
            expect(sourceCall?.[1]?.data?.features?.[0]?.geometry?.type).toBe('Polygon');
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'home-area-fill-layer')).toBe(true);
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'home-area-outline-layer')).toBe(true);

            const outlineLayerCall = mockMap.addLayer.mock.calls.find((call) => call[0]?.id === 'home-area-outline-layer');
            expect(outlineLayerCall?.[1]).toBe('track-layer-glow-123');
        });

        it('should clear the home area source and layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setHomeArea({
                destinationId: 'destination-home',
                pointCount: 4,
                pointShare: 0.6,
                centroidLat: 37.98,
                centroidLng: 23.72,
                bounds: {
                    west: 23.71,
                    east: 23.73,
                    south: 37.97,
                    north: 37.99,
                },
                radiusKm: 3,
            });

            mockMap.getLayer.mockImplementation((id: string) => id === 'home-area-fill-layer' || id === 'home-area-outline-layer');
            mockMap.getSource.mockImplementation((id: string) => id === 'home-area-source');

            manager.clearHomeArea();

            expect(mockMap.removeLayer).toHaveBeenCalledWith('home-area-outline-layer');
            expect(mockMap.removeLayer).toHaveBeenCalledWith('home-area-fill-layer');
            expect(mockMap.removeSource).toHaveBeenCalledWith('home-area-source');
        });

        it('should restore the home area after style reload', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setHomeArea({
                destinationId: 'destination-home',
                pointCount: 5,
                pointShare: 0.55,
                centroidLat: 37.98,
                centroidLng: 23.72,
                bounds: {
                    west: 23.71,
                    east: 23.73,
                    south: 37.97,
                    north: 37.99,
                },
                radiusKm: 2.8,
            });
            const beforeStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'home-area-fill-layer').length;

            emitMapEvent('style.load');

            const afterStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'home-area-fill-layer').length;
            expect(afterStyleReload).toBeGreaterThan(beforeStyleReload);
        });
    });

    describe('trip area', () => {
        it('should render a trip area source with fill and outline layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockImplementation((id: string) => id === 'track-start-layer');
            mockMap.getStyle.mockReturnValue({ layers: [{ id: 'track-layer-glow-123' }, { id: 'track-start-layer' }] });

            manager.setTripArea({
                tripId: 'trip-athens',
                centroidLat: 37.9838,
                centroidLng: 23.7275,
                bounds: {
                    west: 23.70,
                    east: 23.76,
                    south: 37.95,
                    north: 38.01,
                },
            });

            const sourceCall = mockMap.addSource.mock.calls.find((call) => call[0] === 'trip-area-source');
            expect(sourceCall).toBeDefined();
            expect(sourceCall?.[1]?.data?.features?.[0]?.geometry?.type).toBe('Polygon');
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'trip-area-fill-layer')).toBe(true);
            expect(mockMap.addLayer.mock.calls.some((call) => call[0]?.id === 'trip-area-outline-layer')).toBe(true);

            const fillLayerCall = mockMap.addLayer.mock.calls.find((call) => call[0]?.id === 'trip-area-fill-layer');
            expect(fillLayerCall?.[1]).toBe('track-start-layer');
        });

        it('should clear the trip area source and layers', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setTripArea({
                tripId: 'trip-athens',
                centroidLat: 37.9838,
                centroidLng: 23.7275,
                bounds: {
                    west: 23.70,
                    east: 23.76,
                    south: 37.95,
                    north: 38.01,
                },
            });

            mockMap.getLayer.mockImplementation((id: string) => id === 'trip-area-fill-layer' || id === 'trip-area-outline-layer');
            mockMap.getSource.mockImplementation((id: string) => id === 'trip-area-source');

            manager.clearTripArea();

            expect(mockMap.removeLayer).toHaveBeenCalledWith('trip-area-outline-layer');
            expect(mockMap.removeLayer).toHaveBeenCalledWith('trip-area-fill-layer');
            expect(mockMap.removeSource).toHaveBeenCalledWith('trip-area-source');
        });

        it('should restore the trip area after style reload', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockReturnValue(null);

            manager.setTripArea({
                tripId: 'trip-athens',
                centroidLat: 37.9838,
                centroidLng: 23.7275,
                bounds: {
                    west: 23.70,
                    east: 23.76,
                    south: 37.95,
                    north: 38.01,
                },
            });
            const beforeStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'trip-area-fill-layer').length;

            emitMapEvent('style.load');

            const afterStyleReload = mockMap.addLayer.mock.calls.filter((call) => call[0]?.id === 'trip-area-fill-layer').length;
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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
                effortLabel: 'Pace',
                effortDisplayLabel: '5:12 min/km',
                effortStatType: 'Average Pace',
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

        it('should highlight related polyline on start-point hover and restore on mouse leave', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockImplementation((id: string) => id.startsWith('track-layer-') || id === 'track-start-layer');
            const activity = { getID: () => 'activity-1', type: ActivityTypes.Running };
            manager.addTrackFromActivity(activity, [[10, 20], [10.01, 20.01]]);
            vi.clearAllMocks();
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockImplementation((id: string) => id.startsWith('track-layer-') || id === 'track-start-layer');

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
            emitMapEvent('mousemove', {
                features: [{
                    properties: { pointId },
                    geometry: { coordinates: [10, 20] }
                }]
            });
            expect(mockMap.setPaintProperty).toHaveBeenCalledWith('track-layer-activity-1', 'line-width', 4.2);

            emitMapEvent('mouseleave');
            expect(mockMap.setPaintProperty).toHaveBeenCalledWith('track-layer-activity-1', 'line-width', 3);
        });

        it('should highlight selected polyline and set marker green while popup selection is open', () => {
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockImplementation((id: string) => id.startsWith('track-layer-') || id === 'track-start-layer');
            const activity = { getID: () => 'activity-1', type: ActivityTypes.Running };
            manager.addTrackFromActivity(activity, [[10, 20], [10.01, 20.01]]);
            vi.clearAllMocks();
            mockMap.getSource.mockReturnValue(null);
            mockMap.getLayer.mockImplementation((id: string) => id.startsWith('track-layer-') || id === 'track-start-layer');

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
            emitMapEvent('click', {
                features: [{
                    properties: { pointId },
                    geometry: { coordinates: [10, 20] }
                }],
                point: { x: 1, y: 1 }
            });

            const latestSelectedSourceCall = mockMap.addSource.mock.calls
                .filter((call) => call[0] === 'track-start-source')
                .at(-1);
            const selectedMarkerColor = latestSelectedSourceCall?.[1]?.data?.features?.[0]?.properties?.markerColor;
            expect(selectedMarkerColor).toBe('#22c55e');
            expect(mockMap.setPaintProperty).toHaveBeenCalledWith('track-layer-activity-1', 'line-width', 4.2);

            manager.clearStartPointSelection();
            const latestClearedSourceCall = mockMap.addSource.mock.calls
                .filter((call) => call[0] === 'track-start-source')
                .at(-1);
            const clearedMarkerColor = latestClearedSourceCall?.[1]?.data?.features?.[0]?.properties?.markerColor;
            expect(clearedMarkerColor).toBe('#2ca3ff');
            expect(mockMap.setPaintProperty).toHaveBeenCalledWith('track-layer-activity-1', 'line-width', 3);
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

        it('should apply only latest deferred terrain request once style is ready', () => {
            mockMap.isStyleLoaded.mockReturnValue(false);

            manager.toggleTerrain(true, false);
            manager.toggleTerrain(false, false);
            expect(mockMap.setTerrain).not.toHaveBeenCalled();

            mockMap.isStyleLoaded.mockReturnValue(true);
            emitMapEvent('style.load');

            expect(mockMap.setTerrain).toHaveBeenCalledTimes(1);
            expect(mockMap.setTerrain).toHaveBeenCalledWith(null);
            expect(mockMap.setPitch).toHaveBeenCalledWith(0);
        });
    });
});
