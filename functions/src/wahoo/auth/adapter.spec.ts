import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { WahooAuthAdapter } from './adapter';
import * as api from './api';

const firestoreMocks = vi.hoisted(() => {
  const mappingRef = { id: '60462', path: 'wahooAPIUserMappings/60462' };
  const transactionGet = vi.fn();
  const transactionSet = vi.fn();
  return {
    mappingRef,
    transactionGet,
    transactionSet,
    runTransaction: vi.fn(async (runner: any) => runner({
      get: transactionGet,
      set: transactionSet,
    })),
  };
});

const deletionGuardMocks = vi.hoisted(() => ({
  getStateInTransaction: vi.fn(),
}));

const firestoreFieldValueMocks = vi.hoisted(() => ({
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}));

vi.mock('./api');
vi.mock('./auth', () => ({ WahooAPIAuth: vi.fn() }));
vi.mock('../../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: deletionGuardMocks.getStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({
    collection: () => ({ doc: () => firestoreMocks.mappingRef }),
    collectionGroup: () => ({ where: () => ({ where: () => ({}) }) }),
    runTransaction: firestoreMocks.runTransaction,
  }), {}),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: firestoreFieldValueMocks.serverTimestamp,
  },
}));

describe('WahooAuthAdapter', () => {
  let adapter: WahooAuthAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    deletionGuardMocks.getStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    adapter = new WahooAuthAdapter();
  });

  it('requests activity, route, and offline scopes needed for Wahoo imports and delivery', () => {
    expect(adapter.serviceName).toBe(ServiceNames.WahooAPI);
    expect(adapter.oAuthScopes).toBe('user_read workouts_read workouts_write routes_read routes_write offline_data');
  });

  it('resolves and stores the Wahoo user id', async () => {
    vi.mocked(api.getWahooUserID).mockResolvedValue('60462');
    const processed = await adapter.processNewToken({ token: { access_token: 'access' } } as any);
    const stored = adapter.convertTokenResponse({
      token: {
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'bearer',
        expires_in: 7200,
      },
    } as any, processed.uniqueId);

    expect(api.getWahooUserID).toHaveBeenCalledWith('access');
    expect(stored.wahooUserID).toBe('60462');
    expect(stored.refreshToken).toBe('refresh');
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + 7_000_000);
  });

  it('deauthorizes through the permissions endpoint helper', async () => {
    await adapter.deauthorize({ accessToken: 'access' } as any);
    expect(api.deauthorizeWahooUser).toHaveBeenCalledWith('access');
  });

  it('atomically transfers the webhook mapping and reports the prior owner for local cleanup', async () => {
    firestoreMocks.transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ firebaseUserID: 'previous-user' }),
    });

    const persistedIdentity = await adapter.onTokenPersisted('current-user', '60462');

    expect(persistedIdentity.previousOwnerUserID).toBe('previous-user');
    expect(persistedIdentity.previousOwnerTokenCleanupGuard).toEqual(expect.any(Function));
    expect(adapter.managesDuplicateConnections).toBe(true);
    expect(deletionGuardMocks.getStateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'current-user',
    );
    expect(firestoreMocks.transactionSet).toHaveBeenCalledWith(firestoreMocks.mappingRef, {
      firebaseUserID: 'current-user',
      wahooUserID: '60462',
      serviceName: ServiceNames.WahooAPI,
      ownershipVersion: 1,
      updatedAt: 'server-timestamp',
    });
  });

  it('only permits duplicate-owner cleanup while this callback still owns the same mapping version', async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ firebaseUserID: 'previous-user', ownershipVersion: 4 }),
    });

    const persistedIdentity = await adapter.onTokenPersisted('current-user', '60462');
    const guard = persistedIdentity.previousOwnerTokenCleanupGuard;
    if (!guard) throw new Error('Expected duplicate cleanup guard.');

    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ firebaseUserID: 'newer-owner', ownershipVersion: 6 }),
      }),
    } as any;
    await expect(guard(transaction)).resolves.toBe(false);

    transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ firebaseUserID: 'current-user', ownershipVersion: 5 }),
    });
    await expect(guard(transaction)).resolves.toBe(true);
  });

  it('keeps a transfer cleanup guard valid when the new owner reconnects', async () => {
    firestoreMocks.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ firebaseUserID: 'previous-user', ownershipVersion: 4 }),
    });
    const persistedIdentity = await adapter.onTokenPersisted('current-user', '60462');
    const guard = persistedIdentity.previousOwnerTokenCleanupGuard;
    if (!guard) throw new Error('Expected duplicate cleanup guard.');

    firestoreMocks.transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ firebaseUserID: 'current-user', ownershipVersion: 5 }),
    });
    await expect(adapter.onTokenPersisted('current-user', '60462')).resolves.toEqual({});
    expect(firestoreMocks.transactionSet).toHaveBeenLastCalledWith(firestoreMocks.mappingRef, expect.objectContaining({
      firebaseUserID: 'current-user',
      ownershipVersion: 5,
    }));

    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ firebaseUserID: 'current-user', ownershipVersion: 5 }),
      }),
    } as any;
    await expect(guard(transaction)).resolves.toBe(true);
  });

  it('does not create or transfer a webhook mapping after account deletion begins', async () => {
    deletionGuardMocks.getStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    await expect(adapter.onTokenPersisted('current-user', '60462')).rejects.toThrow(
      'account deletion is in progress',
    );
    expect(firestoreMocks.transactionGet).not.toHaveBeenCalled();
    expect(firestoreMocks.transactionSet).not.toHaveBeenCalled();
  });
});
