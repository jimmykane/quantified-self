import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryGet, fileMetadata, fileDownload, queueGet, enqueue, queuedMetadata, destinationStatus } = vi.hoisted(() => ({
  queryGet: vi.fn(),
  fileMetadata: vi.fn(),
  fileDownload: vi.fn(),
  queueGet: vi.fn(),
  enqueue: vi.fn(),
  queuedMetadata: vi.fn(),
  destinationStatus: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({ error: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));

vi.mock('firebase-admin', () => {
  const query = {
    where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), get: queryGet,
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  const firestore = () => ({
    collection: (name: string) => name === 'users'
      ? { doc: () => ({ collection: () => query }) }
      : { doc: () => ({ get: queueGet }) },
  });
  return {
    firestore,
    storage: () => ({ bucket: () => ({ file: () => ({ getMetadata: fileMetadata, download: fileDownload }) }) }),
  };
});

vi.mock('./process-queue-item', () => ({ getDestinationConnectionStatus: destinationStatus }));
vi.mock('./queue', () => ({
  buildActivitySyncQueueItemId: vi.fn(async () => 'queue-id'),
  enqueueActivitySyncQueueItem: enqueue,
}));
vi.mock('./metadata', () => ({
  getActivitySyncMetadataDocId: (routeId: string) => `activitySync_${routeId}`,
  setActivitySyncQueuedMetadata: queuedMetadata,
  setActivitySyncRequeuedMetadata: vi.fn(),
}));

import { runHistoricalSendPage } from './historical-send';
import { ACTIVITY_SYNC_ROUTES, getHistoricalActivityRouteId } from '../../../shared/activity-sync-routes';

const source = ACTIVITY_SYNC_ROUTES.GarminAPI_to_SuuntoApp.sourceServiceName;
const destination = ACTIVITY_SYNC_ROUTES.GarminAPI_to_SuuntoApp.destinationServiceName;
const eventRef = {
  collection: () => ({
    doc: (name: string) => ({ get: async () => name === source
      ? { exists: true, data: () => ({ activityFileID: 'source-1' }) }
      : name === 'manualUploadOrigin'
        ? { exists: true, data: () => ({ kind: 'manualUpload', version: 1 }) }
      : { exists: false, data: () => undefined } }),
  }),
};
const eventSnapshot = {
  id: 'event-1',
  data: () => ({ startDate: Date.parse('2026-01-02T00:00:00.000Z'), originalFiles: [{
    path: 'users/user-1/events/event-1/original.fit', generation: '42',
  }] }),
  ref: eventRef,
};
const request = {
  version: 2 as const,
  action: 'preview' as 'preview' | 'send',
  destinationServiceName: destination,
  sources: [source],
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-01-31T23:59:59.999Z',
};

describe('historical activity send pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryGet.mockResolvedValue({ size: 1, docs: [eventSnapshot] });
    queueGet.mockResolvedValue({ exists: false, data: () => undefined });
    fileMetadata.mockResolvedValue([{ generation: '42', size: '1024' }]);
    const fit = Buffer.alloc(14);
    fit[0] = 12;
    fit.write('.FIT', 8, 'ascii');
    fileDownload.mockResolvedValue([fit]);
    destinationStatus.mockResolvedValue('connected');
    enqueue.mockResolvedValue({ enqueued: true });
    queuedMetadata.mockResolvedValue(undefined);
  });

  it('previews a retained provider import without mutating queue or requiring its source connection', async () => {
    expect(getHistoricalActivityRouteId(source, destination)).toBeTruthy();
    expect(Object.values(ACTIVITY_SYNC_ROUTES).some(route => route.sourceServiceName === source && route.destinationServiceName === destination)).toBe(true);
    const result = await runHistoricalSendPage('user-1', request);
    expect(result).toMatchObject({ scanned: 1, eligibleBySource: { [source]: 1 }, queued: 0, failedCount: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(queuedMetadata).not.toHaveBeenCalled();
    expect(destinationStatus).toHaveBeenCalledWith('user-1', destination);
  });

  it('sends through the existing queue with a historical mode and retained file generation', async () => {
    const result = await runHistoricalSendPage('user-1', { ...request, action: 'send' });
    expect(result.queued).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceServiceName: source, destinationServiceName: destination,
      deliveryMode: 'historical', manual: true,
      originalFile: expect.objectContaining({ generation: '42', extension: 'fit' }),
    }));
    expect(queuedMetadata).toHaveBeenCalledOnce();
  });

  it('includes an unaccepted automatic queue row in preview and one-time send', async () => {
    queueGet.mockResolvedValue({
      exists: true,
      data: () => ({
        processed: false,
        deliveryMode: 'automatic',
        deferredReason: 'service_reconnect_required',
        routeId: ACTIVITY_SYNC_ROUTES.GarminAPI_to_SuuntoApp.id,
        userID: 'user-1',
        eventID: 'event-1',
        sourceServiceName: source,
        destinationServiceName: destination,
      }),
    });

    const preview = await runHistoricalSendPage('user-1', request);
    expect(preview.eligibleBySource[source]).toBe(1);
    expect(preview.skippedByReason.already_queued).toBeUndefined();

    const sent = await runHistoricalSendPage('user-1', { ...request, action: 'send' });
    expect(sent.queued).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: 'historical', manual: true }));
  });

  it('reports durable queue admission even when its status metadata write fails', async () => {
    queuedMetadata.mockRejectedValueOnce(new Error('metadata unavailable'));

    const result = await runHistoricalSendPage('user-1', { ...request, action: 'send' });

    expect(result.queued).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('does not preview a successfully delivered queue item as eligible when metadata is missing', async () => {
    queueGet.mockResolvedValue({ exists: true, data: () => ({ processed: true, resultStatus: 'success' }) });

    const result = await runHistoricalSendPage('user-1', request);

    expect(result.eligibleBySource[source]).toBeUndefined();
    expect(result.skippedByReason.already_sent).toBe(1);
    expect(fileMetadata).not.toHaveBeenCalled();
  });

  it('rejects invalid source selection and a disconnected destination before scanning', async () => {
    await expect(runHistoricalSendPage('user-1', { ...request, sources: [] })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(queryGet).not.toHaveBeenCalled();
    destinationStatus.mockResolvedValue('disconnect_pending');
    await expect(runHistoricalSendPage('user-1', request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(queryGet).not.toHaveBeenCalled();
  });

  it('includes trusted manual FIT uploads and excludes merged events', async () => {
    const manualEvent = {
      ...eventSnapshot,
      data: () => ({ startDate: Date.parse('2026-01-02T00:00:00.000Z'), originalFiles: [{
        path: 'users/user-1/events/event-1/original.fit', generation: '42',
      }] }),
    };
    queryGet.mockResolvedValueOnce({ size: 1, docs: [manualEvent] });
    const manualRequest = { ...request, sources: ['manualUpload' as const] };
    const preview = await runHistoricalSendPage('user-1', manualRequest);
    expect(preview.eligibleBySource.manualUpload).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(fileDownload).not.toHaveBeenCalled();

    queryGet.mockResolvedValueOnce({ size: 1, docs: [{
      ...manualEvent,
      data: () => ({ ...manualEvent.data(), mergeType: 'multi' }),
    }] });
    const excluded = await runHistoricalSendPage('user-1', manualRequest);
    expect(excluded.eligibleBySource.manualUpload).toBeUndefined();
    expect(excluded.skippedByReason.merged_or_derived_event).toBe(1);
  });

  it('returns a bound page cursor and rejects a cursor for different filters', async () => {
    const events = Array.from({ length: 50 }, (_, index) => ({
      ...eventSnapshot,
      id: `event-${`${index}`.padStart(2, '0')}`,
    }));
    queryGet.mockResolvedValueOnce({ size: 50, docs: events });
    const first = await runHistoricalSendPage('user-1', request);
    expect(first.scanned).toBe(50);
    expect(first.nextCursor).toMatchObject({
      lastStartDate: Date.parse('2026-01-02T00:00:00.000Z'),
      lastEventID: 'event-49',
    });

    await expect(runHistoricalSendPage('user-1', {
      ...request, sources: ['manualUpload'], cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('reports a transient original-file lookup failure instead of silently skipping it', async () => {
    fileMetadata.mockRejectedValueOnce(Object.assign(new Error('storage unavailable'), { code: 503 }));

    const result = await runHistoricalSendPage('user-1', request);

    expect(result.failedCount).toBe(1);
    expect(result.skippedByReason.processing_failed).toBe(1);
    expect(result.skippedByReason.missing_invalid_or_oversized_original).toBeUndefined();
  });
});
