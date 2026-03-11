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
      label: 'Ankara Region, Turkey',
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
      city: null,
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

  it('prefers a containing place context over locality labels for Thessaloniki-area points', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            text: 'Kalamaria',
            place_type: ['locality'],
            context: [
              { id: 'place.1234', text: 'Thessaloniki' },
              { id: 'region.5678', text: 'Central Macedonia' },
              { id: 'country.9012', text: 'Greece' }
            ]
          },
          {
            text: 'Central Macedonia',
            place_type: ['region']
          },
          {
            text: 'Greece',
            place_type: ['country']
          }
        ]
      })
    } as unknown as Response);

    const resolved = await service.resolveTripLocation(40.5829, 22.9509);

    expect(resolved).toEqual({
      city: 'Thessaloniki',
      country: 'Greece',
      label: 'Thessaloniki, Greece',
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

  it('votes across candidate coordinates to keep the dominant city label', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
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
      } as unknown as Response)
      .mockResolvedValueOnce({
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
      } as unknown as Response)
      .mockResolvedValueOnce({
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

    const resolved = await service.resolveTripLocationFromCandidates([
      { latitudeDegrees: 27.71, longitudeDegrees: 85.31 },
      { latitudeDegrees: 27.72, longitudeDegrees: 85.32 },
      { latitudeDegrees: 27.73, longitudeDegrees: 85.33 },
    ]);

    expect(resolved).toEqual({
      city: 'Kathmandu',
      country: 'Nepal',
      label: 'Kathmandu, Nepal',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('keeps a shared containing place when sampled Greek locality labels differ', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Kalamaria',
              place_type: ['locality'],
              context: [
                { id: 'place.1234', text: 'Thessaloniki' },
                { id: 'region.5678', text: 'Central Macedonia' },
                { id: 'country.9012', text: 'Greece' }
              ]
            },
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Pylaia',
              place_type: ['locality'],
              context: [
                { id: 'place.1234', text: 'Thessaloniki' },
                { id: 'region.5678', text: 'Central Macedonia' },
                { id: 'country.9012', text: 'Greece' }
              ]
            },
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response);

    const resolved = await service.resolveTripLocationFromCandidates([
      { latitudeDegrees: 40.5829, longitudeDegrees: 22.9509 },
      { latitudeDegrees: 40.5999, longitudeDegrees: 22.9866 },
    ]);

    expect(resolved).toEqual({
      city: 'Thessaloniki',
      country: 'Greece',
      label: 'Thessaloniki, Greece',
    });
  });

  it('keeps a single shared city when other sampled points fall back to country-only', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Kalamaria',
              place_type: ['locality'],
              context: [
                { id: 'place.1234', text: 'Thessaloniki' },
                { id: 'region.5678', text: 'Central Macedonia' },
                { id: 'country.9012', text: 'Greece' }
              ]
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response);

    const resolved = await service.resolveTripLocationFromCandidates([
      { latitudeDegrees: 40.5829, longitudeDegrees: 22.9509 },
      { latitudeDegrees: 40.6401, longitudeDegrees: 22.9444 },
      { latitudeDegrees: 40.6532, longitudeDegrees: 22.9391 },
    ]);

    expect(resolved).toEqual({
      city: 'Thessaloniki',
      country: 'Greece',
      label: 'Thessaloniki, Greece',
    });
  });

  it('preserves repeated rounded coordinates so Thessaloniki wins over a single suburb vote', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Kalamaria',
              place_type: ['place'],
              context: [
                { id: 'region.5678', text: 'Central Macedonia' },
                { id: 'country.9012', text: 'Greece' }
              ]
            },
            {
              text: 'Central Macedonia',
              place_type: ['region']
            },
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Thessaloniki',
              place_type: ['place'],
              context: [
                { id: 'region.5678', text: 'Central Macedonia' },
                { id: 'country.9012', text: 'Greece' }
              ]
            },
            {
              text: 'Central Macedonia',
              place_type: ['region']
            },
            {
              text: 'Greece',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response);

    const resolved = await service.resolveTripLocationFromCandidates([
      { latitudeDegrees: 40.58765645138919, longitudeDegrees: 22.966713001951575 },
      { latitudeDegrees: 40.63384383916855, longitudeDegrees: 22.944797091186047 },
      { latitudeDegrees: 40.63426, longitudeDegrees: 22.944685 },
    ]);

    expect(resolved).toEqual({
      city: 'Thessaloniki',
      country: 'Greece',
      label: 'Thessaloniki, Greece',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to the shared country when sampled city labels disagree', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
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
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              text: 'Lalitpur',
              place_type: ['place']
            },
            {
              text: 'Nepal',
              place_type: ['country']
            }
          ]
        })
      } as unknown as Response);

    const resolved = await service.resolveTripLocationFromCandidates([
      { latitudeDegrees: 27.71, longitudeDegrees: 85.31 },
      { latitudeDegrees: 27.79, longitudeDegrees: 85.35 },
    ]);

    expect(resolved).toEqual({
      city: null,
      country: 'Nepal',
      label: 'Nepal',
    });
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
