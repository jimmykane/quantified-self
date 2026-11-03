import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { FitBaseType as T, FitEncoder } from 'fit-file-parser';
import { Timestamp } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isRetainedHikeFITCopy, skipVerifiedProviderFITCopy } from './provider-fit-copy';

const state = vi.hoisted(() => ({
  docs: new Map<string, { data: Record<string, unknown>; version: number }>(),
  activities: [] as Array<{ id: string; data: Record<string, unknown>; version: number }>,
  read: vi.fn(), update: vi.fn(), deleted: false,
}));
vi.mock('firebase-admin', () => ({
  firestore: () => ({ doc: (path: string) => ref(path), collection: (path: string) => query(path),
    getAll: async (...refs: Array<{ path: string }>) => refs.map(snapshot),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      get: async (target: { path: string; isQuery?: boolean }) => target.isQuery ? children() : snapshot(target),
      getAll: async (...refs: Array<{ path: string }>) => refs.map(snapshot), update: state.update,
    }),
  }),
  storage: () => ({ bucket: () => ({ name: 'test-bucket', file: state.read }) }),
}));
vi.mock('./user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: async () => ({ shouldSkip: state.deleted }),
  UserDeletionGuardReadError: class extends Error {},
}));
vi.mock('../queue-utils', () => ({ QueueResult: { Processed: 'PROCESSED', Failed: 'FAILED' } }));
vi.mock('../queue/import-monitoring', () => ({ recordImportCompletion: vi.fn() }));

function ref(path: string) { return { path, id: path.split('/').at(-1), parent: { id: path.split('/').at(-2) } }; }
function snapshot(target: { path: string }) {
  const entry = state.docs.get(target.path);
  return { ref: ref(target.path), exists: !!entry, data: () => entry?.data,
    updateTime: entry ? Timestamp.fromMillis(entry.version) : undefined };
}
function children() {
  return { docs: state.activities.map(a => ({ id: a.id, ref: ref(`users/owner/activities/${a.id}`),
    data: () => a.data, exists: true, updateTime: Timestamp.fromMillis(a.version) })) };
}
function query(path: string) {
  const value = { path, isQuery: true, where: () => value, select: (...fields: string[]) => {
    expect(fields).toEqual(['type', 'sourceIdentity', 'startDate', 'endDate']);
    return value;
  }, limit: () => value,
    get: async () => children() };
  return value;
}

const start = new Date('2020-01-01T00:00:00Z');
function fixture(options: {
  incoming?: boolean; split?: boolean; badGPS?: boolean; trim?: boolean; noGPS?: boolean;
  differentIdentity?: boolean; differentTimer?: boolean; differentDistance?: boolean; removePoint?: boolean; missingEnd?: boolean;
} = {}) {
  const e = new FitEncoder(), time = FitEncoder.toFitTimestamp(start);
  e.writeMessage(0, [
    { number: 0, size: 1, baseType: T.Enum, value: 4 },
    { number: 1, size: 2, baseType: T.Uint16, value: 23 },
    { number: 2, size: 2, baseType: T.Uint16, value: 66 },
    { number: 4, size: 4, baseType: T.Uint32, value: time + Number(!!options.differentIdentity) },
  ]);
  for (let i = 0; i < 20; i++) {
    if (options.trim && i > 10 || options.removePoint && i === 10) continue;
    e.writeMessage(20, [
      { number: 253, size: 4, baseType: T.Uint32, value: time + i * 30 },
      ...options.noGPS ? [] : [
        { number: 0, size: 4, baseType: T.Sint32, value: 10_000_000 + i * 10 + (options.badGPS && i === 10 ? 1 : 0) },
        { number: 1, size: 4, baseType: T.Sint32, value: 20_000_000 + i * 10 },
      ],
    ], 1);
  }
  const segments = options.split ? [[0, 300], [300, 571]] : [[0, options.incoming ? 570 : 571]];
  for (const [a, b] of segments) e.writeMessage(18, [
    { number: 2, size: 4, baseType: T.Uint32, value: time + a },
    ...options.missingEnd ? [] : [{ number: 253, size: 4, baseType: T.Uint32, value: time + b }],
    { number: 5, size: 1, baseType: T.Enum, value: 17 },
    { number: 6, size: 1, baseType: T.Enum, value: options.incoming ? 0 : 3 },
    { number: 7, size: 4, baseType: T.Uint32, value: (b - a) * 1000 },
    { number: 8, size: 4, baseType: T.Uint32, value: Math.round((500 + Number(!!options.differentTimer) * 10) * (b - a) / (options.incoming ? 570 : 571) * 1000) },
    ...options.split ? [] : [{ number: 9, size: 4, baseType: T.Uint32,
      value: Math.round((100_000 + Number(!!options.differentDistance) * 1000) * (b - a) / (options.incoming ? 570 : 571)) }],
  ], 2);
  return Buffer.from(e.close());
}

