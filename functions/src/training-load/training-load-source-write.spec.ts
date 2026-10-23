import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { TrainingLoadSourceWrite } from './training-load-source-write';

describe('Training load source write reservation', () => {
  function fixture() {
    const event = { getID: () => 'workout' } as EventInterface;
    const finish = Object.assign(vi.fn(async () => undefined), { sourceWriteId: 'attempt-1' });
    const prepare = vi.fn(async () => finish);
    const guard = new TrainingLoadSourceWrite('owner', prepare);
    const doc = vi.fn(path => path);
    const get = vi.fn<() => Promise<{ data: () => { sourceWriteId?: string; revision: number; sourceWritePending: boolean } }>>()
      .mockResolvedValue({ data: () => ({ sourceWriteId: 'attempt-1', revision: 99, sourceWritePending: false }) });
    const db = { doc } as unknown as admin.firestore.Firestore;
    const transaction = { get } as unknown as admin.firestore.Transaction;
    return { event, finish, prepare, guard, doc, get, db, transaction };
  }
  it('fails closed before preparation and after a failed preparation', async () => {
    const f = fixture();
    await expect(f.guard.assertCurrent(f.db, f.transaction)).rejects.toThrow('not prepared');
    f.prepare.mockRejectedValueOnce(new Error('preparation failed'));
    await expect(f.guard.prepareTrainingLoad(f.event)).rejects.toThrow('preparation failed');
    await expect(f.guard.assertCurrent(f.db, f.transaction)).rejects.toThrow('not prepared');
    expect(f.get).not.toHaveBeenCalled();
  });
  it('checks the captured owner and event inside the supplied transaction, independent of owner edits and completion', async () => {
    const f = fixture();
    expect(await f.guard.prepareTrainingLoad(f.event)).toBe(f.finish);
    await f.guard.assertCurrent(f.db, f.transaction);
    expect(f.doc).toHaveBeenCalledWith('users/owner/events/workout/metaData/trainingLoad');
    expect(f.get).toHaveBeenCalledWith('users/owner/events/workout/metaData/trainingLoad');
    expect(f.finish).not.toHaveBeenCalled();
  });
  it.each(['attempt-2', undefined])('rejects a replaced or deleted reservation: %s', async sourceWriteId => {
    const f = fixture(); await f.guard.prepareTrainingLoad(f.event);
    f.get.mockResolvedValueOnce({ data: () => ({ sourceWriteId, revision: 0, sourceWritePending: true }) });
    await expect(f.guard.assertCurrent(f.db, f.transaction)).rejects.toThrow('superseded');
  });
});
