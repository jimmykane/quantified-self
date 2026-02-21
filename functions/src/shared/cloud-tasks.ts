/**
 * Cloud Tasks Utilities
 *
 * This module centralizes all Cloud Tasks operations, including:
 * - Queue depth monitoring
 * - Task enqueuing with deduplication
 * - Singleton client management for performance
 */

import { v2beta3 } from '@google-cloud/tasks';
import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Lazy-initialized singleton client for performance
let _cloudTasksClient: v2beta3.CloudTasksClient | null = null;

function getCloudTasksClient(): v2beta3.CloudTasksClient {
    if (!_cloudTasksClient) {
        _cloudTasksClient = new v2beta3.CloudTasksClient();
    }
    return _cloudTasksClient;
}

// Cache for queue depth to reduce API calls
const CACHE_TTL_MS = 60 * 1000; // 1 minute
const cachedQueueDepthByQueue = new Map<string, { count: number; timestamp: number }>();

/**
 * Resets the Cloud Task queue depth cache.
 * Note: This is primarily used for unit testing.
 */
export function resetCloudTaskQueueDepthCache(): void {
    cachedQueueDepthByQueue.clear();
}

/**
 * Resets the Cloud Tasks client singleton.
 * Note: This is primarily used for unit testing.
 */
export function resetCloudTasksClient(): void {
    _cloudTasksClient = null;
}

/**
 * Get the current depth (number of tasks) in the specified Cloud Tasks queue.
 * Uses caching to reduce API calls unless forceRefresh is true.
 */
export async function getCloudTaskQueueDepthForQueue(queueId: string, forceRefresh = false): Promise<number> {
    const cached = cachedQueueDepthByQueue.get(queueId);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.count;
    }

    const client = getCloudTasksClient();
    const { projectId, location } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const name = client.queuePath(projectId, location, queueId);

    const [response] = await client.getQueue({
        name,
        readMask: {
            paths: ['stats'],
        },
    });

    const tasksCount = Number(response.stats?.tasksCount || 0);
    cachedQueueDepthByQueue.set(queueId, { count: tasksCount, timestamp: Date.now() });
    return tasksCount;
}

/**
 * Get the current depth (number of tasks) in the workout Cloud Tasks queue.
 * Uses caching to reduce API calls unless forceRefresh is true.
 */
export async function getCloudTaskQueueDepth(forceRefresh = false): Promise<number> {
    return getCloudTaskQueueDepthForQueue(config.cloudtasks.workoutQueue, forceRefresh);
}

/**
 * Enqueue a workout processing task to Cloud Tasks.
 * Uses deterministic task names for deduplication.
 */
export async function enqueueWorkoutTask(
    serviceName: ServiceNames,
    queueItemId: string,
    dateCreated: number,
    scheduleDelaySeconds?: number
): Promise<void> {
    const client = getCloudTasksClient();
    const { projectId, location, workoutQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processWorkoutTask`;
    const parent = client.queuePath(projectId, location, workoutQueue);

    // Deterministic task name for deduplication
    // Sanitize serviceName to allow only letters, numbers, hyphens, or underscores
    const sanitizedServiceName = serviceName.replace(/[^a-zA-Z0-9-_]/g, '-');

    // Use dateCreated to ensure uniqueness for re-created items (race condition fix)
    // while preserving deduplication for retries of the SAME item.
    const taskName = `${parent}/tasks/${sanitizedServiceName}-${queueItemId}-${dateCreated}`;

    const payload = { data: { queueItemId, serviceName } };

    await enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[Dispatcher] Task already exists for ${serviceName}:${queueItemId}, skipping`,
        failedLogPrefix: `[Dispatcher] Failed to enqueue task for ${serviceName}:${queueItemId}:`,
    });
}

/**
 * Enqueue a single sports-lib reparse job task.
 */
export async function enqueueSportsLibReparseTask(jobId: string, scheduleDelaySeconds?: number): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, sportsLibReparseQueue, serviceAccountEmail } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const parent = client.queuePath(projectId, location, sportsLibReparseQueue);
    const url = `https://${location}-${projectId}.cloudfunctions.net/processSportsLibReparseTask`;
    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const taskName = `${parent}/tasks/reparse-${safeJobId}`;
    const payload = { data: { jobId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[ReparseDispatcher] Task already exists for job ${jobId}, skipping`,
        failedLogPrefix: `[ReparseDispatcher] Failed to enqueue task for job ${jobId}:`,
    });
}

interface EnqueueTaskParams {
    parent: string;
    taskName: string;
    payload: unknown;
    serviceAccountEmail: string;
    url: string;
    scheduleDelaySeconds?: number;
    alreadyExistsLogMessage: string;
    failedLogPrefix: string;
}

async function enqueueTaskWithRetry(params: EnqueueTaskParams): Promise<boolean> {
    const {
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage,
        failedLogPrefix,
    } = params;

    const task: any = {
        name: taskName,
        httpRequest: {
            httpMethod: 'POST' as const,
            url,
            headers: {
                'Content-Type': 'application/json',
            },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            oidcToken: {
                serviceAccountEmail,
            },
        },
    };

    const minDelaySeconds = Math.max(scheduleDelaySeconds ?? 1, 1);
    task.scheduleTime = {
        seconds: Math.floor(Date.now() / 1000) + minDelaySeconds
    };

    let attempt = 0;
    const MAX_RETRIES = 3;

    while (attempt < MAX_RETRIES) {
        try {
            const currentClient = getCloudTasksClient();
            const [response] = await currentClient.createTask({ parent, task });
            logger.info(`[Dispatcher] Enqueued task: ${response.name}`);
            return true;
        } catch (error: any) {
            if ((error as any).code === 6) {
                logger.info(alreadyExistsLogMessage);
                return false;
            }

            const isRetryable = (error.code === 14) ||
                (error.message && (error.message.includes('ECONNRESET') || error.message.includes('Unavailable')));

            if (isRetryable && attempt < MAX_RETRIES - 1) {
                logger.warn(`[Dispatcher] Transient error enqueueing task (attempt ${attempt + 1}/${MAX_RETRIES}): ${error.message}. Resetting client and retrying...`);
                _cloudTasksClient = null;
                attempt++;
                const delayMs = 1000 * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            logger.error(failedLogPrefix, error);
            throw error;
        }
    }

    throw new Error('[Dispatcher] Failed to enqueue task after retry loop exhausted.');
}
