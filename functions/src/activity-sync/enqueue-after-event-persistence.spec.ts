import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const {
  mockEnqueueActivitySyncJobsForImportedEvent,
  mockShouldSkipQueueWorkForDeletedUser,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockEnqueueActivitySyncJobsForImportedEvent: vi.fn(),
  mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('./enqueue-imported-event', () => ({
  enqueueActivitySyncJobsForImportedEvent: mockEnqueueActivitySyncJobsForImportedEvent,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

vi.mock('firebase-functions/logger', () => ({
  error: mockLoggerError,
}));

import { enqueueActivitySyncAfterEventPersistence } from './enqueue-after-event-persistence';

describe('enqueueActivitySyncAfterEventPersistence', () => {
  const params = {
    userID: 'user-1',
    eventID: 'event-1',
    sourceServiceName: ServiceNames.WahooAPI,
    sourceActivityID: 'workout-1',
    setEventResult: {
      eventID: 'stored-event-1',
      savedOriginalFiles: [{
        path: 'users/user-1/events/stored-event-1/original.fit',
        startDate: new Date('2026-07-21T10:00:00.000Z'),
      }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
    mockEnqueueActivitySyncJobsForImportedEvent.mockResolvedValue({ queued: 1, skippedByReason: {} });
  });

  it('uses the persisted event and retained original files for activity-sync delivery', async () => {
    await expect(enqueueActivitySyncAfterEventPersistence(params)).resolves.toBe(false);

    expect(mockShouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
      'event-1',
      'before_activity_sync_enqueue',
    );
    expect(mockEnqueueActivitySyncJobsForImportedEvent).toHaveBeenCalledWith({
      userID: 'user-1',
      eventID: 'stored-event-1',
      sourceServiceName: ServiceNames.WahooAPI,
      sourceActivityID: 'workout-1',
      originalFiles: params.setEventResult.savedOriginalFiles,
    });
  });

  it('does not enqueue activity delivery after account deletion starts', async () => {
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);

    await expect(enqueueActivitySyncAfterEventPersistence(params)).resolves.toBe(true);
    expect(mockEnqueueActivitySyncJobsForImportedEvent).not.toHaveBeenCalled();
  });

  it('keeps a successfully imported activity when the follow-up queue write fails', async () => {
    const error = new Error('queue unavailable');
    mockEnqueueActivitySyncJobsForImportedEvent.mockRejectedValue(error);

    await expect(enqueueActivitySyncAfterEventPersistence(params)).resolves.toBe(false);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('Import remains successful.'),
      error,
    );
  });
});
