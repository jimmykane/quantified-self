import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), deletion: vi.fn() }));
vi.mock('../connection', () => ({ readTrainingDeliveryAuthority: mocks.read }));
vi.mock('../../../tokens', () => ({ getTokenData: mocks.refresh }));
vi.mock('../../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.deletion }));
import { authorizeSuuntoGuideRequest } from './authorization';

describe('Suunto exact-account refresh fencing', () => {
  const operation = { destinationKey: 'destination', connectionGeneration: 'connection:root:retained' };
  const db = { runTransaction: (cb: (tx: unknown) => unknown) => cb({}) } as unknown as Firestore;
  const authority = () => ({ connection: { state: 'connected', destinationKey: 'destination', generation: operation.connectionGeneration },
    credentialGeneration: 'root', account: 'account', token: { ref: { path: 'tokens/account' }, data: () => ({ accessToken: 'fixture' }) } });
  beforeEach(() => {
    vi.clearAllMocks(); mocks.read.mockImplementation(async () => authority()); mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.refresh.mockResolvedValue({ accessToken: 'fixture', userName: 'account', expiresAt: Date.now() + 60_000 });
  });
  it('reuses OAuth and fences refresh by root revision, separately from retained token generation', async () => {
    expect(await authorizeSuuntoGuideRequest(db, 'uid', operation)).toEqual({ accessToken: 'fixture', account: 'account' });
    expect(mocks.refresh).toHaveBeenCalledWith(expect.anything(), ServiceNames.SuuntoApp, false, { opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: 'root' });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it.each(['account', 'generation', 'deletion', 'token', 'disconnect'])('rejects %s changing during refresh', async change => {
    mocks.refresh.mockImplementation(async () => {
      const changed = authority();
      if (change === 'account') changed.account = 'other';
      if (change === 'generation') changed.connection.generation = 'new';
      if (change === 'deletion') mocks.deletion.mockResolvedValue({ shouldSkip: true });
      if (change === 'token') changed.token.data = () => ({ accessToken: 'other' });
      if (change === 'disconnect') changed.connection.state = 'reconnect_required';
      mocks.read.mockResolvedValue(changed);
      return { accessToken: 'fixture', userName: 'account', expiresAt: Date.now() + 60_000 };
    });
    await expect(authorizeSuuntoGuideRequest(db, 'uid', operation)).rejects.toThrow();
  });
  it.each([undefined, NaN, Infinity, 0, '9999999999999'])('rejects malformed or expired credential expiry: %s', async expiresAt => {
    mocks.refresh.mockResolvedValue({ accessToken: 'fixture', userName: 'account', expiresAt });
    await expect(authorizeSuuntoGuideRequest(db, 'uid', operation)).rejects.toMatchObject({ kind: 'retryable' });
  });
});
