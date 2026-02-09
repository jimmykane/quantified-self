import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripLocationLabelService } from './trip-location-label.service';
import { LoggerService } from './logger.service';

describe('TripLocationLabelService', () => {
  let service: TripLocationLabelService;
  const loggerMock = {
    log: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TripLocationLabelService,
        { provide: LoggerService, useValue: loggerMock },
      ],
    });
    service = TestBed.inject(TripLocationLabelService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns City, Country labels when place and country are available', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Kathmandu',
            place_type: ['place']
          },
          {
            text: 'Nepal',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(27.7172, 85.3240);

    expect(resolved).toEqual({
      city: 'Kathmandu',
      country: 'Nepal',
      label: 'Kathmandu, Nepal',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns country-only labels when no city-like feature exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Ankara Region',
            place_type: ['region']
          },
          {
            text: 'Turkey',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(39.92032, 32.85411);

    expect(resolved).toEqual({
      city: null,
      country: 'Turkey',
      label: 'Turkey',
    });
  });

  it('falls back to district labels when place/locality are unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Kathmandu District',
            place_type: ['district']
          },
          {
            text: 'Nepal',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(27.70, 85.32);

    expect(resolved).toEqual({
      city: 'Kathmandu District',
      country: 'Nepal',
      label: 'Kathmandu District, Nepal',
    });
  });

  it('extracts country from feature context when country is not returned as a top-level feature', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Kathmandu',
            place_type: ['place'],
            context: [
              { id: 'district.1234', text: 'Kathmandu District' },
              { id: 'country.5678', text: 'Nepal' }
            ]
          }
        ]
      })
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(27.7172, 85.3240);

    expect(resolved).toEqual({
      city: 'Kathmandu',
      country: 'Nepal',
      label: 'Kathmandu, Nepal',
    });
  });

  it('uses cache for repeated centroid lookups', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Ankara',
            place_type: ['place']
          },
          {
            text: 'Turkey',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const first = await service.resolveTripLocation(39.92032, 32.85411);
    const second = await service.resolveTripLocation(39.92039, 32.85419);

    expect(first?.label).toBe('Ankara, Turkey');
    expect(second?.label).toBe('Ankara, Turkey');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when geocoding fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({})
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(0, 0);

    expect(resolved).toBeNull();
  });

  it('keeps resolveCountryName for backward compatibility', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Tokyo',
            place_type: ['place']
          },
          {
            text: 'Japan',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const country = await service.resolveCountryName(35.6764, 139.6500);

    expect(country).toBe('Japan');
  });
});
