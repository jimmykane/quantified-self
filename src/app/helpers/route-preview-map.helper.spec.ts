import { encodeRoutePolyline5 } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { buildRoutePreviewMapTracks, buildRoutePreviewThumbnail, isRenderableRoutePreview } from './route-preview-map.helper';

describe('route-preview-map.helper', () => {
  it('decodes preview polylines into map track render data', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
    ]);

    const tracks = buildRoutePreviewMapTracks([{
      id: 'route-1',
      userID: 'user-1',
      name: 'Lunch route',
      srcFileType: 'gpx',
      createdAt: null,
      routes: [],
      routeCount: 1,
      waypointCount: 0,
      pointCount: 2,
      activityTypes: [],
      streamTypes: [],
      preview: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 2,
        pointCount: 2,
        segments: [{
          id: 'segment-1',
          name: 'Main climb',
          sourcePointCount: 2,
          pointCount: 2,
          encodedPolyline,
        }],
      },
    }]);

    expect(tracks).toEqual([expect.objectContaining({
      id: 'route-1-segment-1',
      label: 'Main climb',
      positions: [
        { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
        { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
      ],
    })]);
  });

  it('skips previews that are not renderable', () => {
    expect(isRenderableRoutePreview(null)).toBe(false);
    expect(buildRoutePreviewMapTracks([{
      id: 'route-1',
      userID: 'user-1',
      name: 'Broken route',
      srcFileType: 'gpx',
      createdAt: null,
      routes: [],
      routeCount: 1,
      waypointCount: 0,
      pointCount: 2,
      activityTypes: [],
      streamTypes: [],
      preview: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 2,
        pointCount: 2,
        segments: [{
          sourcePointCount: 2,
          pointCount: 2,
          encodedPolyline: '',
        }],
      },
    }])).toEqual([]);
  });

  it('rejects malformed numeric route preview counts', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
    ]);

    expect(isRenderableRoutePreview({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: '2' as any,
      segments: [{
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline,
      }],
    })).toBe(false);

    expect(buildRoutePreviewMapTracks([{
      id: 'route-1',
      userID: 'user-1',
      name: 'Broken route',
      srcFileType: 'gpx',
      createdAt: null,
      routes: [],
      routeCount: 1,
      waypointCount: 0,
      pointCount: 2,
      activityTypes: [],
      streamTypes: [],
      preview: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 2,
        pointCount: 2,
        segments: [{
          sourcePointCount: 2,
          pointCount: '2' as any,
          encodedPolyline,
        }],
      },
    }])).toEqual([]);
  });

  it('uses route indexes in fallback track ids when route documents are malformed', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
    ]);

    const routes = [0, 1].map(index => ({
      userID: 'user-1',
      name: `Route ${index}`,
      srcFileType: 'gpx',
      createdAt: null,
      routes: [],
      routeCount: 1,
      waypointCount: 0,
      pointCount: 2,
      activityTypes: [],
      streamTypes: [],
      preview: {
        version: 1 as const,
        encoding: 'polyline5' as const,
        precision: 5 as const,
        sourcePointCount: 2,
        pointCount: 2,
        segments: [{
          sourcePointCount: 2,
          pointCount: 2,
          encodedPolyline,
        }],
      },
    }));

    expect(buildRoutePreviewMapTracks(routes).map(track => track.id)).toEqual(['route-0-0', 'route-1-0']);
  });

  it('builds compact SVG path data from encoded route preview segments', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
      { latitudeDegrees: 39.3, longitudeDegrees: 20.3 },
    ]);

    const thumbnail = buildRoutePreviewThumbnail({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 3,
      pointCount: 3,
      segments: [{
        id: 'segment-1',
        name: 'Main climb',
        sourcePointCount: 3,
        pointCount: 3,
        encodedPolyline,
      }],
    }, { width: 96, height: 56, padding: 6 });

    expect(thumbnail).toEqual(expect.objectContaining({
      viewBox: '0 0 96 56',
      startPoint: { x: 6, y: 50 },
      endPoint: { x: 90, y: 6 },
    }));
    expect(thumbnail?.paths).toEqual([expect.objectContaining({
      id: 'segment-1-0',
      label: 'Main climb',
      d: 'M 6 50 L 48 28 L 90 6',
    })]);
  });

  it('centers thumbnail geometry when route preview bounds have no span on one axis', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.1 },
    ]);

    const thumbnail = buildRoutePreviewThumbnail({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: 2,
      segments: [{
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline,
      }],
    }, { width: 96, height: 56, padding: 6 });

    expect(thumbnail?.paths[0]?.d).toBe('M 48 50 L 48 6');
  });

  it('respects explicit zero thumbnail padding for dense callers', () => {
    const encodedPolyline = encodeRoutePolyline5([
      { latitudeDegrees: 39.1, longitudeDegrees: 20.1 },
      { latitudeDegrees: 39.2, longitudeDegrees: 20.2 },
    ]);

    const thumbnail = buildRoutePreviewThumbnail({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: 2,
      segments: [{
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline,
      }],
    }, { width: 100, height: 50, padding: 0 });

    expect(thumbnail?.paths[0]?.d).toBe('M 0 50 L 100 0');
  });

  it('returns no thumbnail render data for non-renderable previews', () => {
    expect(buildRoutePreviewThumbnail(null)).toBeNull();
    expect(buildRoutePreviewThumbnail({
      version: 1,
      encoding: 'polyline5',
      precision: 5,
      sourcePointCount: 2,
      pointCount: 2,
      segments: [{
        sourcePointCount: 2,
        pointCount: 2,
        encodedPolyline: '',
      }],
    })).toBeNull();
  });
});
