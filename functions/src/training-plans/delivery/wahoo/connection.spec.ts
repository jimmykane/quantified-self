import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTrainingDeliveryAuthority } from '../connection';
import { WAHOO_API_SCOPES } from '../../../wahoo/constants';
import { WAHOO_TRAINING_PERMISSION_ISSUE } from '../../../../../shared/wahoo-training';

describe('Wahoo Training canonical account selection', () => {
  const read = async (meta: Record<string, unknown>, root: Record<string, unknown>, rows: { id: string; data: Record<string, unknown> }[]) => {
    const ref = { collection: () => ref, doc: () => ref, limit: () => ref };
    const values = [{ data: () => ({ connectionState: 'connected', connectionStateGeneration: 'connection', ...meta }) },
      { exists: true, data: () => root }, { empty: rows.length === 0, size: rows.length, docs: rows.map(row => ({ id: row.id, data: () => row.data })) }, { data: () => ({}) }];
    return readTrainingDeliveryAuthority({ collection: () => ref } as unknown as Firestore,
      { get: async () => values.shift() } as unknown as Transaction, 'fixture', 'wahoo');
  };
  const token = (id = '123', data: Record<string, unknown> = {}) => ({ id, data: { wahooUserID: id, scope: WAHOO_API_SCOPES, ...data } });
  it.each([
    ['legacy', undefined, undefined, true], ['matching', 'a', 'a', true],
    ['root-only', 'a', undefined, false], ['token-only', undefined, 'a', false], ['mismatch', 'a', 'b', false],
  ] as const)('checks exact credential generations: %s', async (_name, root, generation, allowed) => {
    expect((await read({}, { activeOAuthCredentialGeneration: root }, [token('123', { tokenCredentialGeneration: generation })])).connection.state)
      .toBe(allowed ? 'connected' : 'connection_repair');
  });
  it('honors a pinned account, otherwise uses canonical refreshed/created/ID ordering', async () => {
    const rows = [token('123', { dateRefreshed: 1 }), token('456', { dateRefreshed: 2 })];
    expect((await read({ providerUserId: '123' }, {}, rows)).account).toBe('123');
    expect((await read({}, {}, rows)).account).toBe('456');
  });
  it.each([123, 'invalid/id', '\u0001', 'missing'])('does not replace an invalid or missing pinned account: %s', async pin => {
    expect((await read({ providerUserId: pin }, {}, [token()])).connection.state).toBe('connection_repair');
  });
  it('does not fall back from a malformed selected token', async () => {
    expect((await read({}, {}, [token(), token('456', { wahooUserID: 456, dateRefreshed: 2 })])).connection.state).toBe('connection_repair');
  });
  it('keeps missing grants specific to Training rather than changing general connection state', async () => {
    const result = await read({}, {}, [token('123', { scope: 'user_read workouts_read workouts_write offline_data' })]);
    expect(result.connection).toMatchObject({ state: 'connection_repair', issues: [WAHOO_TRAINING_PERMISSION_ISSUE] });
    expect(result.account).toBe('123'); expect(result.token).toBeNull();
  });
});
