import { Readable } from 'node:stream';
import { File, Storage } from '@google-cloud/storage';
import { Firestore, Query } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { firestoreMock, storageMock } = vi.hoisted(() => ({firestoreMock: vi.fn(), storageMock: vi.fn()}));
vi.mock('firebase-admin', () => ({firestore: firestoreMock, storage: storageMock}));
vi.mock('./activity-chart-rate-limit', async importOriginal => ({
  ...await importOriginal<typeof import('./activity-chart-rate-limit')>(),
  consumeActivityChartRateLimit: vi.fn().mockResolvedValue(undefined),
}));
import { consumeActivityChartRateLimit } from './activity-chart-rate-limit';
import { createMcpDataService } from './data.service';

let fixtureCount = 0;
async function fixture(sourceOverrides: Record<string, unknown> = {}) {
  const uid = `storage-fixture-${++fixtureCount}`;
  const path = `users/${uid}/events/event-1/original.gpx`;
  const source = {path, generation: '123', ...sourceOverrides};
  const startDate = Date.parse('2026-07-01T08:00:00Z');
  const activity = {eventID: 'event-1', eventStartDate: startDate, startDate, endDate: startDate + 2000, type: ActivityTypes.Running, stats: {}};
  const db = new Firestore({projectId: 'test-project'});
  firestoreMock.mockReturnValue(db);
  const ownerRead = vi.spyOn(db, 'getAll').mockResolvedValue([{exists: true}, {exists: false}] as never);
  vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query) {
    const collectionId = (this as Query & { _queryOptions: {collectionId: string} })._queryOptions.collectionId;
    return {empty: false, docs: [{id: collectionId === 'events' ? 'event-1' : 'activity-1',
      data: () => collectionId === 'events' ? {originalFile: source} : activity}]} as never;
  });
  const storage = new Storage({projectId: 'test-project'});
  const bucket = vi.fn((name?: string) => storage.bucket(name || 'test-project.appspot.com'));
  storageMock.mockReturnValue({bucket});
  const metadata = vi.spyOn(File.prototype, 'getMetadata').mockResolvedValue([{generation: '123'}] as never);
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><type>Running</type><trkseg>'
    + [100, 120, 140].map((hr, i) => `<trkpt lat="60.1" lon="24.${1000 + i}"><time>2026-07-01T08:00:0${i}Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`).join('')
    + '</trkseg></trk></gpx>';
  const download = vi.spyOn(File.prototype, 'createReadStream').mockImplementation(() => Readable.from([Buffer.from(gpx)]));
  const service = createMcpDataService();
  const listed = await service.listActivities({uid, connectionId: 'connection-1', appBaseUrl: 'https://quantified-self.io'});
  const input = {uid, connectionId: 'connection-1', scopes: ['activity-details:read'], activityRef: listed.activities[0].activityRef, metrics: ['heart_rate'], limit: 2};
  return {service, input, path, metadata, download, ownerRead};
}

// Exercise the default adapter, real SDK object selection and production parser, with network reads replaced.
describe('activity sample Storage adapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it.each(['123', undefined])('pins metadata generation %s to the downloaded object and rechecks warm pages', async generation => {
    const f = await fixture({generation});
    const first = await f.service.getActivitySamples(f.input);
    const second = await f.service.getActivitySamples({...f.input, cursor: first.nextCursor!});
    expect(first.series[0].values).toEqual([100, 120]);
    expect(second.series[0].values).toEqual([140]);
    expect(second.nextCursor).toBeNull();
    expect(f.metadata).toHaveBeenCalledTimes(4);
    expect(f.metadata.mock.instances.every(file => file.name === f.path && file.generation === (generation ? 123 : undefined))).toBe(true);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.download.mock.instances[0]).toMatchObject({name: f.path, generation: 123, bucket: {name: 'test-project.appspot.com'}});
    expect(consumeActivityChartRateLimit).toHaveBeenCalledTimes(1);
  });

  it('rejects deleted objects and removed owners instead of serving cached values', async () => {
    const f = await fixture();
    const first = await f.service.getActivitySamples(f.input);
    f.metadata.mockRejectedValueOnce(new Error('private Storage object no longer exists'));
    await expect(f.service.getActivitySamples({...f.input, cursor: first.nextCursor!})).rejects.toMatchObject({
      code: 'detail_not_available', message: 'The original activity samples could not be read safely.',
    });
    const reads = f.metadata.mock.calls.length;
    f.ownerRead.mockResolvedValueOnce([{exists: false}, {exists: false}] as never);
    await expect(f.service.getActivitySamples({...f.input, cursor: first.nextCursor!})).rejects.toMatchObject({code: 'detail_not_available'});
    expect(f.metadata).toHaveBeenCalledTimes(reads);
    expect(f.download).toHaveBeenCalledTimes(1);
  });

  it.each(['456', '', 'broken'])('rejects unavailable or mismatched Storage generation %j before download', async generation => {
    const f = await fixture();
    f.metadata.mockResolvedValue([{generation}] as never);
    await expect(f.service.getActivitySamples(f.input)).rejects.toMatchObject({code: 'detail_not_available'});
    expect(f.download).not.toHaveBeenCalled();
    expect(consumeActivityChartRateLimit).not.toHaveBeenCalled();
  });

  it.each([{path: 'users/other/events/event-1/original.gpx'}, {bucket: 'unapproved.appspot.com'}])('rejects unapproved sources before Storage I/O: %j', async source => {
    const f = await fixture(source);
    await expect(f.service.getActivitySamples(f.input)).rejects.toMatchObject({code: 'detail_not_available'});
    expect(f.metadata).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
    expect(consumeActivityChartRateLimit).not.toHaveBeenCalled();
  });
});
