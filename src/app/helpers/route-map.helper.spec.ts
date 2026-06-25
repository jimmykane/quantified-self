import { describe, expect, it } from 'vitest';
import { RouteSegmentDetailView, RouteWaypointDisplayView } from './route-detail.helper';
import { buildRouteMapSegmentRenderData } from './route-map.helper';
import { resolveRouteWaypointPresentation } from './route-waypoint-presentation.helper';

describe('route map helper', () => {
  it('builds segment render data, skips invalid coordinates, and assigns waypoints', () => {
    const segments = [
      createSegment('segment-1', [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: Number.NaN, longitudeDegrees: 22.2 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ], 0, '#111111'),
      createSegment('segment-2', [
        { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
      ], 1, '#222222'),
    ];
    const waypoints: RouteWaypointDisplayView[] = [
      createWaypoint('wp-1', 0, '#111111', 'segment-1'),
      createWaypoint('wp-2', null, '#3949ab', 'Global'),
      createWaypoint('wp-3', 1),
    ];

    const result = buildRouteMapSegmentRenderData(segments, waypoints);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('segment-1');
    expect(result[0].positions).toEqual([
      { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
      { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
    ]);
    expect(result[0].waypoints.map(waypoint => waypoint.id)).toEqual(['wp-1', 'wp-2']);
    expect(result[0].waypoints.map(waypoint => waypoint.color)).toEqual(['#111111', '#3949ab']);
    expect(result[0].waypoints.map(waypoint => waypoint.segmentLabel)).toEqual(['segment-1', 'Global']);
  });

  it('keeps waypoint assignment stable when only a later original segment is selected', () => {
    const selectedSegments = [
      createSegment('segment-2', [
        { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
        { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
      ], 1),
    ];
    const waypoints: RouteWaypointDisplayView[] = [
      createWaypoint('wp-original-first', 0),
      createWaypoint('wp-original-second', 1, '#1e88e5', 'segment-2'),
      createWaypoint('wp-global', null, '#607d8b', 'Global'),
    ];

    const result = buildRouteMapSegmentRenderData(selectedSegments, waypoints);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('segment-2');
    expect(result[0].waypoints.map(waypoint => waypoint.id)).toEqual(['wp-original-second', 'wp-global']);
    expect(result[0].waypoints.map(waypoint => waypoint.segmentLabel)).toEqual(['segment-2', 'Global']);
  });

  function createSegment(
    id: string,
    positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>,
    routeIndex: number,
    color = '#1e88e5',
  ): RouteSegmentDetailView {
    return {
      id,
      routeIndex,
      label: id,
      activityType: 'Running',
      color,
      route: {} as RouteSegmentDetailView['route'],
      positions,
      pointCount: positions.length,
      distance: { label: '-', rawValue: null, title: '' },
      ascent: { label: '-', rawValue: null, title: '' },
      descent: { label: '-', rawValue: null, title: '' },
      minGrade: { label: '-', rawValue: null, title: '' },
      maxGrade: { label: '-', rawValue: null, title: '' },
    };
  }

  function createWaypoint(
    id: string,
    routeIndex: number | null,
    color = '#1e88e5',
    segmentLabel = id,
  ): RouteWaypointDisplayView {
    return {
      id,
      name: id,
      type: 'Waypoint',
      sourceTypeLabel: 'Waypoint',
      sourceSymbolLabel: null,
      presentation: resolveRouteWaypointPresentation({ name: id, type: 'Waypoint' }),
      isRouteShapingPoint: false,
      distanceLabel: null,
      routeIndex,
      routePointIndex: null,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
      color,
      segmentLabel,
    };
  }
});
