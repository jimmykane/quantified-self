import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { getTokenCredentialSnapshot } from '../token-refresh-coordinator';
import { clearRevisionProcessingLeaseUpdate } from '../queue/revision-processing-lease';
import type { SuuntoWebhookWriteLifecycleGuards } from './health-webhook-binding-lifecycle';
const mocks = vi.hoisted(() => ({ transaction: { get: vi.fn(), update: vi.fn() }, deletion: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => ({
  runTransaction: (fn: (transaction: typeof mocks.transaction) => unknown) => fn(mocks.transaction),
}) }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.deletion }));
import { checkpointSuuntoHealthProgress, isValidSuuntoHealthProgress, type SuuntoHealthProgress } from './health-progress';
import { getSuuntoWebhookWriteLifecycleAuthorityDigest } from './health-webhook-binding-lifecycle';

const day = 86_400_000;
const ref = (path: string) => ({ path }) as admin.firestore.DocumentReference;
const token = { accessToken: 'secret', tokenCredentialGeneration: 'generation' };
const guards: SuuntoWebhookWriteLifecycleGuards = {
  requiredExistingDocumentRef: ref('token'), requiredExistingTokenCredential: getTokenCredentialSnapshot(token),
  requiredDocumentFieldValues: { documentRef: ref('binding'), expectedFields: { generation: 'one' } },
  additionalRequiredDocumentFieldValues: [{ documentRef: ref('meta'), expectedFields: { connected: true } }],
};
const queue = (): SleepSyncQueueItemInterface => ({
  id: 'queue', ref: ref('queue'), type: 'suunto_health_poll', provider: 'SuuntoApp', userID: 'owner',
  providerUserId: 'provider', rangeStartMs: day, rangeEndMs: 8 * day, dateCreated: 1,
  processed: false, retryCount: 7, queueRevision: 'original', processingOwner: 'worker',
  processingRevision: 'revision:original',
});
const progress = (): SuuntoHealthProgress => ({ nextStartMs: 2 * day, targetWindowMs: day,
  authorityDigest: getSuuntoWebhookWriteLifecycleAuthorityDigest(guards),
  recordsWritten: 1, recordsUnchanged: 0, recordsStale: 0, lastObservedAtMs: day,
});

describe('Suunto durable Health progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.transaction.get.mockImplementation(async ({ path }: { path: string }) => ({ exists: true,
      data: () => path === 'queue' ? queue() : path === 'token' ? token
        : path === 'binding' ? { generation: 'one' } : { connected: true },
    }));
  });

  it('advances only with current owner, revision and lifecycle and releases a new task revision', async () => {
    const result = await checkpointSuuntoHealthProgress(queue(), 'owner', guards, progress());
    expect(result).toEqual({ continuationRevision: expect.any(String) });
    expect(mocks.transaction.update).toHaveBeenCalledWith(ref('queue'), expect.objectContaining({
      suuntoHealthProgress: progress(), queueRevision: expect.not.stringMatching(/^original$/),
      retryCount: 0, dispatchedToCloudTask: null, ...clearRevisionProcessingLeaseUpdate(),
    }));
  });

  it.each(['deleted', 'missing', 'revision', 'lease', 'processed', 'cursor', 'range', 'owner', 'token', 'binding', 'meta'])(
    'does not advance after %s changes', async change => {
      const originalGet = mocks.transaction.get.getMockImplementation()!;
      if (change === 'deleted') mocks.deletion.mockResolvedValue({ shouldSkip: true });
      mocks.transaction.get.mockImplementation(async (document: { path: string }) => {
        const original = await originalGet(document);
        const data = original.data();
        if (document.path === 'queue') {
          if (change === 'missing') return { exists: false };
          if (change === 'revision') data.queueRevision = 'new';
          if (change === 'lease') data.processingOwner = 'other';
          if (change === 'processed') data.processed = true;
          if (change === 'cursor') data.suuntoHealthProgress = progress();
          if (change === 'range') data.rangeEndMs += day;
          if (change === 'owner') data.userID = 'other';
        }
        if (document.path === change) return { exists: true, data: () => ({}) };
        return { exists: true, data: () => data };
      });
      const result = await checkpointSuuntoHealthProgress(queue(), 'owner', guards, progress());
      expect(typeof result).toBe('string');
      expect(mocks.transaction.update).not.toHaveBeenCalled();
    },
  );

  it('propagates persistence failure without leaking provider document paths', async () => {
    mocks.transaction.update.mockImplementationOnce(() => { throw Error('secret provider path'); });
    await expect(checkpointSuuntoHealthProgress(queue(), 'owner', guards, progress()))
      .rejects.toThrow('Suunto Health checkpoint failed.');
  });

  it.each([
    { nextStartMs: day }, { nextStartMs: 8 * day }, { targetWindowMs: 1 }, { targetWindowMs: 27 * day },
    { authorityDigest: 'raw-account' }, { recordsWritten: -1 }, { recordsStale: NaN },
    { recordsUnchanged: 100_001 }, { lastObservedAtMs: -1 }, { unexpected: true },
  ])('rejects malformed progress %j', invalid => {
    expect(isValidSuuntoHealthProgress({ ...queue(), suuntoHealthProgress: { ...progress(), ...invalid } })).toBe(false);
  });

  it('rejects progress attached to another provider/family', () => {
    expect(isValidSuuntoHealthProgress({ ...queue(), type: 'suunto_poll', suuntoHealthProgress: progress() })).toBe(false);
  });
});
