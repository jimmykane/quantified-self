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
    expect(segments[0].distance.rawValue).toBe(1234);
    expect(segments[0].minGrade.rawValue).toBe(-7);
    expect(segments[0].maxGrade.rawValue).toBe(11);
  });

  it('falls back to Firestore summary stats when parsed stats are missing', () => {
    const routeDocument = createRouteDocument();
    const parsedRoute = createRoute({
      id: 'stored-segment-1',
      name: 'Parsed Segment',
      pointCount: 2,
      positions: [],
      stats: {},
    });

    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile([parsedRoute]), null);

    expect(segments[0].distance.rawValue).toBe(1000);
    expect(segments[0].ascent.rawValue).toBe(20);
    expect(segments[0].descent.rawValue).toBe(15);
  });

  it('builds route summary metrics from parsed segments first', () => {
    const routeDocument = createRouteDocument();
    const routes = [
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
      createRoute({
        id: 'stored-segment-2',
        name: 'B',
        pointCount: 3,
        positions: [],
        stats: {
          [DataDistance.type]: 2000,
          [DataAscent.type]: 30,
          [DataDescent.type]: 18,
          [DataGradeMin.type]: -9,
          [DataGradeMax.type]: 12,
        },
      }),
    ];
    const segments = buildRouteSegmentDetailViews(routeDocument, createRouteFile(routes), null);

    const metrics = buildRouteSummaryMetrics(routeDocument, segments, null);

    expect(metrics.map(metric => metric.label)).toEqual(['Distance', 'Ascent', 'Descent', 'Min grade', 'Max grade', 'Points']);
    expect(metrics.find(metric => metric.label === 'Points')?.value).toBe('5');
    expect(metrics.find(metric => metric.label === 'Min grade')?.value).toBe('-9 %');
    expect(metrics.find(metric => metric.label === 'Max grade')?.value).toBe('12 %');
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
      routeIndex: 0,
      routePointIndex: 2,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
    });
    expect(waypoints[0].distanceLabel).toBe('1.00 Km');
  });

  it('builds waypoint display views with segment and type colors', () => {
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
    });
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
      distanceLabel: null,
      routeIndex,
      routePointIndex: null,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
    };
  }
});
