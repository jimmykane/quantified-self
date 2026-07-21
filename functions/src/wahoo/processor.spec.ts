import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';

const mocks = vi.hoisted(() => ({
  tokenGet: vi.fn(),
  parseFIT: vi.fn(),
  downloadFIT: vi.fn(),
  deletionSkip: vi.fn(),
  disconnectPending: vi.fn(),
  resolveEventID: vi.fn(),
  setEvent: vi.fn(),
  hasProAccess: vi.fn(),
  markSkipped: vi.fn().mockResolvedValue('skipped'),
  deferPending: vi.fn().mockResolvedValue('deferred'),
  retry: vi.fn().mockResolvedValue('retry'),
  processed: vi.fn().mockResolvedValue('processed'),
  claimRevision: vi.fn().mockResolvedValue('claimed'),
  isCurrentRevision: vi.fn().mockResolvedValue(true),
  completeRevision: vi.fn().mockResolvedValue('processed'),
  failRevision: vi.fn().mockResolvedValue('retry'),
  enqueueActivitySyncAfterEventPersistence: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({ doc: () => ({ get: mocks.tokenGet }) }),
      }),
    }),
  }),
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
  return {
    ...actual,
    EventImporterFIT: { getFromArrayBuffer: mocks.parseFIT },
  };
});
vi.mock('./file-download', () => ({ downloadWahooFITFile: mocks.downloadFIT }));
vi.mock('../queue/user-deletion-skip', () => ({ shouldSkipQueueWorkForDeletedUser: mocks.deletionSkip }));
vi.mock('../service-disconnect-pending', () => ({ isServiceDisconnectPendingForUser: mocks.disconnectPending }));
vi.mock('../queue/provider-event-id', () => ({ resolveProviderImportEventID: mocks.resolveEventID }));
vi.mock('../utils', () => ({ hasProAccess: mocks.hasProAccess, setEvent: mocks.setEvent }));
vi.mock('../activity-sync/enqueue-after-event-persistence', () => ({
  enqueueActivitySyncAfterEventPersistence: mocks.enqueueActivitySyncAfterEventPersistence,
}));
vi.mock('../queue-utils', () => ({
  markQueueItemSkipped: mocks.markSkipped,
  deferQueueItemForPendingDisconnect: mocks.deferPending,
  QueueResult: { Processed: 'processed' },
}));
vi.mock('./queue-store', () => ({
  claimWahooWorkoutQueueRevision: mocks.claimRevision,
  isClaimedWahooWorkoutQueueRevisionCurrent: mocks.isCurrentRevision,
  completeWahooWorkoutQueueRevision: mocks.completeRevision,
  failWahooWorkoutQueueRevision: mocks.failRevision,
}));

import { processWahooWorkoutQueueItem } from './processor';

const queueItem = {
  id: 'queue-1',
  firebaseUserID: 'firebase-1',
  wahooUserID: 'wahoo-1',
  workoutID: 'workout-1',
  workoutSummaryID: 'summary-1',
  summaryUpdatedAt: '2026-07-18T10:00:00.000Z',
  FITFileURI: 'https://cdn.wahooligan.com/one.fit',
  starts: '2026-07-18T09:00:00.000Z',
  manual: false,
  edited: true,
  fitnessAppID: 5,
  dateCreated: Date.now(),
  processed: false,
  retryCount: 0,
  dispatchedToCloudTask: null,
} as any;

