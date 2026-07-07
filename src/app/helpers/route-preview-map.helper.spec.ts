import { encodeRoutePolyline5 } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { buildRoutePreviewMapTracks, isRenderableRoutePreview } from './route-preview-map.helper';

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
});