describe('retained FIT copy evidence', () => {
  it.each([false, true])('recognizes the same hike despite end rounding and split=%s', async split => {
    expect(await isRetainedHikeFITCopy(fixture({ split }), fixture({ incoming: true }))).toBe(true);
  });
  it('allows the one missing GPS sample observed in the provider copy', async () => {
    expect(await isRetainedHikeFITCopy(fixture(), fixture({ incoming: true, removePoint: true }))).toBe(true);
  });
  it.each(['badGPS', 'trim', 'noGPS', 'differentIdentity', 'differentTimer', 'differentDistance', 'missingEnd'] as const)(
    'leaves an unverified %s recording blocked', async kind => {
      expect(await isRetainedHikeFITCopy(fixture(), fixture({ incoming: true, [kind]: true }))).toBe(false);
    });
  it('rejects malformed FIT and incorrect CRC instead of recovering bytes', async () => {
    const damaged = fixture({ incoming: true }); damaged[30] ^= 1;
    expect(await isRetainedHikeFITCopy(fixture(), damaged)).toBe(false);
    expect(await isRetainedHikeFITCopy(fixture(), Buffer.from('not FIT'))).toBe(false);
  });
  it('requires the original to belong to the resolved event start', async () => {
    expect(await isRetainedHikeFITCopy(fixture(), fixture({ incoming: true }), +start + 1000)).toBe(false);
  });
});

