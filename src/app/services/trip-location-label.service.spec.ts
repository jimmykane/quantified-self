import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripLocationLabelService } from './trip-location-label.service';

describe('TripLocationLabelService', () => {
  let service: TripLocationLabelService;

  beforeEach(() => {
    service = new TripLocationLabelService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves country labels from mapbox geocoding response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Nepal',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const label = await service.resolveCountryName(27.7172, 85.3240);

    expect(label).toBe('Nepal');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses cache for repeated centroid lookups', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Turkey',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const first = await service.resolveCountryName(39.92032, 32.85411);
    const second = await service.resolveCountryName(39.92039, 32.85419);

    expect(first).toBe('Turkey');
    expect(second).toBe('Turkey');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when geocoding fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({})
    } as unknown as Response);

    const label = await service.resolveCountryName(0, 0);

    expect(label).toBeNull();
  });
});
