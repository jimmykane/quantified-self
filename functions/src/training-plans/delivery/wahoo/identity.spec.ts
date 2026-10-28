import { describe, expect, it, vi } from 'vitest';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { DeliveryLedgerV1 } from '../contracts';
import { recoverWahooWithdrawalGeneration, wahooArtifactGeneration, wahooIdentities, wahooPlanGeneration } from './identity';

describe('Wahoo private withdrawal identity', () => {
  const fixture = () => {
    const artifact = { ids: { ...wahooIdentities('account', 'workout'), plan: '1', workout: '2', association: '2:1' },
      localDate: '2026-10-25', completed: false };
    const ledger = { id: 'delivery', provider: 'wahoo', destinationKey: 'account', workoutId: 'workout', actual: null,
      attempt: { id: 'current', kind: 'upsert', progress: null, artifact: null } } as DeliveryLedgerV1;
    const receipt = { state: 'accepted', artifact: null, startedAtMs: 100,
      progress: { version: 1, step: 'finished', state: 'accepted' },
      operation: { id: 'withdrawal', kind: 'remove', deliveryId: 'delivery', destinationKey: 'account', artifact } };
    const rows = [{ id: 'withdrawal', data: () => receipt }];
    const query = { orderBy: vi.fn(), limit: vi.fn(), select: vi.fn() };
    for (const method of Object.values(query)) method.mockReturnValue(query);
    const tx = { get: vi.fn(async () => ({ docs: rows })) };
    const ref = { collection: vi.fn(() => query) };
    return { ledger, artifact, receipt, rows, query, tx, run: () => recoverWahooWithdrawalGeneration(
      tx as unknown as Transaction, ref as unknown as DocumentReference, ledger) };
  };
  it('recovers only a matching acknowledged withdrawal through a compact bounded read', async () => {
    const f = fixture(); expect(await f.run()).toBe(1);
    expect(f.query.limit).toHaveBeenCalledWith(25);
    expect(f.query.select.mock.calls[0]).not.toContain('operation.workout');
    expect(f.ledger.wahooPlanGeneration).toBeUndefined(); // Caller owns the fenced reservation.
  });
  it.each(['provider', 'generation', 'actual', 'repair', 'unknown-journal', 'started-journal', 'artifact', 'remove', 'quarantined'])(
    'does not inspect history for an inadmissible %s state', async reason => {
      const f = fixture();
      if (reason === 'provider') f.ledger.provider = 'garmin';
      if (reason === 'generation') f.ledger.wahooPlanGeneration = 1;
      if (reason === 'actual') f.ledger.actual = f.artifact;
      if (reason === 'repair') f.ledger.repair = {} as never;
      if (reason === 'unknown-journal') f.ledger.attempt!.progress = undefined;
      if (reason === 'started-journal') f.ledger.attempt!.progress = { version: 1, step: 'plan-create', state: 'started' };
      if (reason === 'artifact') f.ledger.attempt!.artifact = f.artifact;
      if (reason === 'remove') f.ledger.attempt!.kind = 'remove';
      if (reason === 'quarantined') f.ledger.attempt!.recoveryBlocked = true;
      expect(await f.run()).toBeUndefined(); expect(f.tx.get).not.toHaveBeenCalled();
    });
  it.each(['unaccepted', 'upsert', 'partial', 'wrong-delivery', 'wrong-account', 'wrong-workout', 'missing-association',
    'completed', 'unknown-completion', 'unknown-null', 'unknown-journal', 'wrong-generation', 'newer-attempt', 'tied-history', 'wrong-operation', 'bad-time'])(
    'does not grant recreation from %s evidence', async reason => {
      const f = fixture();
      if (reason === 'unaccepted') f.receipt.state = 'checkpoint';
      if (reason === 'upsert') f.receipt.operation.kind = 'upsert';
      if (reason === 'partial') f.receipt.progress.step = 'workout-remove';
      if (reason === 'wrong-delivery') f.receipt.operation.deliveryId = 'foreign';
      if (reason === 'wrong-account') f.receipt.operation.destinationKey = 'foreign';
      if (reason === 'wrong-workout') f.artifact.ids.workoutToken = wahooIdentities('account', 'foreign').workoutToken;
      if (reason === 'missing-association') delete (f.artifact.ids as Partial<typeof f.artifact.ids>).association;
      if (reason === 'completed') f.artifact.completed = true;
      if (reason === 'unknown-completion') delete (f.artifact as Partial<typeof f.artifact>).completed;
      if (reason === 'unknown-null') delete (f.receipt as Partial<typeof f.receipt>).artifact;
      if (reason === 'unknown-journal') delete (f.receipt as Partial<typeof f.receipt>).progress;
      if (reason === 'wrong-generation') f.artifact.ids.planGeneration = '1';
      if (reason === 'wrong-operation') f.receipt.operation.id = 'foreign';
      if (reason === 'bad-time') f.receipt.startedAtMs = NaN;
      if (reason === 'newer-attempt') f.rows.unshift({ id: 'newer', data: () => ({ ...f.receipt, state: 'started', startedAtMs: 101 }) });
      if (reason === 'tied-history') f.rows.push({ id: 'tied', data: () => ({ ...f.receipt, state: 'started' }) });
      expect(await f.run()).toBeUndefined();
    });
  it('ignores the current proven no-write attempt but does not bypass any other operation', async () => {
    const f = fixture(); f.rows.unshift({ id: 'current', data: () => ({ ...f.receipt, state: 'started', startedAtMs: 101 }) });
    expect(await f.run()).toBe(1);
  });
  it.each([null, -1, 0.5, NaN, Infinity, '1', 2_147_483_648])('rejects invalid reserved generation %s', value => {
    expect(() => wahooPlanGeneration(value)).toThrow();
  });
  it.each(['0', '-1', '01', '1.5', '1x', '2147483648'])('rejects malformed artifact generation %s', value => {
    expect(() => wahooArtifactGeneration({ ids: { planGeneration: value }, completed: false, localDate: '2026-10-25' })).toThrow();
  });
});
