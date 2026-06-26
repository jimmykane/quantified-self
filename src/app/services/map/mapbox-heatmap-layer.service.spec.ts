import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapboxHeatmapLayerService } from './mapbox-heatmap-layer.service';

describe('MapboxHeatmapLayerService', () => {
    let service: MapboxHeatmapLayerService;
    let logger: { log: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        logger = {
            log: vi.fn()
        };
        service = new MapboxHeatmapLayerService(logger as any);
    });

    function createMapHarness(options?: { styleReady?: boolean; hasLayer?: boolean; hasSource?: boolean }) {
        let styleReady = options?.styleReady ?? true;
        const handlers: Record<string, Array<() => void>> = {};
        const source = options?.hasSource ? { setData: vi.fn() } : null;
        const layer = options?.hasLayer ? { id: 'heat-layer' } : null;

        const map = {
            isStyleLoaded: vi.fn(() => styleReady),
            getSource: vi.fn(() => source),
            addSource: vi.fn(),
            getLayer: vi.fn(() => layer),
            addLayer: vi.fn(),
            moveLayer: vi.fn(),
            setLayoutProperty: vi.fn(),
            removeLayer: vi.fn(),
            removeSource: vi.fn(),
            on: vi.fn((event: string, handler: () => void) => {
                handlers[event] = handlers[event] || [];
                handlers[event].push(handler);
            }),
            off: vi.fn((event: string, handler: () => void) => {
                handlers[event] = (handlers[event] || []).filter(existing => existing !== handler);
            })
        };

        return {
            map,
            handlers,
            setStyleReady(value: boolean) {
                styleReady = value;
            }
        };
    }

    it('renderGeoJsonHeatmapLayer should defer render until style is ready and then retry', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: false, hasSource: false });
        const config = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]
            },
            paint: { 'heatmap-opacity': 0.8 },
            beforeLayerId: 'tracks-layer'
        };

        service.renderGeoJsonHeatmapLayer(map as any, config);

        expect(logger.log).toHaveBeenCalledWith(
            '[MapboxHeatmapLayerService] Heatmap render deferred; style not ready.',
            { layerId: 'heat-layer' }
        );
        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.addLayer).not.toHaveBeenCalled();

        setStyleReady(true);
        handlers['style.load'][0]();

        expect(map.addSource).toHaveBeenCalledWith('heat-source', {
            type: 'geojson',
            data: config.featureCollection
        });
        expect(map.addLayer).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'heat-layer',
                type: 'heatmap',
                source: 'heat-source',
                layout: { visibility: 'visible' },
                paint: { 'heatmap-opacity': 0.8 }
            }),
            'tracks-layer'
        );
        expect(map.off).toHaveBeenCalledWith('style.load', expect.any(Function));
        expect(map.off).toHaveBeenCalledWith('styledata', expect.any(Function));
        expect(map.off).toHaveBeenCalledWith('load', expect.any(Function));
        expect(map.off).toHaveBeenCalledWith('idle', expect.any(Function));
    });

    it('renderGeoJsonHeatmapLayer should replay the latest deferred render for the same layer', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: false, hasSource: false });
        const oldConfig = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'old' } }]
            },
            paint: { 'heatmap-opacity': 0.4 }
        };
        const newConfig = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 'new' } }]
            },
            paint: { 'heatmap-opacity': 0.9 }
        };

        service.renderGeoJsonHeatmapLayer(map as any, oldConfig);
        service.renderGeoJsonHeatmapLayer(map as any, newConfig);

        expect(handlers['style.load']).toHaveLength(1);

        setStyleReady(true);
        handlers['style.load'][0]();

        expect(map.addSource).toHaveBeenCalledWith('heat-source', {
            type: 'geojson',
            data: newConfig.featureCollection
        });
        expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
            paint: { 'heatmap-opacity': 0.9 }
        }));
    });

    it('clearLayerAndSource should cancel a pending deferred render', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: false, hasSource: false });

        service.renderGeoJsonHeatmapLayer(map as any, {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]
            },
            paint: { 'heatmap-opacity': 0.8 }
        });

        expect(handlers['style.load']).toHaveLength(1);

        service.clearLayerAndSource(map as any, 'heat-source', 'heat-layer');

        setStyleReady(true);
        handlers['style.load'][0]?.();

        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.addLayer).not.toHaveBeenCalled();
        expect(map.off).toHaveBeenCalledWith('style.load', expect.any(Function));
    });

    it('renderGeoJsonHeatmapLayer should not defer work on a removed map', () => {
        const { map } = createMapHarness({ styleReady: false });
        (map as any)._removed = true;

        service.renderGeoJsonHeatmapLayer(map as any, {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]
            },
            paint: { 'heatmap-opacity': 0.8 }
        });

        expect(map.on).not.toHaveBeenCalled();
        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.addLayer).not.toHaveBeenCalled();
    });

    it('renderGeoJsonHeatmapLayer should retry source creation on the next style event after a style-swap error', () => {
        const { map, handlers } = createMapHarness({ styleReady: true, hasLayer: false, hasSource: false });
        const config = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]
            },
            paint: { 'heatmap-opacity': 0.8 }
        };
        map.addSource.mockImplementationOnce(() => {
            throw new Error('Style is not done loading');
        });

        service.renderGeoJsonHeatmapLayer(map as any, config);

        expect(map.addSource).toHaveBeenCalledTimes(1);
        expect(map.addLayer).not.toHaveBeenCalled();
        expect(handlers['idle']).toHaveLength(1);

        handlers['idle'][0]();

        expect(map.addSource).toHaveBeenCalledTimes(2);
        expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
            id: 'heat-layer',
            source: 'heat-source'
        }));
    });

    it('renderGeoJsonHeatmapLayer should cancel a stale deferred render after a newer render succeeds', () => {
        const { map, handlers } = createMapHarness({ styleReady: true, hasLayer: false, hasSource: false });
        const staleConfig = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'stale' } }]
            },
            paint: { 'heatmap-opacity': 0.3 }
        };
        const freshConfig = {
            sourceId: 'heat-source',
            layerId: 'heat-layer',
            featureCollection: {
                type: 'FeatureCollection' as const,
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 'fresh' } }]
            },
            paint: { 'heatmap-opacity': 0.9 }
        };
        map.addSource.mockImplementationOnce(() => {
            throw new Error('Style is not done loading');
        });

        service.renderGeoJsonHeatmapLayer(map as any, staleConfig);
        const deferredIdleHandler = handlers['idle'][0];

        service.renderGeoJsonHeatmapLayer(map as any, freshConfig);
        deferredIdleHandler();

        expect(map.addSource).toHaveBeenCalledTimes(2);
        expect(map.addSource).toHaveBeenLastCalledWith('heat-source', {
            type: 'geojson',
            data: freshConfig.featureCollection
        });
        expect(map.addLayer).toHaveBeenCalledTimes(1);
        expect(map.addLayer).toHaveBeenLastCalledWith(expect.objectContaining({
            id: 'heat-layer',
            paint: { 'heatmap-opacity': 0.9 }
        }));
        expect(map.off).toHaveBeenCalledWith('idle', deferredIdleHandler);
    });

    it('setLayerVisibility should defer until style is ready and then apply visibility', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: true });

        service.setLayerVisibility(map as any, 'heat-layer', false);
        expect(map.setLayoutProperty).not.toHaveBeenCalled();

        setStyleReady(true);
        handlers['styledata'][0]();

        expect(map.setLayoutProperty).toHaveBeenCalledWith('heat-layer', 'visibility', 'none');
    });

    it('setLayerVisibility should cancel a stale deferred visibility update after a newer update succeeds', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: true });

        service.setLayerVisibility(map as any, 'heat-layer', false);
        const deferredIdleHandler = handlers['idle'][0];

        setStyleReady(true);
        service.setLayerVisibility(map as any, 'heat-layer', true);
        deferredIdleHandler();

        expect(map.setLayoutProperty).toHaveBeenCalledTimes(1);
        expect(map.setLayoutProperty).toHaveBeenCalledWith('heat-layer', 'visibility', 'visible');
        expect(map.off).toHaveBeenCalledWith('idle', deferredIdleHandler);
    });

    it('clearLayerAndSource should remove only existing layer/source', () => {
        const mapWithLayerAndSource = createMapHarness({ hasLayer: true, hasSource: true }).map;

        service.clearLayerAndSource(mapWithLayerAndSource as any, 'heat-source', 'heat-layer');

        expect(mapWithLayerAndSource.removeLayer).toHaveBeenCalledWith('heat-layer');
        expect(mapWithLayerAndSource.removeSource).toHaveBeenCalledWith('heat-source');
    });

    it('clearLayerAndSource should no-op when layer/source are missing', () => {
        const mapWithoutLayerAndSource = createMapHarness({ hasLayer: false, hasSource: false }).map;

        service.clearLayerAndSource(mapWithoutLayerAndSource as any, 'heat-source', 'heat-layer');

        expect(mapWithoutLayerAndSource.removeLayer).not.toHaveBeenCalled();
        expect(mapWithoutLayerAndSource.removeSource).not.toHaveBeenCalled();
    });

    it('clearLayerAndSource should no-op when Mapbox style internals are unavailable', () => {
        const mapDuringStyleTeardown = createMapHarness({ hasLayer: true, hasSource: true }).map;
        mapDuringStyleTeardown.getLayer.mockImplementation(() => {
            throw new TypeError("Cannot read properties of undefined (reading 'getOwnLayer')");
        });
        mapDuringStyleTeardown.getSource.mockImplementation(() => {
            throw new TypeError("Cannot read properties of undefined (reading 'getOwnSource')");
        });

        expect(() => service.clearLayerAndSource(mapDuringStyleTeardown as any, 'heat-source', 'heat-layer')).not.toThrow();

        expect(mapDuringStyleTeardown.removeLayer).not.toHaveBeenCalled();
        expect(mapDuringStyleTeardown.removeSource).not.toHaveBeenCalled();
    });

    it('clearLayerAndSource should ignore remove failures during Mapbox teardown', () => {
        const mapDuringRemoval = createMapHarness({ hasLayer: true, hasSource: true }).map;
        mapDuringRemoval.removeLayer.mockImplementation(() => {
            throw new Error('Style is not done loading');
        });
        mapDuringRemoval.removeSource.mockImplementation(() => {
            throw new Error('Style is not done loading');
        });

        expect(() => service.clearLayerAndSource(mapDuringRemoval as any, 'heat-source', 'heat-layer')).not.toThrow();

        expect(mapDuringRemoval.removeLayer).toHaveBeenCalledWith('heat-layer');
        expect(mapDuringRemoval.removeSource).toHaveBeenCalledWith('heat-source');
    });
});
