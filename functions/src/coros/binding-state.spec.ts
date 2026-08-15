import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tokenRef = { path: 'COROSAPIAccessTokens/user-1/tokens/open-id' };
  const metaRef = { path: 'users/user-1/meta/corosAPI' };
  const settingsRef = { path: 'users/user-1/config/settings' };
  const refs = new Map([
    [metaRef.path, metaRef],
    [settingsRef.path, settingsRef],
  ]);
  const doc = vi.fn((id: string) => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((documentID: string) => refs.get(`users/${id}/${collectionName}/${documentID}`)
        || { path: `users/${id}/${collectionName}/${documentID}` }),
    })),
  }));
  const collection = vi.fn((collectionName: string) => {
    if (collectionName !== 'users') throw new Error(`Unexpected collection ${collectionName}`);
    return { doc };
  });
  return {
    tokenRef,
    metaRef,
    settingsRef,
    collection,
    requestGet: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
    runTransaction: vi.fn(),
    getActiveCOROSTokenSnapshot: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    loggerWarn: vi.fn(),
  };
});

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: mocks.collection,
    runTransaction: mocks.runTransaction,
  }), {});
  return { default: { firestore }, firestore };
});

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: mocks.loggerWarn,
  error: vi.fn(),
}));

vi.mock('../request-helper', () => ({
  get: mocks.requestGet,
}));

vi.mock('./account', () => ({
  getActiveCOROSTokenSnapshot: mocks.getActiveCOROSTokenSnapshot,
  normalizeCOROSOpenId: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && !normalized.includes('/') ? normalized : null;
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super('Could not read deletion guard.');
    }
  },
}));

import {
  checkCOROSBindingStateForUser,
  handleCOROSBindingStateRequest,
} from './binding-state';

describe('COROS binding state', () => {
  let currentTokenData: Record<string, unknown>;
  let currentMetaData: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTokenData = { accessToken: 'stored-access-token', openId: 'open-id', dateCreated: 100 };
    currentMetaData = { connectionState: 'connected', providerUserId: 'open-id' };
    mocks.getActiveCOROSTokenSnapshot.mockResolvedValue({
      id: 'open-id',
      ref: mocks.tokenRef,
      exists: true,
      data: () => ({ accessToken: 'stored-access-token', openId: 'open-id', dateCreated: 100 }),
    });
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mocks.transactionGet.mockImplementation(async (ref: { path?: string }) => {
      if (ref === mocks.tokenRef) {
        return { exists: true, data: () => currentTokenData };
      }
      if (ref === mocks.metaRef) {
        return { exists: true, data: () => currentMetaData };
      }
      throw new Error(`Unexpected transaction ref ${ref?.path}`);
    });
    mocks.runTransaction.mockImplementation(async (runner: (transaction: unknown) => unknown) => runner({
      get: mocks.transactionGet,
      set: mocks.transactionSet,
    }));
  });

  it('records a current bound state without changing lifecycle or routes', async () => {
    mocks.requestGet.mockResolvedValue(JSON.stringify({
      result: '0000',
      message: 'OK',
      data: { bindState: 1 },
    }));

    await expect(checkCOROSBindingStateForUser('user-1', 1234)).resolves.toEqual({
      status: 'bound',
      bound: true,
      checkedAt: 1234,
    });

    expect(mocks.requestGet).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://open.coros.com/coros/bindState?token=stored-access-token&openId=open-id',
      headers: { token: 'stored-access-token' },
      timeout: 30_000,
    }));
    expect(mocks.transactionSet).toHaveBeenCalledTimes(1);
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.metaRef, {
      providerBindingState: 'bound',
      providerBindingCheckedAt: 1234,
    }, { merge: true });
  });

  it('atomically marks an unbound account for reconnect and disables every COROS sync route', async () => {
    mocks.requestGet.mockResolvedValue(JSON.stringify({
      result: '0000',
      data: { bindState: 0 },
    }));

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'unbound',
      bound: false,
      checkedAt: 5678,
    });

    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.metaRef, expect.objectContaining({
      connectionState: 'reconnect_required',
      providerBindingState: 'unbound',
      providerBindingCheckedAt: 5678,
      lastAuthFailureCode: 'coros_unbound',
      lastDisconnectedAt: 5678,
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(mocks.settingsRef, {
      serviceSyncSettings: {
        activitySyncRoutes: {
          COROSAPI_to_SuuntoApp: { enabled: false },
          COROSAPI_to_WahooAPI: { enabled: false },
          GarminAPI_to_COROSAPI: { enabled: false },
          SuuntoApp_to_COROSAPI: { enabled: false },
          WahooAPI_to_COROSAPI: { enabled: false },
        },
        routeDeliverySyncRoutes: {
          SuuntoApp_to_COROSAPI: { enabled: false },
        },
      },
    }, { merge: true });
  });

  it('ignores a provider result when the token changed before persistence', async () => {
    mocks.requestGet.mockResolvedValue('{"result":"0000","data":{"bindState":0}}');
    currentTokenData = { accessToken: 'new-access-token', openId: 'open-id' };

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'stale',
      bound: null,
    });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('ignores an unbound result from before a same-account OAuth reconnect', async () => {
    mocks.requestGet.mockResolvedValue('{"result":"0000","data":{"bindState":0}}');
    currentTokenData = {
      accessToken: 'stored-access-token',
      openId: 'open-id',
      dateCreated: 200,
    };

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).resolves.toEqual({
      status: 'stale',
      bound: null,
    });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('does not write after the deletion guard reports an inactive user', async () => {
    mocks.requestGet.mockResolvedValue('{"result":"0000","data":{"bindState":0}}');
    mocks.getUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await expect(checkCOROSBindingStateForUser('user-1', 5678)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('maps provider and malformed responses to retryable callable failures without writes', async () => {
    mocks.requestGet.mockRejectedValueOnce(Object.assign(new Error('network failed'), { statusCode: 503 }));
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.runTransaction).not.toHaveBeenCalled();

    mocks.requestGet.mockResolvedValueOnce('{"result":"0000","data":{"bindState":2}}');
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('does not trust a contradictory provider success message', async () => {
    mocks.requestGet.mockResolvedValueOnce(JSON.stringify({
      result: '0000',
      message: 'ERROR',
      data: { bindState: 0 },
    }));

    await expect(handleCOROSBindingStateRequest({ app: {}, auth: { uid: 'user-1' } }))
      .rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('requires authentication before contacting COROS', async () => {
    await expect(handleCOROSBindingStateRequest({ app: {}, auth: null }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.requestGet).not.toHaveBeenCalled();
  });
});
