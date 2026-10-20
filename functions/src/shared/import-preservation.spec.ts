import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { EventWriter, type FirestoreAdapter } from './event-writer';
import { preserveImportedActivityEdits, preserveImportedActivityIdentities, preserveImportedEventEdits } from './import-preservation';

const state = vi.hoisted(() => ({
  activities: new Map<string, Record<string, unknown>>(), metadata: {} as Record<string, unknown>,
  get: vi.fn(), runTransaction: vi.fn(), collection: vi.fn(), select: vi.fn(), where: vi.fn(), limit: vi.fn(),
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({
  doc: (path: string) => ({ path }), collection: state.collection, runTransaction: state.runTransaction,
}) }));

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
    vi.clearAllMocks(); state.activities.clear(); state.metadata = {};
    const query = { where: state.where, select: state.select, limit: state.limit };
    state.collection.mockReturnValue(query); state.where.mockReturnValue(query);
    state.select.mockReturnValue(query); state.limit.mockReturnValue(query);
    state.get.mockImplementation(async ref => ref === query
      ? { size: state.activities.size, docs: [...state.activities].map(([id, data]) => ({ id, data: () => data })) }
      : { data: () => state.metadata });
    state.runTransaction.mockImplementation(async callback => callback({ get: state.get }));
    authorize = vi.fn(async () => undefined);
  });

  function store(id: string, parsed = activity(), extra: Record<string, unknown> = {}) {
    state.activities.set(id, { ...parsed.toJSON(), ...extra });
  }

  it('keeps new-import IDs unchanged and scopes/masks the existing-activity read', async () => {
    const parsed = activity();
    await preserveImportedActivityIdentities('owner', event([parsed]), authorize);
    expect(parsed.getID()).toBe('legacy-0');
    expect(state.collection).toHaveBeenCalledWith('users/owner/activities');
    expect(state.where).toHaveBeenCalledWith('eventID', '==', 'event');
    expect(state.select).toHaveBeenCalledWith('startDate', 'endDate', 'type', 'sourceActivityKey', 'stats.Duration', 'stats.Distance');
    expect(state.limit).toHaveBeenCalledWith(101);
    expect(state.runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
  });

  it.each([false, true])('reuses legacy or source-keyed stored identities (source key: %s)', async keyed => {
    const parsed = activity(); store('saved-id', parsed, keyed ? { sourceActivityKey: 'saved-source-key' } : {});
    await preserveImportedActivityIdentities('owner', event([parsed]), authorize);
    expect(parsed.getID()).toBe('saved-id');
    if (keyed) expect(parsed).toHaveProperty('sourceActivityKey', 'saved-source-key');
  });

  it('matches reordered multisport legs and verified sport refinements instead of reusing array indexes', async () => {
    const bike = activity(0, 'Cycling'), ski = activity(1, 'Backcountry Skiing');
    store('bike-id', bike); store('ski-id', ski, { stats: { Duration: { _value: 3600 }, Distance: { value: 10_000 } } });
    const parsedBike = activity(0, 'Road Cycling'), parsedSki = activity(1, 'Ski Touring');
    await preserveImportedActivityIdentities('owner', event([parsedSki, parsedBike]), authorize);
    expect([parsedSki.getID(), parsedBike.getID()]).toEqual(['ski-id', 'bike-id']);
  });

  it('retains partial-first-import recovery without granting saved events permission to append legs', async () => {
    store('saved-first', activity());
    const first = activity(), second = activity(1);
    await expect(preserveImportedActivityIdentities('owner', event([first, second]), authorize)).rejects.toThrow('Cannot safely match');
    expect(first.getID()).toBe('legacy-0');
    state.metadata = { sourceFirstImport: true };
    await preserveImportedActivityIdentities('owner', event([first, second]), authorize);
    expect([first.getID(), second.getID()]).toEqual(['saved-first', 'legacy-1']);
  });

  it('rejects ID collisions during partial-first-import recovery before changing any IDs', async () => {
    state.metadata = { sourceFirstImport: true }; store('legacy-1', activity());
    const first = activity(), second = activity(1);
    await expect(preserveImportedActivityIdentities('owner', event([first, second]), authorize)).rejects.toThrow('Cannot safely reuse');
    expect(first.getID()).toBe('legacy-0');
  });

  it('rejects ambiguous duplicates rather than choosing a device name or adding another copy', async () => {
    store('copy-1'); store('copy-2');
    const parsed = activity();
    await expect(preserveImportedActivityIdentities('owner', event([parsed]), authorize)).rejects.toThrow('Cannot safely match');
    expect(parsed.getID()).toBe('legacy-0');
    expect(state.activities.size).toBe(2);
  });

  it('stops before reading or mutating identities when the existing source reservation is stale', async () => {
    authorize.mockRejectedValueOnce(new Error('superseded'));
    const parsed = activity();
    await expect(preserveImportedActivityIdentities('owner', event([parsed]), authorize)).rejects.toThrow('superseded');
    expect(state.get).not.toHaveBeenCalled(); expect(parsed.getID()).toBe('legacy-0');
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
        await preserveImportedActivityIdentities('owner', parsed, authorize);
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
