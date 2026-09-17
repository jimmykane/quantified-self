import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { DeliveryConnection } from '../contracts';
import { WAHOO_TRAINING_PERMISSION_ISSUE } from '../../../../../shared/wahoo-training';
import { WahooRefreshBackoffError, WahooReconnectRequiredError, WahooCredentialSupersededError } from '../../../wahoo/refresh-recovery';
const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), deletion: vi.fn(), capture: vi.fn(), assert: vi.fn() }));
vi.mock('../connection', () => ({ readTrainingDeliveryAuthority: mocks.read }));
vi.mock('../../../tokens', () => ({ getTokenData: mocks.refresh }));
vi.mock('../../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.deletion }));
vi.mock('../../../wahoo/account', () => ({ captureWahooActiveAccountGuard: mocks.capture, assertWahooActiveAccountGuardCurrent: mocks.assert }));
import { authorizeWahooTrainingRequest } from './authorization';

describe('Wahoo Training credential lifecycle', () => {
  const operation = { destinationKey: 'destination', connectionGeneration: 'generation' };
  const db = { runTransaction: (callback: (tx: unknown) => unknown) => callback({}) } as unknown as Firestore;
  let authority: { connection: DeliveryConnection; account: string; credentialGeneration: string;
    token: { ref: { path: string }; data: () => { accessToken: string } } };
  beforeEach(() => {
    vi.resetAllMocks();
    authority = { connection: { state: 'connected', destinationKey: 'destination', generation: 'generation', epoch: 0 },
      account: '123', credentialGeneration: 'credential', token: { ref: { path: 'tokens/123' }, data: () => ({ accessToken: 'fixture-token' }) } };
    mocks.read.mockImplementation(async () => authority);
    mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.refresh.mockResolvedValue({ accessToken: 'fixture-token', wahooUserID: '123', expiresAt: Date.now() + 60_000 });
    mocks.capture.mockResolvedValue({ providerUserId: '123' });
  });
  it('refreshes through the existing Wahoo lease and rechecks account plus credential immediately before I/O', async () => {
    const authorized = await authorizeWahooTrainingRequest(db, 'uid', operation);
    expect(authorized).toMatchObject({ accessToken: 'fixture-token', account: '123' });
    expect(mocks.refresh).toHaveBeenCalledWith(authority.token, ServiceNames.WahooAPI, false, {
      opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: 'credential',
    });
    await authorized.assertCurrent();
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.capture).toHaveBeenCalledWith('uid', '123', 'fixture-token');
    expect(mocks.assert).toHaveBeenCalledWith('uid', { providerUserId: '123' });
  });
  it.each(['account', 'generation', 'deletion', 'permission', 'token'])('rejects %s changing during refresh', async change => {
    mocks.refresh.mockImplementation(async () => {
      if (change === 'account') authority = { ...authority, account: '456' };
      if (change === 'generation') authority = { ...authority, connection: { ...authority.connection, generation: 'new' } };
      if (change === 'deletion') mocks.deletion.mockResolvedValue({ shouldSkip: true });
      if (change === 'permission') authority.connection.issues = [WAHOO_TRAINING_PERMISSION_ISSUE];
      if (change === 'token') authority.token.data = () => ({ accessToken: 'replacement' });
      return { accessToken: 'fixture-token', wahooUserID: '123', expiresAt: Date.now() + 60_000 };
    });
    await expect(authorizeWahooTrainingRequest(db, 'uid', operation)).rejects.toThrow();
  });
  it('does not refresh when Training grants are missing', async () => {
    authority.connection.issues = [WAHOO_TRAINING_PERMISSION_ISSUE];
    await expect(authorizeWahooTrainingRequest(db, 'uid', operation)).rejects.toMatchObject({ kind: 'permission' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('retains opaque refresh cooldowns without exposing the exception', async () => {
    mocks.refresh.mockRejectedValue(new WahooRefreshBackoffError(Date.now() + 60_000));
    await expect(authorizeWahooTrainingRequest(db, 'uid', operation)).rejects.toMatchObject({ kind: 'deferred', message: 'deferred' });
    mocks.refresh.mockRejectedValue(new WahooReconnectRequiredError());
    await expect(authorizeWahooTrainingRequest(db, 'uid', operation)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('treats access-token rotation after preparation as retryable, not revoked consent', async () => {
    const authorized = await authorizeWahooTrainingRequest(db, 'uid', operation);
    mocks.assert.mockRejectedValue(new WahooCredentialSupersededError());
    await expect(authorized.assertCurrent()).rejects.toMatchObject({ kind: 'retryable' });
    mocks.assert.mockRejectedValue(new Error('private-provider-response'));
    await expect(authorized.assertCurrent()).rejects.toMatchObject({ message: 'retryable' });
  });
});
