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
let cachedQueueDepth: { count: number; timestamp: number } | null = null;

/**
 * Resets the Cloud Task queue depth cache.
 * Note: This is primarily used for unit testing.
 */
export function resetCloudTaskQueueDepthCache(): void {
    cachedQueueDepth = null;
}

/**
 * Get the current depth (number of tasks) in the Cloud Tasks queue.
 * Uses caching to reduce API calls unless forceRefresh is true.
 */
export async function getCloudTaskQueueDepth(forceRefresh = false): Promise<number> {
    if (!forceRefresh && cachedQueueDepth && (Date.now() - cachedQueueDepth.timestamp < CACHE_TTL_MS)) {
        return cachedQueueDepth.count;
    }

    const client = getCloudTasksClient();
    const { projectId, location, queue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const name = client.queuePath(projectId, location, queue);

    const [response] = await client.getQueue({
        name,
        readMask: {
            paths: ['stats'],
        },
    });

    const tasksCount = Number(response.stats?.tasksCount || 0);
    cachedQueueDepth = { count: tasksCount, timestamp: Date.now() };
    return tasksCount;
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
    const { projectId, location, queue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/${queue}`;
    const parent = client.queuePath(projectId, location, queue);

    // Deterministic task name for deduplication
    // Sanitize serviceName to allow only letters, numbers, hyphens, or underscores
    const sanitizedServiceName = serviceName.replace(/[^a-zA-Z0-9-_]/g, '-');

    // Use dateCreated to ensure uniqueness for re-created items (race condition fix)
    // while preserving deduplication for retries of the SAME item.
    const taskName = `${parent}/tasks/${sanitizedServiceName}-${queueItemId}-${dateCreated}`;

    const payload = { data: { queueItemId, serviceName } };

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

    if (scheduleDelaySeconds) {
        task.scheduleTime = {
            seconds: Math.floor(Date.now() / 1000) + scheduleDelaySeconds
        };
    }

    try {
        const [response] = await client.createTask({ parent, task });
        logger.info(`[Dispatcher] Enqueued task: ${response.name}`);
    } catch (error: any) {
        if (error.code === 6) { // ALREADY_EXISTS (GRPC code 6)
            logger.info(`[Dispatcher] Task already exists for ${serviceName}:${queueItemId}, skipping`);
            return;
        }
        logger.error(`[Dispatcher] Failed to enqueue task for ${serviceName}:${queueItemId}:`, error);
        // Don't rethrow - log and continue to prevent blocking other tasks
    }
}
