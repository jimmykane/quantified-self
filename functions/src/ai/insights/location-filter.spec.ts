import { describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createResolveLocationFilter } from './location-filter';

describe('location-filter', () => {
  it('prefers explicit input over prompt-derived locations', async () => {
    const geocodeLocation = vi.fn().mockResolvedValue({
      resolvedLabel: 'Greece',
      center: {
        latitudeDegrees: 39.0742,
        longitudeDegrees: 21.8243,
      },
      bbox: {
        west: 19.3736,
        south: 34.8021,
        east: 28.2471,
        north: 41.7485,
      },
    });
    const inferLocationText = vi.fn().mockResolvedValue(null);
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides in Italy this year',
      requestLocationFilter: {
        locationText: 'Greece',
        radiusKm: 80,
      },
    });

    expect(geocodeLocation).toHaveBeenCalledWith('Greece');
    expect(inferLocationText).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestedText: 'Greece',
      effectiveText: 'Greece',
      resolvedLabel: 'Greece',
      source: 'input',
      mode: 'bbox',
      radiusKm: 80,
      center: {
        latitudeDegrees: 39.0742,
        longitudeDegrees: 21.8243,
      },
      bbox: {
        west: 19.3736,
        south: 34.8021,
        east: 28.2471,
        north: 41.7485,
      },
    });
  });

  it('extracts prompt locations and radius phrases when explicit input is absent', async () => {
    const geocodeLocation = vi.fn().mockResolvedValue({
      resolvedLabel: 'Athens, Greece',
      center: {
        latitudeDegrees: 37.9838,
        longitudeDegrees: 23.7275,
      },
    });
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText: vi.fn().mockResolvedValue(null),
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides within 20 km of Athens this year',
    });

    expect(geocodeLocation).toHaveBeenCalledWith('Athens');
    expect(result).toEqual({
      requestedText: 'Athens',
      effectiveText: 'Athens',
      resolvedLabel: 'Athens, Greece',
      source: 'prompt',
      mode: 'radius',
      radiusKm: 20,
      center: {
        latitudeDegrees: 37.9838,
        longitudeDegrees: 23.7275,
      },
    });
  });

  it('extracts radius from prompt clauses like "with a 10km radius"', async () => {
    const geocodeLocation = vi.fn().mockResolvedValue({
      resolvedLabel: 'Ano Chora, Greece',
      center: {
        latitudeDegrees: 38.8012,
        longitudeDegrees: 21.5564,
      },
    });
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText: vi.fn().mockResolvedValue(null),
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my biggest jump this year in ano chora with a 10km radius',
    });

    expect(geocodeLocation).toHaveBeenCalledWith('ano chora');
    expect(result).toEqual({
      requestedText: 'ano chora',
      effectiveText: 'ano chora',
      resolvedLabel: 'Ano Chora, Greece',
      source: 'prompt',
      mode: 'radius',
      radiusKm: 10,
      center: {
        latitudeDegrees: 38.8012,
        longitudeDegrees: 21.5564,
      },
    });
  });

  it('does not treat generic time clauses as prompt locations', async () => {
    const geocodeLocation = vi.fn();
    const inferLocationText = vi.fn();
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my distance in the last 3 months',
    });

    expect(result).toBeNull();
    expect(geocodeLocation).not.toHaveBeenCalled();
    expect(inferLocationText).not.toHaveBeenCalled();
  });

  it('still extracts place-like in clauses with trailing time scopes', async () => {
    const geocodeLocation = vi.fn().mockResolvedValue({
      resolvedLabel: 'Paris, France',
      center: {
        latitudeDegrees: 48.8566,
        longitudeDegrees: 2.3522,
      },
    });
    const inferLocationText = vi.fn();
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my distance in Paris in the last 3 months',
    });

    expect(geocodeLocation).toHaveBeenCalledWith('Paris');
    expect(inferLocationText).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestedText: 'Paris',
      effectiveText: 'Paris',
      resolvedLabel: 'Paris, France',
      source: 'prompt',
      mode: 'radius',
      radiusKm: 50,
      center: {
        latitudeDegrees: 48.8566,
        longitudeDegrees: 2.3522,
      },
    });
  });

  it('uses radius mode for place-level geocodes even when mapbox returns a bbox', async () => {
    const geocodeLocation = vi.fn().mockResolvedValue({
      resolvedLabel: 'Patra, West Greece, Greece',
      center: {
        latitudeDegrees: 38.245506,
        longitudeDegrees: 21.734795,
      },
      preferredMode: 'radius',
      bbox: {
        west: 21.691142,
        south: 38.200257,
        east: 21.874699,
        north: 38.309154,
      },
    });
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText: vi.fn().mockResolvedValue(null),
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my biggest jump last year',
      requestLocationFilter: {
        locationText: 'Patras',
        radiusKm: 50,
      },
    });

    expect(geocodeLocation).toHaveBeenCalledWith('Patras');
    expect(result).toEqual({
      requestedText: 'Patras',
      effectiveText: 'Patras',
      resolvedLabel: 'Patra, West Greece, Greece',
      source: 'input',
      mode: 'radius',
      radiusKm: 50,
      center: {
        latitudeDegrees: 38.245506,
        longitudeDegrees: 21.734795,
      },
    });
  });

  it('invokes AI fallback only after geocoding fails and retries once', async () => {
    const geocodeLocation = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        resolvedLabel: 'Greece',
        center: {
          latitudeDegrees: 39.0742,
          longitudeDegrees: 21.8243,
        },
        bbox: {
          west: 19.3736,
          south: 34.8021,
          east: 28.2471,
          north: 41.7485,
        },
      });
    const inferLocationText = vi.fn().mockResolvedValue('Greece');
    const onAiFallbackAttempt = vi.fn().mockResolvedValue(undefined);
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides in Grece this year',
      onAiFallbackAttempt,
    });

    expect(geocodeLocation).toHaveBeenNthCalledWith(1, 'Grece');
    expect(onAiFallbackAttempt).toHaveBeenCalledTimes(1);
    expect(inferLocationText).toHaveBeenCalledWith({
      prompt: 'show my rides in Grece this year',
      failedLocationText: 'Grece',
    });
    expect(geocodeLocation).toHaveBeenNthCalledWith(2, 'Greece');
    expect(result).toEqual({
      requestedText: 'Grece',
      effectiveText: 'Greece',
      resolvedLabel: 'Greece',
      source: 'ai_fallback',
      mode: 'bbox',
      radiusKm: 50,
      center: {
        latitudeDegrees: 39.0742,
        longitudeDegrees: 21.8243,
      },
      bbox: {
        west: 19.3736,
        south: 34.8021,
        east: 28.2471,
        north: 41.7485,
      },
    });
  });

  it('throws a clear invalid-argument error when the location cannot be resolved', async () => {
    const testSubject = createResolveLocationFilter({
      geocodeLocation: vi.fn().mockResolvedValue(null),
      inferLocationText: vi.fn().mockResolvedValue('still not real'),
    });

    await expect(testSubject.resolveLocationFilter({
      prompt: 'show my rides in qwertyland',
      onAiFallbackAttempt: vi.fn(),
    })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'Could not resolve the location "qwertyland". Try a city, region, country, or coordinates.',
    } satisfies Partial<HttpsError>);
  });

  it('supports direct coordinate input without geocoding', async () => {
    const geocodeLocation = vi.fn();
    const inferLocationText = vi.fn();
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides this year',
      requestLocationFilter: {
        locationText: '37.9838, 23.7275',
      },
    });

    expect(geocodeLocation).not.toHaveBeenCalled();
    expect(inferLocationText).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestedText: '37.98380, 23.72750',
      effectiveText: '37.98380, 23.72750',
      resolvedLabel: '37.98380, 23.72750',
      source: 'input',
      mode: 'radius',
      radiusKm: 50,
      center: {
        latitudeDegrees: 37.9838,
        longitudeDegrees: 23.7275,
      },
    });
  });

  it('preserves negative direct coordinate input without geocoding', async () => {
    const geocodeLocation = vi.fn();
    const inferLocationText = vi.fn();
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides this year',
      requestLocationFilter: {
        locationText: '(-33.8688, 151.2093)',
      },
    });

    expect(geocodeLocation).not.toHaveBeenCalled();
    expect(inferLocationText).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestedText: '-33.86880, 151.20930',
      effectiveText: '-33.86880, 151.20930',
      resolvedLabel: '-33.86880, 151.20930',
      source: 'input',
      mode: 'radius',
      radiusKm: 50,
      center: {
        latitudeDegrees: -33.8688,
        longitudeDegrees: 151.2093,
      },
    });
  });

  it('extracts negative direct coordinates from the prompt', async () => {
    const geocodeLocation = vi.fn();
    const inferLocationText = vi.fn();
    const testSubject = createResolveLocationFilter({
      geocodeLocation,
      inferLocationText,
    });

    const result = await testSubject.resolveLocationFilter({
      prompt: 'show my rides around (-33.8688, 151.2093) this year',
    });

    expect(geocodeLocation).not.toHaveBeenCalled();
    expect(inferLocationText).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestedText: '-33.86880, 151.20930',
      effectiveText: '-33.86880, 151.20930',
      resolvedLabel: '-33.86880, 151.20930',
      source: 'prompt',
      mode: 'radius',
      radiusKm: 50,
      center: {
        latitudeDegrees: -33.8688,
        longitudeDegrees: 151.2093,
      },
    });
  });
});
