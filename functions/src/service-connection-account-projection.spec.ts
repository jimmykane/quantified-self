import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const deletionGuard = vi.hoisted(() => vi.fn(async () => ({
  userExists: true,
  deletionInProgress: false,
  shouldSkip: false,
})));

vi.mock('./shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: deletionGuard,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

import {
  buildServiceConnectionAccountProjection,
  projectionRevisionKeyFromEventTime,
  projectionRevisionKeyFromMs,
  readServiceConnectionAccountProjection,
  refreshServiceConnectionAccountProjection,
} from './service-connection-account-projection';

function snapshot(id: string, data: Record<string, unknown>) {
  return { id, data: () => data } as never;
}

describe('service connection account projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletionGuard.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('projects only browser-safe Garmin account fields', () => {
    const result = buildServiceConnectionAccountProjection(ServiceNames.GarminAPI, [snapshot('token-1', {
      userID: 'garmin-user',
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      credentialGeneration: 'secret-generation',
      dateCreated: 1_700_000_000_000,
      permissions: ['COURSE_IMPORT', 'HEALTH_EXPORT', 'COURSE_IMPORT', 42],
      permissionsLastChangedAt: 1_700_000_000,
    })]);

    expect(result).toEqual([{
      providerUserId: 'garmin-user',
      connectedAtMs: 1_700_000_000_000,
      permissions: ['COURSE_IMPORT', 'HEALTH_EXPORT'],
      permissionsUpdatedAtMs: 1_700_000_000_000,
    }]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('normalizes Suunto and COROS identities without copying token payloads', () => {
    expect(buildServiceConnectionAccountProjection(ServiceNames.SuuntoApp, [snapshot('suunto-token', {
      userName: 'suunto-user',
      accessToken: 'secret',
      dateCreated: { toMillis: () => 1234 },
    })])).toEqual([{ providerUserId: 'suunto-user', connectedAtMs: 1234 }]);

    expect(buildServiceConnectionAccountProjection(ServiceNames.COROSAPI, [snapshot('coros-token', {
      openId: 'coros-user',
      refreshToken: 'secret',
      dateCreated: new Date(5678),
    })])).toEqual([{ providerUserId: 'coros-user', connectedAtMs: 5678 }]);
  });

  it('drops malformed identities and deterministically deduplicates accounts', () => {
    const result = buildServiceConnectionAccountProjection(ServiceNames.GarminAPI, [
      snapshot('newer', { userID: 'same-user', dateCreated: 200, permissions: ['COURSE_IMPORT'] }),
      snapshot('older', { userID: 'same-user', dateCreated: 100, permissions: [] }),
      snapshot('missing', { accessToken: 'secret' }),
      snapshot('oversized', { userID: 'x'.repeat(513), accessToken: 'secret' }),
    ]);

    expect(result).toEqual([{
      providerUserId: 'same-user',
      connectedAtMs: 200,
      permissions: ['COURSE_IMPORT'],
    }]);
  });

  it('deterministically bounds oversized retained account sets', async () => {
    const tokenChildren = Array.from({ length: 33 }, (_, index) => snapshot(
      `token-${`${index}`.padStart(2, '0')}`,
      { userID: `garmin-user-${index}` },
    ));
    const orderBy = vi.fn();
    const limit = vi.fn((maximum: number) => ({
      get: vi.fn(async () => ({ docs: tokenChildren.slice(0, maximum) })),
    }));
    orderBy.mockReturnValue({ limit });
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({ exists: true })),
          collection: vi.fn(() => ({ orderBy })),
        })),
      })),
    };

    const result = await readServiceConnectionAccountProjection({
      db: db as never,
      userID: 'user-1',
      serviceName: ServiceNames.GarminAPI,
    });

    expect(result).toHaveLength(32);
    expect(result[0]).toEqual({ providerUserId: 'garmin-user-0' });
    expect(result.map(account => account.providerUserId)).toContain('garmin-user-31');
    expect(result.map(account => account.providerUserId)).not.toContain('garmin-user-32');
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(32);
  });

  it('writes the exact safe projection when the event revision is current', async () => {
    const transactionSet = vi.fn();
    const metaRef = { path: 'users/user-1/meta/Garmin API' };
    const tokenChildren = [snapshot('token-1', {
      userID: 'garmin-user',
      accessToken: 'secret',
      permissions: ['HEALTH_EXPORT'],
    })];
    const db = {
      collection: vi.fn((collectionName: string) => ({
        doc: vi.fn((documentID: string) => {
          if (collectionName === 'garminAPITokens') {
            return {
              get: vi.fn(async () => ({ exists: true })),
              collection: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(() => ({ get: vi.fn(async () => ({ docs: tokenChildren })) })),
                })),
              })),
            };
          }
          expect(collectionName).toBe('users');
          expect(documentID).toBe('user-1');
          return { collection: vi.fn(() => ({ doc: vi.fn(() => metaRef) })) };
        }),
      })),
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        get: vi.fn(async () => ({ data: () => ({ connectionAccountsRevisionKey: projectionRevisionKeyFromMs(100) }) })),
        set: transactionSet,
      })),
    };

    await expect(refreshServiceConnectionAccountProjection({
      db: db as never,
      userID: 'user-1',
      serviceName: ServiceNames.GarminAPI,
      revisionKey: projectionRevisionKeyFromMs(101),
    })).resolves.toBe('updated');
    expect(transactionSet).toHaveBeenCalledWith(metaRef, {
      connectionAccounts: [{
        providerUserId: 'garmin-user',
        permissions: ['HEALTH_EXPORT'],
      }],
      connectionAccountsRevisionKey: projectionRevisionKeyFromMs(101),
    }, { merge: true });
    expect(JSON.stringify(transactionSet.mock.calls)).not.toContain('secret');
  });

  it('does not recreate projection state for a deleting user', async () => {
    deletionGuard.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });
    const transactionSet = vi.fn();
    const db = {
      collection: vi.fn((collectionName: string) => ({
        doc: vi.fn(() => collectionName === 'users'
          ? { collection: vi.fn(() => ({ doc: vi.fn(() => ({})) })) }
          : {
            get: vi.fn(async () => ({ exists: true })),
            collection: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
              })),
            })),
          }),
      })),
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        get: vi.fn(),
        set: transactionSet,
      })),
    };

    await expect(refreshServiceConnectionAccountProjection({
      db: db as never,
      userID: 'user-1',
      serviceName: ServiceNames.SuuntoApp,
      revisionKey: projectionRevisionKeyFromMs(101),
    })).resolves.toBe('deleted-user');
    expect(transactionSet).not.toHaveBeenCalled();
  });

  it('rejects an out-of-order projection event', async () => {
    const transactionSet = vi.fn();
    const db = {
      collection: vi.fn((collectionName: string) => ({
        doc: vi.fn(() => collectionName === 'users'
          ? { collection: vi.fn(() => ({ doc: vi.fn(() => ({})) })) }
          : {
            get: vi.fn(async () => ({ exists: true })),
            collection: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
              })),
            })),
          }),
      })),
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        get: vi.fn(async () => ({ data: () => ({ connectionAccountsRevisionKey: projectionRevisionKeyFromMs(102) }) })),
        set: transactionSet,
      })),
    };

    await expect(refreshServiceConnectionAccountProjection({
      db: db as never,
      userID: 'user-1',
      serviceName: ServiceNames.COROSAPI,
      revisionKey: projectionRevisionKeyFromMs(101),
    })).resolves.toBe('stale');
    expect(transactionSet).not.toHaveBeenCalled();
  });

  it('orders distinct writes within the same millisecond at nanosecond precision', () => {
    expect(
      projectionRevisionKeyFromEventTime('2026-09-02T09:00:00.123456700Z')
      > projectionRevisionKeyFromEventTime('2026-09-02T09:00:00.123456699Z'),
    ).toBe(true);
  });
});
