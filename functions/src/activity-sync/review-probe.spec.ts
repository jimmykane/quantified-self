import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { observeActivityDeliveryReview } from './review-probe';
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
const now = 1_800_000_000_000;
function harness(options: { rows?: number; deleted?: boolean; replayed?: boolean; changed?: boolean; unknown?: boolean; fail?: boolean; disconnected?: boolean; missingRoot?: boolean; missingTokens?: boolean; resumed?: boolean } = {}) {
  const version = { isEqual: (other: unknown) => !options.changed && other === version, toMillis: () => now - 2 * 86400_000 };
  const row = { userID: 'private-owner', routeId: 'GarminAPI_to_SuuntoApp', sourceServiceName: ServiceNames.GarminAPI, destinationServiceName: ServiceNames.SuuntoApp,
    processed: !options.resumed, resultStatus: 'manual_reconciliation_required', dateCreated: now - 3 * 86400_000,
    manualReconciliationRequiredAt: options.unknown ? undefined : now - 2 * 86400_000, failedAt: now - 2 * 86400_000 };
  const snapshots = Array.from({ length: options.rows || 1 }, (_, i) => ({ id: `private-job-${i}`, ref: { path: `queue/item-${i}` }, exists: true, data: () => row, updateTime: version }));
  const snap = snapshots[0];
  const query = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn(async () => {
    if (options.fail) throw Error('private-error'); return { docs: snapshots, size: snapshots.length };
  }) };
  const refFor = (path: string) => ({ path, collection: (name: string) => ({ path: `${path}/${name}`,
    select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() }) });
  const tx = { get: vi.fn(async () => ({ empty: !!options.missingTokens })), getAll: vi.fn(async (...refs: Array<{ path?: string }>) => refs.filter(r => r.path).map(r => {
    const current = snapshots.find(snapshot => snapshot.ref.path === r.path);
    if (current) return current;
    if (r.path!.includes('/meta/')) return { exists: true, get: (field: string) => field === 'connectionState' ? options.disconnected ? 'reconnect_required' : 'connected' : undefined };
    if (r.path!.startsWith('users/')) return { exists: !options.deleted };
    if (r.path!.startsWith('suuntoAppAccessTokens/')) return { exists: !options.missingRoot, get: () => undefined };
    if (r.path!.startsWith('activitySyncQueue/')) return { exists: !!options.replayed };
    return { exists: false };
  })) };
  const db = { collection: vi.fn(() => query), doc: vi.fn(refFor), runTransaction: vi.fn(async fn => fn(tx)) };
  return { db, query, tx, snap };
}
describe('retained delivery review observation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('observes aged reconciliation and dead letters separately without mutation or private telemetry', async () => {
    const { db, query } = harness(); await observeActivityDeliveryReview(db as never, now);
    const samples = vi.mocked(logger.info).mock.calls.map(([, fields]) => fields);
    expect(samples).toHaveLength(6);
    expect(samples.filter(s => s.destination === 'suunto').map(s => [s.reviewKind, s.overdueSample])).toEqual([['manual_reconciliation', 1], ['dead_letter', 1]]);
    expect(query.limit).toHaveBeenCalledWith(21);
    expect(query.where).toHaveBeenCalledWith('resultStatus', '==', 'manual_reconciliation_required');
    expect(query.select.mock.calls[0]).not.toContain('originalFile');
    expect(JSON.stringify(samples)).not.toContain('private-');
    expect(db.runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
  });
  it('shares owner and connection reads within a snapshot and rechecks them on the next observation', async () => {
    const options = { rows: 20, disconnected: false };
    const { db, tx } = harness(options);
    await observeActivityDeliveryReview(db as never, now);
    expect(db.runTransaction).toHaveBeenCalledTimes(2);
    const paths = tx.getAll.mock.calls.flatMap(refs => refs.filter(ref => ref.path).map(ref => ref.path));
    expect(paths.filter(path => path === 'users/private-owner')).toHaveLength(2);
    expect(paths.filter(path => path === 'suuntoAppAccessTokens/private-owner')).toHaveLength(2);
    // Two 20-row query results + 68 unique document reads + 2 token queries,
    // rather than the previous 300 reads for these same two full samples.
    expect(40 + paths.length + tx.get.mock.calls.length).toBe(110);
    for (const [, sample] of vi.mocked(logger.info).mock.calls.filter(([, fields]) => fields.destination === 'suunto')) {
      expect(sample).toMatchObject({ overdueSample: 20, excludedSample: 0 });
    }
    options.disconnected = true; vi.clearAllMocks();
    await observeActivityDeliveryReview(db as never, now);
    expect(tx.get).not.toHaveBeenCalled();
    for (const [, sample] of vi.mocked(logger.info).mock.calls.filter(([, fields]) => fields.destination === 'suunto')) {
      expect(sample).toMatchObject({ overdueSample: 0, excludedSample: 20 });
    }
  });
  it.each([{ deleted: true }, { changed: true }, { disconnected: true }, { missingRoot: true }, { missingTokens: true }])('excludes lifecycle or revision changes: %j', async options => {
    const { db } = harness(options); await observeActivityDeliveryReview(db as never, now);
    expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.overdueSample === 0)).toBe(true);
  });
  it('does not count a resumed manual-review record as unresolved while its old marker remains', async () => {
    await observeActivityDeliveryReview(harness({ resumed: true }).db as never, now);
    const manual = vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.destination === 'suunto' && fields.reviewKind === 'manual_reconciliation')?.[1];
    expect(manual).toMatchObject({ overdueSample: 0, excludedSample: 1 });
  });
  it('does not page for retained dead letters already replaced by a live job', async () => {
    const { db } = harness({ replayed: true }); await observeActivityDeliveryReview(db as never, now);
    expect(vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.destination === 'suunto' && fields.reviewKind === 'dead_letter')?.[1]).toMatchObject({ overdueSample: 0, excludedSample: 1 });
  });
  it('reports missing timestamps as unknown, and read failure as unavailable', async () => {
    await observeActivityDeliveryReview(harness({ unknown: true }).db as never, now);
    const unknown = vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.destination === 'suunto' && fields.reviewKind === 'manual_reconciliation')?.[1];
    expect(unknown).toMatchObject({ event: 'review_sample', unknownSample: 1 });
    expect(unknown).not.toHaveProperty('overdueSample');
    expect(unknown).not.toHaveProperty('ageLowerBoundMs');
    const idle = vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.destination === 'wahoo')?.[1];
    expect(idle).toMatchObject({ overdueSample: 0, ageLowerBoundMs: 0 });
    vi.clearAllMocks(); await observeActivityDeliveryReview(harness({ fail: true }).db as never, now);
    expect(logger.info).toHaveBeenCalledTimes(6);
    expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'review_sample_unavailable')).toBe(true);
  });
  it.each([false, true])('preserves a confirmed overdue lower bound with unknown records (truncated: %s)', async truncated => {
    const { db, query, snap } = harness();
    const unknown = { ...snap, data: () => ({ ...snap.data(), routeId: 'unknown-route' }) };
    const docs = [snap, ...Array.from({ length: truncated ? 20 : 1 }, () => unknown)];
    query.get.mockResolvedValue({ docs, size: docs.length });
    await observeActivityDeliveryReview(db as never, now);
    const samples = vi.mocked(logger.info).mock.calls.map(([, fields]) => fields);
    expect(samples).toHaveLength(6);
    for (const sample of samples.filter(s => s.destination === 'suunto')) {
      expect(sample).toMatchObject({ overdueSample: 1, ageLowerBoundMs: 2 * 86400_000, truncated, unknownSample: truncated ? 19 : 1 });
    }
    for (const sample of samples.filter(s => s.destination !== 'suunto')) {
      expect(sample).not.toHaveProperty('overdueSample');
      expect(sample).not.toHaveProperty('ageLowerBoundMs');
    }
  });
  it('stops after its deadline and never emits a late healthy result', async () => {
    vi.useFakeTimers(); const { db, query } = harness(); let resolve!: (data: unknown) => void;
    query.get.mockImplementation(() => new Promise(res => { resolve = res; }));
    try {
      const pending = observeActivityDeliveryReview(db as never, now);
      await vi.advanceTimersByTimeAsync(5000); await pending;
      resolve({ docs: [], size: 0 }); await Promise.resolve();
      expect(logger.info).toHaveBeenCalledTimes(6); expect(db.runTransaction).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
