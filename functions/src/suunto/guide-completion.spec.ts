import { describe, it, expect, vi } from 'vitest';
import { readFITWorkoutReferenceEvidence, readSuuntoGuideCompletions, retainSuuntoGuideCompletions } from './guide-completion';
import { guideExternalId } from '../training-plans/delivery/suunto/mapping';
import { suuntoFitFixture } from '../training-plans/delivery/test-support/suunto-fit-fixture';
import type { Firestore } from 'firebase-admin/firestore';
const deletion = vi.hoisted(() => vi.fn());
const authority = vi.hoisted(() => vi.fn());
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: deletion }));
vi.mock('../training-plans/delivery/connection', () => ({ readTrainingDeliveryAuthority: authority }));

describe('Suunto private FIT Guide evidence', () => {
  const id = guideExternalId('account', 'workout'); const second = guideExternalId('account', 'second');
  it.each([false, true])('preserves aligned arrays and exact exporter/client ownership (big endian: %s)', big => {
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['other', 'qs', 'qs'], ['third-party', id, second], undefined, big), 'qs'))
      .toEqual([{ sessionIndex: 0, startTimeUnixMs: 631065723000, externalIds: [id, second] }]);
  });
  it('uses the Sports Lib parser and keeps structured metadata outside activity JSON', () => {
    const evidence = readFITWorkoutReferenceEvidence(suuntoFitFixture(['qs'], [id]));
    expect(evidence).toMatchObject({ status: 'ok', diagnostics: [], trainingFiles: [], workouts: [],
      sessions: [{ sessionIndex: 0, startTimeUnixMs: 631065723000 }] });
    expect(evidence.suuntoGuides).toEqual([expect.objectContaining({ applicationId: 'SuuntoFitExport1', ownerId: 'qs', externalId: id })]);
  });
  it('does not combine mismatched arrays or import unrelated exporters/client IDs', () => {
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['qs', 'qs'], [id]), 'qs')).toEqual([]);
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['qs'], [id], 'OtherExport00000'), 'qs')).toEqual([]);
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['other'], [id]), 'qs')).toEqual([]);
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['qs'], ['other-plugin']), 'qs')).toEqual([]);
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['qs', '', 'qs'], [id, second, id]), 'qs')).toEqual([]);
  });
  it('rejects invalid/truncated FIT safely and deduplicates repeated Guide markers', () => {
    expect(readSuuntoGuideCompletions(Buffer.from('invalid'), 'qs')).toEqual([]);
    const bytes = suuntoFitFixture(['qs', 'qs'], [id, id]);
    expect(readSuuntoGuideCompletions(bytes, 'qs')[0].externalIds).toEqual([id]);
    expect(readSuuntoGuideCompletions(bytes.subarray(0, bytes.length - 1), 'qs')).toEqual([]);
    bytes[15] ^= 1; expect(readSuuntoGuideCompletions(bytes, 'qs')).toEqual([]);
  });
  it.each(['write', 'deletion', 'event-deleted', 'generation', 'disconnect', 'binding', 'failure'])('fences persistence: %s', async scenario => {
    const writes = vi.fn(); deletion.mockResolvedValue({ shouldSkip: scenario === 'deletion' });
    authority.mockResolvedValue({ account: scenario === 'binding' ? 'other' : 'account',
      token: { data: () => ({ tokenCredentialGeneration: scenario === 'generation' ? 'new' : 'g' }) },
      connection: { state: scenario === 'disconnect' ? 'reconnect_required' : 'connected', destinationKey: 'destination' } });
    const ref = (path: string): any => ({ path, collection: (p: string) => ref(`${path}/${p}`), doc: (p: string) => ref(`${path}/${p}`),
      where: () => ({ path: `${path}?query`, query: true }) });
    const tx = { set: writes, delete: vi.fn(), get: vi.fn(async (r: { path: string; query?: boolean }) => {
      if (scenario === 'failure') throw new Error('database-failure');
      if (r.query) return { docs: [] };
      if (r.path.endsWith('/events/event')) return { exists: scenario !== 'event-deleted' };
      return { exists: false, data: () => undefined };
    }) };
    const db = { collection: (p: string) => ref(p), runTransaction: (cb: (tx: unknown) => unknown) => cb(tx) } as unknown as Firestore;
    const promise = retainSuuntoGuideCompletions(db, 'uid', 'event', 'account', 'g', suuntoFitFixture(['qs'], [id]), 'qs');
    if (scenario === 'failure') await expect(promise).rejects.toThrow('database-failure'); else await promise;
    if (scenario === 'write') {
      expect(writes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'users/uid/events/event/trainingCompletionEvidence/fit' }),
        expect.objectContaining({ reader: 'sports-lib', sourceProvider: 'suunto',
          sessions: [{ sessionIndex: 0, startTimeUnixMs: 631065723000 }] }));
    } else expect(writes).not.toHaveBeenCalled();
  });

  it('links one exact account-bound Guide marker and marks its delivery completed', async () => {
    deletion.mockResolvedValue({ shouldSkip: false });
    authority.mockResolvedValue({ account: 'account', token: { data: () => ({ tokenCredentialGeneration: 'g' }) },
      connection: { state: 'connected', destinationKey: 'destination' } });
    const ledger = { schemaVersion: 1, id: 'ledger', workoutId: 'workout', planId: 'plan', provider: 'suunto',
      destinationKey: 'destination', desiredGeneration: 1, connectionEpoch: 0, settingsRevision: 1, desiredDigest: 'd',
      desired: 'present', status: 'delivered', timeZone: 'Europe/Helsinki', issues: [], approvalDigest: null,
      actual: { ids: { externalId: id }, localDate: '1990-01-01', completed: false }, acceptedDigest: 'd',
      contentDigest: 'c', acceptedContentDigest: 'c', attempt: null, lease: null, retries: 0, retryAtMs: 0,
      blockedConnectionGeneration: null, lastAttemptAtMs: 1, lastAcceptedAtMs: 1, updatedAtMs: 1 };
    const workout = { schemaVersion: 1, id: 'workout', planId: 'plan', localDate: '1990-01-01', lifecycle: 'planned',
      title: 'Ride', structure: { version: 1, sport: 'Cycling', nodes: [{ kind: 'step', id: 's', purpose: 'work',
        ending: { kind: 'time', seconds: 600 }, targets: [] }] }, revision: 2, createdAtMs: 1, updatedAtMs: 2 };
    const writes = vi.fn();
    const ref = (path: string): any => ({ path, collection: (p: string) => ref(`${path}/${p}`), doc: (p: string) => ref(`${path}/${p}`),
      where: () => ({ path: `${path}?query`, query: true }) });
    const tx = { set: writes, delete: vi.fn(), get: vi.fn(async (r: { path: string; query?: boolean }) => {
      if (r.query) return { docs: [{ id: 'ledger', data: () => ledger }] };
      if (r.path.endsWith('/events/event')) return { exists: true, data: () => ({}) };
      if (r.path.endsWith('/scheduledWorkouts/workout')) return { exists: true, data: () => workout };
      return { exists: false, data: () => undefined };
    }) };
    const db = { collection: (p: string) => ref(p), runTransaction: (cb: (tx: unknown) => unknown) => cb(tx) } as unknown as Firestore;
    const result = await retainSuuntoGuideCompletions(db, 'uid', 'event', 'account', 'g',
      suuntoFitFixture(['qs'], [id]), 'qs', [{ id: 'activity', startTimeMs: 631065723000 }], 2_000);
    expect(result).toEqual({ retained: true, linkedWorkoutIds: ['workout'] });
    expect(writes).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/uid/trainingWorkoutCompletions/workout' }),
      expect.objectContaining({ eventId: 'event', activityId: 'activity', workoutRevisionAtLink: 2, matchMethod: 'provider_marker' }));
    expect(writes).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/uid/trainingDeliveryLedger/ledger' }),
      expect.objectContaining({ status: 'completed', completionLinkId: expect.any(String),
        actual: expect.objectContaining({ completed: true }) }));
  });

  it('defers an exact link while the delivery identity has an active operation', async () => {
    deletion.mockResolvedValue({ shouldSkip: false });
    authority.mockResolvedValue({ account: 'account', token: { data: () => ({ tokenCredentialGeneration: 'g' }) },
      connection: { state: 'connected', destinationKey: 'destination' } });
    const ledger = { schemaVersion: 1, id: 'ledger', workoutId: 'workout', provider: 'suunto', destinationKey: 'destination',
      actual: { ids: { externalId: id }, localDate: '1990-01-01', completed: false },
      attempt: { id: 'operation' }, lease: { id: 'lease', expiresAtMs: 10_000 } };
    const ref = (path: string): any => ({ path, collection: (part: string) => ref(`${path}/${part}`),
      doc: (part: string) => ref(`${path}/${part}`), where: () => ({ path: `${path}?query`, query: true }) });
    const tx = { get: vi.fn(async (target: { path: string; query?: boolean }) => target.query
      ? { docs: [{ id: 'ledger', data: () => ledger }] }
      : { exists: true, data: () => ({}) }), set: vi.fn(), delete: vi.fn() };
    const db = { collection: (path: string) => ref(path), runTransaction: (callback: (value: unknown) => unknown) => callback(tx) } as unknown as Firestore;
    await expect(retainSuuntoGuideCompletions(db, 'uid', 'event', 'account', 'g',
      suuntoFitFixture(['qs'], [id]), 'qs')).rejects.toThrow('delivery is changing');
    expect(tx.set).not.toHaveBeenCalled();
  });
});
