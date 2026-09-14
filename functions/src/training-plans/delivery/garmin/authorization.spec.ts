import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { DeliveryOperation } from '../contracts';
import type { DeliveryConnection } from '../contracts';
const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), deletion: vi.fn() }));
vi.mock('../connection', () => ({ readTrainingDeliveryAuthority: mocks.read, GARMIN_TRAINING_PERMISSION_ISSUE: 'Workout Import required' }));
vi.mock('../../../tokens', () => ({ getTokenData: mocks.refresh }));
vi.mock('../../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: mocks.deletion }));
import { authorizeGarminTrainingRequest } from './authorization';

describe('Garmin delivery credential binding', () => {
  const operation = { destinationKey: 'destination', connectionGeneration: 'connection:credential' } as DeliveryOperation;
  const db = { runTransaction: (callback: (tx: unknown) => unknown) => callback({}) } as unknown as Firestore;
  let authority: { connection: DeliveryConnection; account: string; credentialGeneration: string;
    token: { ref: { path: string }; data: () => { accessToken: string } } };
  beforeEach(() => {
    vi.clearAllMocks();
    authority = { connection: { state: 'connected', destinationKey: 'destination', generation: 'connection:credential', epoch: 0 },
      account: 'fixture-account', credentialGeneration: 'credential', token: { ref: { path: 'fixture/token' }, data: () => ({ accessToken: 'fixture-token' }) } };
    mocks.read.mockImplementation(async () => authority);
    mocks.deletion.mockResolvedValue({ shouldSkip: false });
    mocks.refresh.mockResolvedValue({ accessToken: 'fixture-token', userID: 'fixture-account', expiresAt: Date.now() + 60_000 });
  });
  it('uses the shared generation-fenced refresh path and rereads authority after refresh', async () => {
    expect(await authorizeGarminTrainingRequest(db, 'fixture-uid', operation)).toBe('fixture-token');
    expect(mocks.refresh).toHaveBeenCalledWith(authority.token, ServiceNames.GarminAPI, false, {
      opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: 'credential',
    });
    expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.deletion).toHaveBeenCalledTimes(2);
  });
  it.each(['account', 'generation', 'deletion', 'permission', 'token'])('rejects %s changing during refresh', async change => {
    mocks.refresh.mockImplementation(async () => {
      if (change === 'account') authority = { ...authority, account: 'different-account' };
      if (change === 'generation') authority = { ...authority, connection: { ...authority.connection, generation: 'replacement' } };
      if (change === 'deletion') mocks.deletion.mockResolvedValue({ shouldSkip: true });
      if (change === 'permission') authority = { ...authority, connection: { ...authority.connection, issues: ['Workout Import required'] } };
      if (change === 'token') authority = { ...authority, token: { ...authority.token, data: () => ({ accessToken: 'another-token' }) } };
      return { accessToken: 'fixture-token', userID: 'fixture-account', expiresAt: Date.now() + 60_000 };
    });
    await expect(authorizeGarminTrainingRequest(db, 'fixture-uid', operation)).rejects.toThrow();
  });
  it('blocks missing permission before token use and sanitizes refresh errors', async () => {
    authority.connection.issues = ['Workout Import required'];
    await expect(authorizeGarminTrainingRequest(db, 'fixture-uid', operation)).rejects.toMatchObject({ kind: 'permission' });
    expect(mocks.refresh).not.toHaveBeenCalled();
    delete authority.connection.issues;
    mocks.refresh.mockRejectedValue(new Error('private-token-provider-body'));
    await expect(authorizeGarminTrainingRequest(db, 'fixture-uid', operation)).rejects.toMatchObject({ kind: 'retryable', message: 'retryable' });
  });
});
