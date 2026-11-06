import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ db: undefined as unknown as Firestore, request: vi.fn(), refresh: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => mocks.db }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../request-helper', () => ({ get: mocks.request }));
vi.mock('../utils', () => ({ hasProAccess: async () => true }));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: async () => ({ shouldSkip: false }),
  getUserDeletionGuardStateInTransaction: async () => ({ shouldSkip: false }),
  UserDeletionGuardReadError: class extends Error {},
}));
vi.mock('./health-flags', () => ({ isGarminHealthSyncEnabled: () => true }));
vi.mock('./health-lifecycle', () => ({
  captureActiveGarminHealthWriteLifecycleGuards: async () => guards(),
  GarminHealthAccountValidationError: class extends Error {},
}));
vi.mock('./health-sync', async original => ({
  ...await original<typeof import('./health-sync')>(),
  refreshAndCaptureGarminHealthGuards: mocks.refresh,
  verifyLegacyGarminProviderIdentity: async () => {},
}));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun, type ConnectionHistoryRun } from '../connection-history/model';
import { QueueResult } from '../queue-utils';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { getTokenCredentialSnapshot } from '../token-refresh-coordinator';
import { processGarminHealthBackfillQueueItem } from './health-backfill';
import type { GarminHealthWriteLifecycleGuards } from './health-lifecycle';

const tokenPath = 'garminAPITokens/owner/tokens/account';
const rootPath = 'garminAPITokens/owner';
const metaPath = `users/owner/meta/${ServiceNames.GarminAPI}`;
const token = { userID: 'account', serviceName: ServiceNames.GarminAPI, accessToken: 'PRIVATE_TOKEN',
  tokenCredentialGeneration: 'credential', permissions: ['HEALTH_EXPORT'] };
