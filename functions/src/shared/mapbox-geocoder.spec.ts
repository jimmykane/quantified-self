import { describe, expect, it, vi } from 'vitest';
import {
  forwardGeocodeMapbox,
  MapboxForwardGeocoderDependencies,
  MapboxGeocodingError,
  normalizeMapboxQuery,
} from './mapbox-geocoder';

function dependencies(
  response: Partial<{ ok: boolean; status: number; body: string }> = {},
): MapboxForwardGeocoderDependencies {
  return {
    accessToken: () => 'mapbox-token',
    fetch: vi.fn().mockResolvedValue({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: vi.fn().mockResolvedValue(response.body ?? JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [20.8537, 39.665],
          },
          bbox: [20.7, 39.5, 21, 39.8],
          properties: {
            feature_type: 'place',
            name_preferred: 'Ioannina\n',
            place_formatted: 'Epirus,\u0000 Greece',
          },
        }],
      })),
    }),
    createAbortController: () => new AbortController(),
    setTimeout: vi.fn().mockReturnValue(1),
    clearTimeout: vi.fn(),
  };
}

describe('Mapbox forward geocoder', () => {
  it('normalizes and bounds location text', () => {
    expect(normalizeMapboxQuery('  Ioannina,   Greece ')).toBe('Ioannina, Greece');
    expect(normalizeMapboxQuery('Ioannina\u0000,\nGreece'))
      .toBe('Ioannina, Greece');
    expect(() => normalizeMapboxQuery('word '.repeat(21))).toThrow(
      expect.objectContaining({ code: 'invalid_query' }),
    );
    expect(normalizeMapboxQuery('12 Example St; Ioannina'))
      .toBe('12 Example St; Ioannina');
  });

  it('calls Mapbox v6 without autocomplete and projects only safe fields', async () => {
    const mocks = dependencies();

    const result = await forwardGeocodeMapbox('Ioannina, Greece', mocks);

    expect(result).toEqual({
      resolvedLabel: 'Ioannina, Epirus, Greece',
      center: {
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
      },
      featureType: 'place',
      bbox: {
        west: 20.7,
        south: 39.5,
        east: 21,
        north: 39.8,
      },
    });
    const requestedUrl = new URL(vi.mocked(mocks.fetch).mock.calls[0][0]);
    expect(requestedUrl.origin + requestedUrl.pathname)
      .toBe('https://api.mapbox.com/search/geocode/v6/forward');
    expect(requestedUrl.searchParams.get('q')).toBe('Ioannina, Greece');
    expect(requestedUrl.searchParams.get('autocomplete')).toBe('false');
    expect(requestedUrl.searchParams.get('limit')).toBe('1');
    expect(requestedUrl.searchParams.get('access_token')).toBe('mapbox-token');
  });

  it('maps missing, rejected, rate-limited, and empty results to bounded errors', async () => {
    await expect(forwardGeocodeMapbox('Ioannina', {
      ...dependencies(),
      accessToken: () => '',
    })).rejects.toMatchObject<MapboxGeocodingError>({ code: 'not_configured' });
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ ok: false, status: 401 }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'unauthorized' });
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ ok: false, status: 429 }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'rate_limited' });
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ body: JSON.stringify({ features: [] }) }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'not_found' });
  });

  it('rejects malformed and oversized upstream responses', async () => {
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ body: 'not-json' }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'unavailable' });
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ body: 'x'.repeat((64 * 1024) + 1) }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'unavailable' });
    await expect(forwardGeocodeMapbox('Ioannina', {
      ...dependencies(),
      fetch: vi.fn().mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      ),
    })).rejects.toMatchObject<MapboxGeocodingError>({
      code: 'unavailable',
      message: 'Mapbox geocoding timed out.',
    });
  });

  it('does not coerce malformed provider coordinates to zero', async () => {
    const malformedCenter = JSON.stringify({
      features: [{
        geometry: { coordinates: [null, null] },
        properties: { name: 'Malformed place' },
      }],
    });
    await expect(forwardGeocodeMapbox(
      'Malformed place',
      dependencies({ body: malformedCenter }),
    )).rejects.toMatchObject<MapboxGeocodingError>({ code: 'unavailable' });

    const malformedBounds = JSON.stringify({
      features: [{
        geometry: { coordinates: [20.8537, 39.665] },
        bbox: [null, null, null, null],
        properties: { name: 'Ioannina' },
      }],
    });
    await expect(forwardGeocodeMapbox(
      'Ioannina',
      dependencies({ body: malformedBounds }),
    )).resolves.toEqual({
      resolvedLabel: 'Ioannina',
      center: {
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.8537,
      },
      featureType: null,
    });
  });
});
