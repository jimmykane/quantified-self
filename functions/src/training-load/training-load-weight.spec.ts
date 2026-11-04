import { describe, expect, it, vi } from 'vitest';
import { readTrainingLoadWeight, trainingLoadWeightCandidates } from './training-load-weight';

function record(id: string, time: number, kg: number, extra = {}) {
  const data = { userID: 'owner', kind: 'point_measurement', endTimeMs: time,
    source: { provider: 'quantified_self', revision: { digest: id } },
    metrics: [{ metricId: 'body_weight', kind: 'value', valueType: 'number', aggregation: 'measurement',
      semanticVariant: 'point', normalizationStatus: 'canonical', canonical: { value: kg, unit: 'kg' } }], ...extra };
  return { id, data: () => data, get: (key: string) => data[key as keyof typeof data] };
}
function reader(pages: ReturnType<typeof record>[][]) {
  const query = { where: vi.fn(), orderBy: vi.fn(), select: vi.fn(), startAfter: vi.fn(), limit: vi.fn() };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  const db = { collection: vi.fn(() => query) };
  const transaction = { get: vi.fn().mockImplementation(async () => {
    const docs = pages.shift() ?? []; return { docs, size: docs.length };
  }) };
  return { db, transaction, query, read: () => readTrainingLoadWeight(db as never, transaction as never, 'owner', 100_000) };
}

describe('Training MET Health weight fallback', () => {
  it('accepts actual manual or device measurements without an age cutoff', () => {
    const manual = record('manual', -3650 * 86400000, 70);
    const device = record('device', 50, 71, { source: { provider: 'garmin', revision: { digest: 'device' } } });
    expect(trainingLoadWeightCandidates('owner', 100, [manual, device]).map(row => row.kilograms)).toEqual([70, 71]);
  });
  it('rejects future, foreign, profile-context and nonpositive values', () => {
    expect(trainingLoadWeightCandidates('owner', 100, [record('future', 101, 70),
      record('foreign', 50, 70, { userID: 'someone-else' }), record('context', 50, 70, { kind: 'activity' }),
      record('zero', 50, 0), record('nan', 50, NaN)])).toEqual([]);
  });
  it('uses the latest prior measurement and checks equal-time source conflicts', async () => {
    const run = reader([[record('latest', 100, 70), record('older', 99, 71)]]);
    expect(await run.read()).toMatchObject({ status: 'available', kilograms: 70, observedAtMs: 100 });
    expect(run.transaction.get).toHaveBeenCalledTimes(1);
    const conflict = reader([[record('a', 100, 70), record('b', 100, 71)]]);
    expect(await conflict.read()).toEqual({ status: 'unavailable', reason: 'conflicting' });
  });
  it('does not guess when an equal-time group needs another bounded page', async () => {
    const run = reader([[record('a', 100, 70), record('b', 100, 70)], [record('c', 100, 71)]]);
    expect(await run.read()).toEqual({ status: 'unavailable', reason: 'conflicting' });
    expect(run.query.startAfter).toHaveBeenCalledTimes(1);
  });
  it('deduplicates identical values, represents absence and propagates query failures', async () => {
    expect(await reader([[record('a', 100, 70), record('b', 100, 70)], []]).read())
      .toMatchObject({ status: 'available', kilograms: 70 });
    expect(await reader([[]]).read()).toEqual({ status: 'unavailable', reason: 'missing' });
    const failure = reader([]); failure.transaction.get.mockRejectedValueOnce(new Error('offline'));
    await expect(failure.read()).rejects.toThrow('offline');
  });
  it('stops a pathological invalid-measurement scan at 64 records', async () => {
    const pages = [Array.from({ length: 2 }, (_, i) => record(`x${i}`, 100, 0)),
      ...Array.from({ length: 7 }, () => Array.from({ length: 8 }, (_, i) => record(`x${i}`, 100, 0))),
      Array.from({ length: 6 }, (_, i) => record(`x${i}`, 100, 0))];
    const run = reader(pages);
    expect(await run.read()).toEqual({ status: 'unavailable', reason: 'scan-limit' });
    expect(run.transaction.get).toHaveBeenCalledTimes(9);
  });
});
