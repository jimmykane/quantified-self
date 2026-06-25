import {
  DataAscent,
  DataDescent,
  DataDistance,
  DataGradeMax,
  DataGradeMin,
  RouteFileInterface,
  RouteInterface,
} from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import {
  buildRouteSegmentDetailViews,
  buildRouteSummaryMetrics,
  buildRouteWaypointDetailViews,
  buildRouteWaypointDisplayViews,
  RouteWaypointDetailView,
} from './route-detail.helper';
import { resolveRouteWaypointPresentation } from './route-waypoint-presentation.helper';

describe('route detail helpers', () => {
  it('builds segment views from parsed route data and keeps Firestore segment IDs', () => {
    const routeDocument = createRouteDocument();
    const parsedRoute = createRoute({
      id: null,
      name: 'Parsed Segment',
      pointCount: 2,
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 0, longitudeDegrees: 0 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
      stats: {
        [DataDistance.type]: 1234,
        [DataAscent.type]: 56,
        [DataDescent.type]: 45,
        [DataGradeMin.type]: -7,
        [DataGradeMax.type]: 11,
      },
    });

    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([parsedRoute]), null);

    expect(segments).toHaveLength(1);
    expect(segments[0].id).toBe('stored-segment-1');
    expect(segments[0].routeIndex).toBe(0);
    expect(segments[0].label).toBe('Parsed Segment');
    expect(segments[0].positions).toEqual([
      { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
      { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
    ]);
    expect(segments[0].distance.rawValue).toBe(1000);
    expect(segments[0].minGrade.rawValue).toBe(-4);
    expect(segments[0].maxGrade.rawValue).toBe(9);
  });

  it('does not use parsed stats when stored segment stats are missing', () => {
    const routeDocument = {
      ...createRouteDocument(),
      routes: [{
        id: 'stored-segment-1',
        name: 'Stored Segment',
        activityType: 'Running',
        pointCount: 2,
        streamTypes: [],
      }],
    };
    const parsedRoute = createRoute({
      id: 'stored-segment-1',
      name: 'Parsed Segment',
      pointCount: 2,
      positions: [],
      stats: {
        [DataDistance.type]: 1234,
        [DataAscent.type]: 56,
        [DataDescent.type]: 45,
      },
    });

    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([parsedRoute]), null);

    expect(segments[0].distance.rawValue).toBeNull();
    expect(segments[0].ascent.rawValue).toBeNull();
    expect(segments[0].descent.rawValue).toBeNull();
  });

  it('builds route summary metrics from top-level route document stats', () => {
    const routeDocument = {
      ...createRouteDocument(),
      pointCount: 9,
      stats: {
        [DataDistance.type]: 5000,
        [DataAscent.type]: 70,
        [DataDescent.type]: 45,
        [DataGradeMin.type]: -12,
        [DataGradeMax.type]: 18,
      },
    };
    const metrics = buildRouteSummaryMetrics(routeDocument, null);

    expect(metrics.map(metric => metric.label)).toEqual(['Distance', 'Ascent', 'Descent', 'Min grade', 'Max grade', 'Points']);
    expect(metrics.find(metric => metric.label === 'Distance')?.value).toBe('5.00 Km');
    expect(metrics.find(metric => metric.label === 'Ascent')?.value).toBe('70 m');
    expect(metrics.find(metric => metric.label === 'Descent')?.value).toBe('45 m');
    expect(metrics.find(metric => metric.label === 'Min grade')?.value).toBe('-12 %');
    expect(metrics.find(metric => metric.label === 'Max grade')?.value).toBe('18 %');
    expect(metrics.find(metric => metric.label === 'Points')?.value).toBe('9');
  });

  it('does not aggregate route summary metrics from segments when top-level stats are missing', () => {
    const routeDocument = {
      ...createRouteDocument(),
    };
    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([
      createRoute({
        id: 'stored-segment-1',
        name: 'A',
        pointCount: 2,
        positions: [],
        stats: {
          [DataDistance.type]: 1000,
          [DataAscent.type]: 20,
          [DataDescent.type]: 12,
          [DataGradeMin.type]: -5,
          [DataGradeMax.type]: 8,
        },
      }),
    ]), null);

    const metrics = buildRouteSummaryMetrics(routeDocument, null);

    expect(segments[0].distance.rawValue).toBe(1000);
    expect(metrics.find(metric => metric.label === 'Distance')?.value).toBe('-');
    expect(metrics.find(metric => metric.label === 'Ascent')?.value).toBe('-');
    expect(metrics.find(metric => metric.label === 'Descent')?.value).toBe('-');
    expect(metrics.find(metric => metric.label === 'Min grade')?.value).toBe('-');
    expect(metrics.find(metric => metric.label === 'Max grade')?.value).toBe('-');
  });

  it('builds compact waypoint views with distance labels', () => {
    const routeFile = {
      getWaypoints: vi.fn(() => [
        {
          name: 'Summit',
          type: 'peak',
          distance: 1000,
          routeIndex: 0,
          routePointIndex: 2,
          latitudeDegrees: 40.2,
          longitudeDegrees: 22.2,
        },
        {
          name: 'Invalid',
          latitudeDegrees: Number.NaN,
          longitudeDegrees: 22.3,
        },
      ]),
    } as unknown as RouteFileInterface;

    const waypoints = buildRouteWaypointDetailViews(routeFile, null);

    expect(waypoints).toHaveLength(1);
    expect(waypoints[0]).toMatchObject({
      name: 'Summit',
      type: 'peak',
      sourceTypeLabel: 'peak',
      sourceSymbolLabel: null,
      isRouteShapingPoint: false,
      presentation: expect.objectContaining({
        category: 'summit',
        icon: 'terrain',
        label: 'Summit',
        sourceLabel: 'peak',
      }),
      routeIndex: 0,
      routePointIndex: 2,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
    });
    expect(waypoints[0].distanceLabel).toBe('1.00 Km');
  });

  it('preserves numeric FIT course-point type zero in waypoint detail views', () => {
    const routeFile = {
      getWaypoints: vi.fn(() => [
        {
          name: 'Generic course point',
          type: 0,
          latitudeDegrees: 40.2,
          longitudeDegrees: 22.2,
        },
      ]),
    } as unknown as RouteFileInterface;

    const waypoints = buildRouteWaypointDetailViews(routeFile, null);

    expect(waypoints[0]).toMatchObject({
      type: '0',
      sourceTypeLabel: '0',
      presentation: expect.objectContaining({
        category: 'generic',
        sourceLabel: '0',
      }),
    });
  });

  it('builds waypoint display views with segment and presentation colors', () => {
    const routeDocument = createRouteDocument();
    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([
      createRoute({
        id: 'stored-segment-1',
        name: 'Parsed Segment',
        pointCount: 2,
        positions: [],
        stats: {},
      }),
    ]), null);
    const waypoints: RouteWaypointDetailView[] = [
      createWaypoint('Segment aid station', 'water', 0),
      createWaypoint('Global summit', 'peak', null),
    ];

    const displayViews = buildRouteWaypointDisplayViews(waypoints, segments);

    expect(displayViews).toHaveLength(2);
    expect(displayViews[0]).toMatchObject({
      name: 'Segment aid station',
      color: segments[0].color,
      segmentLabel: 'Parsed Segment',
    });
    expect(displayViews[1]).toMatchObject({
      name: 'Global summit',
      color: '#8e24aa',
      segmentLabel: 'Global',
      presentation: expect.objectContaining({
        category: 'summit',
        icon: 'terrain',
      }),
    });
  });

  it('does not render shaping points as visible waypoint display rows', () => {
    const routeDocument = createRouteDocument();
    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([
      createRoute({
        id: 'stored-segment-1',
        name: 'Parsed Segment',
        pointCount: 2,
        positions: [],
        stats: {},
      }),
    ]), null);
    const waypoints: RouteWaypointDetailView[] = [
      createWaypoint('Shaping point', '26', 0),
      createWaypoint('Aid station', 'aid_station', 0),
    ];

    const displayViews = buildRouteWaypointDisplayViews(waypoints, segments);

    expect(displayViews.map(waypoint => waypoint.name)).toEqual(['Aid station']);
  });

  function createRouteDocument(): FirestoreRouteJSON {
    return {
      id: 'route-1',
      userID: 'user-1',
      name: 'Route',
      srcFileType: 'gpx',
      createdAt: null,
      routes: [{
        id: 'stored-segment-1',
        name: 'Stored Segment',
        activityType: 'Running',
        pointCount: 2,
        streamTypes: [],
        stats: {
          [DataDistance.type]: 1000,
          [DataAscent.type]: 20,
          [DataDescent.type]: 15,
          [DataGradeMin.type]: -4,
          [DataGradeMax.type]: 9,
        },
      }],
      routeCount: 1,
      waypointCount: 0,
      pointCount: 2,
      activityTypes: ['Running'],
      streamTypes: [],
    };
  }

  function createRouteFile(routes: RouteInterface[]): RouteFileInterface {
    return {
      getRoutes: vi.fn(() => routes),
      getWaypoints: vi.fn(() => []),
    } as unknown as RouteFileInterface;
  }

  function createRoute(options: {
    id: string | null;
    name: string;
    pointCount: number;
    positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>;
    stats: Record<string, number>;
  }): RouteInterface {
    return {
      name: options.name,
      activityType: 'Running',
      getID: vi.fn(() => options.id),
      getPointCount: vi.fn(() => options.pointCount),
      getSquashedPositionData: vi.fn(() => options.positions),
      getStat: vi.fn((type: string) => options.stats[type] === undefined ? undefined : {
        getValue: () => options.stats[type],
      }),
    } as unknown as RouteInterface;
  }

  function createWaypoint(
    name: string,
    type: string,
    routeIndex: number | null,
  ): RouteWaypointDetailView {
    return {
      id: name,
      name,
      type,
      sourceTypeLabel: type,
      sourceSymbolLabel: null,
      presentation: resolveRouteWaypointPresentation({ name, type }),
      isRouteShapingPoint: resolveRouteWaypointPresentation({ name, type }).isRouteShapingPoint,
      distanceLabel: null,
      routeIndex,
      routePointIndex: null,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
    };
  }
});