describe('processWahooWorkoutQueueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletionSkip.mockResolvedValue(false);
    mocks.disconnectPending.mockResolvedValue(false);
    mocks.tokenGet.mockResolvedValue({ exists: true, data: () => ({ serviceName: ServiceNames.WahooAPI }) });
    mocks.downloadFIT.mockResolvedValue(Buffer.from('valid-fit'));
    mocks.parseFIT.mockResolvedValue({ startDate: new Date('2026-07-18T09:00:00.000Z'), name: '' });
    mocks.resolveEventID.mockResolvedValue('event-1');
    mocks.setEvent.mockResolvedValue({
      eventID: 'event-1',
      savedOriginalFiles: [{
        path: 'users/firebase-1/events/event-1/original.fit',
        startDate: new Date('2026-07-18T09:00:00.000Z'),
      }],
    });
    mocks.enqueueActivitySyncAfterEventPersistence.mockResolvedValue(false);
    mocks.hasProAccess.mockResolvedValue(true);
    mocks.claimRevision.mockResolvedValue('claimed');
    mocks.isCurrentRevision.mockResolvedValue(true);
    mocks.completeRevision.mockResolvedValue('processed');
    mocks.failRevision.mockResolvedValue('retry');
  });

  it('downloads, parses, guards again, writes through setEvent, and marks processed', async () => {
    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');

    expect(mocks.deletionSkip).toHaveBeenNthCalledWith(1, 'firebase-1', ServiceNames.WahooAPI, 'queue-1', 'before_token_refresh');
    expect(mocks.deletionSkip).toHaveBeenNthCalledWith(2, 'firebase-1', ServiceNames.WahooAPI, 'queue-1', 'before_event_write');
    expect(mocks.resolveEventID).toHaveBeenCalledWith({
      userID: 'firebase-1',
      startDate: new Date('2026-07-18T09:00:00.000Z'),
      serviceName: ServiceNames.WahooAPI,
      providerEventID: 'workout-1',
      providerEventIDField: 'serviceWorkoutID',
      providerEventSecondaryID: 'wahoo-1',
      providerEventSecondaryIDField: 'serviceUserID',
      preferProviderIdentityEventID: true,
    });
    expect(mocks.setEvent).toHaveBeenCalledWith(
      'firebase-1',
      'event-1',
      expect.objectContaining({ name: '2026-07-18T09:00:00.000Z' }),
      expect.objectContaining({
        serviceName: ServiceNames.WahooAPI,
        serviceWorkoutID: 'workout-1',
        serviceWorkoutSummaryID: 'summary-1',
        serviceUserID: 'wahoo-1',
      }),
      expect.objectContaining({ extension: 'fit' }),
    );
    expect(mocks.enqueueActivitySyncAfterEventPersistence).toHaveBeenCalledWith({
      userID: 'firebase-1',
      eventID: 'event-1',
      sourceServiceName: ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp].sourceServiceName,
      sourceActivityID: 'workout-1',
      setEventResult: expect.objectContaining({
        eventID: 'event-1',
        savedOriginalFiles: [expect.objectContaining({
          path: 'users/firebase-1/events/event-1/original.fit',
        })],
      }),
    });
    expect(mocks.completeRevision).toHaveBeenCalledWith(queueItem, expect.any(String));
  });

  it('does not queue activity delivery when deletion starts after the activity was stored', async () => {
    mocks.enqueueActivitySyncAfterEventPersistence.mockResolvedValue(true);

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');

    expect(mocks.completeRevision).toHaveBeenCalledWith(queueItem, expect.any(String), {
      resultStatus: 'skipped',
      skippedReason: 'user_deleted_or_deleting',
    });
  });

  it('does not write if deletion starts after the FIT file was parsed', async () => {
    mocks.deletionSkip.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');
    expect(mocks.setEvent).not.toHaveBeenCalled();
    expect(mocks.completeRevision).toHaveBeenCalledWith(queueItem, expect.any(String), {
      resultStatus: 'skipped',
      skippedReason: 'user_deleted_or_deleting',
    });
  });

  it('skips work if the server-side Wahoo credential is no longer present', async () => {
    mocks.tokenGet.mockResolvedValue({ exists: false });

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');
    expect(mocks.downloadFIT).not.toHaveBeenCalled();
    expect(mocks.completeRevision).toHaveBeenCalledWith(queueItem, expect.any(String), {
      resultStatus: 'skipped',
      skippedReason: 'provider_not_connected',
    });
  });

  it('does not import a queued workout after Pro access expires', async () => {
    mocks.hasProAccess.mockResolvedValue(false);

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');
    expect(mocks.tokenGet).not.toHaveBeenCalled();
    expect(mocks.downloadFIT).not.toHaveBeenCalled();
    expect(mocks.completeRevision).toHaveBeenCalledWith(queueItem, expect.any(String), {
      resultStatus: 'skipped',
      skippedReason: 'pro_access_required',
    });
  });

  it('releases the claimed revision through retry handling when the token read fails', async () => {
    mocks.tokenGet.mockRejectedValue(new Error('firestore unavailable'));

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('retry');
    expect(mocks.downloadFIT).not.toHaveBeenCalled();
    expect(mocks.failRevision).toHaveBeenCalledWith(
      queueItem,
      expect.any(String),
      expect.objectContaining({ message: 'Wahoo activity processing failed: Error' }),
    );
  });

  it('sanitizes signed provider URLs before persisting retry errors', async () => {
    mocks.downloadFIT.mockRejectedValue(new Error(`request failed for ${queueItem.FITFileURI}?signature=secret-value`));

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('retry');
    expect(mocks.failRevision).toHaveBeenCalledWith(
      queueItem,
      expect.any(String),
      expect.objectContaining({ message: 'Wahoo activity processing failed: Error' }),
    );
    expect(mocks.failRevision.mock.calls[0][2].message).not.toContain('secret-value');
    expect(mocks.failRevision.mock.calls[0][2].message).not.toContain(queueItem.FITFileURI);
  });

  it('acks a superseded snapshot without downloading or completing the newer revision', async () => {
    mocks.claimRevision.mockResolvedValue('superseded');

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');
    expect(mocks.downloadFIT).not.toHaveBeenCalled();
    expect(mocks.completeRevision).not.toHaveBeenCalled();
  });

  it('acks a duplicate task while another worker owns the current revision', async () => {
    mocks.claimRevision.mockResolvedValue('busy');

    await expect(processWahooWorkoutQueueItem(queueItem)).resolves.toBe('processed');
    expect(mocks.downloadFIT).not.toHaveBeenCalled();
    expect(mocks.failRevision).not.toHaveBeenCalled();
  });
});
