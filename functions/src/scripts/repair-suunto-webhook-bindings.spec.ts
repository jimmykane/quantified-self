import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => {
  const apps: unknown[] = [];
  const documents = new Map<string, Record<string, unknown>>();
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  class TerminalServiceAuthError extends Error {}

  class FakeDocumentRef {
    constructor(public readonly path: string) {}

    get id(): string {
      return this.path.split('/').at(-1) || '';
    }

    collection(name: string): FakeCollectionRef {
      return new FakeCollectionRef(`${this.path}/${name}`);
    }

    async get(): Promise<FakeDocumentSnapshot> {
      return new FakeDocumentSnapshot(this, documents.get(this.path));
    }
  }

  class FakeDocumentSnapshot {
    readonly id: string;
    readonly exists: boolean;

    constructor(
      public readonly ref: FakeDocumentRef,
      private readonly value: Record<string, unknown> | undefined,
    ) {
      this.id = ref.id;
      this.exists = value !== undefined;
    }

    data(): Record<string, unknown> | undefined {
      return this.value;
    }
  }

  class FakeCollectionRef {
    private queryLimit = Number.POSITIVE_INFINITY;
    private startAfterID: string | null = null;

    constructor(public readonly path: string) {}

    doc(id: string): FakeDocumentRef {
      return new FakeDocumentRef(`${this.path}/${id}`);
    }

    orderBy(): this {
      return this;
    }

    startAfter(id: string): this {
      this.startAfterID = id;
      return this;
    }

    limit(value: number): this {
      this.queryLimit = value;
      return this;
    }

    async get(): Promise<{ docs: FakeDocumentSnapshot[]; size: number; empty: boolean }> {
      const prefix = `${this.path}/`;
      const expectedSegments = this.path.split('/').length + 1;
      const docs = [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && path.split('/').length === expectedSegments)
        .map(([path, value]) => new FakeDocumentSnapshot(new FakeDocumentRef(path), value))
        .filter(snapshot => !this.startAfterID || snapshot.id > this.startAfterID)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, this.queryLimit);
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  }

  const db = {
    collection: vi.fn((name: string) => new FakeCollectionRef(name)),
    getAll: vi.fn(async (...refs: FakeDocumentRef[]) => Promise.all(refs.map(ref => ref.get()))),
  };

  return {
    apps,
    db,
    documents,
    FakeDocumentRef,
    loggerError,
    loggerInfo,
    TerminalServiceAuthError,
    getUserDeletionGuardState: vi.fn(async () => ({ shouldSkip: false })),
    getUserDeletionGuardStateInTransaction: vi.fn(async () => ({ shouldSkip: false })),
    repairBinding: vi.fn(),
    resolveBindingUsers: vi.fn(async () => ['user-1']),
    getTokenData: vi.fn(),
    getWorkoutQueueItems: vi.fn(),
    addToQueueForSuunto: vi.fn(),
    enqueueActivitySync: vi.fn(),
    isRouteEnabled: vi.fn(),
    generateIDFromParts: vi.fn(async (parts: unknown[]) => parts.join(':')),
  };
});

