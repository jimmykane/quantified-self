import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  interface MockDocumentReference {
    path: string;
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    collection: (name: string) => MockCollectionReference;
  }
  interface MockCollectionReference {
    path: string;
    doc: (id: string) => MockDocumentReference;
  }
  const documents = new Map<string, Record<string, unknown>>();
  const writes: Array<{ path: string; data: Record<string, unknown>; options: unknown }> = [];
  const document = (path: string): MockDocumentReference => ({
    path,
    get: vi.fn(async () => ({
      exists: documents.has(path),
      data: () => documents.get(path),
    })),
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string): MockCollectionReference => ({
    path,
    doc: (id: string) => document(`${path}/${id}`),
  });
  const transaction = {
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>, options: unknown) => {
      writes.push({ path: ref.path, data, options });
      documents.set(ref.path, data);
    }),
  };
  const db = {
    collection: (name: string) => collection(name),
    runTransaction: vi.fn(async (callback: (transactionValue: typeof transaction) => unknown) => callback(transaction)),
  };
  return {
    db,
    documents,
    writes,
    transaction,
    getUserDeletionGuardStateInTransaction: vi.fn(),
    importer: vi.fn(),
    loggerWarn: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => mocks.db,
}));

vi.mock('firebase-functions/logger', () => ({
  warn: (...args: unknown[]) => mocks.loggerWarn(...args),
}));

vi.mock('@sports-alliance/sports-lib', async importOriginal => {
  const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
  return {
    ...actual,
    EventImporterFIT: {
      getFromArrayBuffer: (...args: unknown[]) => mocks.importer(...args),
    },
  };
});

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: (...args: unknown[]) => mocks.getUserDeletionGuardStateInTransaction(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

vi.mock('../shared/ttl-config', () => ({
  TTL_CONFIG: { ACTIVITY_SYNC_OUTBOUND_FINGERPRINT_IN_DAYS: 120 },
  getExpireAtTimestamp: () => ({ toMillis: () => Date.now() + 120 * 24 * 60 * 60 * 1000 }),
}));

import {
  ActivitySyncOutboundFingerprintSkippedForDeletedUserError,
  buildActivitySyncOutboundFingerprintIds,
  getActivitySyncOutboundFingerprintDocumentId,
  isActivitySyncOutboundEcho,
  recordActivitySyncOutboundFingerprint,
} from './outbound-fingerprint';

function parsedEvent() {
  const activity = {
    startDate: new Date('2026-08-01T08:00:00.000Z'),
    endDate: new Date('2026-08-01T09:00:00.000Z'),
    type: 'Running',
    getDuration: () => ({ getValue: () => 3600 }),
    getDistance: () => ({ getValue: () => 10000 }),
  };
  return {
    startDate: activity.startDate,
    endDate: activity.endDate,
    getActivities: () => [activity],
  };
}

describe('activity sync outbound fingerprints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.writes.length = 0;
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: false });
    mocks.importer.mockResolvedValue(parsedEvent());
  });

  it('creates an exact receipt and a provider-reencoding-tolerant semantic receipt', async () => {
    const first = await buildActivitySyncOutboundFingerprintIds(Buffer.from('first-fit'));
    const second = await buildActivitySyncOutboundFingerprintIds(Buffer.from('reencoded-fit'));

    expect(first.exactFingerprintId).not.toBe(second.exactFingerprintId);
    expect(first.fingerprintIds).toHaveLength(2);
    expect(first.fingerprintIds[1]).toBe(second.fingerprintIds[1]);
  });

  it('writes receipts under the user root before provider delivery', async () => {
    const result = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('fit-data'),
    });

    expect(mocks.writes).toHaveLength(2);
    expect(mocks.writes.map(write => write.path)).toEqual(result.fingerprintIds.map(
      id => `users/user-1/activitySyncOutboundFingerprints/${getActivitySyncOutboundFingerprintDocumentId(ServiceNames.COROSAPI, id)}`,
    ));
    expect(mocks.writes[0].data).toEqual(expect.objectContaining({
      version: 1,
      destinationServiceName: ServiceNames.COROSAPI,
      recordedAt: expect.any(Number),
      expireAt: expect.objectContaining({ toMillis: expect.any(Function) }),
    }));
  });

  it('fails closed without writing when account deletion has started', async () => {
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({ shouldSkip: true });

    await expect(recordActivitySyncOutboundFingerprint({
      userID: 'deleted-user',
      destinationServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('fit-data'),
    })).rejects.toBeInstanceOf(ActivitySyncOutboundFingerprintSkippedForDeletedUserError);
    expect(mocks.transaction.set).not.toHaveBeenCalled();
  });

  it('matches a semantically identical provider echo even when FIT bytes changed', async () => {
    await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('outbound-fit'),
    });

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('provider-reencoded-fit'),
    })).resolves.toBe(true);
  });

  it('does not match a receipt written for a different destination', async () => {
    await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.SuuntoApp,
      fileBuffer: Buffer.from('outbound-fit'),
    });

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.COROSAPI,
      fileBuffer: Buffer.from('outbound-fit'),
    })).resolves.toBe(false);
  });

  it('keeps receipts for multiple destinations without overwriting either provider', async () => {
    const fileBuffer = Buffer.from('shared-outbound-fit');
    await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.SuuntoApp,
      fileBuffer,
    });
    await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.COROSAPI,
      fileBuffer,
    });

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.SuuntoApp,
      fileBuffer,
    })).resolves.toBe(true);
    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.COROSAPI,
      fileBuffer,
    })).resolves.toBe(true);
    expect(mocks.documents.size).toBe(4);
  });
});
