import { RouteSegmentDetailView, RouteWaypointDisplayView } from './route-detail.helper';

export interface RouteMapWaypointRenderData extends RouteWaypointDisplayView {
  segmentId: string;
}

export interface RouteMapSegmentRenderData {
  id: string;
  label: string;
  color: string;
  positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>;
  waypoints: RouteMapWaypointRenderData[];
}

export function buildRouteMapSegmentRenderData(
  segments: RouteSegmentDetailView[],
  waypoints: RouteWaypointDisplayView[],
): RouteMapSegmentRenderData[] {
  const selectedSegments = Array.isArray(segments) ? segments : [];
  return selectedSegments
    .map((segment, segmentIndex) => ({
      id: segment.id,
      label: segment.label,
      color: segment.color,
      positions: (segment.positions || []).filter(position => (
        Number.isFinite(position?.latitudeDegrees)
        && Number.isFinite(position?.longitudeDegrees)
        && (position.latitudeDegrees !== 0 || position.longitudeDegrees !== 0)
      )),
      waypoints: getSegmentWaypoints(segment, segmentIndex, selectedSegments, waypoints),
    }))
    .filter(segment => segment.positions.length > 1);
}

function getSegmentWaypoints(
  segment: RouteSegmentDetailView,
  segmentIndex: number,
  allSegments: RouteSegmentDetailView[],
  waypoints: RouteWaypointDisplayView[],
): RouteMapWaypointRenderData[] {
  const selectedSegmentIds = new Set(allSegments.map(item => item.id));
  const firstSelectedRouteIndex = allSegments[0]?.routeIndex ?? segmentIndex;
  return (Array.isArray(waypoints) ? waypoints : [])
    .filter(waypoint => Number.isFinite(waypoint.latitudeDegrees) && Number.isFinite(waypoint.longitudeDegrees))
    .filter((waypoint) => {
      if (waypoint.routeIndex === null) {
        return segment.routeIndex === firstSelectedRouteIndex;
      }
      return waypoint.routeIndex === segment.routeIndex;
    })
    .map(waypoint => ({
      ...waypoint,
      segmentId: selectedSegmentIds.has(segment.id) ? segment.id : '',
    }));
}
