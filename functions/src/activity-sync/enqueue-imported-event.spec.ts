import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { OriginalFileMetaData } from '../../../shared/app-event.interface';

const fitOriginalFile = (path: string): OriginalFileMetaData => ({
  path,
  startDate: new Date('2026-01-10T10:00:00.000Z'),
});

const {
  mockGetActivitySyncRouteAllowlistConfigError,
  mockIsActivitySyncRouteBlockedByReconnectRequiredForUser,
  mockIsActivitySyncRouteEnabledForUser,
  mockIsActivitySyncRouteUserAllowlisted,
  mockEnqueueActivitySyncQueueItem,
  mockSetActivitySyncQueuedMetadata,
  mockSetActivitySyncRequeuedMetadata,
  mockSetActivitySyncSkippedMetadata,
  mockShouldSkipQueueWorkForDeletedUser,
} = vi.hoisted(() => ({
  mockGetActivitySyncRouteAllowlistConfigError: vi.fn(),
  mockIsActivitySyncRouteBlockedByReconnectRequiredForUser: vi.fn(),
  mockIsActivitySyncRouteEnabledForUser: vi.fn(),
  mockIsActivitySyncRouteUserAllowlisted: vi.fn(),
  mockEnqueueActivitySyncQueueItem: vi.fn(),
  mockSetActivitySyncQueuedMetadata: vi.fn().mockResolvedValue(undefined),
  mockSetActivitySyncRequeuedMetadata: vi.fn().mockResolvedValue(undefined),
  mockSetActivitySyncSkippedMetadata: vi.fn().mockResolvedValue(undefined),
  mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
}));

vi.mock('./settings', () => ({
  isActivitySyncRouteBlockedByReconnectRequiredForUser: mockIsActivitySyncRouteBlockedByReconnectRequiredForUser,
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

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

import { enqueueActivitySyncJobsForImportedEvent } from './enqueue-imported-event';

describe('activity-sync/enqueue-imported-event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue(null);
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(true);
    mockIsActivitySyncRouteBlockedByReconnectRequiredForUser.mockResolvedValue(false);
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(true);
    mockEnqueueActivitySyncQueueItem.mockResolvedValue({
      enqueued: true,
      queueItemId: 'activitySyncQueueItem1',
    });
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
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

  it('omits undefined optional original file fields from the queue payload', async () => {
    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-with-minimal-file',
      sourceServiceName: ServiceNames.GarminAPI,
      sourceActivityID: 'garmin-activity-1',
      routeIdFilter: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      originalFiles: [{
        path: 'users/user-1/events/event-with-minimal-file/original.fit',
        startDate: { toMillis: () => 1784619857072 },
      }],
    });

    expect(result).toEqual({ queued: 1, skippedByReason: {} });
    const queuedOriginalFile = mockEnqueueActivitySyncQueueItem.mock.calls[0][0].originalFile;
    expect(queuedOriginalFile).toEqual({
      path: 'users/user-1/events/event-with-minimal-file/original.fit',
      startDate: 1784619857072,
      extension: 'fit',
    });
    expect(queuedOriginalFile).not.toHaveProperty('bucket');
    expect(queuedOriginalFile).not.toHaveProperty('originalFilename');
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

  it('queues Wahoo->Suunto route when a retained Wahoo FIT is imported', async () => {
    const result = await enqueueActivitySyncJobsForImportedEvent({
      userID: 'user-1',
      eventID: 'event-wahoo-1',
      sourceServiceName: ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp].sourceServiceName,
      sourceActivityID: 'wahoo-workout-1',
      originalFiles: [
        fitOriginalFile('users/user-1/events/event-wahoo-1/original.fit'),
      ],
    });

    expect(result).toEqual({ queued: 1, skippedByReason: {} });
    expect(mockIsActivitySyncRouteEnabledForUser).toHaveBeenCalledWith(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp,
    );
    expect(mockEnqueueActivitySyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-wahoo-1',
      sourceActivityID: 'wahoo-workout-1',
      originalFile: expect.objectContaining({
        path: 'users/user-1/events/event-wahoo-1/original.fit',
        extension: 'fit',
      }),
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

  it('does not write route metadata or enqueue work when account deletion is active', async () => {
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);

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
        user_deleted_or_deleting: 1,
      },
    });
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncQueuedMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
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

  it('marks route as skipped when a route service requires reconnect', async () => {
    mockIsActivitySyncRouteBlockedByReconnectRequiredForUser.mockResolvedValue(true);

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
        service_reconnect_required: 1,
      },
    });
    expect(mockIsActivitySyncRouteEnabledForUser).not.toHaveBeenCalled();
    expect(mockEnqueueActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      skippedReason: 'service_reconnect_required',
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
