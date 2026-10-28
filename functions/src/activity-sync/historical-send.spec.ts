import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryGet, bulkGet, queryStartAfter, fileMetadata, fileDownload, queueGet, enqueue, queuedMetadata, destinationStatus } = vi.hoisted(() => ({
  queryGet: vi.fn(),
  bulkGet: vi.fn(),
  queryStartAfter: vi.fn(),
  fileMetadata: vi.fn(),
  fileDownload: vi.fn(),
  queueGet: vi.fn(),
  enqueue: vi.fn(),
  queuedMetadata: vi.fn(),
  destinationStatus: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({ error: vi.fn(), info: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));

vi.mock('firebase-admin', () => {
  const query = {
    where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: queryStartAfter, get: queryGet,
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  const firestore = () => ({
    getAll: bulkGet,
    collection: (name: string) => name === 'users'
      ? { doc: () => ({ collection: () => query }) }
      : { doc: (id: string) => ({ path: `${name}/${id}`, get: queueGet }) },
  });
  return {
    firestore,
    storage: () => ({ bucket: () => ({ file: () => ({ getMetadata: fileMetadata, download: fileDownload }) }) }),
  };
});

vi.mock('./process-queue-item', () => ({ getDestinationConnectionStatus: destinationStatus }));
vi.mock('./queue', () => ({
  buildActivitySyncQueueItemId: vi.fn(async (route: string, owner: string, event: string) => `${route}-${owner}-${event}`),
  enqueueActivitySyncQueueItem: enqueue,
}));
vi.mock('./metadata', () => ({
  getActivitySyncMetadataDocId: (routeId: string) => `activitySync_${routeId}`,
  setActivitySyncQueuedMetadata: queuedMetadata,
  setActivitySyncRequeuedMetadata: vi.fn(),
}));

import { runHistoricalSendPage } from './historical-send';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTES, getHistoricalActivityRouteId } from '../../../shared/activity-sync-routes';

const source = ACTIVITY_SYNC_ROUTES.GarminAPI_to_SuuntoApp.sourceServiceName;
const destination = ACTIVITY_SYNC_ROUTES.GarminAPI_to_SuuntoApp.destinationServiceName;
const eventRef = {
  collection: () => ({
    doc: (name: string) => ({ path: `users/user-1/events/event-1/metaData/${name}`, get: async () => name === source
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
    bulkGet.mockImplementation(async (...refs) => Promise.all(refs.map(async ref => ({ ...await ref.get(), ref }))));
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
    expect(bulkGet).not.toHaveBeenCalled();
  });

  it('checks fifty events and all four sources in six bounded bulk reads without individual Firestore reads', async () => {
    const destination = ACTIVITY_SYNC_ROUTES.GarminAPI_to_COROSAPI.destinationServiceName;
    const sources = [source, ACTIVITY_SYNC_ROUTES.SuuntoApp_to_COROSAPI.sourceServiceName,
      ACTIVITY_SYNC_ROUTES.WahooAPI_to_COROSAPI.sourceServiceName, 'manualUpload'] as const;
    const individualGet = vi.fn(() => { throw new Error('Unexpected individual preview read'); });
    const docs = Array.from({ length: 50 }, (_, index) => {
      const id = `event-${index.toString().padStart(2, '0')}`;
      const root = `users/user-1/events/${id}`;
      return { id, data: () => ({ startDate: Date.parse('2026-01-02T00:00:00Z'),
        originalFiles: [{ path: `${root}/original.fit`, generation: '42' }] }),
        ref: { collection: () => ({ doc: (name: string) => ({ path: `${root}/metaData/${name}`, get: individualGet }) }) } };
    });
    queryGet.mockResolvedValue({ size: docs.length, docs });
    let activeReads = 0;
    let maxActiveReads = 0;
    bulkGet.mockImplementation(async (...refs) => {
      maxActiveReads = Math.max(maxActiveReads, ++activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return refs.map(ref => ({ ref,
        exists: ref.path.endsWith(`/metaData/${source}`),
        data: () => ref.path.endsWith(`/metaData/${source}`) ? { activityFileID: 'source-file' } : undefined,
      }));
    });

    const result = await runHistoricalSendPage('user-1', { ...request, destinationServiceName: destination, sources: [...sources] });

    expect(result.eligibleBySource).toEqual({ [source]: 50 });
    expect(result.skippedBySource).toEqual({ [sources[1]]: 50, [sources[2]]: 50, manualUpload: 50 });
    expect(result.failedCount).toBe(0);
    expect(result.nextCursor?.lastEventID).toBe('event-49');
    expect(bulkGet).toHaveBeenCalledTimes(6);
    expect(bulkGet.mock.calls.every(refs => refs.length <= 100)).toBe(true);
    expect(maxActiveReads).toBe(2);
    expect(individualGet).not.toHaveBeenCalled();
    expect(queueGet).not.toHaveBeenCalled();
    expect(fileMetadata).toHaveBeenCalledTimes(50);
    expect(fileDownload).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fails a bulk-read outage without publishing an eligible page or writing anything', async () => {
    bulkGet.mockRejectedValueOnce(new Error('Firestore unavailable'));
    await expect(runHistoricalSendPage('user-1', request)).rejects.toThrow('Firestore unavailable');
    expect(enqueue).not.toHaveBeenCalled();
    expect(fileMetadata).not.toHaveBeenCalled();
  });

  it('does not read queue rows or provenance for activities already marked sent', async () => {
    bulkGet.mockImplementation(async (...refs) => refs.map(ref => ({ ref, exists: true, data: () => ({ status: 'success' }) })));
    const result = await runHistoricalSendPage('user-1', request);
    expect(result.skippedByReason.already_sent).toBe(1);
    expect(bulkGet).toHaveBeenCalledOnce();
    expect(bulkGet.mock.calls[0][0].path).toContain('/metaData/activitySync_');
    expect(queueGet).not.toHaveBeenCalled();
    expect(fileMetadata).not.toHaveBeenCalled();
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

  it.each([
    { deliveryMode: 'historical' }, { destinationUploadID: 'accepted-upload' },
    { providerOperationStartedAt: 1 }, { destinationUploadContinuation: { retained: true } },
    { resultStatus: 'manual_reconciliation_required' },
  ])('keeps pending or accepted queue rows protected with batched preview reads: %j', async protection => {
    queueGet.mockResolvedValue({ exists: true, data: () => ({ processed: false, ...protection }) });
    const result = await runHistoricalSendPage('user-1', request);
    expect(result.eligibleBySource[source]).toBeUndefined();
    expect(result.skippedByReason.already_queued).toBe(1);
    expect(fileMetadata).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('re-reads queue state on Send rather than reusing preview snapshots', async () => {
    expect((await runHistoricalSendPage('user-1', request)).eligibleBySource[source]).toBe(1);
    queueGet.mockResolvedValue({ exists: true, data: () => ({ processed: true, resultStatus: 'success' }) });
    const result = await runHistoricalSendPage('user-1', { ...request, action: 'send' });
    expect(result.queued).toBe(0);
    expect(result.skippedByReason.already_sent).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('logs only bounded count/timing diagnostics and retains success if diagnostic logging fails', async () => {
    await runHistoricalSendPage('user-1', request);
    expect(logger.info).toHaveBeenCalledWith('[HistoricalActivitySend] Preview page checked.', {
      destination, sourceCount: 1, scanned: 1, failedCount: 0, hasNextPage: false, elapsedMs: expect.any(Number),
    });
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('Logger unavailable'); });
    expect((await runHistoricalSendPage('user-1', request)).eligibleBySource[source]).toBe(1);
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

    queryGet.mockResolvedValueOnce({ size: 1, docs: [eventSnapshot] });
    const next = await runHistoricalSendPage('user-1', { ...request, cursor: first.nextCursor! });
    expect(queryStartAfter).toHaveBeenCalledWith(first.nextCursor!.lastStartDate, 'event-49');
    expect(next.nextCursor).toBeNull();

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
