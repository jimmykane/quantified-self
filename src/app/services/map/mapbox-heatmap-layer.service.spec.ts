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

    it('setLayerVisibility should defer until style is ready and then apply visibility', () => {
        const { map, handlers, setStyleReady } = createMapHarness({ styleReady: false, hasLayer: true });

        service.setLayerVisibility(map as any, 'heat-layer', false);
        expect(map.setLayoutProperty).not.toHaveBeenCalled();

        setStyleReady(true);
        handlers['styledata'][0]();

        expect(map.setLayoutProperty).toHaveBeenCalledWith('heat-layer', 'visibility', 'none');
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
});

