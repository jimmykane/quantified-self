import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ list: vi.fn(), enqueue: vi.fn(), get: vi.fn(), set: vi.fn(),
  before: vi.fn(), guard: vi.fn(), meta: {} as Record<string, unknown>, token: {} as Record<string, unknown> }));
vi.mock('./routes', () => ({ listSuuntoRoutes: mocks.list }));
vi.mock('../routes/route-sync-queue', () => ({ enqueueRouteSyncQueueItem: mocks.enqueue }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: (path: string) => ({ path, id: 'selected-account', get: mocks.get }),
  runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ get: async () => ({ data: () => mocks.meta }), set: mocks.set }) }) }));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSuuntoRouteImportSourceKeyFromTokenLike } from '../../../shared/suunto-route-import-state';
import type { HistoryExecution } from '../connection-history/execution';
import { queueSuuntoRouteHistory } from './route-history';
const execution = { userID: 'owner', serviceName: ServiceNames.SuuntoApp, tokenPath: 'suuntoAppAccessTokens/owner/tokens/selected-account', providerUserId: 'selected-account',
  beforeRequest: mocks.before, inTransaction: mocks.guard } as unknown as HistoryExecution;
const route = (id: number) => ({ id: `route-${String(id).padStart(4, '0')}`, providerUserId: execution.providerUserId,
  providerSourceKey: getSuuntoRouteImportSourceKeyFromTokenLike(mocks.token)!, created: 0 });
function listing(count: number) {
  return { routes: Array.from({ length: count }, (_, i) => route(i)).reverse(),
    successfulProviderSourceKeys: [getSuuntoRouteImportSourceKeyFromTokenLike(mocks.token)], failedProviderSourceKeys: [] };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.before.mockResolvedValue(undefined); mocks.guard.mockResolvedValue(undefined);
  mocks.token = { userName: 'selected-account', dateCreated: 1000 }; mocks.meta = {};
  mocks.get.mockResolvedValue({ exists: true, id: 'selected-account', ref: { path: execution.tokenPath }, data: () => mocks.token });
  mocks.enqueue.mockResolvedValue({ enqueued: true }); mocks.list.mockResolvedValue(listing(1));
});
describe('connection route library admission', () => {
  it('reads only the exact connected account, keeps ancient routes and bounds the request', async () => {
    expect(await queueSuuntoRouteHistory('owner', execution)).toEqual({ count: 1, hasMore: false, afterRouteId: 'route-0000' });
    expect(mocks.list).toHaveBeenCalledWith('owner', expect.objectContaining({ tokenRefs: [expect.objectContaining({
      providerUserId: 'selected-account', ref: { path: execution.tokenPath } })] }), { timeout: 30_000, maxResponseBytes: 4 * 1024 * 1024 });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ providerRouteCreatedAt: 0,
      providerRouteId: 'route-0000', providerUserId: 'selected-account', firebaseUserID: 'owner', manual: true }));
    expect(mocks.guard).toHaveBeenCalledTimes(1);
  });
  it('admits at most 100 children and resumes by route ID despite provider order or earlier removals', async () => {
    mocks.list.mockResolvedValueOnce(listing(205));
    expect(await queueSuuntoRouteHistory('owner', execution)).toEqual({ count: 100, hasMore: true, afterRouteId: 'route-0099' });
    expect(mocks.enqueue).toHaveBeenCalledTimes(100); expect(mocks.set).not.toHaveBeenCalled();
    const remaining = listing(205); remaining.routes = remaining.routes.filter(item => item.id > 'route-0020');
    mocks.list.mockResolvedValueOnce(remaining); mocks.enqueue.mockClear();
    expect(await queueSuuntoRouteHistory('owner', execution, 'route-0099', 100)).toEqual({ count: 100, hasMore: true, afterRouteId: 'route-0199' });
    expect(mocks.enqueue.mock.calls[0][0].providerRouteId).toBe('route-0100');
  });
  it('keeps other account markers and records final admission without claiming worker completion', async () => {
    mocks.meta = { routeImportStatesByProviderSourceKey: [{ sourceKey: 'other', providerUserId: 'other', didLastRouteImport: 1 }] };
    mocks.list.mockResolvedValue(listing(105));
    await queueSuuntoRouteHistory('owner', execution, 'route-0099', 100);
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), { routeImportStatesByProviderSourceKey: [
      { sourceKey: 'other', providerUserId: 'other', didLastRouteImport: 1 },
      expect.objectContaining({ queuedCount: 105, totalCount: 105, sourceKey: getSuuntoRouteImportSourceKeyFromTokenLike(mocks.token) }),
    ] }, { merge: true });
  });
  it('records an empty account without inventing a child or a cursor', async () => {
    mocks.list.mockResolvedValue(listing(0));
    expect(await queueSuuntoRouteHistory('owner', execution)).toEqual({ count: 0, hasMore: false });
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.set).toHaveBeenCalledTimes(1);
  });
  it('fails an incomplete listing instead of recording an empty success', async () => {
    mocks.list.mockResolvedValue({ ...listing(0), failedProviderSourceKeys: ['failed'] });
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('could not be read completely');
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
  it('retains the cursor after partial admission failure so checkpoint replay can reuse children', async () => {
    mocks.list.mockResolvedValue(listing(3)); mocks.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('queue unavailable');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects mismatched accounts and replacement credentials before queue or metadata writes', async () => {
    mocks.token.userName = 'replacement';
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('earlier connection');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects a changed connection after the provider response before admitting any routes', async () => {
    mocks.before.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('replacement after read'));
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('replacement after read');
    expect(mocks.list).toHaveBeenCalledTimes(1); expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects a different Firebase owner before reading the provider', async () => {
    await expect(queueSuuntoRouteHistory('foreign-owner', execution)).rejects.toThrow('earlier connection');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rechecks the connection after the provider response and inside the final write', async () => {
    mocks.before.mockRejectedValueOnce(new Error('deleted'));
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('deleted');
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.guard.mockRejectedValueOnce(new Error('superseded'));
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('superseded');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects oversized and foreign-source inventories instead of truncating them', async () => {
    mocks.list.mockResolvedValueOnce(listing(10001));
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('exceeds the supported');
    mocks.list.mockResolvedValueOnce({ ...listing(1), routes: [{ ...route(0), providerUserId: 'foreign' }] });
    await expect(queueSuuntoRouteHistory('owner', execution)).rejects.toThrow('invalid source');
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
});
