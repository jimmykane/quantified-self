import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { firestore } from 'firebase-admin';
import { createGarminActivityHistoryRestoration, getGarminActivityHistoryRestoration, restoreCompletedGarminActivity } from './activity-history-restoration';
import type { GarminAPIActivityQueueItemInterface } from '../queue/queue-item.interface';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), deletion: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => ({
  doc: (path: string) => ({ path }), collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
  runTransaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({ get: mocks.get, set: mocks.set }),
}) }));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletion,
  UserDeletionGuardReadError: class extends Error {},
}));

const id = '00000000-0000-4000-8000-000000000001';
const nextId = '00000000-0000-4000-8000-000000000002';
const permission = { id, startMs: 100_000, endMs: 200_000, providerUserId: 'garmin', connectionGeneration: 'connection', credentialGeneration: 'credential', runId: id };
const connected = { providerUserId: 'garmin', connectionState: 'connected', connectionStateGeneration: 'connection', activityHistoryRestoration: permission };
const credential = { activeOAuthCredentialGeneration: 'credential' };
const payload = { id: 'job', firebaseUserID: 'owner', userID: 'garmin', activityFileID: 'file', startTimeInSeconds: 150,
  queueRevision: id, fromHistory: true, processed: false, retryCount: 0, totalRetryCount: 0, dateCreated: 300, dispatchedToCloudTask: null,
  connectionHistoryRunId: id, callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityFile?id=file&token=synthetic',
} as GarminAPIActivityQueueItemInterface;
const ref = { path: 'garminAPIActivityQueue/job' } as firestore.DocumentReference;

describe('Garmin manual activity restoration', () => {
  let row: Record<string, unknown>, meta: Record<string, unknown>, root: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    row = { firebaseUserID: 'owner', userID: 'garmin', activityFileID: 'file', processed: true, retryCount: 8, callbackURL: 'old', errors: ['old'] };
    meta = structuredClone(connected); root = { ...credential };
    mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.get.mockImplementation(async ({ path }: { path: string }) => ({ exists: true, data: () => path === ref.path ? row : path.startsWith('users/') ? meta : root }));
    mocks.set.mockImplementation((_ref: unknown, data: Record<string, unknown>) => { row = { ...data }; });
  });

  it('records a manual range and accumulates windows under the same request identity', () => {
    expect(createGarminActivityHistoryRestoration(connected, credential, id, 200_000, 300_000, id))
      .toEqual({ ...permission, endMs: 300_000 });
    expect(createGarminActivityHistoryRestoration(connected, credential, nextId, 250_000, 300_000))
      .toEqual({ ...permission, id: nextId, runId: undefined, startMs: 250_000, endMs: 300_000 });
  });

  it.each([100, 150, 200])('allows exact selected-range boundaries (%s)', seconds => {
    expect(getGarminActivityHistoryRestoration(connected, 'garmin', seconds)).toEqual(permission);
  });
  it.each([99, 201, NaN, Infinity])('ignores callbacks outside the selected range (%s)', seconds => {
    expect(getGarminActivityHistoryRestoration(connected, 'garmin', seconds)).toBeUndefined();
  });
  it.each([
    { connectionState: 'reconnect_required' }, { connectionStateGeneration: 'replacement' }, { providerUserId: 'other' },
    { activityHistoryRestoration: undefined }, { activityHistoryRestoration: { ...permission, id: 'bad' } },
  ])('requires a current, explicit server request: %j', patch => {
    expect(getGarminActivityHistoryRestoration({ ...connected, ...patch }, 'garmin', 150)).toBeUndefined();
  });

  it.each([{}, { resultStatus: 'success' }, { resultStatus: 'skipped', skippedReason: 'cross_provider_duplicate' }])(
    'reopens eligible completed work once, clearing old outcome/retry fields: %j', async outcome => {
      Object.assign(row, outcome);
      await expect(restoreCompletedGarminActivity(ref, payload, permission)).resolves.toBe(true);
      expect(row).toEqual(payload);
      row.processed = true;
      await expect(restoreCompletedGarminActivity(ref, payload, permission)).resolves.toBe(false);
      expect(mocks.set).toHaveBeenCalledTimes(1);
    });

  it.each([
    { processed: false, retryCount: 8 }, { queueRevision: id }, { firebaseUserID: 'other' }, { firebaseUserID: undefined },
    { userID: 'other' }, { activityFileID: 'other' }, { resultStatus: 'skipped', skippedReason: 'provider_auth_required' },
    { resultStatus: 'skipped', skippedReason: 'outbound_provider_echo' }, { resultStatus: 'manual_reconciliation_required' },
    { processingOwner: 'worker', processingRevision: 'old', processingLeaseExpiresAt: Date.now() + 60_000 },
  ])('preserves protected queue state: %j', async patch => {
    Object.assign(row, patch);
    await expect(restoreCompletedGarminActivity(ref, payload, permission)).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.deletion).not.toHaveBeenCalled();
  });

  it.each(['request', 'connection', 'credential', 'disconnect', 'deletion', 'missing'])('rechecks %s inside the transaction', async change => {
    if (change === 'request') meta.activityHistoryRestoration = { ...permission, id: nextId, runId: nextId };
    if (change === 'connection') meta.connectionStateGeneration = 'new';
    if (change === 'credential') root.activeOAuthCredentialGeneration = 'new';
    if (change === 'disconnect') root.disconnectOperationGeneration = 'pending';
    if (change === 'deletion') mocks.deletion.mockResolvedValue({ shouldSkip: true });
    if (change === 'missing') mocks.get.mockResolvedValue({ exists: false, data: () => undefined });
    await expect(restoreCompletedGarminActivity(ref, payload, permission)).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('propagates read failures for normal webhook retry instead of acknowledging restoration', async () => {
    mocks.get.mockRejectedValue(new Error('unavailable'));
    await expect(restoreCompletedGarminActivity(ref, payload, permission)).rejects.toThrow('unavailable');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('allows a later explicit request after the previous restoration finished', async () => {
    await restoreCompletedGarminActivity(ref, payload, permission);
    row.processed = true;
    const next = { ...permission, id: nextId, runId: nextId };
    meta.activityHistoryRestoration = next;
    await expect(restoreCompletedGarminActivity(ref, { ...payload, queueRevision: nextId, connectionHistoryRunId: nextId }, next)).resolves.toBe(true);
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });
  it.each(['150', null, undefined])('does not classify malformed recording timestamps (%s)', seconds => {
    expect(getGarminActivityHistoryRestoration(connected, 'garmin', seconds as unknown as number)).toBeUndefined();
  });
});