describe('verified provider copy completion', () => {
  const parent = 'users/owner/events/event';
  const queue = { id: 'job', ref: ref('garminAPIActivityQueue/job'), userID: 'provider', firebaseUserID: 'owner',
    dateCreated: 1000, activityFileID: 'file', activityFileType: 'FIT', callbackURL: 'private-callback', token: 'private-token' };
  const run = () => skipVerifiedProviderFITCopy(queue as never, 'owner', 'event', fixture({ incoming: true }));
  beforeEach(() => {
    vi.clearAllMocks(); state.docs.clear(); state.deleted = false;
    state.docs.set(queue.ref.path, { version: 1, data: { ...queue, processed: false } });
    state.docs.set(parent, { version: 1, data: { name: 'Owner title', notes: 'Owner note', tags: ['saved'],
      startDate: start, originalFiles: [{ path: `${parent}/original.fit`, bucket: 'test-bucket', generation: '123' }] } });
    state.docs.set(`${parent}/metaData/trainingLoad`, { version: 1, data: { controls: { first: { override: 0 } } } });
    state.docs.set(`${parent}/metaData/${ServiceNames.SuuntoApp}`, { version: 1,
      data: { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'source', serviceWorkoutID: 'original' } });
    state.activities = ['first', 'second'].map((id, index) => ({ id, version: 1, data: { type: 'Hiking',
      startDate: new Date(+start + index * 300_000), endDate: new Date(+start + (index ? 571_000 : 300_000)),
      creator: { name: 'Owner watch name' }, ascentCorrection: { value: 20 } } }));
    state.read.mockReturnValue({ createReadStream: () => Readable.from([fixture({ split: true })]) });
  });
  it('handles repeated deliveries without rewriting the original, its two legs or edits', async () => {
    Object.assign(state.activities[0].data, { type: 'Running', sourceIdentity: {
      version: 1, activityId: 'first', startMs: +start, endMs: +start + 300_000, importedType: 'Hiking',
    } });
    const before = structuredClone({ parent: state.docs.get(parent), activities: state.activities });
    for (let i = 0; i < 2; i++) expect(await run()).toBe('PROCESSED');
    expect({ parent: state.docs.get(parent), activities: state.activities }).toEqual(before);
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ path: queue.ref.path }), expect.objectContaining({
      processed: true, resultStatus: 'skipped', skippedReason: 'cross_provider_duplicate', duplicateEventID: 'event',
    }));
    expect(state.update.mock.calls.every(([r]) => r.path === queue.ref.path)).toBe(true);
    expect(state.read).toHaveBeenCalledWith(`${parent}/original.fit`, { generation: '123' });
  });
  it.each(['source', 'activity', 'provider', 'pending', 'connection', 'root', 'queue', 'token', 'revision', 'start', 'deletion'])('does not change queue state after a concurrent %s change', async kind => {
    state.read.mockReturnValue({ createReadStream: () => {
      if (kind === 'source') state.docs.get(parent)!.version++;
      if (kind === 'activity') state.activities[0].version++;
      if (kind === 'provider') state.docs.get(`${parent}/metaData/${ServiceNames.SuuntoApp}`)!.version++;
      if (kind === 'pending') state.docs.get(`${parent}/metaData/trainingLoad`)!.version++;
      if (kind === 'connection') state.docs.set(`users/owner/meta/${ServiceNames.GarminAPI}`, { version: 2, data: {} });
      if (kind === 'root') state.docs.set('garminAPITokens/owner', { version: 2, data: {} });
      if (kind === 'queue') state.docs.get(queue.ref.path)!.data.dateCreated = 2000;
      if (kind === 'token') state.docs.get(queue.ref.path)!.data.token = 'replacement';
      if (kind === 'revision') state.docs.get(queue.ref.path)!.data.queueRevision = 2;
      if (kind === 'start') state.docs.get(queue.ref.path)!.data.startTimeInSeconds = 2;
      if (kind === 'deletion') state.deleted = true;
      return Readable.from([fixture({ split: true })]);
    } });
    expect(await run()).toBe(kind === 'deletion' ? 'PROCESSED' : 'FAILED');
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(['foreign-path', 'foreign-bucket', 'missing-generation', 'pending', 'same-provider', 'extra-leg', 'different-sport'])('avoids Storage reads for %s', async kind => {
    const p = state.docs.get(parent)!.data;
    if (kind === 'foreign-path') p.originalFiles = [{ path: 'users/other/events/event/file.fit', generation: '123' }];
    if (kind === 'foreign-bucket') p.originalFiles = [{ path: `${parent}/file.fit`, bucket: 'other', generation: '123' }];
    if (kind === 'missing-generation') p.originalFiles = [{ path: `${parent}/file.fit` }];
    if (kind === 'pending') state.docs.get(`${parent}/metaData/trainingLoad`)!.data.sourceWritePending = true;
    if (kind === 'same-provider') state.docs.set(`${parent}/metaData/${ServiceNames.GarminAPI}`, { version: 1, data: {} });
    if (kind === 'extra-leg') state.activities.push(state.activities[0]);
    if (kind === 'different-sport') Object.assign(state.activities[0].data, { type: 'Running', sourceIdentity: { importedType: 'Hiking' } });
    expect(await run()).toBeNull();
    expect(state.read).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it('rejects an oversized source even if the Storage stream ignores the requested range', async () => {
    state.read.mockReturnValue({ createReadStream: () => Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1)]) });
    expect(await run()).toBeNull(); expect(state.update).not.toHaveBeenCalled();
  });
  it('keeps a mismatch between the saved legs and original sessions blocked', async () => {
    state.activities[0].data.endDate = new Date(+start + 301_000);
    expect(await run()).toBeNull(); expect(state.update).not.toHaveBeenCalled();
  });
  it('keeps unavailable source reads retryable with no private Storage error text', async () => {
    state.read.mockReturnValue({ createReadStream: () => { throw new Error('private/path/or/provider/error'); } });
    await expect(run()).rejects.toThrow('Could not read the retained FIT for copy verification.');
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(['disconnected', 'replaced-account', 'pending-disconnect', 'wrong-owner', 'wrong-queue'])('rejects %s before reading Storage', async kind => {
    state.docs.set(`users/owner/meta/${ServiceNames.GarminAPI}`, { version: 1, data: {
      connectionState: kind === 'disconnected' ? 'reconnect_required' : 'connected',
      providerUserId: kind === 'replaced-account' ? 'other' : 'provider',
    } });
    if (kind === 'pending-disconnect') state.docs.set('garminAPITokens/owner', { version: 1, data: { disconnectState: 'disconnect_pending' } });
    const attempt = { ...queue, ...(kind === 'wrong-owner' ? { firebaseUserID: 'other' } : {}),
      ...(kind === 'wrong-queue' ? { ref: ref('other/job') } : {}) };
    expect(await skipVerifiedProviderFITCopy(attempt as never, 'owner', 'event', fixture({ incoming: true }))).toBeNull();
    expect(state.read).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
});
