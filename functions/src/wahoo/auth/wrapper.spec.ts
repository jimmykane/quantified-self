import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const tokenQueryGet = vi.fn();
  const tokenCollection = {
    limit: vi.fn(() => ({ get: tokenQueryGet })),
  };
  const tokenRoot = {
    collection: vi.fn(() => tokenCollection),
  };
  const rootCollection = {
    doc: vi.fn(() => tokenRoot),
  };
  const firestoreCollection = vi.fn(() => rootCollection);
  const firestore = vi.fn(() => ({ collection: firestoreCollection }));
  return {
    enforceAppCheck: vi.fn(),
    hasServiceOAuthConnectAccess: vi.fn(),
    getAndSetServiceOAuth2AccessTokenForUser: vi.fn(),
    getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn(),
    disconnectServiceForUser: vi.fn(),
    validateOAuth2State: vi.fn(),
    getServiceConnectionMeta: vi.fn(),
    getActiveWahooTokenSnapshot: vi.fn(),
    tokenQueryGet,
    tokenCollection,
    tokenRoot,
    rootCollection,
    firestoreCollection,
    firestore,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

vi.mock('firebase-admin', () => ({
  default: { firestore: mocks.firestore },
  firestore: mocks.firestore,
}));

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  enforceAppCheck: mocks.enforceAppCheck,
  PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
}));

vi.mock('../../service-oauth-access', () => ({
  hasServiceOAuthConnectAccess: mocks.hasServiceOAuthConnectAccess,
}));

vi.mock('../../OAuth2', () => ({
  disconnectServiceForUser: mocks.disconnectServiceForUser,
  getAndSetServiceOAuth2AccessTokenForUser: mocks.getAndSetServiceOAuth2AccessTokenForUser,
  getServiceOAuth2CodeRedirectAndSaveStateToUser: mocks.getServiceOAuth2CodeRedirectAndSaveStateToUser,
  isOAuthFlowContextMismatchError: (error: unknown) => (error as { name?: string } | null)?.name === 'OAuthFlowContextMismatchError',
  isServiceDisconnectInProgressError: (error: unknown) => (error as { name?: string } | null)?.name === 'ServiceDisconnectInProgressError',
  validateOAuth2State: mocks.validateOAuth2State,
}));

vi.mock('../../service-connection-meta', () => ({
  getServiceConnectionMeta: mocks.getServiceConnectionMeta,
}));

vi.mock('../account', () => ({
  getActiveWahooTokenSnapshot: mocks.getActiveWahooTokenSnapshot,
  isWahooOAuthAccountMismatchError: (error: unknown) => (error as { name?: string } | null)?.name === 'WahooOAuthAccountMismatchError',
  normalizeWahooUserID: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null,
}));

import {
  deauthorizeWahooAPI,
  getWahooAPIConnectionAccount,
  requestAndSetWahooAPIAccessToken,
} from './wrapper';

describe('Wahoo Auth Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAndSetServiceOAuth2AccessTokenForUser.mockReset().mockResolvedValue(undefined);
    mocks.disconnectServiceForUser.mockReset().mockResolvedValue(undefined);
    mocks.getServiceConnectionMeta.mockResolvedValue(null);
    mocks.getActiveWahooTokenSnapshot.mockRejectedValue(new Error('No Wahoo account'));
    mocks.tokenQueryGet.mockResolvedValue({ docs: [] });
    mocks.hasServiceOAuthConnectAccess.mockResolvedValue(true);
    mocks.validateOAuth2State.mockResolvedValue(true);
  });

  it('passes the validated callback state into the atomic OAuth context claim', async () => {
    await expect(requestAndSetWahooAPIAccessToken({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {
        state: 'oauth-state',
        code: 'oauth-code',
        redirectUri: 'https://localhost/callback',
      },
    } as Parameters<typeof requestAndSetWahooAPIAccessToken>[0])).resolves.toBeUndefined();

    expect(mocks.getAndSetServiceOAuth2AccessTokenForUser).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
      'https://localhost/callback',
      'oauth-code',
      'oauth-state',
    );
  });

  it('reports an OAuth context race as an invalid state', async () => {
    mocks.getAndSetServiceOAuth2AccessTokenForUser.mockRejectedValue(
      Object.assign(new Error('stale callback'), { name: 'OAuthFlowContextMismatchError', statusCode: 403 }),
    );

    await expect(requestAndSetWahooAPIAccessToken({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {
        state: 'oauth-state',
        code: 'oauth-code',
        redirectUri: 'https://localhost/callback',
      },
    } as Parameters<typeof requestAndSetWahooAPIAccessToken>[0])).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Invalid OAuth state.',
    });
  });

  it('does not misreport a provider HTTP 403 as an invalid OAuth state', async () => {
    mocks.getAndSetServiceOAuth2AccessTokenForUser.mockRejectedValue(
      Object.assign(new Error('provider rejected code'), { statusCode: 403 }),
    );

    await expect(requestAndSetWahooAPIAccessToken({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {
        state: 'oauth-state',
        code: 'oauth-code',
        redirectUri: 'https://localhost/callback',
      },
    } as Parameters<typeof requestAndSetWahooAPIAccessToken>[0])).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'Wahoo rejected the authorization request.',
    });
  });

  it('returns only the pinned Wahoo account ID for an authenticated user', async () => {
    mocks.getServiceConnectionMeta.mockResolvedValue({ providerUserId: ' 60462 ' });

    await expect(getWahooAPIConnectionAccount({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
    } as any)).resolves.toEqual({ providerUserId: '60462' });

    expect(mocks.getActiveWahooTokenSnapshot).not.toHaveBeenCalled();
  });

  it('does not disclose credentials when no Wahoo account ID is available', async () => {
    await expect(getWahooAPIConnectionAccount({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
    } as any)).resolves.toEqual({ providerUserId: null });

    expect(mocks.getActiveWahooTokenSnapshot).toHaveBeenCalledWith('user-1');
  });

  it('requires an authenticated user before reading the server-only token record', async () => {
    await expect(getWahooAPIConnectionAccount({ app: { appId: 'app-1' } } as any))
      .rejects.toThrow('User must be authenticated.');

    expect(mocks.getServiceConnectionMeta).not.toHaveBeenCalled();
  });

  it('reports retryable Wahoo authorization failures as temporarily unavailable', async () => {
    mocks.getAndSetServiceOAuth2AccessTokenForUser.mockRejectedValue({ statusCode: 503 });

    await expect(requestAndSetWahooAPIAccessToken({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {
        state: 'oauth-state',
        code: 'oauth-code',
        redirectUri: 'https://localhost/callback',
      },
    } as Parameters<typeof requestAndSetWahooAPIAccessToken>[0])).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Wahoo is temporarily unavailable.',
    });
  });

  it('returns a retryable error when token refresh blocks disconnect', async () => {
    const details = {
      reason: 'service_disconnect_in_progress',
      blocker: 'token_refresh',
      retryAt: Date.now() + 1_000,
      retryDeadlineAt: Date.now() + 90_000,
    };
    mocks.disconnectServiceForUser.mockRejectedValue(
      Object.assign(new Error('Wahoo credentials are being refreshed.'), {
        name: 'ServiceDisconnectInProgressError',
        details,
      }),
    );

    await expect(deauthorizeWahooAPI({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
    } as any)).rejects.toMatchObject({
      code: 'unavailable',
      details,
    });
  });
});