vi.mock('firebase-admin', () => ({
  apps: hoisted.apps,
  initializeApp: vi.fn(() => hoisted.apps.push({ name: 'test' })),
  firestore: vi.fn(() => hoisted.db),
}));
vi.mock('firebase-functions/logger', () => ({
  info: hoisted.loggerInfo,
  error: hoisted.loggerError,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
}));
vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn((userID: string) =>
    new hoisted.FakeDocumentRef(`suuntoAppAccessTokens/${userID}`)),
  doesServiceDisconnectOperationPermitTokenUse: vi.fn(() => true),
}));
vi.mock('../service-disconnect-pending-state', () => ({
  isServiceDisconnectPendingData: vi.fn(() => false),
}));
vi.mock('../suunto/health-webhook-binding', () => ({
  getSuuntoHealthWebhookAccountBindingRef: vi.fn((_db: unknown, providerUserId: string, userID: string) =>
    new hoisted.FakeDocumentRef(`suuntoHealthWebhookAccountBindings/${providerUserId}:${userID}`)),
  parseSuuntoHealthWebhookAccountBinding: vi.fn(() => null),
  doesSuuntoHealthWebhookBindingMatch: vi.fn(() => false),
}));
vi.mock('../suunto/health-webhook-binding-lifecycle', () => ({
  repairSuuntoLegacyWebhookBindingForProviderVerifiedToken: hoisted.repairBinding,
  resolveActiveSuuntoWebhookUserIDs: hoisted.resolveBindingUsers,
  SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_VERSION: 1,
  SUUNTO_LEGACY_WEBHOOK_BINDING_REPAIR_FIELDS: {
    Version: 'suuntoLegacyWebhookBindingRepairVersion',
    RepairedAtMs: 'suuntoLegacyWebhookBindingRepairedAtMs',
    IncidentStartMs: 'suuntoLegacyWebhookBindingRepairIncidentStartMs',
  },
}));
vi.mock('../tokens', () => ({
  TerminalServiceAuthError: hoisted.TerminalServiceAuthError,
  getTokenData: hoisted.getTokenData,
}));
vi.mock('../history', () => ({
  getWorkoutQueueItems: hoisted.getWorkoutQueueItems,
}));
vi.mock('../queue', () => ({
  addToQueueForSuunto: hoisted.addToQueueForSuunto,
}));
vi.mock('../activity-sync/enqueue-imported-event', () => ({
  enqueueActivitySyncJobsForImportedEvent: hoisted.enqueueActivitySync,
}));
vi.mock('../activity-sync/settings', () => ({
  isActivitySyncRouteEnabledForUser: hoisted.isRouteEnabled,
}));
vi.mock('../activity-sync/metadata', () => ({
  getActivitySyncMetadataDocId: vi.fn((routeID: string) => `activitySync:${routeID}`),
}));
vi.mock('../shared/queue-names', () => ({
  getServiceWorkoutQueueName: vi.fn(() => 'suuntoAppWorkoutQueue'),
}));
vi.mock('../utils', () => ({
  generateIDFromParts: hoisted.generateIDFromParts,
}));

import {
  parseSuuntoLegacyWebhookRepairOptions,
  runSuuntoLegacyWebhookRepairScript,
  suuntoLegacyWebhookRepairTestInternals,
} from './repair-suunto-webhook-bindings';

