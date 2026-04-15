import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueDerivedMetricsTask, resetCloudTasksClient } from './cloud-tasks';

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
      sportsLibReparseQueue: 'processSportsLibReparseTask',
      derivedMetricsQueue: 'processDerivedMetricsTask',
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
