import { Firestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { DeliveryRuntime } from './contracts';
import { ReconciliationReads } from './reconciliation-reads';
import { readDeliveryContext } from './store';

describe('reconciliation transaction reads', () => {
  // References only; all reads below use the synthetic transaction.
  const db = new Firestore({ projectId: 'demo-training-delivery-cache' });
  afterAll(() => db.terminate());
  const fixture = () => {
    const get = vi.fn(async (_reference: DocumentReference) => ({ exists: false, data: () => undefined, get: () => undefined }));
    const tx = { get } as unknown as Transaction;
    const connection = vi.fn(async (_tx: Transaction, _uid: string, _provider: PlannedWorkoutProviderId) => (
      { state: 'connected' as const, destinationKey: 'fixture-account', generation: 'one', epoch: 0 }));
    const runtime: DeliveryRuntime = { db, now: () => 1, hasPro: async () => true, connection, transport: () => null };
    return { tx, get, runtime, connection };
  };

  it('reads a shared plan, settings and owner once per page; keeps workout-specific reads distinct', async () => {
    const { tx, get, runtime, connection } = fixture();
    const reads = new ReconciliationReads(runtime, tx, 'fixture');
    for (let index = 0; index < 25; index++) {
      const workout = { id: `w${index}`, planId: 'plan', structure: { sport: ActivityTypes.Running } } as ScheduledWorkoutV1;
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) await readDeliveryContext(runtime, tx,
        'fixture', workout, provider, true, undefined, undefined, reads);
    }
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      expect(connection.mock.calls.filter(call => call[2] === provider)).toHaveLength(1);
    }
    const paths = get.mock.calls.map(call => call[0].path);
    expect(paths.filter(path => path === 'users/fixture/trainingPlans/plan')).toHaveLength(1);
    expect(paths.filter(path => path === 'users/fixture')).toHaveLength(1);
    expect(paths.filter(path => path.includes('/trainingDeliverySettings/plan_'))).toHaveLength(4);
    expect(paths.filter(path => path.includes('/trainingDeliverySettings/workout_'))).toHaveLength(100);
    expect(paths.filter(path => path.includes('/trainingDeliveryScopes/'))).toHaveLength(25);
    expect(get).toHaveBeenCalledTimes(131);
  });

  it('coalesces concurrent reads of the same path, including a missing document', async () => {
    const { tx, get, runtime, connection } = fixture();
    const reads = new ReconciliationReads(runtime, tx, 'fixture');
    const first = reads.get(db.doc('users/fixture'));
    const second = reads.get(db.doc('users/fixture'));
    expect(first).toBe(second);
    expect((await first).exists).toBe(false);
    await Promise.all([reads.connection('garmin'), reads.connection('garmin')]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(connection).toHaveBeenCalledExactlyOnceWith(tx, 'fixture', 'garmin');
  });

  it('rereads documents and connection authority for another attempt or owner', async () => {
    const { tx, get, runtime, connection } = fixture();
    for (const owner of ['first', 'first', 'second']) {
      const reads = new ReconciliationReads(runtime, tx, owner);
      await reads.get(db.doc(`users/${owner}`));
      await reads.connection('garmin');
    }
    expect(get).toHaveBeenCalledTimes(3);
    expect(connection.mock.calls.map(call => call[1])).toEqual(['first', 'first', 'second']);
  });

  it('does not retain failed connection reads in a later attempt', async () => {
    const { tx, runtime, connection } = fixture();
    connection.mockRejectedValueOnce(new Error('transaction aborted'));
    await expect(new ReconciliationReads(runtime, tx, 'fixture').connection('garmin')).rejects.toThrow('transaction aborted');
    await expect(new ReconciliationReads(runtime, tx, 'fixture').connection('garmin')).resolves.toMatchObject({ generation: 'one' });
    expect(connection).toHaveBeenCalledTimes(2);
  });
});
