import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { OriginalFileMetaData } from '../../../shared/app-event.interface';

const fitOriginalFile = (path: string): OriginalFileMetaData => ({
  path,
  startDate: new Date('2026-01-10T10:00:00.000Z'),
});

const {
  mockGetActivitySyncRouteAllowlistConfigError,
  mockIsActivitySyncRouteEnabledForUser,
  mockIsActivitySyncRouteUserAllowlisted,
  mockEnqueueActivitySyncQueueItem,
  mockSetActivitySyncQueuedMetadata,
  mockSetActivitySyncRequeuedMetadata,
  mockSetActivitySyncSkippedMetadata,
} = vi.hoisted(() => ({
  mockGetActivitySyncRouteAllowlistConfigError: vi.fn(),
  mockIsActivitySyncRouteEnabledForUser: vi.fn(),
  mockIsActivitySyncRouteUserAllowlisted: vi.fn(),
  mockEnqueueActivitySyncQueueItem: vi.fn(),
  mockSetActivitySyncQueuedMetadata: vi.fn().mockResolvedValue(undefined),
  mockSetActivitySyncRequeuedMetadata: vi.fn().mockResolvedValue(undefined),
  mockSetActivitySyncSkippedMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./settings', () => ({
  isActivitySyncRouteEnabledForUser: mockIsActivitySyncRouteEnabledForUser,
}));

vi.mock('./allowlist', () => ({
  getActivitySyncRouteAllowlistConfigError: mockGetActivitySyncRouteAllowlistConfigError,
  isActivitySyncRouteUserAllowlisted: mockIsActivitySyncRouteUserAllowlisted,
}));

vi.mock('./queue', () => ({
  enqueueActivitySyncQueueItem: mockEnqueueActivitySyncQueueItem,
}));

vi.mock('./metadata', () => ({
  setActivitySyncQueuedMetadata: mockSetActivitySyncQueuedMetadata,
  setActivitySyncRequeuedMetadata: mockSetActivitySyncRequeuedMetadata,
  setActivitySyncSkippedMetadata: mockSetActivitySyncSkippedMetadata,
}));

import { enqueueActivitySyncJobsForImportedEvent } from './enqueue-imported-event';

describe('activity-sync/enqueue-imported-event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue(null);
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(true);
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(true);
    mockEnqueueActivitySyncQueueItem.mockResolvedValue({
      enqueued: true,
      queueItemId: 'activitySyncQueueItem1',
    });
  });

  it('queues Garmin->Suunto route when user enabled route and FIT original exists', async () => {
    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      sourceActivityID: 'garmin-activity-1',
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [
        fitOriginalFile('users/user-1/events/event-1/original.fit'),
      ],
    });

    expect(result).toEqual({ queued: 1, skippedByReason: {} });
    expect(mockIsActivitySyncRouteEnabledForUser).toHaveBeenCalledWith(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    );
    expect(mockEnqueueActivitySyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceActivityID: 'garmin-activity-1',
      originalFile: expect.objectContaining({
        path: 'users/user-1/events/event-1/original.fit',
        extension: 'fit',
      }),
      manual: false,
    }));
    expect(mockSetActivitySyncQueuedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      manual: false,
    }));
  });

  it('queues COROS->Suunto route when source event comes from COROS and FIT original exists', async () => {
    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-coros-1',
      sourceServiceName: ServiceNames.COROSAPI,
      sourceActivityID: 'coros-activity-1',
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
      originalFiles: [
        fitOriginalFile('users/user-1/events/event-coros-1/original.fit'),
      ],
    });

    expect(result).toEqual({ queued: 1, skippedByReason: {} });
    expect(mockIsActivitySyncRouteEnabledForUser).toHaveBeenCalledWith(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    );
    expect(mockEnqueueActivitySyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-coros-1',
      sourceActivityID: 'coros-activity-1',
      originalFile: expect.objectContaining({
        path: 'users/user-1/events/event-coros-1/original.fit',
        extension: 'fit',
      }),
      manual: false,
    }));
    expect(mockSetActivitySyncQueuedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-coros-1',
      manual: false,
    }));
  });

  it('marks route as skipped when user is not allowlisted', async () => {
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(false);

    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.fit')],
    });

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        user_not_allowlisted: 1,
      },
    });
    expect(mockIsActivitySyncRouteEnabledForUser).not.toHaveBeenCalled();
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'user_not_allowlisted',
    }));
  });

  it('marks route as skipped when allowlist configuration is invalid', async () => {
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue('allowlist misconfigured');

    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.fit')],
    });

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        allowlist_misconfigured: 1,
      },
    });
    expect(mockIsActivitySyncRouteUserAllowlisted).not.toHaveBeenCalled();
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'allowlist_misconfigured',
    }));
  });

  it('marks route as skipped when route is disabled', async () => {
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);

    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.fit')],
    });

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        route_disabled: 1,
      },
    });
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      skippedReason: 'route_disabled',
    }));
  });

  it('marks route as skipped when no supported FIT original exists', async () => {
    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.gpx')],
    });

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        unsupported_original_file: 1,
      },
    });
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'unsupported_original_file',
    }));
  });

  it('tracks queue dedupe reasons when enqueue returns not enqueued', async () => {
    mockEnqueueActivitySyncQueueItem.mockResolvedValue({
      enqueued: false,
      queueItemId: 'activitySyncQueueItem1',
      reason: 'already_pending',
    });

    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.fit')],
    });

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        already_pending: 1,
      },
    });
    expect(mockSetActivitySyncQueuedMetadata).not.toHaveBeenCalled();
  });

  it('counts redispatched pending queue items as queued work', async () => {
    mockEnqueueActivitySyncQueueItem.mockResolvedValue({
      enqueued: false,
      queueItemId: 'activitySyncQueueItem1',
      reason: 'already_pending',
      redispatched: true,
    });

    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [fitOriginalFile('users/user-1/events/event-1/original.fit')],
    });

    expect(result).toEqual({
      queued: 1,
      skippedByReason: {},
    });
    expect(mockSetActivitySyncQueuedMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncRequeuedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      manual: false,
    }));
  });
});
