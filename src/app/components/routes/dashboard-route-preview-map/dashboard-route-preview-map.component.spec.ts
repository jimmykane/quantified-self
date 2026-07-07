import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DashboardRoutePreviewMapComponent } from './dashboard-route-preview-map.component';
import { AppThemeService } from '../../../services/app.theme.service';
import { LoggerService } from '../../../services/logger.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';

describe('DashboardRoutePreviewMapComponent', () => {
  let fixture: ComponentFixture<DashboardRoutePreviewMapComponent>;
  let createMapResolve: (map: any) => void;
  let mapboxLoaderMock: { createMap: ReturnType<typeof vi.fn>; loadMapbox: ReturnType<typeof vi.fn> };
  let mapboxAutoResizeMock: { bind: ReturnType<typeof vi.fn>; unbind: ReturnType<typeof vi.fn> };
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

    await TestBed.configureTestingModule({
      imports: [DashboardRoutePreviewMapComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } },
        { provide: MarkerFactoryService, useValue: {} },
        { provide: MapboxAutoResizeService, useValue: mapboxAutoResizeMock },
        { provide: MapboxLoaderService, useValue: mapboxLoaderMock },
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

    fixture = TestBed.createComponent(DashboardRoutePreviewMapComponent);
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
