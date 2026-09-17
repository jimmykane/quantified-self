import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onDocumentWritten: vi.fn((options: unknown, handler: unknown) => ({ options, handler })),
}));

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: vi.fn((_options: unknown, handler: unknown) => handler) }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: mocks.onDocumentWritten }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn((_options: unknown, handler: unknown) => handler) }));
vi.mock('../../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: { processTrainingDeliveryTask: { region: 'europe-west2' } },
}));
vi.mock('../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: vi.fn() }));
vi.mock('../../shared/cloud-tasks', () => ({
  enqueueTrainingDeliveryTask: vi.fn(),
  getCloudTaskQueueDepthForQueue: vi.fn(),
}));
vi.mock('../../shared/queue-config', () => ({ CLOUD_TASK_RETRY_CONFIG: {}, MAX_PENDING_TASKS: 100 }));
vi.mock('../../config', () => ({ config: { cloudtasks: { trainingDeliveryQueue: 'training-delivery' } } }));
vi.mock('../../secrets', () => ({ FUNCTION_SECRET_BINDINGS: { processTrainingDeliveryTask: [] } }));
vi.mock('./contracts', () => ({ DELIVERY_QUEUE: 'trainingDeliveryQueue' }));
vi.mock('./runtime', () => ({ productionDeliveryRuntime: vi.fn() }));
vi.mock('./store', () => ({ reconcileTrainingDeliveryPage: vi.fn() }));
vi.mock('./worker', () => ({ processTrainingDelivery: vi.fn() }));

vi.mock('./verification-worker', () => ({ processTrainingVerification: vi.fn() }));

import { dispatchTrainingDelivery, onTrainingDeliveryQueued } from './tasks';
import { productionDeliveryRuntime } from './runtime';
import { enqueueTrainingDeliveryTask, getCloudTaskQueueDepthForQueue } from '../../shared/cloud-tasks';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';

describe('Training delivery queue trigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('allocates 512 MiB to bounded enqueue dispatch', () => {
    expect((onTrainingDeliveryQueued as unknown as { options: unknown }).options).toMatchObject({
      document: 'trainingDeliveryQueue/{jobId}',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    });
  });
  it('leaves verification enqueue to the prioritized dispatcher', async () => {
    const trigger = onTrainingDeliveryQueued as unknown as { handler: (event: unknown) => Promise<void> };
    await trigger.handler({ data: { after: { exists: true, data: () => ({ kind: 'verification', dueAtMs: 0 }) } } });
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
  });
  it('leaves due COROS delivery leaves to the batch-coalescing dispatcher', async () => {
    const trigger = onTrainingDeliveryQueued as unknown as { handler: (event: unknown) => Promise<void> };
    await trigger.handler({ data: { after: { exists: true, data: () => ({
      kind: 'delivery', provider: 'coros', dueAtMs: 0,
    }) } } });
    expect(productionDeliveryRuntime).not.toHaveBeenCalled();
  });
  it.each([0, 92, 100])('bounds recovery dispatch and prioritizes writes, manual then ordinary at depth %s', async depth => {
    const scans: { filters: unknown[][]; limit: number }[] = [];
    const collection = () => {
      const filters: unknown[][] = []; let count = 0;
      const query = {
        where: (...args: unknown[]) => { filters.push(args); return query; },
        orderBy: () => query, limit: (value: number) => { count = value; return query; }, doc: () => ({}),
        get: async () => {
          scans.push({ filters: [...filters], limit: count });
          const size = Math.min(count, 5);
          return { size, docs: Array.from({ length: size }, (_, i) => ({ id: String(i) })) };
        },
      };
      return query;
    };
    vi.mocked(getCloudTaskQueueDepthForQueue).mockResolvedValue(depth);
    vi.mocked(productionDeliveryRuntime).mockReturnValue({ now: () => 100,
      db: { collection, runTransaction: vi.fn().mockResolvedValue(false) },
    } as unknown as ReturnType<typeof productionDeliveryRuntime>);
    await (dispatchTrainingDelivery as unknown as () => Promise<void>)();
    expect(scans.map(scan => scan.limit)).toEqual(depth === 100 ? [] : [25, 25, 25]);
    if (depth < 100) {
      expect(scans[0].filters[0]).toEqual(['kind', 'in', ['delivery', 'reconcile']]);
      expect(scans[1].filters[1]).toEqual(['priority', '==', 'manual']);
      expect(scans.every(scan => scan.filters.some(filter => filter[0] === 'dueAtMs'))).toBe(true);
    }
    if (depth === 0) expect(scans[2].filters[1]).toEqual(['priority', '==', 'ordinary']);
  });

  it('continues a bounded scan after coalescing a dense COROS group', async () => {
    let collectionCount = 0;
    const collection = () => {
      const current = collectionCount++;
      if (current >= 3) return { doc: (id: string) => ({ id }) };
      let page = 0;
      const query = {
        where: () => query,
        orderBy: () => query,
        startAfter: () => query,
        limit: () => query,
        get: async () => {
          if (current !== 0) return { size: 0, docs: [] };
          if (page++ === 0) {
            const docs = Array.from({ length: 25 }, (_, index) => ({
              id: `coros-${index}`,
              data: () => ({ kind: 'delivery', provider: 'coros', uid: 'user',
                destinationKey: 'destination', operationKind: 'upsert' }),
            }));
            return { size: docs.length, docs };
          }
          const docs = [{ id: 'garmin', data: () => ({ kind: 'delivery', provider: 'garmin', uid: 'user' }) }];
          return { size: docs.length, docs };
        },
      };
      return query;
    };
    vi.mocked(getCloudTaskQueueDepthForQueue).mockResolvedValue(0);
    vi.mocked(getUserDeletionGuardStateInTransaction).mockResolvedValue({ shouldSkip: false } as never);
    vi.mocked(productionDeliveryRuntime).mockReturnValue({ now: () => 100,
      db: {
        collection,
        runTransaction: vi.fn(async callback => callback({
          get: vi.fn(async () => ({ exists: true, data: () => ({ uid: 'user', dueAtMs: 0 }) })),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      },
    } as unknown as ReturnType<typeof productionDeliveryRuntime>);

    await (dispatchTrainingDelivery as unknown as () => Promise<void>)();

    expect(vi.mocked(enqueueTrainingDeliveryTask).mock.calls.map(call => call[0]))
      .toEqual(['coros-0', 'garmin']);
  });
});
