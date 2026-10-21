import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { DataAscent, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { EventWriter, type FirestoreAdapter } from './event-writer';
import { prepareImportedEventWrite, prepareReparsedEventWrite, preserveImportedActivityEdits, preserveImportedEventEdits } from './import-preservation';

const state = vi.hoisted(() => ({
  activities: new Map<string, Record<string, unknown>>(), metadata: {} as Record<string, unknown>, parentExists: true,
  parent: {} as Record<string, unknown>,
  get: vi.fn(), prepare: vi.fn(), commit: vi.fn(), collection: vi.fn(), select: vi.fn(), where: vi.fn(), limit: vi.fn(),
}));
vi.mock('../training-load/training-load-metadata', () => ({ prepareTrainingLoadMetadata: state.prepare }));

function activity(index = 0, type = 'Running') {
  let id = `legacy-${index}`;
  const startDate = new Date(1_700_000_000_000 + index * 3_600_000);
  const data = { startDate, endDate: new Date(startDate.getTime() + 3_600_000), type,
    creator: { name: 'Parsed watch', manufacturer: 'Manufacturer' }, stats: { Duration: 3600, Distance: 10_000 } };
  return { ...data, getID: () => id, setID: (value: string) => { id = value; },
    getStat: (type: string) => ({ getValue: () => data.stats[type as keyof typeof data.stats] }),
    getAllExportableStreams: () => [], toJSON: () => ({ ...data, id }),
  };
}

function event(activities = [activity()]) {
  return { getID: () => 'event', getActivities: () => activities,
    toJSON: () => ({ name: 'File title', description: 'File description', activities: [], streams: {} }),
  } as unknown as EventInterface;
}

describe('shared import preservation', () => {
  let authorize: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks(); state.activities.clear(); state.metadata = {}; state.parentExists = true; state.parent = {};
    const query = { where: state.where, select: state.select, limit: state.limit };
    state.collection.mockReturnValue(query); state.where.mockReturnValue(query);
    state.select.mockReturnValue(query); state.limit.mockReturnValue(query);
    state.get.mockImplementation(async ref => ref === query
      ? { size: state.activities.size, docs: [...state.activities].map(([id, data]) => ({ id, data: () => data })) }
      : ref.path.includes('/activities/') ? { id: ref.path.split('/').at(-1), exists: state.activities.has(ref.path.split('/').at(-1)),
        data: () => state.activities.get(ref.path.split('/').at(-1)) }
      : ref.path.endsWith('/trainingLoad') ? { data: () => state.metadata } : { exists: state.parentExists, data: () => state.parent });
    state.prepare.mockImplementation(async (_uid, _event, authorize) => {
      const doc = (path: string) => ({ path, collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }) });
      const db = { doc, collection: state.collection };
      const transaction = { get: state.get, getAll: (...refs: unknown[]) => Promise.all(refs.map(ref => state.get(ref))) };
      await authorize(db, transaction);
      state.commit();
      return Object.assign(vi.fn(async () => authorize(db, transaction)), { sourceWriteId: 'attempt' });
    });
    authorize = vi.fn(async () => undefined);
  });

  function store(id: string, parsed = activity(), extra: Record<string, unknown> = {}) {
    state.activities.set(id, { ...parsed.toJSON(), ...extra });
  }

  it.each(['pending', 'finalized', 'legacy'])('recovers corrected activities from an interrupted reparse: %s', async phase => {
    const parsed = EventImporterJSON.getEventFromJSON({ name: 'Run', startDate: 1700000000000, endDate: 1700003600000,
      activities: [{ ...activity().toJSON(), streams: [], laps: [], intensityZones: [] }], stats: {} }).setID('event');
    parsed.getFirstActivity().setID('retry-id'); parsed.getFirstActivity().addStat(new DataAscent(300));
    store('saved-id', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 100 } });
    store('partial-id', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 250 } });
    state.parent = { benchmarkSourceWritePending: true };
    const legs = { original: { activityId: phase === 'finalized' ? 'partial-id' : 'saved-id' } };
    state.metadata = { sourceWritePending: phase !== 'finalized', [phase === 'legacy' ? 'legacyLegs' : 'legs']: legs };
    if (phase === 'pending') for (let index = 0; index < 101; index++)
      store(`partial-${index}`, activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 250 } });
    await prepareReparsedEventWrite('owner', parsed);
    expect(state.collection).not.toHaveBeenCalled();
    expect(parsed.getFirstActivity()).toHaveProperty('ascentCorrection', { value: 75, sourceValue: 300 });
    expect(parsed.getStat(DataAscent.type).getValue()).toBe(75);
  });

  it.each([false, true])('rejects ambiguous completed sources or foreign recovery references (recovering: %s)', async recovering => {
    store('saved-id', activity(), { eventID: recovering ? 'another-event' : 'event', ascentCorrection: { value: 75, sourceValue: 100 } });
    store('duplicate', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 100 } });
    state.metadata = recovering ? { sourceWritePending: true, legs: { original: { activityId: 'saved-id' } } } : {};
    await expect(prepareReparsedEventWrite('owner', event())).rejects.toThrow();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('keeps new-import IDs unchanged and scopes/masks the existing-activity read', async () => {
    const parsed = activity();
    await prepareImportedEventWrite('owner', event([parsed]), authorize);
    expect(parsed.getID()).toBe('legacy-0');
    expect(state.collection).toHaveBeenCalledWith('users/owner/activities');
    expect(state.where).toHaveBeenCalledWith('eventID', '==', 'event');
    expect(state.select).toHaveBeenCalledWith('startDate', 'endDate', 'type', 'sourceActivityKey', 'stats.Duration', 'stats.Distance', 'ascentCorrection');
    expect(state.limit).toHaveBeenCalledWith(101);
    expect(state.get.mock.invocationCallOrder.at(-1)).toBeLessThan(state.commit.mock.invocationCallOrder[0]);
  });

  it.each([false, true])('reuses legacy or source-keyed stored identities (source key: %s)', async keyed => {
    const parsed = activity(); store('saved-id', parsed, keyed ? { sourceActivityKey: 'saved-source-key' } : {});
    await prepareImportedEventWrite('owner', event([parsed]), authorize);
    expect(parsed.getID()).toBe('saved-id');
    if (keyed) expect(parsed).toHaveProperty('sourceActivityKey', 'saved-source-key');
  });

  it('matches reordered multisport legs and verified sport refinements instead of reusing array indexes', async () => {
    const bike = activity(0, 'Cycling'), ski = activity(1, 'Backcountry Skiing');
    store('bike-id', bike); store('ski-id', ski, { stats: { Duration: { _value: 3600 }, Distance: { value: 10_000 } } });
    const parsedBike = activity(0, 'Road Cycling'), parsedSki = activity(1, 'Ski Touring');
    await prepareImportedEventWrite('owner', event([parsedSki, parsedBike]), authorize);
    expect([parsedSki.getID(), parsedBike.getID()]).toEqual(['ski-id', 'bike-id']);
  });

  it.each([false, true])('retains partial-first-import recovery without granting saved events permission to append legs (missing parent: %s)', async missingParent => {
    store('saved-first', activity());
    const first = activity(), second = activity(1);
    await expect(prepareImportedEventWrite('owner', event([first, second]), authorize)).rejects.toThrow('Cannot safely match');
    expect(first.getID()).toBe('legacy-0');
    state.metadata = missingParent ? {} : { sourceFirstImport: true };
    state.parentExists = !missingParent;
    await prepareImportedEventWrite('owner', event([first, second]), authorize);
    expect([first.getID(), second.getID()]).toEqual(['saved-first', 'legacy-1']);
  });

  it('rejects ID collisions during partial-first-import recovery before changing any IDs', async () => {
    state.metadata = { sourceFirstImport: true }; store('legacy-1', activity());
    const first = activity(), second = activity(1);
    await expect(prepareImportedEventWrite('owner', event([first, second]), authorize)).rejects.toThrow('Cannot safely reuse');
    expect(first.getID()).toBe('legacy-0');
  });

  it('rejects ambiguous duplicates rather than choosing a device name or adding another copy', async () => {
    store('copy-1'); store('copy-2');
    const parsed = activity();
    await expect(prepareImportedEventWrite('owner', event([parsed]), authorize)).rejects.toThrow('Cannot safely match');
    expect(state.commit).not.toHaveBeenCalled();
    expect(parsed.getID()).toBe('legacy-0');
    expect(state.activities.size).toBe(2);
  });

  it('stops before reading or mutating identities when existing authorization rejects the import', async () => {
    authorize.mockRejectedValueOnce(new Error('superseded'));
    const parsed = activity();
    await expect(prepareImportedEventWrite('owner', event([parsed]), authorize)).rejects.toThrow('superseded');
    expect(state.get).not.toHaveBeenCalled(); expect(parsed.getID()).toBe('legacy-0');
  });

  it('rejects a corrected source changing to diving before committing a source reservation', async () => {
    store('saved-id', activity(), { sourceActivityKey: 'same-source', ascentCorrection: { value: 75, sourceValue: 100 } });
    const parsed = Object.assign(activity(0, 'Scuba Diving'), { sourceActivityKey: 'same-source' });
    await expect(prepareImportedEventWrite('owner', event([parsed]))).rejects.toThrow('Reset it before changing');
    expect(state.commit).not.toHaveBeenCalled();
    expect(parsed.getID()).toBe('legacy-0');
  });

  it('does not apply identities from a failed or retried reservation transaction', async () => {
    const parsed = activity(); store('aborted-id', parsed, { sourceActivityKey: 'aborted-key' });
    const db = { doc: (path: string) => ({ path }), collection: state.collection };
    const transaction = { get: state.get };
    state.prepare.mockImplementationOnce(async (_uid, _event, authorize) => {
      await authorize(db, transaction);
      throw new Error('commit failed');
    });
    await expect(prepareImportedEventWrite('owner', event([parsed]))).rejects.toThrow('commit failed');
    expect(parsed.getID()).toBe('legacy-0'); expect(parsed).not.toHaveProperty('sourceActivityKey');

    state.prepare.mockImplementationOnce(async (_uid, _event, authorize) => {
      await authorize(db, transaction);
      expect(parsed.getID()).toBe('legacy-0');
      state.activities.clear(); store('committed-id', parsed, { sourceActivityKey: 'committed-key' });
      await authorize(db, transaction);
      expect(parsed.getID()).toBe('legacy-0'); expect(parsed).not.toHaveProperty('sourceActivityKey');
      return Object.assign(vi.fn(), { sourceWriteId: 'attempt' });
    });
    await prepareImportedEventWrite('owner', event([parsed]));
    expect(parsed.getID()).toBe('committed-id'); expect(parsed).toHaveProperty('sourceActivityKey', 'committed-key');
  });

  it('rechecks authorization but does not prepare identities again during finalization', async () => {
    store('saved-id');
    const finish = await prepareImportedEventWrite('owner', event(), authorize);
    state.get.mockClear(); state.activities.clear(); store('ambiguous-1'); store('ambiguous-2');
    await finish();
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(state.get).not.toHaveBeenCalled();
  });

  it('reuploads through the real writer twice without adding duplicates and preserves live user edits', async () => {
    store('source-based-id', activity(), { sourceActivityKey: 'saved-source-key', creator: { name: 'Custom watch' } });
    const savedEvent = { name: 'Custom title', description: 'Custom description', tags: ['My tag'],
      notes: 'Private notes', privacy: 'private', rpe: 7, feeling: 3 };
    let parent: Record<string, unknown> = savedEvent;
    const setDoc = vi.fn(async (path: string[], data: unknown) => {
      if (path[2] === 'activities') state.activities.set(path[3], preserveImportedActivityEdits(data as Record<string, unknown>, state.activities.get(path[3]) ?? null));
      else parent = preserveImportedEventEdits(data as Record<string, unknown>, parent);
    });
    const adapter: FirestoreAdapter = { setDoc, generateID: () => 'unexpected-new-id', createBlob: data => data,
      prepareTrainingLoad: async parsed => {
        await prepareImportedEventWrite('owner', parsed, authorize);
        // An edit after the identity read must win over the parsed payload too.
        state.activities.get('source-based-id')!.creator = { name: 'Latest custom watch' };
        return async () => undefined;
      },
    };
    const writer = new EventWriter(adapter, undefined, undefined, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    for (let attempt = 0; attempt < 2; attempt++) await writer.writeAllEventData('owner', event());
    expect([...state.activities.keys()]).toEqual(['source-based-id']);
    expect(state.activities.get('source-based-id')).toMatchObject({ sourceActivityKey: 'saved-source-key', creator: { name: 'Latest custom watch' } });
    expect(parent).toMatchObject(savedEvent); expect(parent).not.toHaveProperty('activities'); expect(parent).not.toHaveProperty('streams');
    expect(setDoc).toHaveBeenCalledTimes(4);
  });

  it('preserves cleared fields and sanitizes carried-over edits without mutating either input', () => {
    const incoming = { name: 'Parsed', activities: [], notes: { streams: [1], text: 'Parsed' } };
    const existing = { name: '', description: null, notes: { text: 'Saved', streams: [1] }, tags: ['Saved'] };
    expect(preserveImportedEventEdits(incoming, existing)).toEqual({ name: '', description: null, notes: { text: 'Saved' }, tags: ['Saved'] });
    expect(existing.notes).toHaveProperty('streams'); expect(incoming).toHaveProperty('activities');
    expect(preserveImportedActivityEdits({ creator: { name: 'Recovered watch' }, streams: [1] }, { creator: { name: 'Unknown Device' } }))
      .toEqual({ creator: { name: 'Recovered watch' } });
  });

  it('preserves edited or cleared canonical feedback while still replacing parsed metrics', () => {
    const incoming = { stats: { Feeling: 1, 'Rated Perceived Exertion': 2, Distance: 2000 } };
    expect(preserveImportedEventEdits(incoming, { stats: { Feeling: 5, 'Rated Perceived Exertion': 8, Distance: 1000 } }))
      .toEqual({ stats: { Feeling: 5, 'Rated Perceived Exertion': 8, Distance: 2000 } });
    expect(preserveImportedEventEdits(incoming, { stats: { Distance: 1000 } }))
      .toEqual({ stats: { Distance: 2000 } });
    expect(preserveImportedEventEdits(incoming, null)).toEqual(incoming);
  });
});
