import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceConnectionMeta } from '../service-connection-meta';
import { getServiceTokenRootDocumentRef } from '../service-token-store';
import { isSuuntoImportDisconnected } from './disconnected-import';

vi.mock('../service-connection-meta', () => ({ getServiceConnectionMeta: vi.fn() }));
vi.mock('../service-token-store', () => ({ getServiceTokenRootDocumentRef: vi.fn() }));

describe('confirmed Suunto import disconnect', () => {
  const disconnectedMeta = {
    connectionStateGeneration: 'cleared-generation',
    connectionAccountsRevisionKey: 'empty-accounts-revision',
    connectionAccounts: [],
  };
  const query = { select: vi.fn(), limit: vi.fn(), get: vi.fn() };
  const root = { collection: vi.fn(), get: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServiceConnectionMeta).mockResolvedValue(disconnectedMeta);
    vi.mocked(getServiceTokenRootDocumentRef).mockReturnValue(root as never);
    root.collection.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.get.mockResolvedValue({ empty: true });
  });

  it('accepts a cleared lifecycle and revisioned empty projection only with no remaining credentials', async () => {
    await expect(isSuuntoImportDisconnected('owner')).resolves.toBe(true);
    expect(getServiceConnectionMeta).toHaveBeenCalledWith('owner', ServiceNames.SuuntoApp);
    expect(getServiceTokenRootDocumentRef).toHaveBeenCalledWith('owner', ServiceNames.SuuntoApp);
    expect(root.collection).toHaveBeenCalledWith('tokens');
    expect(query.select).toHaveBeenCalledWith();
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(root.get).not.toHaveBeenCalled();
  });

  it.each([
    null, {},
    { ...disconnectedMeta, connectionState: 'connected' },
    { ...disconnectedMeta, connectionState: 'reconnect_required' },
    { ...disconnectedMeta, connectionState: 'disconnect_pending' },
    { ...disconnectedMeta, connectionStateGeneration: undefined },
    { ...disconnectedMeta, connectionStateGeneration: ' ' },
    { ...disconnectedMeta, connectionStateGeneration: 42 },
    { ...disconnectedMeta, connectionAccountsRevisionKey: undefined },
    { ...disconnectedMeta, connectionAccountsRevisionKey: ' ' },
    { ...disconnectedMeta, connectionAccountsRevisionKey: 42 },
    { ...disconnectedMeta, connectionAccounts: undefined },
    { ...disconnectedMeta, connectionAccounts: [{ providerUserId: 'another-account' }] },
  ])('does not infer a disconnect from unknown or inconsistent metadata: %j', async meta => {
    vi.mocked(getServiceConnectionMeta).mockResolvedValue(meta as never);
    await expect(isSuuntoImportDisconnected('owner')).resolves.toBe(false);
    expect(getServiceTokenRootDocumentRef).not.toHaveBeenCalled();
  });

  it('rejects an empty projection when another credential still exists', async () => {
    query.get.mockResolvedValue({ empty: false });
    await expect(isSuuntoImportDisconnected('owner')).resolves.toBe(false);
  });

  it.each(['metadata', 'credentials'])('propagates %s read failures instead of inventing a disconnect', async stage => {
    const error = new Error('temporary Firestore failure');
    if (stage === 'metadata') vi.mocked(getServiceConnectionMeta).mockRejectedValueOnce(error);
    else query.get.mockRejectedValueOnce(error);
    await expect(isSuuntoImportDisconnected('owner')).rejects.toBe(error);
  });
});