describe('repair-suunto-webhook-bindings script', () => {
  const nowMs = Date.parse('2026-09-01T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.apps.length = 0;
    hoisted.documents.clear();
    hoisted.repairBinding.mockReset();
  });

  it('is read-only by default and requires explicit apply for every mutating stage', () => {
    expect(parseSuuntoLegacyWebhookRepairOptions([], nowMs)).toMatchObject({
      execute: false,
      stage: 'audit',
      userLimit: 100,
      throughMs: nowMs,
    });
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--stage=repair'], nowMs))
      .toThrow('repair requires the explicit --apply flag');
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--stage=verify', '--apply'], nowMs))
      .toThrow('verify is read-only');
  });

  it('rejects unbounded or ambiguous scans', () => {
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--limit=501'], nowMs))
      .toThrow('no greater than 500');
    expect(() => parseSuuntoLegacyWebhookRepairOptions([
      '--uid=user-1',
      '--start-after-uid=user-0',
    ], nowMs)).toThrow('either --uid or --start-after-uid');
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--limit=2oops'], nowMs))
      .toThrow('positive integer');
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--limit'], nowMs))
      .toThrow('--limit requires a value');
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--uid=user/1'], nowMs))
      .toThrow('canonical Firebase user ID');
    expect(() => parseSuuntoLegacyWebhookRepairOptions(['--unknown=value'], nowMs))
      .toThrow('Unknown argument');
  });

  it('discovers a child-only Suunto token by paging canonical user documents', async () => {
    hoisted.documents.set('users/user-1', { active: true });
    hoisted.documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    });
    // Intentionally do not create suuntoAppAccessTokens/user-1.
    hoisted.documents.set('suuntoAppAccessTokens/user-1/tokens/provider-1', {
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
      expiresAt: nowMs + 60_000,
    });

    const summary = await runSuuntoLegacyWebhookRepairScript([
      '--stage=audit',
      '--through=2026-08-30T12:00:00.000Z',
    ]);

    expect(summary).toMatchObject({
      dryRun: true,
      scannedUsers: 1,
      scannedTokens: 1,
      repairCandidates: 1,
      alreadyCurrent: 0,
      repairedMarkerTokens: 0,
      page: { hasMoreUsers: false, nextStartAfterUID: null },
    });
    expect(suuntoLegacyWebhookRepairTestInternals.getSummaryExitCode(summary)).toBe(2);
    expect(hoisted.repairBinding).not.toHaveBeenCalled();
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
  });

  it('contacts only users whose provider refresh is terminally rejected', async () => {
    for (const userID of ['user-1', 'user-2']) {
      hoisted.documents.set(`users/${userID}`, { active: true });
      hoisted.documents.set(`users/${userID}/meta/${ServiceNames.SuuntoApp}`, {
        connectionState: 'connected',
        connectionStateGeneration: `connection-${userID}`,
      });
      hoisted.documents.set(`suuntoAppAccessTokens/${userID}/tokens/provider-${userID}`, {
        serviceName: ServiceNames.SuuntoApp,
        userName: `provider-${userID}`,
        refreshToken: `refresh-${userID}`,
        accessToken: `access-${userID}`,
        expiresAt: nowMs + 60_000,
      });
    }
    const terminal = new hoisted.TerminalServiceAuthError('reconnect required');
    hoisted.repairBinding
      .mockRejectedValueOnce(terminal)
      .mockRejectedValueOnce(new Error('temporary provider failure'));

    const summary = await runSuuntoLegacyWebhookRepairScript([
      '--stage=repair',
      '--apply',
      '--through=2026-08-30T12:00:00.000Z',
    ]);

    expect(summary.repair).toMatchObject({
      attempted: 2,
      refreshRejected: 1,
      failed: 1,
      contactUserIDs: ['user-1'],
    });
    expect(suuntoLegacyWebhookRepairTestInternals.getSummaryExitCode(summary)).toBe(1);
  });

  it('does not let backfill bypass the retained-token bound', async () => {
    hoisted.documents.set('users/user-1', { active: true });
    hoisted.documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    });
    hoisted.documents.set('suuntoAppAccessTokens/user-1', {
      activeOAuthCredentialGeneration: 'root-generation-1',
    });
    for (let index = 0; index < 9; index += 1) {
      const providerUserId = `provider-${index}`;
      hoisted.documents.set(`suuntoAppAccessTokens/user-1/tokens/${providerUserId}`, {
        serviceName: ServiceNames.SuuntoApp,
        userName: providerUserId,
        refreshToken: `refresh-${index}`,
        accessToken: `access-${index}`,
        tokenCredentialGeneration: `token-generation-${index}`,
        suuntoLegacyWebhookBindingRepairVersion: 1,
      });
    }

    const summary = await runSuuntoLegacyWebhookRepairScript([
      '--stage=backfill',
      '--apply',
      '--through=2026-08-30T12:00:00.000Z',
    ]);

    expect(summary.skipped).toEqual({ too_many_retained_tokens: 1 });
    expect(summary.backfill.attemptedTokens).toBe(0);
    expect(hoisted.getWorkoutQueueItems).not.toHaveBeenCalled();
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
  });

  it('fails a backfill closed when the bounded provider window has too many workouts', async () => {
    hoisted.documents.set('users/user-1', { active: true });
    hoisted.documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    });
    hoisted.documents.set('suuntoAppAccessTokens/user-1', {
      activeOAuthCredentialGeneration: 'root-generation-1',
    });
    hoisted.documents.set('suuntoAppAccessTokens/user-1/tokens/provider-1', {
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
      tokenCredentialGeneration: 'token-generation-1',
      suuntoLegacyWebhookBindingRepairVersion: 1,
    });
    hoisted.getTokenData.mockResolvedValue({
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
      accessToken: 'access-1',
    });
    hoisted.getWorkoutQueueItems.mockResolvedValue(Array.from({ length: 1001 }, (_, index) => ({
      userName: 'provider-1',
      workoutID: `workout-${index}`,
    })));

    const summary = await runSuuntoLegacyWebhookRepairScript([
      '--stage=backfill',
      '--apply',
      '--through=2026-08-30T12:00:00.000Z',
    ]);

    expect(summary.backfill).toMatchObject({ attemptedTokens: 1, failedTokens: 1 });
    expect(hoisted.addToQueueForSuunto).not.toHaveBeenCalled();
    expect(suuntoLegacyWebhookRepairTestInternals.getSummaryExitCode(summary)).toBe(1);
  });

  it('keeps verification incomplete until repaired tokens finish backfill and reconciliation', async () => {
    hoisted.documents.set('users/user-1', { active: true });
    hoisted.documents.set(`users/user-1/meta/${ServiceNames.SuuntoApp}`, {
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    });
    hoisted.documents.set('suuntoAppAccessTokens/user-1', {
      activeOAuthCredentialGeneration: 'root-generation-1',
    });
    hoisted.documents.set('suuntoAppAccessTokens/user-1/tokens/provider-1', {
      serviceName: ServiceNames.SuuntoApp,
      userName: 'provider-1',
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
      tokenCredentialGeneration: 'token-generation-1',
      suuntoLegacyWebhookBindingRepairVersion: 1,
    });

    const summary = await runSuuntoLegacyWebhookRepairScript([
      '--stage=verify',
      '--through=2026-08-30T12:00:00.000Z',
    ]);

    expect(summary.verification).toEqual({
      backfillIncompleteTokens: 1,
      reconciliationIncompleteTokens: 1,
      fullyRecoveredTokens: 0,
    });
    expect(suuntoLegacyWebhookRepairTestInternals.getSummaryExitCode(summary)).toBe(2);
  });

  it('reports processed, pending, failed, and missing idempotent backfill queue rows', async () => {
    const token = {
      userID: 'user-1',
      providerUserId: 'provider-1',
      tokenSnapshot: await new hoisted.FakeDocumentRef(
        'suuntoAppAccessTokens/user-1/tokens/provider-1',
      ).get(),
      reasons: [],
    };
    hoisted.documents.set('suuntoAppWorkoutQueue/provider-1:done:user-1', { processed: true });
    hoisted.documents.set('suuntoAppWorkoutQueue/provider-1:pending:user-1', { processed: false });
    hoisted.documents.set('failed_jobs/provider-1:failed:user-1', {
      originalCollection: 'suuntoAppWorkoutQueue',
    });

    await expect(suuntoLegacyWebhookRepairTestInternals.getQueueDrainStatus(
      hoisted.db as never,
      token as never,
      [
        { userName: 'provider-1', workoutID: 'done' },
        { userName: 'provider-1', workoutID: 'pending' },
        { userName: 'provider-1', workoutID: 'failed' },
        { userName: 'provider-1', workoutID: 'missing' },
      ],
    )).resolves.toEqual({ processed: 1, pending: 1, failed: 1, missing: 1 });
  });

  it('accepts only bounded, canonical original-file metadata for sync reconciliation', () => {
    expect(suuntoLegacyWebhookRepairTestInternals.toOriginalFiles({
      originalFiles: [{
        path: 'users/user-1/events/event-1/original.fit',
        bucket: 'bucket-1',
        originalFilename: 'activity.fit',
      }, { path: ' spaced.fit ' }, null],
    })).toEqual([{
      path: 'users/user-1/events/event-1/original.fit',
      bucket: 'bucket-1',
      originalFilename: 'activity.fit',
    }]);
  });
});
