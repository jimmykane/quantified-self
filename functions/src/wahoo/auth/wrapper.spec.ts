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
    tokenQueryGet,
    tokenCollection,
    tokenRoot,
    rootCollection,
    firestoreCollection,
    firestore,
    setServiceConnectionProviderUserId: vi.fn(),
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public readonly code: string, message: string) {
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
}));

vi.mock('../../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  enforceAppCheck: mocks.enforceAppCheck,
  PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature.',
}));

vi.mock('../../service-oauth-access', () => ({
  hasServiceOAuthConnectAccess: vi.fn(),
}));

vi.mock('../../OAuth2', () => ({
  disconnectServiceForUser: vi.fn(),
  getAndSetServiceOAuth2AccessTokenForUser: vi.fn(),
  getServiceOAuth2CodeRedirectAndSaveStateToUser: vi.fn(),
  validateOAuth2State: vi.fn(),
}));

vi.mock('../../service-connection-meta', () => ({
  setServiceConnectionProviderUserId: mocks.setServiceConnectionProviderUserId,
}));

import { getWahooAPIConnectionAccount } from './wrapper';

describe('Wahoo Auth Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setServiceConnectionProviderUserId.mockResolvedValue(true);
    mocks.tokenQueryGet.mockResolvedValue({ docs: [] });
  });

  it('returns and safely mirrors only the Wahoo account ID for an authenticated user', async () => {
    mocks.tokenQueryGet.mockResolvedValue({
      docs: [{
        data: () => ({
          wahooUserID: ' 60462 ',
          accessToken: 'server-only-access-token',
          refreshToken: 'server-only-refresh-token',
        }),
      }],
    });

    await expect(getWahooAPIConnectionAccount({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
    } as any)).resolves.toEqual({ providerUserId: '60462' });

    expect(mocks.firestoreCollection).toHaveBeenCalledWith('wahooAPIAccessTokens');
    expect(mocks.setServiceConnectionProviderUserId).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.WahooAPI,
      '60462',
    );
  });

  it('does not disclose credentials when no Wahoo account ID is available', async () => {
    mocks.tokenQueryGet.mockResolvedValue({
      docs: [{ data: () => ({ accessToken: 'server-only-access-token' }) }],
    });

    await expect(getWahooAPIConnectionAccount({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
    } as any)).resolves.toEqual({ providerUserId: null });

    expect(mocks.setServiceConnectionProviderUserId).not.toHaveBeenCalled();
  });

  it('requires an authenticated user before reading the server-only token record', async () => {
    await expect(getWahooAPIConnectionAccount({ app: { appId: 'app-1' } } as any))
      .rejects.toThrow('User must be authenticated.');

    expect(mocks.tokenQueryGet).not.toHaveBeenCalled();
  });
});
