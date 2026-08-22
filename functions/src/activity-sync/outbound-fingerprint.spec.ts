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
    get: vi.fn(async (ref: { path: string }) => ({
      exists: documents.has(ref.path),
      data: () => documents.get(ref.path),
    })),
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>, options: { merge?: boolean } | undefined) => {
      const next: Record<string, unknown> = options?.merge
        ? { ...(documents.get(ref.path) || {}) }
        : {};
      for (const [key, value] of Object.entries(data)) {
        const transform = value as { __op?: string; values?: unknown[] };
        if (transform?.__op === 'arrayUnion') {
          const current = Array.isArray(next[key]) ? next[key] as unknown[] : [];
          next[key] = [...new Set([...current, ...(transform.values || [])])];
        } else if (transform?.__op === 'arrayRemove') {
          const removed = new Set(transform.values || []);
          next[key] = (Array.isArray(next[key]) ? next[key] as unknown[] : [])
            .filter(item => !removed.has(item));
        } else if (transform?.__op === 'delete') {
          delete next[key];
        } else {
          next[key] = value;
        }
      }
      writes.push({ path: ref.path, data: next, options });
      documents.set(ref.path, next);
    }),
    delete: vi.fn((ref: { path: string }) => {
      documents.delete(ref.path);
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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (...values: unknown[]) => ({ __op: 'arrayUnion', values }),
    arrayRemove: (...values: unknown[]) => ({ __op: 'arrayRemove', values }),
    delete: () => ({ __op: 'delete' }),
  },
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
  completeActivitySyncOutboundFingerprintProviderRequest,
  getActivitySyncOutboundFingerprintDocumentId,
  isActivitySyncOutboundEcho,
  markActivitySyncOutboundFingerprintProviderRequestStarted,
  recordActivitySyncOutboundFingerprint,
  rollbackActivitySyncOutboundFingerprint,
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
      providerRequestStartedAt: expect.any(Number),
      recordedAt: expect.any(Number),
      expireAt: expect.objectContaining({ toMillis: expect.any(Function) }),
    }));
  });

  it('rolls back only receipts from the provider operation that never started', async () => {
    const first = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer: Buffer.from('fit-data'),
      provisional: true,
    });
    const replacement = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer: Buffer.from('fit-data'),
      provisional: true,
    });

    await rollbackActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: first,
    });
    expect(mocks.documents.size).toBe(2);

    await rollbackActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: replacement,
    });
    expect(mocks.documents.size).toBe(0);
  });

  it('keeps an accepted receipt when a later provisional operation rolls back', async () => {
    const fileBuffer = Buffer.from('same-fit');
    const accepted = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer,
      provisional: true,
    });
    await markActivitySyncOutboundFingerprintProviderRequestStarted({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: accepted,
    });
    await completeActivitySyncOutboundFingerprintProviderRequest({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: accepted,
    });
    const acceptedRecordedAt = 123_456;
    const acceptedExpireAt = { toMillis: () => Date.now() + 60_000 };
    for (const fingerprintId of accepted.fingerprintIds) {
      const path = `users/user-1/activitySyncOutboundFingerprints/${getActivitySyncOutboundFingerprintDocumentId(ServiceNames.WahooAPI, fingerprintId)}`;
      mocks.documents.set(path, {
        ...(mocks.documents.get(path) || {}),
        recordedAt: acceptedRecordedAt,
        expireAt: acceptedExpireAt,
      });
    }
    const aborted = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer,
      provisional: true,
    });
    await markActivitySyncOutboundFingerprintProviderRequestStarted({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: aborted,
    });
    await rollbackActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: aborted,
    });

    for (const fingerprintId of accepted.fingerprintIds) {
      const path = `users/user-1/activitySyncOutboundFingerprints/${getActivitySyncOutboundFingerprintDocumentId(ServiceNames.WahooAPI, fingerprintId)}`;
      expect(mocks.documents.get(path)).toEqual(expect.objectContaining({
        recordedAt: acceptedRecordedAt,
        expireAt: acceptedExpireAt,
      }));
    }

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.WahooAPI,
      fileBuffer,
    })).resolves.toBe(true);
  });

  it('removes a promoted receipt when the provider request is aborted before it starts', async () => {
    const fileBuffer = Buffer.from('post-promotion-account-switch-fit');
    const provisional = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer,
      provisional: true,
    });
    await markActivitySyncOutboundFingerprintProviderRequestStarted({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: provisional,
    });

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.WahooAPI,
      fileBuffer,
    })).resolves.toBe(true);

    await rollbackActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: provisional,
    });

    expect(mocks.documents.size).toBe(0);
    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.WahooAPI,
      fileBuffer,
    })).resolves.toBe(false);
  });

  it('does not treat a provisional receipt as a provider echo', async () => {
    const fileBuffer = Buffer.from('provisional-fit');
    await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer,
      provisional: true,
    });

    await expect(isActivitySyncOutboundEcho({
      userID: 'user-1',
      sourceServiceName: ServiceNames.WahooAPI,
      fileBuffer,
    })).resolves.toBe(false);
  });

  it('does not mutate provisional receipts after account deletion starts', async () => {
    const provisional = await recordActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      fileBuffer: Buffer.from('deleted-user-fit'),
      provisional: true,
    });
    vi.clearAllMocks();
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({ shouldSkip: true });

    await rollbackActivitySyncOutboundFingerprint({
      userID: 'user-1',
      destinationServiceName: ServiceNames.WahooAPI,
      record: provisional,
    });

    expect(mocks.transaction.set).not.toHaveBeenCalled();
    expect(mocks.transaction.delete).not.toHaveBeenCalled();
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
