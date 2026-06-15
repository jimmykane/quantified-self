import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueDerivedMetricsIngressTask, enqueueDerivedMetricsTask, resetCloudTasksClient } from './cloud-tasks';

const hoisted = vi.hoisted(() => {
  const mockCloudTasksClient = {
    queuePath: vi.fn(),
    createTask: vi.fn(),
  };
  const CloudTasksClientSpy = vi.fn(() => mockCloudTasksClient);

  return {
    mockCloudTasksClient,
    CloudTasksClientSpy,
  };
});

vi.mock('@google-cloud/tasks', () => ({
  v2beta3: {
    CloudTasksClient: hoisted.CloudTasksClientSpy,
  },
}));

vi.mock('../config', () => ({
  config: {
    cloudtasks: {
      projectId: 'test-project',
      location: 'test-location',
      workoutQueue: 'processWorkoutTask',
      activitySyncQueue: 'processActivitySyncTask',
      sportsLibReparseQueue: 'processSportsLibReparseTask',
      sportsLibRouteReparseQueue: 'processSportsLibRouteReparseTask',
      derivedMetricsQueue: 'processDerivedMetricsTask',
      derivedMetricsIngressBucketSeconds: 30,
      serviceAccountEmail: 'sa@test.com',
    },
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('enqueueDerivedMetricsTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCloudTasksClient();
    hoisted.mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
    hoisted.mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);
  });

  it('enqueues a deterministic task with sanitized uid and normalized generation', async () => {
    await expect(enqueueDerivedMetricsTask('user/with spaces', 7.8)).resolves.toBe(true);

    expect(hoisted.mockCloudTasksClient.queuePath).toHaveBeenCalledWith(
      'test-project',
      'test-location',
      'processDerivedMetricsTask',
    );

    expect(hoisted.mockCloudTasksClient.createTask).toHaveBeenCalledWith({
      parent: 'projects/p/locations/l/queues/q',
      task: expect.objectContaining({
        name: 'projects/p/locations/l/queues/q/tasks/derived-metrics-user-with-spaces-7',
        httpRequest: expect.objectContaining({
          url: 'https://test-location-test-project.cloudfunctions.net/processDerivedMetricsTask',
          body: expect.any(String),
        }),
      }),
    });

    const encodedBody = hoisted.mockCloudTasksClient.createTask.mock.calls[0][0].task.httpRequest.body;
    const payload = JSON.parse(Buffer.from(encodedBody, 'base64').toString('utf8'));
    expect(payload).toEqual({ data: { uid: 'user/with spaces', generation: 7 } });
  });

  it('returns false for already-existing deterministic tasks', async () => {
    const err: any = new Error('Already exists');
    err.code = 6;
    hoisted.mockCloudTasksClient.createTask.mockRejectedValue(err);

    await expect(enqueueDerivedMetricsTask('user-1', 1)).resolves.toBe(false);
  });
});

describe('enqueueDerivedMetricsIngressTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCloudTasksClient();
    hoisted.mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
    hoisted.mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);
  });

  it('enqueues deterministic ingress task per uid + bucket', async () => {
    await expect(enqueueDerivedMetricsIngressTask('user/with spaces', undefined, 1_712_000_015_000)).resolves.toBe(true);

    expect(hoisted.mockCloudTasksClient.createTask).toHaveBeenCalledWith({
      parent: 'projects/p/locations/l/queues/q',
      task: expect.objectContaining({
        name: 'projects/p/locations/l/queues/q/tasks/derived-metrics-ingress-user-with-spaces-1712000010',
        scheduleTime: {
          seconds: 1712000042,
        },
        httpRequest: expect.objectContaining({
          url: 'https://test-location-test-project.cloudfunctions.net/processDerivedMetricsIngressTask',
        }),
      }),
    });

    const encodedBody = hoisted.mockCloudTasksClient.createTask.mock.calls[0][0].task.httpRequest.body;
    const payload = JSON.parse(Buffer.from(encodedBody, 'base64').toString('utf8'));
    expect(payload).toEqual({
      data: {
        uid: 'user/with spaces',
        bucketStartEpochSec: 1712000010,
      },
    });
  });

  it('returns false for already-existing ingress bucket tasks', async () => {
    const err: any = new Error('Already exists');
    err.code = 6;
    hoisted.mockCloudTasksClient.createTask.mockRejectedValue(err);

    await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000)).resolves.toBe(false);
  });

  it('uses different deterministic task names across different buckets', async () => {
    await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000)).resolves.toBe(true);
    await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_055_000)).resolves.toBe(true);

    const firstTaskName = hoisted.mockCloudTasksClient.createTask.mock.calls[0][0].task.name as string;
    const secondTaskName = hoisted.mockCloudTasksClient.createTask.mock.calls[1][0].task.name as string;

    expect(firstTaskName).toContain('derived-metrics-ingress-user-1-1712000010');
    expect(secondTaskName).toContain('derived-metrics-ingress-user-1-1712000040');
    expect(firstTaskName).not.toBe(secondTaskName);
  });

  it('supports explicit schedule delay override for manual enqueue call-sites', async () => {
    await expect(enqueueDerivedMetricsIngressTask('user-1', 9, 1_712_000_015_000)).resolves.toBe(true);

    expect(hoisted.mockCloudTasksClient.createTask).toHaveBeenCalledWith({
      parent: 'projects/p/locations/l/queues/q',
      task: expect.objectContaining({
        name: 'projects/p/locations/l/queues/q/tasks/derived-metrics-ingress-user-1-1712000010',
        scheduleTime: {
          seconds: 1712000024,
        },
      }),
    });
  });
});
