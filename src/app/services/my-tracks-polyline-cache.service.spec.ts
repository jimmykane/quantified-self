import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as idb from 'idb-keyval';
import { AppOriginalFileHydrationService } from './app.original-file-hydration.service';
import { LoggerService } from './logger.service';
import {
  CachedMyTracksActivityPolyline,
  CachedMyTracksEventPolylines,
  MyTracksPolylineCacheService,
} from './my-tracks-polyline-cache.service';

vi.mock('idb-keyval', () => ({
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

const createCompleteCachedTrackActivity = (
  overrides: Partial<CachedMyTracksActivityPolyline> = {},
): CachedMyTracksActivityPolyline => ({
  activityId: 'activity-1',
  activityIndex: 0,
  coordinates: [[22.94, 40.63], [22.95, 40.64]],
  activityTypeValue: 'running',
  activityTypeLabel: 'Running',
  durationValue: 3600,
  distanceValue: 10000,
  durationLabel: '01:00:00',
  distanceLabel: '10 km',
  effortLabel: 'Pace',
  effortDisplayLabel: '6:00 min/km',
  effortStatType: 'Average Pace',
  jumpHeatPoints: [],
  ...overrides,
});

describe('MyTracksPolylineCacheService', () => {
  let service: MyTracksPolylineCacheService;
  let hydrationServiceMock: { getFileGeneration: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    hydrationServiceMock = {
      getFileGeneration: vi.fn().mockResolvedValue('gen-1'),
    };

    TestBed.configureTestingModule({
      providers: [
        MyTracksPolylineCacheService,
        { provide: AppOriginalFileHydrationService, useValue: hydrationServiceMock },
        { provide: LoggerService, useValue: { warn: vi.fn(), log: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } },
      ],
    });

    service = TestBed.inject(MyTracksPolylineCacheService);
    vi.clearAllMocks();
  });

  it('should resolve cache keys from canonical originalFiles using source generations', async () => {
    hydrationServiceMock.getFileGeneration
      .mockResolvedValueOnce('gen-a')
      .mockResolvedValueOnce('gen-b');

    const cacheKey = await service.resolveEventCacheKey({
      getID: () => 'event-1',
      originalFiles: [
        { path: 'users/u/events/e/file-a.fit' },
        { path: 'users/u/events/e/file-b.fit' },
      ],
    } as any, {
      metadataCacheTtlMs: 1234,
    });

    expect(cacheKey).toBe(
      'my-tracks-polyline:v3:event-1:users/u/events/e/file-a.fit@gen-a|users/u/events/e/file-b.fit@gen-b'
    );
    expect(hydrationServiceMock.getFileGeneration).toHaveBeenNthCalledWith(
      1,
      'users/u/events/e/file-a.fit',
      { metadataCacheTtlMs: 1234 },
    );
    expect(hydrationServiceMock.getFileGeneration).toHaveBeenNthCalledWith(
      2,
      'users/u/events/e/file-b.fit',
      { metadataCacheTtlMs: 1234 },
    );
  });

  it('should fall back to legacy originalFile when needed', async () => {
    const cacheKey = await service.resolveEventCacheKey({
      getID: () => 'legacy-event',
      originalFile: { path: 'users/u/events/e/original.fit' },
    } as any);

    expect(cacheKey).toBe('my-tracks-polyline:v3:legacy-event:users/u/events/e/original.fit@gen-1');
  });

  it('should extract raw track polylines from activities with valid coordinates', () => {
    const result = service.extractTrackPolylines([
      {
        getID: () => 'activity-1',
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.63384383916855, longitudeDegrees: 22.944797091186047 },
          { latitudeDegrees: 40.63426, longitudeDegrees: 22.944685 },
        ],
      },
      {
        getID: () => 'activity-2',
        hasPositionData: () => false,
        getPositionData: () => [],
      },
    ] as any);

    expect(result).toEqual({
      activityCount: 2,
      activityIdentitySignature: ['id:activity-1', 'id:activity-2'],
      trackActivities: [
        {
          activityId: 'activity-1',
          activityIndex: 0,
          coordinates: [
            [22.9447971, 40.6338438],
            [22.944685, 40.63426],
          ],
          activityTypeValue: null,
          activityTypeLabel: 'Activity',
          durationValue: null,
          distanceValue: null,
          durationLabel: '-',
          distanceLabel: '-',
          effortLabel: null,
          effortDisplayLabel: '-',
          effortStatType: null,
          jumpHeatPoints: [],
        },
      ],
    });
  });

  it('should match cached track polylines by activity id and fall back to index', () => {
    const cached: CachedMyTracksEventPolylines = {
      activityCount: 2,
      activityIdentitySignature: ['id:activity-a', 'id:activity-b'],
      trackActivities: [
        createCompleteCachedTrackActivity({
          activityId: 'activity-b',
          activityIndex: 0,
          coordinates: [[22.94, 40.63], [22.95, 40.64]],
        }),
        createCompleteCachedTrackActivity({
          activityId: 'activity-fallback',
          activityIndex: 1,
          coordinates: [[20.85, 39.66], [20.86, 39.67]],
        }),
      ],
    };

    const resolved = service.resolveTrackPolylines([
      { getID: () => 'activity-a' },
      { getID: () => 'activity-b' },
    ] as any, cached);

    expect(resolved).toEqual([
      {
        activity: expect.objectContaining({ getID: expect.any(Function) }),
        activityIndex: 1,
        coordinates: [[22.94, 40.63], [22.95, 40.64]],
        cachedActivity: expect.objectContaining({ activityId: 'activity-b' }),
      },
      {
        activity: expect.objectContaining({ getID: expect.any(Function) }),
        activityIndex: 1,
        coordinates: [[20.85, 39.66], [20.86, 39.67]],
        cachedActivity: expect.objectContaining({ activityId: 'activity-fallback' }),
      },
    ]);
  });

  it('should validate cached polylines against ordered activity identities', () => {
    const cached: CachedMyTracksEventPolylines = {
      activityCount: 2,
      activityIdentitySignature: ['id:activity-a', 'id:activity-b'],
      trackActivities: [],
    };

    expect(service.hasMatchingActivityIdentity([
      { getID: () => 'activity-a', type: 'running' },
      { getID: () => 'activity-b', type: 'running' },
    ] as any, cached)).toBe(true);

    expect(service.hasMatchingActivityIdentity([
      { getID: () => 'activity-a', type: 'running' },
      { getID: () => 'activity-c', type: 'running' },
    ] as any, cached)).toBe(false);
  });

  it('should build a fallback identity signature for activities without ids', () => {
    const result = service.extractTrackPolylines([
      {
        getID: () => null,
        type: 'running',
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.63384383916855, longitudeDegrees: 22.944797091186047 },
          { latitudeDegrees: 40.63426, longitudeDegrees: 22.944685 },
        ],
      },
    ] as any);

    expect(result.activityIdentitySignature).toEqual(['idx:0:type:running']);
  });

  it('should persist and read cached event polylines through IndexedDB', async () => {
    const cachedValue: CachedMyTracksEventPolylines = {
      activityCount: 1,
      activityIdentitySignature: ['id:activity-1'],
      trackActivities: [
        createCompleteCachedTrackActivity(),
      ],
    };
    vi.mocked(idb.get).mockResolvedValue(cachedValue);

    await service.setEventPolylines('cache-key', cachedValue);
    const result = await service.getEventPolylines('cache-key');

    expect(idb.set).toHaveBeenCalledWith('cache-key', cachedValue);
    expect(idb.get).toHaveBeenCalledWith('cache-key');
    expect(result).toEqual(cachedValue);
  });

  it('should reject metadata-incomplete cached entries', () => {
    const incomplete: CachedMyTracksEventPolylines = {
      activityCount: 1,
      activityIdentitySignature: ['id:activity-1'],
      trackActivities: [
        createCompleteCachedTrackActivity({
          effortLabel: null,
        }),
      ],
    };

    expect(service.hasCompleteTrackMetadata(incomplete)).toBe(false);
  });

  it('should resolve runtime tracks directly from cache entries', () => {
    const cached: CachedMyTracksEventPolylines = {
      activityCount: 1,
      activityIdentitySignature: ['id:activity-1'],
      trackActivities: [
        createCompleteCachedTrackActivity({
          activityId: 'activity-1',
          activityTypeValue: 'running',
        }),
      ],
    };

    const resolved = service.resolveTrackPolylinesFromCache(cached);

    expect(resolved).toEqual([
      {
        activity: expect.objectContaining({
          getID: expect.any(Function),
          type: 'running',
        }),
        activityIndex: 0,
        coordinates: [[22.94, 40.63], [22.95, 40.64]],
        cachedActivity: expect.objectContaining({ activityId: 'activity-1' }),
      },
    ]);
  });

  it('should delete cached event polylines through IndexedDB', async () => {
    await service.deleteEventPolylines('cache-key');

    expect(idb.del).toHaveBeenCalledWith('cache-key');
  });
});
