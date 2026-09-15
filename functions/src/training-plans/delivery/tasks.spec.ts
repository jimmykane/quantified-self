import { describe, expect, it, vi } from 'vitest';

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

import './tasks';

describe('Training delivery queue trigger', () => {
  it('allocates 512 MiB to bounded enqueue dispatch', () => {
    expect(mocks.onDocumentWritten).toHaveBeenCalledWith(expect.objectContaining({
      document: 'trainingDeliveryQueue/{jobId}',
      region: 'europe-west2',
      memory: '512MiB',
      retry: true,
    }), expect.any(Function));
  });
});
