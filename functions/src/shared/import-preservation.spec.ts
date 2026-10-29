import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { DataAscent, DataDescent, ServiceNames, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { EventWriter, type FirestoreAdapter } from './event-writer';
import { prepareImportedEventWrite, prepareReparsedEventWrite, preserveImportedActivityEdits, preserveImportedEventEdits } from './import-preservation';

const state = vi.hoisted(() => ({
  activities: new Map<string, Record<string, unknown>>(), metadata: {} as Record<string, unknown>, parentExists: true,
  parent: {} as Record<string, unknown>, provider: {} as Record<string, unknown>,
  garminProvider: {} as Record<string, unknown>,
  otherProviders: {} as Record<string, Record<string, unknown>>,
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
    addStat: vi.fn(),
    toJSON: () => ({ name: 'File title', description: 'File description', activities: [], streams: {} }),
  } as unknown as EventInterface;
}

describe('shared import preservation', () => {
  let authorize: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks(); state.activities.clear(); state.metadata = {}; state.parentExists = true; state.parent = {}; state.provider = {}; state.garminProvider = {}; state.otherProviders = {};
    const query = { where: state.where, select: state.select, limit: state.limit };
    state.collection.mockReturnValue(query); state.where.mockReturnValue(query);
    state.select.mockReturnValue(query); state.limit.mockReturnValue(query);
    state.get.mockImplementation(async ref => ref === query
      ? { size: state.activities.size, docs: [...state.activities].map(([id, data]) => ({ id, data: () => data })) }
      : ref.path.includes('/activities/') ? { id: ref.path.split('/').at(-1), exists: state.activities.has(ref.path.split('/').at(-1)),
        data: () => state.activities.get(ref.path.split('/').at(-1)) }
      : ref.path.endsWith(`/${ServiceNames.SuuntoApp}`) ? { exists: !!Object.keys(state.provider).length, data: () => state.provider }
      : ref.path.endsWith(`/${ServiceNames.GarminAPI}`) ? { exists: !!Object.keys(state.garminProvider).length, data: () => state.garminProvider }
      : [ServiceNames.COROSAPI, ServiceNames.WahooAPI].some(name => ref.path.endsWith(`/${name}`))
        ? { exists: !!state.otherProviders[ref.path.split('/').at(-1)], data: () => state.otherProviders[ref.path.split('/').at(-1)] }
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

  function garminCopy(type = 'Treadmill', generic = 'Running') {
    const incoming = activity(0, generic), startMs = +incoming.startDate;
    state.parent = { originalFiles: [{ path: 'users/owner/events/event/original.fit' }] };
    store('saved-id', activity(0, type), { endDate: new Date(startMs + 3_652_000),
      sourceIdentity: { version: 1, activityId: 'saved-id', startMs, endMs: startMs + 3_652_000, importedType: type } });
    state.garminProvider = { serviceName: ServiceNames.GarminAPI, serviceUserID: 'garmin-account',
      serviceActivityFileID: 'garmin-file', serviceActivityFileType: 'FIT' };
    if (type === 'Running') {
      incoming.endDate = new Date(startMs + 3_652_000);
      incoming.getStat = type => ({ getValue: () => type === 'Duration' ? 3599.5 : 10_000 });
    }
    if (type === 'Virtual Running') {
      state.activities.get('saved-id')!.sourceIdentity = {
        version: 1, activityId: 'saved-id', startMs, endMs: startMs + 3_601_000, importedType: type,
      };
    }
    return { incoming, provider: { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'suunto-account', serviceWorkoutID: 'workout' } };
  }

  it.each([['Treadmill', 'Running'], ['Indoor Rowing', 'Rowing'], ['Running', 'Trail Running'], ['Virtual Running', 'Running']])(
    'skips a verified Garmin %s copy from Suunto %s before reserving or changing any source', async (type, generic) => {
      const { incoming, provider } = garminCopy(type, generic);
      state.parent = { ...state.parent, name: 'Owner title', notes: 'Owner note' };
      state.metadata = { controls: { saved: { override: 0 } } };
      const before = structuredClone({ parent: state.parent, activities: [...state.activities], metadata: state.metadata });
      await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider))
        .rejects.toMatchObject({ name: 'ProviderImportDuplicateError', eventID: 'event' });
      expect(state.commit).not.toHaveBeenCalled();
      expect({ parent: state.parent, activities: [...state.activities], metadata: state.metadata }).toEqual(before);
      expect(incoming.getID()).toBe('legacy-0');
      expect(state.get.mock.calls.filter(([ref]) => ref.path?.endsWith(`/${ServiceNames.GarminAPI}`))).toHaveLength(1);
    });

  const unverifiedScenarios = ['manual', 'same-provider', 'multisport', 'merged-files', 'missing-original', 'malformed-original',
    'foreign-original', 'different-event-original', 'non-fit-original', 'pending', 'pending-parent', 'first-import', 'different-distance',
    'missing-provenance', 'wrong-provenance', 'non-fit', 'incomplete-provenance', 'sml-original'];
  it.each(['Treadmill', 'Running', 'Virtual Running'].flatMap(type => unverifiedScenarios
    .filter(scenario => type !== 'Running' || scenario !== 'same-provider').map(scenario => ({ type, scenario }))))(
    'retains identity conflict protection for an unverified $type copy: $scenario', async ({ type, scenario }) => {
      const { incoming, provider } = garminCopy(type, type === 'Running' ? 'Trail Running' : 'Running');
      if (scenario === 'same-provider') state.provider = provider;
      if (scenario === 'pending') state.metadata = { sourceWritePending: true };
      if (scenario === 'pending-parent') state.parent.benchmarkSourceWritePending = true;
      if (scenario === 'merged-files') state.parent.originalFiles = [{ path: 'one.fit' }, { path: 'two.fit' }];
      if (scenario === 'missing-original') delete state.parent.originalFiles;
      if (scenario === 'malformed-original') state.parent.originalFiles = [{}];
      if (scenario === 'foreign-original') state.parent.originalFiles = [{ path: 'users/other/events/event/original.fit' }];
      if (scenario === 'different-event-original') state.parent.originalFiles = [{ path: 'users/owner/events/other/original.fit' }];
      if (scenario === 'non-fit-original') state.parent.originalFiles = [{ path: 'users/owner/events/event/original.gpx' }];
      if (scenario === 'sml-original') state.parent.originalFiles = [{ path: 'users/owner/events/event/original.json' }];
      if (scenario === 'first-import') state.metadata = { sourceFirstImport: true };
      if (scenario === 'different-distance') state.activities.get('saved-id')!.stats = { Duration: 3600, Distance: type === 'Running' ? 9000 : 9999 };
      if (scenario === 'missing-provenance') state.garminProvider = {};
      if (scenario === 'wrong-provenance') state.garminProvider.serviceName = ServiceNames.WahooAPI;
      if (scenario === 'non-fit') state.garminProvider.serviceActivityFileType = 'TCX';
      if (scenario === 'incomplete-provenance') delete state.garminProvider.serviceActivityFileID;
      await expect(prepareImportedEventWrite('owner', event(scenario === 'multisport' ? [incoming, activity(1)] : [incoming]),
        authorize, scenario === 'manual' ? undefined : provider)).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
      expect(state.commit).not.toHaveBeenCalled();
      const needsProvenance = ['missing-provenance', 'wrong-provenance', 'non-fit', 'incomplete-provenance'].includes(scenario);
      expect(state.get.mock.calls.filter(([ref]) => ref.path?.endsWith(`/${ServiceNames.GarminAPI}`)))
        .toHaveLength(needsProvenance ? 1 : 0);
    });

  it('keeps a verified same-provider sport revision on the ordinary preservation path', async () => {
    const { incoming, provider } = garminCopy('Running', 'Trail Running');
    state.provider = provider;
    await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider)).resolves.toBeTypeOf('function');
    expect(state.commit).toHaveBeenCalledOnce();
    expect(incoming.getID()).toBe('saved-id');
    expect(state.get.mock.calls.filter(([ref]) => ref.path?.endsWith(`/${ServiceNames.GarminAPI}`))).toHaveLength(0);
  });

  function conflictingRun() {
    const incoming = activity(0, 'Running'), startMs = +incoming.startDate;
    incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 3599.7 : 9900 });
    state.parent = { name: 'Owner title', notes: 'Owner notes', tags: ['retained'],
      originalFiles: [{ path: 'users/owner/events/event/original.fit' }] };
    store('saved-id', activity(0, 'Trail Running'), {
      sourceIdentity: { version: 1, activityId: 'saved-id', startMs, endMs: +incoming.endDate, importedType: 'Trail Running' },
      ascentCorrection: { value: 75, sourceValue: 100 },
    });
    state.metadata = { controls: { 'saved-id': { override: 0 } } };
    state.garminProvider = { serviceName: ServiceNames.GarminAPI, serviceUserID: 'account',
      serviceActivityFileID: 'file', serviceActivityFileType: 'FIT' };
    const provider = { serviceName: ServiceNames.COROSAPI, serviceOpenId: 'account', serviceWorkoutID: 'workout',
      serviceWorkoutComponentKey: 'root' };
    return { incoming, provider };
  }

  it('skips a conflicting second-provider run repeatedly without changing the saved workout, source or edits', async () => {
    const { incoming, provider } = conflictingRun();
    const before = structuredClone({ parent: state.parent, activities: [...state.activities], metadata: state.metadata });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider))
        .rejects.toMatchObject({ name: 'ProviderImportDuplicateError', eventID: 'event' });
      expect({ parent: state.parent, activities: [...state.activities], metadata: state.metadata }).toEqual(before);
      expect(incoming.getID()).toBe('legacy-0');
    }
    expect(state.commit).not.toHaveBeenCalled();
    expect([...state.activities.keys()]).toEqual(['saved-id']);
  });

  it('propagates the duplicate through the real writer before any document or original-file upload', async () => {
    const { incoming, provider } = conflictingRun();
    const setDoc = vi.fn(), uploadFile = vi.fn(), log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const writer = new EventWriter({ setDoc, createBlob: data => data, generateID: () => 'unexpected',
      prepareTrainingLoad: parsed => prepareImportedEventWrite('owner', parsed, authorize, provider),
    }, { uploadFile }, undefined, log);
    await expect(writer.writeAllEventData('owner', event([incoming]), {
      data: new Uint8Array(), extension: 'fit', startDate: incoming.startDate,
    })).rejects.toMatchObject({ name: 'ProviderImportDuplicateError', eventID: 'event' });
    expect(setDoc).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  const recordingProviders: Record<string, Record<string, unknown>> = {
    [ServiceNames.GarminAPI]: { serviceName: ServiceNames.GarminAPI, serviceUserID: 'account', serviceActivityFileID: 'file', serviceActivityFileType: 'FIT' },
    [ServiceNames.SuuntoApp]: { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'account', serviceWorkoutID: 'workout' },
    [ServiceNames.COROSAPI]: { serviceName: ServiceNames.COROSAPI, serviceOpenId: 'account', serviceWorkoutID: 'workout', serviceWorkoutComponentKey: 'root' },
    [ServiceNames.WahooAPI]: { serviceName: ServiceNames.WahooAPI, serviceUserID: 'account', serviceWorkoutID: 'workout' },
  };
  it.each(Object.keys(recordingProviders).flatMap(source => Object.keys(recordingProviders)
    .filter(incoming => incoming !== source).map(incoming => ({ source, incoming }))))(
    'verifies retained $source provenance before skipping a conflicting $incoming recording', async ({ source, incoming }) => {
      const { incoming: parsed } = conflictingRun();
      state.garminProvider = source === ServiceNames.GarminAPI ? recordingProviders[source] : {};
      state.provider = source === ServiceNames.SuuntoApp ? recordingProviders[source] : {};
      if (source === ServiceNames.COROSAPI || source === ServiceNames.WahooAPI) state.otherProviders[source] = recordingProviders[source];
      await expect(prepareImportedEventWrite('owner', event([parsed]), authorize, recordingProviders[incoming]))
        .rejects.toMatchObject({ name: 'ProviderImportDuplicateError', eventID: 'event' });
      expect(state.commit).not.toHaveBeenCalled();
    });

  it('keeps an ordinary matched cross-provider update on the existing write path without extra provenance reads', async () => {
    const { incoming, provider } = conflictingRun();
    incoming.type = 'Trail Running';
    delete state.activities.get('saved-id')!.ascentCorrection;
    await prepareImportedEventWrite('owner', event([incoming]), authorize, provider);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(incoming.getID()).toBe('saved-id');
    expect(state.get.mock.calls.some(([ref]) => ref.path?.endsWith(`/${ServiceNames.GarminAPI}`))).toBe(false);
  });

  it('does not convert an unsafe correction carryover on a matched recording into a duplicate skip', async () => {
    const { incoming, provider } = conflictingRun();
    incoming.type = 'Trail Running';
    await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each(['source', 'same-provider', 'manual', 'incomplete-provider', 'pending', 'first-import', 'pending-parent',
    'multiple-sources', 'multiple-originals', 'multisport',
    'foreign-original', 'non-fit-original', 'missing-provenance', 'wrong-provenance', 'distance', 'metadata-read-failure'])(
    'keeps an unverified second-provider run blocked: %s', async scenario => {
      const { incoming, provider } = conflictingRun();
      if (scenario === 'source') delete state.activities.get('saved-id')!.sourceIdentity;
      if (scenario === 'same-provider') state.otherProviders[ServiceNames.COROSAPI] = { ...provider, serviceWorkoutID: 'different' };
      if (scenario === 'incomplete-provider') delete (provider as Record<string, unknown>).serviceOpenId;
      if (scenario === 'pending') state.metadata.sourceWritePending = true;
      if (scenario === 'first-import') state.metadata.sourceFirstImport = true;
      if (scenario === 'pending-parent') state.parent.benchmarkSourceWritePending = true;
      if (scenario === 'multiple-sources') state.provider = { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'account', serviceWorkoutID: 'other' };
      if (scenario === 'multiple-originals') state.parent.originalFiles = [{ path: 'users/owner/events/event/a.fit' }, { path: 'users/owner/events/event/b.fit' }];
      if (scenario === 'foreign-original') state.parent.originalFiles = [{ path: 'users/other/events/event/original.fit' }];
      if (scenario === 'non-fit-original') state.parent.originalFiles = [{ path: 'users/owner/events/event/original.json' }];
      if (scenario === 'missing-provenance') state.garminProvider = {};
      if (scenario === 'wrong-provenance') state.garminProvider.serviceName = ServiceNames.COROSAPI;
      if (scenario === 'distance') incoming.getStat = key => ({ getValue: () => key === 'Duration' ? 3599.7 : 9000 });
      if (scenario === 'metadata-read-failure') {
        const get = state.get.getMockImplementation()!;
        state.get.mockImplementation(ref => ref.path?.endsWith(`/${ServiceNames.GarminAPI}`)
          ? Promise.reject(new Error('metadata unavailable')) : get(ref));
      }
      const error = scenario === 'metadata-read-failure' ? { message: 'metadata unavailable' } : { code: 'ACTIVITY_IDENTITY_CONFLICT' };
      await expect(prepareImportedEventWrite('owner', event(scenario === 'multisport' ? [incoming, activity(1)] : [incoming]),
        authorize, scenario === 'manual' ? undefined : provider)).rejects.toMatchObject(error);
      expect(state.commit).not.toHaveBeenCalled();
      expect(incoming.getID()).toBe('legacy-0');
    });

  it('recognizes a valid legacy original-file reference without requiring a generation', async () => {
    const { incoming, provider } = garminCopy();
    state.parent = { originalFile: { path: 'users/owner/events/event/original.FIT' } };
    await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider))
      .rejects.toMatchObject({ name: 'ProviderImportDuplicateError', eventID: 'event' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('honors lifecycle authorization before duplicate detection or extra provenance reads', async () => {
    const { incoming, provider } = garminCopy();
    authorize.mockRejectedValueOnce(new Error('account deleting or history superseded'));
    await expect(prepareImportedEventWrite('owner', event([incoming]), authorize, provider)).rejects.toThrow('account deleting');
    expect(state.get).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('does not reserve a reparse after the workout was deleted', async () => {
    state.parentExists = false;
    await expect(prepareReparsedEventWrite('owner', event())).rejects.toMatchObject({ name: 'EventWriteSkippedForDeletedEventError' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each(['pending', 'finalized', 'legacy'])('recovers corrected activities from an interrupted reparse: %s', async phase => {
    const parsed = EventImporterJSON.getEventFromJSON({ name: 'Run', startDate: 1700000000000, endDate: 1700003600000,
      activities: [{ ...activity().toJSON(), streams: [], laps: [], intensityZones: [] }], stats: {} }).setID('event');
    parsed.getFirstActivity().addStat(new DataDescent(400));
    parsed.getFirstActivity().setID('retry-id'); parsed.getFirstActivity().addStat(new DataAscent(300));
    store('saved-id', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 100 }, descentCorrection: { value: 80, sourceValue: 120 } });
    store('partial-id', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 250 }, descentCorrection: { value: 80, sourceValue: 320 } });
    state.parent = { benchmarkSourceWritePending: true };
    const legs = { original: { activityId: phase === 'finalized' ? 'partial-id' : 'saved-id',
      identity: { startMs: +parsed.getFirstActivity().startDate, endMs: +parsed.getFirstActivity().endDate } } };
    state.metadata = { sourceWritePending: phase !== 'finalized', [phase === 'legacy' ? 'legacyLegs' : 'legs']: legs };
    if (phase === 'pending') for (let index = 0; index < 101; index++)
      store(`partial-${index}`, activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 250 } });
    await prepareReparsedEventWrite('owner', parsed);
    expect(state.collection).not.toHaveBeenCalled();
    expect(parsed.getFirstActivity()).toHaveProperty('ascentCorrection', { value: 75, sourceValue: 300 });
    expect(parsed.getStat(DataAscent.type).getValue()).toBe(75);
    expect(parsed.getFirstActivity()).toHaveProperty('descentCorrection', { value: 80, sourceValue: 400 });
    expect(parsed.getStat(DataDescent.type).getValue()).toBe(80);
  });

  it.each([false, true])('rejects ambiguous completed sources or foreign recovery references (recovering: %s)', async recovering => {
    store('saved-id', activity(), { eventID: recovering ? 'another-event' : 'event', ascentCorrection: { value: 75, sourceValue: 100 } });
    store('duplicate', activity(), { eventID: 'event', ascentCorrection: { value: 75, sourceValue: 100 } });
    state.metadata = recovering ? { sourceWritePending: true, legs: { original: { activityId: 'saved-id' } } } : {};
    await expect(prepareReparsedEventWrite('owner', event())).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('requires review instead of retrying a missing active leg during interrupted reparse recovery', async () => {
    state.metadata = { sourceWritePending: true, legs: { controlled: { activityId: 'missing-leg' } },
      controls: { controlled: { override: 0 } } };
    await expect(prepareReparsedEventWrite('owner', event())).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each(['import', 'reparse'])('rejects legacy IDs overwritten by a different leg during an interrupted %s', async mode => {
    const old = activity(), incoming = activity(1);
    store('reused-id', incoming, { eventID: 'event' });
    state.metadata = { sourceWritePending: true, legs: { controlled: {
      activityId: 'reused-id', identity: { startMs: +old.startDate, endMs: +old.endDate, type: old.type },
    } }, controls: { controlled: { override: 0 } } };
    await expect(mode === 'import' ? prepareImportedEventWrite('owner', event([incoming]))
      : prepareReparsedEventWrite('owner', event([incoming])))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
    expect(incoming.getID()).toBe('legacy-1');
  });

  it.each(['import', 'reparse'])('requires source evidence for a pending legacy control without a frozen identity during %s', async mode => {
    const incoming = activity(); store('controlled-id', incoming, { eventID: 'event' });
    state.metadata = { sourceWritePending: true, sourceFirstImport: true, controls: { 'controlled-id': { override: 0 } } };
    await expect(mode === 'import' ? prepareImportedEventWrite('owner', event([incoming]))
      : prepareReparsedEventWrite('owner', event([incoming])))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
    expect(incoming.getID()).toBe('legacy-0');
  });

  it.each([
    { mode: 'import', frozen: true }, { mode: 'reparse', frozen: true },
    { mode: 'import', frozen: false }, { mode: 'reparse', frozen: false },
  ])('recovers valid source provenance during an interrupted $mode (frozen identity: $frozen)', async ({ mode, frozen }) => {
    const old = activity(), incoming = activity(1);
    store('stable-id', incoming, { eventID: 'event', sourceIdentity: { version: 1, activityId: 'stable-id',
      startMs: +incoming.startDate, endMs: +incoming.endDate, importedType: incoming.type } });
    state.metadata = { sourceWritePending: true, ...(frozen ? { legs: { controlled: {
      activityId: 'stable-id', identity: { startMs: +old.startDate, endMs: +old.endDate, type: old.type },
    } } } : { sourceFirstImport: true }), controls: { [frozen ? 'controlled' : 'stable-id']: { override: 0 } } };
    if (mode === 'import') await prepareImportedEventWrite('owner', event([incoming]));
    else await prepareReparsedEventWrite('owner', event([incoming]));
    expect(state.commit).toHaveBeenCalledOnce();
    expect(incoming.getID()).toBe('stable-id');
  });

  it('rejects silently dropping a saved descent correction', () => {
    expect(() => preserveImportedActivityEdits({ stats: { Descent: 300 } }, { descentCorrection: { value: 80, sourceValue: 120 } }))
      .toThrow('descent correction was not safely matched');
  });

  it.each(['import', 'reparse'])('takes the newly parsed sport for a matched legacy leg during %s', async mode => {
    store('stable-id', activity(0, 'Stretching'));
    const incoming = activity(0, 'Yoga');
    state.provider = { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'synthetic', serviceWorkoutID: 'workout' };
    if (mode === 'import') await prepareImportedEventWrite('owner', event([incoming]), authorize, state.provider);
    else await prepareReparsedEventWrite('owner', event([incoming]));
    expect(state.commit).toHaveBeenCalledOnce();
    expect(incoming.getID()).toBe('stable-id');
    expect(incoming.type).toBe('Yoga');
    expect(incoming).toHaveProperty('sourceIdentity.importedType', 'Yoga');
  });

  it('keeps the file sport while preserving device names and legacy source keys', () => {
    expect(preserveImportedActivityEdits({ type: 'Yoga', creator: { name: 'Parsed watch' } },
      { type: 'Stretching', creator: { name: 'Custom watch' }, sourceActivityKey: 'saved-key' }))
      .toMatchObject({ type: 'Yoga', creator: { name: 'Custom watch' }, sourceActivityKey: 'saved-key' });
  });

  it('does not accept a sport revision from a mismatched provider recording', async () => {
    store('stable-id', activity(0, 'Stretching'));
    state.provider = { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'synthetic', serviceWorkoutID: 'old' };
    await expect(prepareImportedEventWrite('owner', event([activity(0, 'Yoga')]), authorize,
      { ...state.provider, serviceWorkoutID: 'different' })).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('rejects stale retained references before reserving a reparse', async () => {
    state.parent = { originalFile: { path: 'users/owner/events/event/original.fit', generation: '2' } };
    const { retainedSourceRevision } = await import('./retained-activity-source');
    const expected = retainedSourceRevision({ originalFile: { path: 'users/owner/events/event/original.fit', generation: '1' } });
    await expect(prepareReparsedEventWrite('owner', event(), expected)).rejects.toThrow('Recording source changed');
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('keeps new-import IDs unchanged and scopes/masks the existing-activity read', async () => {
    const parsed = activity();
    await prepareImportedEventWrite('owner', event([parsed]), authorize);
    expect(parsed.getID()).toBe('legacy-0');
    expect(state.collection).toHaveBeenCalledWith('users/owner/activities');
    expect(state.where).toHaveBeenCalledWith('eventID', '==', 'event');
    expect(state.select).toHaveBeenCalledWith('startDate', 'endDate', 'type', 'sourceActivityKey', 'sourceIdentity', 'stats.Duration', 'stats.Distance', 'ascentCorrection', 'descentCorrection');
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
    await expect(prepareImportedEventWrite('owner', event([first, second]), authorize)).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
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

  it('keeps strict correction matching for an ordinary upload with an altered source window', async () => {
    store('stable-id', activity(), { ascentCorrection: { value: 75, sourceValue: 100 } });
    const parsed = activity(); parsed.endDate = new Date(+parsed.endDate + 1000);
    await expect(prepareImportedEventWrite('owner', event([parsed])))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
    expect(parsed.getID()).toBe('legacy-0');
  });

  it('rejects a corrected source changing to diving before committing a source reservation', async () => {
    store('saved-id', activity(), { sourceActivityKey: 'same-source', ascentCorrection: { value: 75, sourceValue: 100 } });
    const parsed = Object.assign(activity(0, 'Scuba Diving'), { sourceActivityKey: 'same-source' });
    await expect(prepareImportedEventWrite('owner', event([parsed]))).rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
    expect(parsed.getID()).toBe('legacy-0');
  });

  it('rejects conflicting correction and ID pairings before committing a source reservation', async () => {
    store('first', activity(), { sourceActivityKey: 'first-source', ascentCorrection: { value: 75, sourceValue: 100 } });
    store('second', activity(1), { sourceActivityKey: 'second-source' });
    const parsed = EventImporterJSON.getEventFromJSON({ name: 'Multisport', startDate: 1700000000000, endDate: 1700007200000,
      activities: [activity(), activity(1)].map(item => ({ ...item.toJSON(), streams: [], laps: [], intensityZones: [] })), stats: {} }).setID('event');
    parsed.getActivities().forEach((item, index) => {
      item.setID(`incoming-${index}`);
      Object.assign(item, { sourceActivityKey: index ? 'first-source' : 'second-source' });
      item.addStat(new DataAscent(300));
    });
    state.provider = { serviceName: ServiceNames.SuuntoApp, serviceUserName: 'synthetic', serviceWorkoutID: 'workout' };
    await expect(prepareImportedEventWrite('owner', parsed, authorize, state.provider))
      .rejects.toMatchObject({ code: 'ACTIVITY_IDENTITY_CONFLICT' });
    expect(state.commit).not.toHaveBeenCalled();
    expect(parsed.getActivities().map(item => item.getID())).toEqual(['incoming-0', 'incoming-1']);
    expect(parsed.getActivities().every(item => !('ascentCorrection' in item))).toBe(true);
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
