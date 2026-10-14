import { afterEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { observeEmailOutbox } from './monitoring-probe';
import { EMAIL_MONITORING_FIELDS, EMAIL_PROBE_LIMIT } from './monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
function database(get: () => Promise<unknown>) {
  const query = { where: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn(get) };
  return { query, db: { collection: vi.fn(() => query) } as unknown as FirebaseFirestore.Firestore };
}
describe('bounded direct mail observations', () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
  it('uses one bounded masked query and performs no additional reads or writes', async () => {
    const { db, query } = database(async () => ({ size: 0, docs: [] }));
    await observeEmailOutbox(db);
    expect(db.collection).toHaveBeenCalledExactlyOnceWith('mail');
    expect(query.where).toHaveBeenCalledExactlyOnceWith('delivery.state', 'in', ['PENDING', 'PROCESSING', 'RETRY']);
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(EMAIL_PROBE_LIMIT + 1);
    expect(query.select).toHaveBeenCalledExactlyOnceWith(...EMAIL_MONITORING_FIELDS);
    expect(EMAIL_MONITORING_FIELDS).not.toContain('message'); expect(EMAIL_MONITORING_FIELDS).not.toContain('to');
    expect(EMAIL_MONITORING_FIELDS).not.toContain('delivery.error');
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.info).mock.calls.every(call => (call[1] as Record<string, unknown>).dueSample === 0)).toBe(true);
  });
  it('query failures are unknown observations, not healthy zero or mail retries', async () => {
    const { db } = database(async () => { throw new Error('private error credential canary'); });
    await expect(observeEmailOutbox(db)).resolves.toBeUndefined();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled(); expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
    expect(vi.mocked(logger.warn).mock.calls.every(call => !('dueSample' in (call[1] as Record<string, unknown>)))).toBe(true);
  });
  it('deadline bounds scheduler waiting and suppresses late observations', async () => {
    vi.useFakeTimers(); let complete!: (value: unknown) => void;
    const { db } = database(() => new Promise(resolve => { complete = resolve; }));
    const running = observeEmailOutbox(db);
    await vi.advanceTimersByTimeAsync(5_000); await running;
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
    complete({ size: 0, docs: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
  });
});
