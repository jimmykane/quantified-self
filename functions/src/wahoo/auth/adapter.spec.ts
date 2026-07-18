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
  }), {
    FieldValue: { serverTimestamp: () => 'server-timestamp' },
  }),
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

  it('requests only the read and offline scopes needed for activity import', () => {
    expect(adapter.serviceName).toBe(ServiceNames.WahooAPI);
    expect(adapter.oAuthScopes).toBe('user_read workouts_read offline_data');
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

    await expect(adapter.onTokenPersisted('current-user', '60462')).resolves.toEqual({
      previousOwnerUserID: 'previous-user',
    });
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
      updatedAt: 'server-timestamp',
    });
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
