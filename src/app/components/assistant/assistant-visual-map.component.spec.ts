import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import { AssistantVisualMapComponent } from './assistant-visual-map.component';

describe('AssistantVisualMapComponent', () => {
  let fixture: ComponentFixture<AssistantVisualMapComponent>;
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const handlers = new Map<string, Set<() => void>>();
  const map = {
    addControl: vi.fn(),
    addLayer: vi.fn((layer: { id: string }) => layers.set(layer.id, layer)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    fitBounds: vi.fn(),
    getLayer: vi.fn((id: string) => layers.get(id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    isStyleLoaded: vi.fn(() => true),
    off: vi.fn((event: string, handler: () => void) => handlers.get(event)?.delete(handler)),
    on: vi.fn((event: string, ...args: unknown[]) => {
      const handler = args.at(-1) as () => void;
      const current = handlers.get(event) ?? new Set();
      current.add(handler);
      handlers.set(event, current);
    }),
    remove: vi.fn(),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setPaintProperty: vi.fn(),
  };
  class Marker {
    setLngLat = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
    constructor(readonly options: unknown) {}
  }
  class LngLatBounds {
    extend = vi.fn(() => this);
  }
  const mapboxgl = {
    LngLatBounds,
    Marker,
    NavigationControl: class {},
    ScaleControl: class {},
  };
  const loader = {
    createMap: vi.fn().mockResolvedValue(map),
    loadMapbox: vi.fn().mockResolvedValue(mapboxgl),
  };
  const autoResize = {
    bind: vi.fn(),
    unbind: vi.fn(),
  };
  const mapStyleService = {
    normalizeStyle: vi.fn((value: string | undefined) => value || 'default'),
    resolve: vi.fn((style: string) => ({
      styleUrl: style === 'outdoors'
        ? 'mapbox://styles/mapbox/outdoors-v12'
        : 'mapbox://styles/mapbox/standard-satellite',
      preset: style === 'outdoors' ? undefined : 'day',
    })),
  };
  const userSettingsQuery = {
    mapSettings: signal({ mapStyle: 'outdoors' as const }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    sources.clear();
    layers.clear();
    handlers.clear();
    await TestBed.configureTestingModule({
      imports: [AssistantVisualMapComponent],
      providers: [
        { provide: MapboxLoaderService, useValue: loader },
        { provide: MapboxAutoResizeService, useValue: autoResize },
        { provide: MapStyleService, useValue: mapStyleService },
        { provide: AppUserSettingsQueryService, useValue: userSettingsQuery },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AssistantVisualMapComponent);
    fixture.componentInstance.visual = {
      kind: 'map',
      title: 'Activity location',
      style: 'user_preference',
      markers: [{
        kind: 'jump',
        label: 'Biggest jump',
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.853,
      }],
      path: [
        { latitudeDegrees: 39.66, longitudeDegrees: 20.85 },
        { latitudeDegrees: 39.67, longitudeDegrees: 20.86 },
      ],
    };
  });

  it('uses the preferred map style with the shared renderer and bounded camera', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(autoResize.bind).toHaveBeenCalled());

    expect(fixture.nativeElement.querySelector('.assistant-visual-map').getAttribute('role'))
      .toBe('region');
    expect(loader.createMap).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [20.85, 39.66],
    }));
    expect(mapStyleService.normalizeStyle).toHaveBeenCalledWith('outdoors');
    expect(mapStyleService.resolve).toHaveBeenCalledWith('outdoors', AppThemes.Normal);
    expect(autoResize.bind).toHaveBeenCalledWith(map, expect.objectContaining({
      container: expect.any(HTMLElement),
      throttleMs: 150,
    }));
    expect(map.addSource).toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledWith(expect.any(LngLatBounds), {
      padding: 50,
      animate: false,
      maxZoom: 16,
    });
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.loadFailed()).toBe(false);
  });

  it('uses the current preference for an existing stored satellite visual', async () => {
    fixture.componentInstance.visual = {
      ...fixture.componentInstance.visual,
      style: 'satellite',
    };

    fixture.detectChanges();
    await vi.waitFor(() => expect(autoResize.bind).toHaveBeenCalled());

    expect(mapStyleService.normalizeStyle).toHaveBeenCalledWith('outdoors');
    expect(mapStyleService.resolve).toHaveBeenCalledWith('outdoors', AppThemes.Normal);
    expect(loader.createMap).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      style: 'mapbox://styles/mapbox/outdoors-v12',
    }));
  });

  it('removes the only active map and resize binding on teardown', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(autoResize.bind).toHaveBeenCalled());
    fixture.destroy();

    expect(autoResize.unbind).toHaveBeenCalledWith(map);
    expect(map.remove).toHaveBeenCalledOnce();
  });

  it('removes a partially initialized map when the shared Mapbox module lookup fails', async () => {
    loader.loadMapbox.mockRejectedValueOnce(new Error('Mapbox module unavailable'));

    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loadFailed()).toBe(true));

    expect(map.remove).toHaveBeenCalledOnce();
    expect(autoResize.bind).not.toHaveBeenCalled();
  });
});
