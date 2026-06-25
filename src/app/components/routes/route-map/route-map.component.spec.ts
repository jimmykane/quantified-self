import { ChangeDetectorRef, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { resolveRouteWaypointPresentation } from '../../../helpers/route-waypoint-presentation.helper';
import { AppThemeService } from '../../../services/app.theme.service';
import { RouteMapComponent } from './route-map.component';

describe('RouteMapComponent', () => {
  it('passes waypoint icon, color, title, and aria label to the marker factory', () => {
    const markerElement = document.createElement('div');
    const markerFactory = {
      createIconPinMarker: vi.fn(() => markerElement),
      createCompactIconMarker: vi.fn(() => document.createElement('div')),
    };
    const component = createComponent(markerFactory);
    const waypoint = {
      id: 'waypoint-1',
      name: 'Water stop',
      type: 'Water',
      sourceTypeLabel: 'Water',
      sourceSymbolLabel: null,
      presentation: resolveRouteWaypointPresentation({ type: 'Water' }),
      isRouteShapingPoint: false,
      isRouteTurnInstruction: false,
      distanceLabel: '1.00 Km',
      routeIndex: 0,
      routePointIndex: 12,
      latitudeDegrees: 40.1,
      longitudeDegrees: 22.1,
      color: '#0277bd',
      segmentLabel: 'Segment 1',
      segmentId: 'segment-1',
    };

    const result = (component as unknown as {
      createWaypointMarker(color: string, waypoint: typeof waypoint): HTMLElement;
    }).createWaypointMarker('#0277bd', waypoint);

    expect(result).toBe(markerElement);
    expect(markerFactory.createIconPinMarker).toHaveBeenCalledWith({
      color: '#0277bd',
      icon: 'water_drop',
      title: 'Water stop\nWater\n1.00 Km\nSegment 1',
      ariaLabel: 'Waypoint Water stop, Water, 1.00 Km, Segment 1',
    });
    expect(markerFactory.createCompactIconMarker).not.toHaveBeenCalled();
  });

  it('uses compact markers for turn-by-turn waypoint instructions', () => {
    const markerElement = document.createElement('div');
    const markerFactory = {
      createIconPinMarker: vi.fn(() => document.createElement('div')),
      createCompactIconMarker: vi.fn(() => markerElement),
    };
    const component = createComponent(markerFactory);
    const waypoint = {
      id: 'waypoint-1',
      name: 'Sharp right',
      type: 'Sharp_right_turn',
      sourceTypeLabel: 'Sharp_right_turn',
      sourceSymbolLabel: null,
      presentation: resolveRouteWaypointPresentation({ type: 'Sharp_right_turn' }),
      isRouteShapingPoint: false,
      isRouteTurnInstruction: true,
      distanceLabel: '2.00 Km',
      routeIndex: 0,
      routePointIndex: 28,
      latitudeDegrees: 40.1,
      longitudeDegrees: 22.1,
      color: '#3949ab',
      segmentLabel: 'Segment 1',
      segmentId: 'segment-1',
    };

    const result = (component as unknown as {
      createWaypointMarker(color: string, waypoint: typeof waypoint): HTMLElement;
    }).createWaypointMarker('#3949ab', waypoint);

    expect(result).toBe(markerElement);
    expect(markerFactory.createIconPinMarker).not.toHaveBeenCalled();
    expect(markerFactory.createCompactIconMarker).toHaveBeenCalledWith({
      color: '#3949ab',
      icon: 'turn_sharp_right',
      svgPath: 'M8 12h9m-3.5-3.5L17 12l-3.5 3.5',
      title: 'Sharp right\nSharp right turn\n2.00 Km\nSegment 1',
      ariaLabel: 'Waypoint Sharp right, Sharp right turn, 2.00 Km, Segment 1',
    });
    expect((component as unknown as {
      getWaypointMarkerAnchor(waypoint: typeof waypoint): 'bottom' | 'center';
    }).getWaypointMarkerAnchor(waypoint)).toBe('center');
  });

  it('uses bottom anchors for normal waypoint pin markers', () => {
    const markerFactory = {
      createIconPinMarker: vi.fn(() => document.createElement('div')),
      createCompactIconMarker: vi.fn(() => document.createElement('div')),
    };
    const component = createComponent(markerFactory);
    const waypoint = {
      id: 'waypoint-1',
      name: 'Water stop',
      type: 'Water',
      sourceTypeLabel: 'Water',
      sourceSymbolLabel: null,
      presentation: resolveRouteWaypointPresentation({ type: 'Water' }),
      isRouteShapingPoint: false,
      isRouteTurnInstruction: false,
      distanceLabel: '1.00 Km',
      routeIndex: 0,
      routePointIndex: 12,
      latitudeDegrees: 40.1,
      longitudeDegrees: 22.1,
      color: '#0277bd',
      segmentLabel: 'Segment 1',
      segmentId: 'segment-1',
    };

    expect((component as unknown as {
      getWaypointMarkerAnchor(waypoint: typeof waypoint): 'bottom' | 'center';
    }).getWaypointMarkerAnchor(waypoint)).toBe('bottom');
  });

  function createComponent(markerFactory: {
    createIconPinMarker: ReturnType<typeof vi.fn>;
    createCompactIconMarker: ReturnType<typeof vi.fn>;
  }): RouteMapComponent {
    TestBed.configureTestingModule({
      providers: [{
        provide: AppThemeService,
        useValue: { appTheme: signal(AppThemes.Light) },
      }],
    });

    return TestBed.runInInjectionContext(() => new RouteMapComponent(
      { run: (callback: () => void) => callback() } as unknown as NgZone,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      {
        mapSettings: signal({}),
        updateMapSettings: vi.fn(),
      } as any,
      markerFactory as any,
      {} as any,
      { bind: vi.fn(), unbind: vi.fn() } as any,
      {
        resolve: vi.fn(() => ({ styleUrl: 'mapbox://styles/default' })),
        createSynchronizer: vi.fn(),
        adjustColorForTheme: vi.fn((color: string) => color),
        isStandard: vi.fn(() => false),
      } as any,
      { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as any,
    ));
  }
});
