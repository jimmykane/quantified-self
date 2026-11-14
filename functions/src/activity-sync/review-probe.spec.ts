import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { observeActivityDeliveryReview } from './review-probe';
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
const now = 1_800_000_000_000;
function harness(options: { deleted?: boolean; replayed?: boolean; changed?: boolean; unknown?: boolean; fail?: boolean } = {}) {
  const version = { isEqual: (other: unknown) => !options.changed && other === version, toMillis: () => now - 2 * 86400_000 };
  const row = { userID: 'private-owner', routeId: 'GarminAPI_to_SuuntoApp', sourceServiceName: ServiceNames.GarminAPI, destinationServiceName: ServiceNames.SuuntoApp,
    processed: true, resultStatus: 'manual_reconciliation_required', dateCreated: now - 3 * 86400_000,
    manualReconciliationRequiredAt: options.unknown ? undefined : now - 2 * 86400_000, failedAt: now - 2 * 86400_000 };
  const ref = { path: 'queue/item' };
  const snap = { id: 'private-job', ref, exists: true, data: () => row, updateTime: version };
  const query = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn(async () => {
    if (options.fail) throw Error('private-error'); return { docs: [snap], size: 1 };
  }) };
  const tx = { getAll: vi.fn(async (...refs: unknown[]) => [snap, { exists: !options.deleted }, { exists: false }, ...(refs.length === 5 ? [{ exists: !!options.replayed }] : [])]) };
  const db = { collection: vi.fn(() => query), doc: vi.fn(path => ({ path })), runTransaction: vi.fn(async fn => fn(tx)) };
  return { db, query, tx };
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
  it.each([{ deleted: true }, { changed: true }])('excludes lifecycle or revision changes: %j', async options => {
    const { db } = harness(options); await observeActivityDeliveryReview(db as never, now);
    expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.overdueSample === 0)).toBe(true);
  });
  it('does not page for retained dead letters already replaced by a live job', async () => {
    const { db } = harness({ replayed: true }); await observeActivityDeliveryReview(db as never, now);
    expect(vi.mocked(logger.info).mock.calls.find(([, fields]) => fields.destination === 'suunto' && fields.reviewKind === 'dead_letter')?.[1]).toMatchObject({ overdueSample: 0, excludedSample: 1 });
  });
  it('reports missing timestamps as unknown, and read failure as unavailable', async () => {
    await observeActivityDeliveryReview(harness({ unknown: true }).db as never, now);
    expect(vi.mocked(logger.info).mock.calls.some(([, fields]) => fields.unknownSample === 1)).toBe(true);
    vi.clearAllMocks(); await observeActivityDeliveryReview(harness({ fail: true }).db as never, now);
    expect(logger.info).toHaveBeenCalledTimes(6);
    expect(vi.mocked(logger.info).mock.calls.every(([, fields]) => fields.event === 'review_sample_unavailable')).toBe(true);
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
