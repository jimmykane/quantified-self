import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { RoutePreviewMapComponent } from './route-preview-map.component';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';

describe('RoutePreviewMapComponent', () => {
  let fixture: ComponentFixture<RoutePreviewMapComponent>;
  let createMapResolve: (map: any) => void;
  let mapboxLoaderMock: { createMap: ReturnType<typeof vi.fn>; loadMapbox: ReturnType<typeof vi.fn> };
  let mapboxAutoResizeMock: { bind: ReturnType<typeof vi.fn>; unbind: ReturnType<typeof vi.fn> };
  let analyticsMock: { logSavedRouteAction: ReturnType<typeof vi.fn> };
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let mapMock: {
    remove: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    addControl: ReturnType<typeof vi.fn>;
    isStyleLoaded: ReturnType<typeof vi.fn>;
  };
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 320,
      height: 180,
      top: 0,
      right: 320,
      bottom: 180,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    mapMock = {
      remove: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      addControl: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
    };
    mapboxLoaderMock = {
      createMap: vi.fn().mockImplementation(() => new Promise(resolve => {
        createMapResolve = resolve;
      })),
      loadMapbox: vi.fn().mockResolvedValue({
        ScaleControl: vi.fn(),
      }),
    };
    mapboxAutoResizeMock = {
      bind: vi.fn(),
      unbind: vi.fn(),
    };
    analyticsMock = {
      logSavedRouteAction: vi.fn(),
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [RoutePreviewMapComponent],
      providers: [
        { provide: AppAnalyticsService, useValue: analyticsMock },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } },
        { provide: MarkerFactoryService, useValue: {} },
        { provide: MapboxAutoResizeService, useValue: mapboxAutoResizeMock },
        { provide: MapboxLoaderService, useValue: mapboxLoaderMock },
        { provide: Router, useValue: routerMock },
        {
          provide: MapStyleService,
          useValue: {
            normalizeStyle: vi.fn((style) => style || 'default'),
            resolve: vi.fn(() => ({ styleUrl: 'mapbox://styles/mapbox/standard', preset: 'day' })),
            isStandard: vi.fn(() => true),
            createSynchronizer: vi.fn(() => ({ update: vi.fn() })),
            adjustColorForTheme: vi.fn((color) => color),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoutePreviewMapComponent);
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('removes a map that resolves after the component has been destroyed', async () => {
    fixture.detectChanges();
    expect(mapboxLoaderMock.createMap).toHaveBeenCalledTimes(1);

    fixture.destroy();
    createMapResolve(mapMock);
    await Promise.resolve();

    expect(mapMock.remove).toHaveBeenCalledTimes(1);
    expect(mapboxLoaderMock.loadMapbox).not.toHaveBeenCalled();
    expect(mapboxAutoResizeMock.bind).not.toHaveBeenCalled();
  });

  it('does not clear the parent-owned loading input when rendering an empty preview set', () => {
    const component = fixture.componentInstance as any;
    const loadedSpy = vi.spyOn(component, 'loaded');
    fixture.componentRef.setInput('isLoading', true);
    fixture.detectChanges();

    component.mapReady = true;
    component.mapInstance.set({ isStyleLoaded: () => true });

    component.renderRoutePreviews(true);

    expect(component.noMapData).toBe(true);
    expect(component.isLoading).toBe(true);
    expect(loadedSpy).not.toHaveBeenCalled();
  });

  it('passes route endpoint marker visibility into track rendering', () => {
    const component = fixture.componentInstance as any;
    const renderSpy = vi.spyOn(component.mapManager, 'renderTrackData').mockImplementation(() => undefined);

    component.showEndpointMarkers = false;
    component.mapReady = true;
    component.mapInstance.set({ isStyleLoaded: () => true });

    component.renderRoutePreviews(false);

    expect(renderSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        showEndpointMarkers: false,
        endpointMarkerStyle: 'dots',
      })
    );
  });

  it('reuses decoded route positions across filtered arrays while invalidating changed route documents', () => {
    const component = fixture.componentInstance as any;
    const route = buildPreviewRoute('route-1');
    component.routes = [route];

    const firstTracks = component.buildTracks();
    const secondTracks = component.buildTracks();

    expect(secondTracks[0].positions).toBe(firstTracks[0].positions);

    component.routes = [route];
    const filteredArrayTracks = component.buildTracks();

    expect(filteredArrayTracks[0].positions).toBe(firstTracks[0].positions);

    component.routes = [buildPreviewRoute('route-1')];
    const refreshedTracks = component.buildTracks();

    expect(refreshedTracks[0].positions).not.toBe(firstTracks[0].positions);
  });

  it('selects clicked route previews and opens route details', () => {
    const component = fixture.componentInstance as any;
    const renderSpy = vi.spyOn(component.mapManager, 'renderTrackData').mockImplementation(() => undefined);

    component.user = { uid: 'fallback-user', settings: { unitSettings: {} } };
    component.routes = [
      buildPreviewRoute('route-1', {
        userID: 'route-user',
        srcFileType: 'gpx',
        stats: {
          distance: 1234,
          ascent: 56,
          descent: 43,
        },
      }),
    ];
    component.mapReady = true;
    component.mapInstance.set({ isStyleLoaded: () => true });

    component.renderRoutePreviews(false);
    const renderOptions = renderSpy.mock.calls[0]?.[1];
    renderOptions.onTrackClick({
      track: {
        metadata: { routeId: 'route-1', routeUserId: 'route-user' },
      },
      originalEvent: {},
      latitudeDegrees: 39.6,
      longitudeDegrees: 20.8,
    });

    expect(component.selectedRoute()?.id).toBe('route-1');
    expect(component.selectedRouteMetrics().map((metric: { label: string }) => metric.label)).toEqual(['Distance', 'Ascent', 'Descent']);

    component.openSelectedRoute();

    expect(analyticsMock.logSavedRouteAction).toHaveBeenCalledWith('open_details', {
      fileType: 'gpx',
      source: 'dashboard_route_map',
    });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/user', 'route-user', 'route', 'route-1']);
  });

  it('refreshes an open route popup when the live route document changes', () => {
    const component = fixture.componentInstance as any;
    const originalRoute = buildPreviewRoute('route-1', { name: 'Original name' });
    const updatedRoute = buildPreviewRoute('route-1', {
      name: 'Updated name',
      stats: { distance: 4321, ascent: 80, descent: 75 },
    });
    vi.spyOn(component.mapManager, 'renderTrackData').mockImplementation(() => undefined);
    component.selectedRoute.set(originalRoute);
    component.routes = [updatedRoute];
    component.mapReady = true;
    component.mapInstance.set({ isStyleLoaded: () => true });

    component.renderRoutePreviews(false);

    expect(component.selectedRoute()).toBe(updatedRoute);
    expect(component.selectedRouteTitle()).toBe('Updated name');
    expect(component.selectedRouteMetrics().map((metric: { label: string }) => metric.label))
      .toEqual(['Distance', 'Ascent', 'Descent']);
  });

  it('uses the parent-provided analytics source when opening route details', () => {
    const component = fixture.componentInstance;
    component.analyticsSource = 'routes_page_map';
    component.selectedRoute.set(buildPreviewRoute('route-1'));

    component.openSelectedRoute();

    expect(analyticsMock.logSavedRouteAction).toHaveBeenCalledWith('open_details', {
      fileType: 'gpx',
      source: 'routes_page_map',
    });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/user', 'user-1', 'route', 'route-1']);
  });

  it('debounces automatic route preview bounds fits without animating repeated previews', () => {
    vi.useFakeTimers();
    try {
      const component = fixture.componentInstance as any;
      const fitSpy = vi.spyOn(component.mapManager, 'fitBoundsToTracks').mockReturnValue(true);
      component.mapReady = true;
      component.mapInstance.set({ isStyleLoaded: () => true });

      component.routes = [buildPreviewRoute('route-1')];
      component.renderRoutePreviews(true);
      component.routes = [buildPreviewRoute('route-1'), buildPreviewRoute('route-2')];
      component.renderRoutePreviews(true);

      vi.advanceTimersByTime(499);
      expect(fitSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fitSpy).toHaveBeenCalledTimes(1);
      expect(fitSpy).toHaveBeenCalledWith(false);

      component.renderRoutePreviews(true);
      vi.advanceTimersByTime(500);
      expect(fitSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an order-independent geometry-bounds fingerprint for automatic camera fits', () => {
    const component = fixture.componentInstance as any;
    const firstTrack = {
      id: 'route-1-segment-1',
      strokeColor: '#000000',
      positions: [
        { latitudeDegrees: 39, longitudeDegrees: 20 },
        { latitudeDegrees: 39.5, longitudeDegrees: 20.5 },
        { latitudeDegrees: 40, longitudeDegrees: 21 },
      ],
    };
    const secondTrack = {
      id: 'route-2-segment-1',
      strokeColor: '#ffffff',
      positions: [
        { latitudeDegrees: 41, longitudeDegrees: 22 },
        { latitudeDegrees: 42, longitudeDegrees: 23 },
      ],
    };

    const initialFingerprint = component.buildTrackBoundsFingerprint([firstTrack, secondTrack]);
    const reorderedFingerprint = component.buildTrackBoundsFingerprint([secondTrack, firstTrack]);
    const expandedFingerprint = component.buildTrackBoundsFingerprint([{
      ...firstTrack,
      positions: [
        firstTrack.positions[0],
        { latitudeDegrees: 50, longitudeDegrees: 30 },
        firstTrack.positions[2],
      ],
    }, secondTrack]);

    expect(reorderedFingerprint).toBe(initialFingerprint);
    expect(expandedFingerprint).not.toBe(initialFingerprint);
  });

  it('detaches map lifecycle handlers when destroyed after initialization', async () => {
    fixture.detectChanges();
    createMapResolve(mapMock);
    await Promise.resolve();
    await Promise.resolve();

    const componentLifecycleCalls = mapMock.on.mock.calls
      .filter(([eventName]) => ['style.import.load', 'styledata', 'idle', 'load'].includes(eventName));
    expect(componentLifecycleCalls).toHaveLength(4);

    fixture.destroy();

    componentLifecycleCalls.forEach(([eventName, handler]) => {
      expect(mapMock.off).toHaveBeenCalledWith(eventName, handler);
    });
    expect(mapMock.remove).toHaveBeenCalledTimes(1);
  });

  it('does not re-render route previews for styledata after the map is already ready', async () => {
    fixture.detectChanges();
    createMapResolve(mapMock);
    await Promise.resolve();
    await Promise.resolve();

    const component = fixture.componentInstance as any;
    const renderSpy = vi.spyOn(component, 'renderRoutePreviews');
    const styleDataHandler = mapMock.on.mock.calls.find(([eventName]) => eventName === 'styledata')?.[1];

    expect(styleDataHandler).toBeTruthy();
    styleDataHandler();

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('re-renders route previews for a real style load after the map is ready', async () => {
    fixture.detectChanges();
    createMapResolve(mapMock);
    await Promise.resolve();
    await Promise.resolve();

    const component = fixture.componentInstance as any;
    const renderSpy = vi.spyOn(component, 'renderRoutePreviews');
    const styleLoadHandlers = mapMock.on.mock.calls
      .filter(([eventName]) => eventName === 'style.load')
      .map(([, handler]) => handler);

    expect(styleLoadHandlers.length).toBeGreaterThan(0);
    styleLoadHandlers.forEach(handler => handler());

    expect(renderSpy).toHaveBeenCalledWith(true);
  });

  it('cleans up a created map when initialization fails before completion', async () => {
    mapMock.addControl.mockImplementationOnce(() => {
      throw new Error('control failed');
    });

    fixture.detectChanges();
    createMapResolve(mapMock);
    await Promise.resolve();
    await Promise.resolve();

    expect(mapboxAutoResizeMock.unbind).toHaveBeenCalledWith(mapMock);
    expect(mapMock.remove).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.mapLoadFailed).toBe(true);
    expect(fixture.componentInstance.apiLoaded()).toBe(true);
  });
});

function buildPreviewRoute(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    userID: 'user-1',
    name: id,
    srcFileType: 'gpx',
    routes: [],
    routeCount: 0,
    waypointCount: 0,
    pointCount: 2,
    activityTypes: [],
    streamTypes: [],
    createdAt: null,
    ...overrides,
    preview: {
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: 2,
      segments: [{
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline: '_p~iF~ps|U_ulLnnqC',
      }],
    },
  };
}