function guards(credentials: Record<string, unknown> = token): GarminHealthWriteLifecycleGuards {
  return {
    requiredExistingDocumentRef: mocks.db.doc(tokenPath), requiredExistingTokenCredential: getTokenCredentialSnapshot(credentials),
    requiredDocumentFieldValues: { documentRef: mocks.db.doc(rootPath), expectedFields: { activeOAuthCredentialGeneration: 'credential' } },
    additionalRequiredDocumentFieldValues: [{ documentRef: mocks.db.doc(metaPath), expectedFields: { connectionStateGeneration: 'connection' } }],
    providerUserId: 'account', providerIdentityPinned: true, tokenCredentialGeneration: 'credential',
    rootOAuthCredentialGeneration: 'credential', connectionStateGeneration: 'connection',
  };
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Garmin Health run cutoff transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  let run: ConnectionHistoryRun;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.db = new Firestore({ projectId: `demo-garmin-cutoff-${randomUUID().slice(0, 8)}` });
    mocks.db.settings({ ignoreUndefinedProperties: true });
    run = createHistoryRun('owner', ServiceNames.GarminAPI, {
      requested: true, rangePreset: '30_days', runId: randomUUID(), tokenPath, rootPath,
      providerUserId: 'account', credentialGeneration: 'credential',
    }, 'connection', Date.now());
    Object.assign(run, { startMs: 0, endMs: 10_000, garminHealthSummaryTypes: ['dailies'] });
    await Promise.all([
      mocks.db.doc(rootPath).set({ activeOAuthCredentialGeneration: 'credential' }),
      mocks.db.doc(tokenPath).set(token),
      mocks.db.doc(metaPath).set({ connectionState: 'connected', connectionStateGeneration: 'connection' }),
      mocks.db.doc(`connectionHistoryImports/${run.id}`).set(run),
    ]);
    mocks.refresh.mockReset().mockImplementation(async () => {
      const snapshot = await mocks.db.doc(tokenPath).get();
      return { tokenData: snapshot.data(), tokenSnapshot: snapshot, lifecycleGuards: guards(snapshot.data()) };
    });
    mocks.request.mockReset().mockRejectedValue({ statusCode: 400, error: { minStartTimeInSeconds: 10 } });
  });
  afterEach(async () => { vi.restoreAllMocks(); await mocks.db.terminate(); });
  async function child() {
    const ref = mocks.db.collection('sleepSyncQueue').doc();
    const item: SleepSyncQueueItemInterface = {
      id: ref.id, type: 'garmin_health_backfill', provider: 'GarminAPI', userID: 'owner', providerUserId: 'account',
      rangeStartMs: 0, rangeEndMs: 0, healthTrigger: 'backfill', connectionHistoryRunId: run.id,
      garminHealthTokenCredentialGeneration: 'credential', garminHealthRootOAuthCredentialGeneration: 'credential',
      garminHealthConnectionStateGeneration: 'connection', garminHealthBackfillSummaryIndex: 0,
      garminHealthBackfillNextStartMs: 0, garminHealthBackfillWindowsCompleted: 0, garminHealthBackfillWindowsTotal: 1,
      dateCreated: Date.now(), processed: false, retryCount: 0, dispatchedToCloudTask: 1, queueRevision: randomUUID(),
    };
    await ref.set(item);
    return { ...item, ref };
  }
  const savedRun = async () => (await mocks.db.doc(`connectionHistoryImports/${run.id}`).get()).data() as ConnectionHistoryRun;
  async function learn() { expect(await processGarminHealthBackfillQueueItem(await child())).toBe(QueueResult.Processed); }

  it('commits provider evidence with cursor progress and reuses it in a separate worker invocation', async () => {
    await learn();
    expect((await savedRun()).garminHealthBackfillCutoffs?.dailies?.minimumStartMs).toBe(10_000);
    const next = await child();
    expect(await processGarminHealthBackfillQueueItem(next)).toBe(QueueResult.Processed);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect((await next.ref!.get()).data()).toMatchObject({ processed: true, resultStatus: 'success', garminHealthBackfillWindowsCompleted: 1 });
  });

  it('does not reuse one family minimum for another family', async () => {
    await learn();
    await mocks.db.doc(`connectionHistoryImports/${run.id}`).update({ garminHealthSummaryTypes: ['stressDetails'] });
    await learn();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect((await savedRun()).garminHealthBackfillCutoffs).toMatchObject({ dailies: { minimumStartMs: 10_000 }, stressDetails: { minimumStartMs: 10_000 } });
  });

  it('fences a reconnect that happens after the cached run was read', async () => {
    await learn();
    mocks.request.mockClear();
    mocks.refresh.mockImplementationOnce(async () => {
      await mocks.db.doc(rootPath).update({ activeOAuthCredentialGeneration: 'replacement' });
      return { tokenData: token, tokenSnapshot: await mocks.db.doc(tokenPath).get(), lifecycleGuards: guards() };
    });
    const next = await child();
    await processGarminHealthBackfillQueueItem(next);
    expect(mocks.request).not.toHaveBeenCalled();
    expect((await mocks.db.doc(rootPath).get()).data()?.activeOAuthCredentialGeneration).toBe('replacement');
    expect((await next.ref!.get()).data()).toMatchObject({ processed: true, resultStatus: 'skipped',
      skippedReason: 'connection_history_superseded', garminHealthBackfillWindowsCompleted: 0 });
  });

  it('does not advance a replacement queue revision using the old invocation', async () => {
    await learn();
    const next = await child();
    mocks.refresh.mockImplementationOnce(async () => {
      await next.ref!.update({ queueRevision: 'replacement' });
      return { tokenData: token, tokenSnapshot: await mocks.db.doc(tokenPath).get(), lifecycleGuards: guards() };
    });
    mocks.request.mockClear();
    await processGarminHealthBackfillQueueItem(next);
    expect(mocks.request).not.toHaveBeenCalled();
    expect((await next.ref!.get()).data()).toMatchObject({ queueRevision: 'replacement', processed: false, garminHealthBackfillWindowsCompleted: 0 });
  });

  it('falls back to fresh provider checks after a parallel OAuth token refresh without skipping valid work', async () => {
    await learn();
    mocks.refresh.mockImplementationOnce(async () => {
      const snapshot = await mocks.db.doc(tokenPath).get();
      await mocks.db.doc(tokenPath).update({ accessToken: 'PRIVATE_REFRESHED_TOKEN' });
      return { tokenData: token, tokenSnapshot: snapshot, lifecycleGuards: guards() };
    });
    const next = await child();
    await processGarminHealthBackfillQueueItem(next);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect((await next.ref!.get()).data()).toMatchObject({ processed: true, resultStatus: 'success', garminHealthBackfillWindowsCompleted: 1 });
  });

  it('retains the permission failure path when Health access is revoked after preflight', async () => {
    await learn();
    mocks.request.mockClear();
    mocks.refresh.mockImplementationOnce(async () => {
      const snapshot = await mocks.db.doc(tokenPath).get();
      await mocks.db.doc(tokenPath).update({ permissions: [] });
      return { tokenData: snapshot.data(), tokenSnapshot: snapshot, lifecycleGuards: guards(snapshot.data()) };
    });
    const next = await child();
    expect(await processGarminHealthBackfillQueueItem(next)).toBe(QueueResult.MovedToDLQ);
    expect(mocks.request).not.toHaveBeenCalled();
    expect((await next.ref!.get()).exists).toBe(false);
    expect((await mocks.db.doc(`failed_jobs/${next.id}`).get()).data()).toMatchObject({
      context: 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING', garminHealthBackfillWindowsCompleted: 0,
    });
    expect((await mocks.db.doc('users/owner/healthSyncState/GarminAPI').get()).data()?.status).toBe('permission_missing');
  });

  it.each(['expanded-grants', 'same-grants-new-event'])('requests newly eligible history after %s', async change => {
    await learn();
    mocks.request.mockClear().mockResolvedValue('');
    await mocks.db.doc(tokenPath).update({
      permissions: change === 'expanded-grants' ? ['HEALTH_EXPORT', 'HISTORICAL_DATA_EXPORT'] : ['HEALTH_EXPORT'],
      permissionsLastChangedAt: Math.floor(Date.now() / 1000),
    });
    const next = await child();
    await processGarminHealthBackfillQueueItem(next);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect((await next.ref!.get()).data()).toMatchObject({ processed: true, resultStatus: 'success' });
  });

  it('does not publish evidence from a provider request that crossed a permission change', async () => {
    mocks.request.mockImplementationOnce(async () => {
      await mocks.db.doc(tokenPath).update({ permissionsLastChangedAt: Math.floor(Date.now() / 1000) });
      throw { statusCode: 400, error: { minStartTimeInSeconds: 10 } };
    });
    await learn();
    expect((await savedRun()).garminHealthBackfillCutoffs).toBeUndefined();
    await learn();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect((await savedRun()).garminHealthBackfillCutoffs?.dailies).toBeDefined();
  });

  it('commits competing discoveries and each exact child cursor without losing progress', async () => {
    // Exercise Firestore retry/conflict behavior with real overlapping worker commits.
    await mocks.db.doc(`connectionHistoryImports/${run.id}`).update({ garminHealthSummaryTypes: ['dailies'] });
    let arrivals = 0;
    let release!: () => void;
    const bothRequested = new Promise<void>(resolve => { release = resolve; });
    mocks.request.mockImplementation(async () => {
      if (++arrivals === 2) release();
      await bothRequested;
      throw { statusCode: 400, error: { minStartTimeInSeconds: 10 } };
    });
    const children = await Promise.all([child(), child()]);
    await Promise.all(children.map(item => processGarminHealthBackfillQueueItem(item)));
    expect((await savedRun()).garminHealthBackfillCutoffs?.dailies?.minimumStartMs).toBe(10_000);
    for (const item of children) expect((await item.ref!.get()).data()?.processed).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('keeps a newer lower cutoff when an older response commits later', async () => {
    const observedAtMs = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(observedAtMs);
    const original = mocks.db.runTransaction.bind(mocks.db);
    let delayNextTransaction = false;
    let release!: () => void;
    let parked!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const transactionParked = new Promise<void>(resolve => { parked = resolve; });
    vi.spyOn(mocks.db, 'runTransaction').mockImplementation(async (...args) => {
      if (delayNextTransaction) {
        delayNextTransaction = false;
        parked();
        await delayed;
      }
      return original(...args);
    });
    mocks.request.mockImplementationOnce(async () => {
      delayNextTransaction = true;
      throw { statusCode: 400, error: { minStartTimeInSeconds: 10 } };
    }).mockRejectedValue({ statusCode: 400, error: { minStartTimeInSeconds: 5 } });
    const older = processGarminHealthBackfillQueueItem(await child());
    await transactionParked;
    try {
      now.mockReturnValue(observedAtMs + 1000);
      await learn();
    } finally {
      release();
      await older;
    }
    expect((await savedRun()).garminHealthBackfillCutoffs?.dailies).toMatchObject({
      minimumStartMs: 5000, observedAtMs: observedAtMs + 1000,
    });
    mocks.request.mockClear().mockResolvedValue('');
    const available = await child();
    await available.ref!.update({ rangeStartMs: 6000, rangeEndMs: 6000, garminHealthBackfillNextStartMs: 6000 });
    Object.assign(available, { rangeStartMs: 6000, rangeEndMs: 6000, garminHealthBackfillNextStartMs: 6000 });
    await processGarminHealthBackfillQueueItem(available);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect((await available.ref!.get()).data()?.resultStatus).toBe('success');
  }, 15_000);
});
