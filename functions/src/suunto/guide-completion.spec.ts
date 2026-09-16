import { describe, it, expect, vi } from 'vitest';
import { readSuuntoGuideCompletions, retainSuuntoGuideCompletions } from './guide-completion';
import { guideExternalId } from '../training-plans/delivery/suunto/mapping';
import { suuntoFitFixture } from '../training-plans/delivery/test-support/suunto-fit-fixture';
import { buildSuuntoHealthWebhookAccountBinding } from './health-webhook-binding';
import type { Firestore } from 'firebase-admin/firestore';
const deletion = vi.hoisted(() => vi.fn());
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: deletion }));

describe('Suunto private FIT Guide evidence', () => {
  const id = guideExternalId('account', 'workout'); const second = guideExternalId('account', 'second');
  it.each([false, true])('preserves aligned arrays and exact exporter/client ownership (big endian: %s)', big => {
    expect(readSuuntoGuideCompletions(suuntoFitFixture(['other', 'qs', 'qs'], ['third-party', id, second], undefined, big), 'qs'))
      .toEqual([{ sessionIndex: 0, startTimeSeconds: 123, externalIds: [id, second] }]);
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
    const ref = (path: string): unknown => ({ path, collection: (p: string) => ref(`${path}/${p}`), doc: (p: string) => ref(`${path}/${p}`) });
    const tx = { set: writes, get: vi.fn(async (r: { path: string }) => {
      if (scenario === 'failure') throw new Error('database-failure');
      if (r.path.endsWith('/events/event')) return { exists: scenario !== 'event-deleted' };
      if (r.path.endsWith('/tokens/account')) return { data: () => ({ userName: 'account', tokenCredentialGeneration: scenario === 'generation' ? 'new' : 'g' }) };
      if (r.path === 'suuntoAppAccessTokens/uid') return { exists: true, data: () => ({}) };
      if (r.path.includes('/meta/')) return { data: () => ({ connectionState: scenario === 'disconnect' ? 'disconnected' : 'connected' }) };
      return { data: () => scenario === 'binding' ? {} : buildSuuntoHealthWebhookAccountBinding('uid', 'account', 'g', 'oauth_callback') };
    }) };
    const db = { collection: (p: string) => ref(p), runTransaction: (cb: (tx: unknown) => unknown) => cb(tx) } as unknown as Firestore;
    const promise = retainSuuntoGuideCompletions(db, 'uid', 'event', 'account', 'g', suuntoFitFixture(['qs'], [id]), 'qs');
    if (scenario === 'failure') await expect(promise).rejects.toThrow('database-failure'); else await promise;
    if (scenario === 'write') {
      expect(writes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'users/uid/events/event/trainingCompletionEvidence/suunto' }),
        expect.objectContaining({ sessions: [{ sessionIndex: 0, startTimeSeconds: 123, externalIds: [id] }] }));
    } else expect(writes).not.toHaveBeenCalled();
  });
});
