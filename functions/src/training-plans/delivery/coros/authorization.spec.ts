import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({
  getTokenData: vi.fn(),
  deletion: vi.fn(),
  authority: vi.fn(),
}));

vi.mock('../../../tokens', () => ({ getTokenData: mocks.getTokenData }));
vi.mock('../../../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletion,
}));
vi.mock('../connection', () => ({ readTrainingDeliveryAuthority: mocks.authority }));

import { authorizeCorosTrainingRequest } from './authorization';

describe('COROS Training request authority', () => {
  const token = (accessToken = 'access') => ({
    id: 'account',
    ref: { path: 'COROSAPIAccessTokens/user/tokens/account' },
    data: () => ({ accessToken }),
  });
  const connected = (generation = 'connection::', currentToken = token()) => ({
    account: 'account',
    credentialGeneration: '',
    token: currentToken,
    connection: { state: 'connected', destinationKey: 'destination', generation, epoch: 1 },
  });
  const db = { runTransaction: async (callback: (tx: unknown) => unknown) => callback({}) } as unknown as Firestore;
  const operation = { destinationKey: 'destination', connectionGeneration: 'connection::' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.authority.mockResolvedValue(connected());
    mocks.getTokenData.mockResolvedValue({ accessToken: 'access', openId: 'account', expiresAt: Date.now() + 60_000 });
  });

  it('accepts the exact account when both credential generations are absent', async () => {
    await expect(authorizeCorosTrainingRequest(db, 'user', operation)).resolves.toEqual({
      accessToken: 'access', account: 'account',
    });
    expect(mocks.getTokenData).toHaveBeenCalledWith(expect.anything(), expect.anything(), false,
      expect.objectContaining({ opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: null }));
  });

  it('passes a present generation through coordinated refresh fencing', async () => {
    mocks.authority.mockResolvedValue({ ...connected('connection:root:root'), credentialGeneration: 'root' });
    await authorizeCorosTrainingRequest(db, 'user', {
      destinationKey: 'destination', connectionGeneration: 'connection:root:root',
    });
    expect(mocks.getTokenData).toHaveBeenCalledWith(expect.anything(), expect.anything(), false,
      expect.objectContaining({ expectedActiveOAuthCredentialGeneration: 'root' }));
  });

  it('fails closed when the account authority changes during refresh', async () => {
    mocks.authority.mockResolvedValueOnce(connected()).mockResolvedValueOnce({
      ...connected('changed::'), account: 'changed-account',
    });
    await expect(authorizeCorosTrainingRequest(db, 'user', operation)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('maps terminal refresh rejection to reconnect and transient failure to retry', async () => {
    mocks.getTokenData.mockRejectedValueOnce(Object.assign(new Error('redacted'), { name: 'TerminalServiceAuthError' }));
    await expect(authorizeCorosTrainingRequest(db, 'user', operation)).rejects.toMatchObject({ kind: 'auth' });
    mocks.getTokenData.mockRejectedValueOnce(new Error('network'));
    await expect(authorizeCorosTrainingRequest(db, 'user', operation)).rejects.toMatchObject({ kind: 'retryable' });
  });

  it('fences account deletion before token use', async () => {
    mocks.deletion.mockResolvedValue({ shouldSkip: true });
    await expect(authorizeCorosTrainingRequest(db, 'user', operation)).rejects.toMatchObject({ kind: 'auth' });
    expect(mocks.getTokenData).not.toHaveBeenCalled();
  });
});
