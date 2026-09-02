import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => {
  const rootsByCollection = new Map<string, Array<{ id: string }>>();
  const metaByPath = new Map<string, Record<string, unknown>>();
  const readProjection = vi.fn();
  const refreshProjection = vi.fn();
  const initializeApp = vi.fn();
  const adminApps: unknown[] = [{}];

  const collection = vi.fn((collectionName: string) => {
    let pageSize = 100;
    let startAfterId: string | null = null;
    const query = {
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn((value: number) => {
        pageSize = value;
        return query;
      }),
      startAfter: vi.fn((document: { id: string }) => {
        startAfterId = document.id;
        return query;
      }),
      get: vi.fn(async () => {
        const roots = rootsByCollection.get(collectionName) || [];
        const start = startAfterId
          ? Math.max(0, roots.findIndex(root => root.id === startAfterId) + 1)
          : 0;
        const docs = roots.slice(start, start + pageSize);
        return { docs, size: docs.length };
      }),
    };
    return query;
  });

  return {
    rootsByCollection,
    metaByPath,
    readProjection,
    refreshProjection,
    initializeApp,
    adminApps,
    collection,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = vi.fn(() => ({
    collection: hoisted.collection,
    doc: (path: string) => ({
      get: vi.fn(async () => ({ data: () => hoisted.metaByPath.get(path) })),
    }),
  }));
  Object.assign(firestore, {
    FieldPath: { documentId: () => '__name__' },
  });
  return {
    apps: hoisted.adminApps,
    initializeApp: hoisted.initializeApp,
    firestore,
  };
});

vi.mock('../service-connection-account-projection', () => ({
  projectionRevisionKeyFromMs: (timestampMs: number) => `revision:${timestampMs}`,
  getServiceConnectionProjectionConfig: (serviceName: ServiceNames) => ({
    tokenCollectionName: serviceName === ServiceNames.GarminAPI
      ? 'garminAPITokens'
      : serviceName === ServiceNames.SuuntoApp
        ? 'suuntoAppAccessTokens'
        : 'COROSAPIAccessTokens',
  }),
  readServiceConnectionAccountProjection: hoisted.readProjection,
  refreshServiceConnectionAccountProjection: hoisted.refreshProjection,
}));

import {
  parseServiceConnectionProjectionBackfillOptions,
  runServiceConnectionProjectionBackfill,
} from './backfill-service-connection-account-projections';

describe('service connection projection backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rootsByCollection.clear();
    hoisted.metaByPath.clear();
    hoisted.readProjection.mockResolvedValue([{ providerUserId: 'provider-user' }]);
    hoisted.refreshProjection.mockResolvedValue('updated');
  });

  it('defaults to a dry run across all supported providers', () => {
    expect(parseServiceConnectionProjectionBackfillOptions([])).toEqual({
      execute: false,
      pageSize: 100,
      services: [ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI],
    });
  });

  it('requires an explicit confirmation before applying writes', () => {
    expect(() => parseServiceConnectionProjectionBackfillOptions(['--execute']))
      .toThrow('Applying the backfill requires');
    expect(parseServiceConnectionProjectionBackfillOptions([
      '--execute',
      '--confirm=BACKFILL_CONNECTION_PROJECTIONS',
      '--services=suunto,garmin',
      '--page-size=25',
    ])).toEqual({
      execute: true,
      pageSize: 25,
      services: [ServiceNames.SuuntoApp, ServiceNames.GarminAPI],
    });
  });

  it('inspects every token root without writing during a dry run', async () => {
    hoisted.rootsByCollection.set('garminAPITokens', [
      { id: 'user-a' },
      { id: 'user-b' },
      { id: 'user-c' },
    ]);

    const summary = await runServiceConnectionProjectionBackfill([
      '--services=garmin',
      '--page-size=1',
    ], { db: {
      collection: hoisted.collection,
      doc: (path: string) => ({
        get: async () => ({
          data: () => path.includes('/user-a/')
            ? { connectionAccounts: [{ providerUserId: 'provider-user' }] }
            : path.includes('/user-c/')
              ? { connectionAccounts: [{ providerUserId: 'provider-user', accessToken: 'must-be-removed' }] }
              : undefined,
        }),
      }),
    } as never, revisionAtMs: 1234 });

    expect(summary).toMatchObject({
      dryRun: true,
      rootsScanned: 3,
      accountsProjected: 3,
      wouldUpdate: 2,
      unchanged: 1,
      updated: 0,
      failed: 0,
    });
    expect(hoisted.readProjection).toHaveBeenCalledTimes(3);
    expect(hoisted.refreshProjection).not.toHaveBeenCalled();
  });

  it('records updated, stale, deleted-user, and failed apply outcomes opaquely', async () => {
    hoisted.rootsByCollection.set('suuntoAppAccessTokens', [
      { id: 'user-a' },
      { id: 'user-b' },
      { id: 'user-c' },
      { id: 'user-d' },
    ]);
    hoisted.refreshProjection
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('deleted-user')
      .mockRejectedValueOnce(new Error('failure'));

    const summary = await runServiceConnectionProjectionBackfill([
      '--execute',
      '--confirm=BACKFILL_CONNECTION_PROJECTIONS',
      '--services=suunto',
    ], { db: { collection: hoisted.collection } as never, revisionAtMs: 5678 });

    expect(summary).toMatchObject({
      dryRun: false,
      rootsScanned: 4,
      accountsProjected: 4,
      updated: 1,
      skippedStale: 1,
      skippedDeletedUser: 1,
      failed: 1,
    });
  });
});
