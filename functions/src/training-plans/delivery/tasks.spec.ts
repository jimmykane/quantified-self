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
import { getCloudTaskQueueDepthForQueue } from '../../shared/cloud-tasks';

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
  it.each([0, 92, 100])('bounds scans by queue capacity and prioritizes writes, manual then ordinary at depth %s', async depth => {
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
    expect(scans.map(scan => scan.limit)).toEqual(depth === 100 ? [] : depth === 92 ? [8, 3] : [25, 20, 15]);
    if (depth < 100) {
      expect(scans[0].filters[0]).toEqual(['kind', 'in', ['delivery', 'reconcile']]);
      expect(scans[1].filters[1]).toEqual(['priority', '==', 'manual']);
      expect(scans.every(scan => scan.filters.some(filter => filter[0] === 'dueAtMs'))).toBe(true);
    }
    if (depth === 0) expect(scans[2].filters[1]).toEqual(['priority', '==', 'ordinary']);
  });
});
