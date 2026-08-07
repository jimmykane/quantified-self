import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppMapStyleName } from '../../models/app-user.interface';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import {
  MapboxLayersControlService,
  type MapboxLayersControlInputs,
  type MapboxLayersControlOutputs,
} from '../../services/map/mapbox-layers-control.service';
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
  const styleSynchronizer = {
    update: vi.fn(),
  };
  const mapStyleService = {
    normalizeStyle: vi.fn((value: string | undefined) => value || 'default'),
    resolve: vi.fn((style: string) => ({
      styleUrl: style === 'outdoors'
        ? 'mapbox://styles/mapbox/outdoors-v12'
        : style === 'satellite'
          ? 'mapbox://styles/mapbox/standard-satellite'
          : 'mapbox://styles/mapbox/standard',
      preset: style === 'outdoors' ? undefined : 'day',
    })),
    createSynchronizer: vi.fn(() => styleSynchronizer),
  };
  const appUser = { uid: 'assistant-map-user' };
  const userSettingsQuery = {
    mapSettings: signal<{
      mapStyle: AppMapStyleName;
      assistantMapStyle: AppMapStyleName;
    }>({
      mapStyle: 'satellite',
      assistantMapStyle: 'outdoors',
    }),
    updateMapSettings: vi.fn().mockResolvedValue(undefined),
  };
  const mapLayersControlHandle = {
    control: { onAdd: vi.fn(), onRemove: vi.fn() },
    instance: {},
    updateInputs: vi.fn(),
    destroy: vi.fn(),
  };
  let mapLayersControlConfig: {
    inputs?: Partial<MapboxLayersControlInputs>;
    outputs?: MapboxLayersControlOutputs;
  } | undefined;
  const mapLayersControl = {
    create: vi.fn((config: {
      inputs?: Partial<MapboxLayersControlInputs>;
      outputs?: MapboxLayersControlOutputs;
    }) => {
      mapLayersControlConfig = config;
      return mapLayersControlHandle;
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mapLayersControlConfig = undefined;
    sources.clear();
    layers.clear();
    handlers.clear();
    userSettingsQuery.mapSettings.set({
      mapStyle: 'satellite',
      assistantMapStyle: 'outdoors',
    });
    await TestBed.configureTestingModule({
      imports: [AssistantVisualMapComponent],
      providers: [
        { provide: MapboxLoaderService, useValue: loader },
        { provide: MapboxAutoResizeService, useValue: autoResize },
        { provide: MapboxLayersControlService, useValue: mapLayersControl },
        { provide: MapStyleService, useValue: mapStyleService },
        { provide: AppUserSettingsQueryService, useValue: userSettingsQuery },
        { provide: AppAuthService, useValue: { user$: of(appUser) } },
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

  it('uses the separate Assistant map style with the shared renderer and bounded camera', async () => {
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
    expect(mapStyleService.createSynchronizer).toHaveBeenCalledWith(map, {
      styleUrl: 'mapbox://styles/mapbox/outdoors-v12',
      preset: undefined,
    });
    expect(mapLayersControl.create).toHaveBeenCalledWith({
      inputs: {
        user: appUser,
        mapStyle: 'outdoors',
        enableJumpHeatmapToggle: false,
        enableLapsToggle: false,
        enableArrowsToggle: false,
        enable3DToggle: false,
        analyticsEventName: 'assistant_map_style_change',
      },
      outputs: {
        mapStyleChange: expect.any(Function),
      },
    });
    expect(map.addControl).toHaveBeenCalledWith(mapLayersControlHandle.control, 'top-left');
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

  it('switches the live map and persists only the Assistant map preference', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(autoResize.bind).toHaveBeenCalled());

    mapLayersControlConfig?.outputs?.mapStyleChange?.('satellite');

    expect(styleSynchronizer.update).toHaveBeenLastCalledWith({
      styleUrl: 'mapbox://styles/mapbox/standard-satellite',
      preset: 'day',
    });
    expect(mapLayersControlHandle.updateInputs).toHaveBeenLastCalledWith({
      mapStyle: 'satellite',
    });
    expect(userSettingsQuery.updateMapSettings).toHaveBeenCalledWith({
      assistantMapStyle: 'satellite',
    });
    expect(userSettingsQuery.updateMapSettings).not.toHaveBeenCalledWith({
      mapStyle: expect.anything(),
    });
  });

  it('applies a saved Assistant preference change to an active map', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(autoResize.bind).toHaveBeenCalled());

    userSettingsQuery.mapSettings.set({
      mapStyle: 'satellite',
      assistantMapStyle: 'default',
    });
    fixture.detectChanges();

    await vi.waitFor(() => expect(styleSynchronizer.update).toHaveBeenLastCalledWith({
      styleUrl: 'mapbox://styles/mapbox/standard',
      preset: 'day',
    }));
    expect(mapLayersControlHandle.updateInputs).toHaveBeenLastCalledWith({
      user: appUser,
      mapStyle: 'default',
    });
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
    expect(mapLayersControlHandle.destroy).toHaveBeenCalledOnce();
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
