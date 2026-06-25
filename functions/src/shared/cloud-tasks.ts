/**
 * Cloud Tasks Utilities
 *
 * This module centralizes all Cloud Tasks operations, including:
 * - Queue depth monitoring
 * - Task enqueuing with deduplication
 * - Singleton client management for performance
 */

import { protos, v2beta3 } from '@google-cloud/tasks';
import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS,
    REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS,
} from './activity-processing-config';
import { SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME } from '../../../shared/functions-manifest';

// Lazy-initialized singleton client for performance
let _cloudTasksClient: v2beta3.CloudTasksClient | null = null;

const SPORTS_LIB_REPARSE_TASK_DISPATCH_DEADLINE_SECONDS = REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS.timeoutSeconds;
const SPORTS_LIB_REPARSE_HEAVY_TASK_DISPATCH_DEADLINE_SECONDS = REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS.timeoutSeconds;

interface EnqueueSportsLibReparseHeavyTaskOptions {
    scheduleDelaySeconds?: number;
    taskNameSuffix?: string;
}

interface EnqueueWorkoutTaskOptions {
    recoveryTaskKey?: number | string;
}

function getCloudTasksClient(): v2beta3.CloudTasksClient {
    if (!_cloudTasksClient) {
        _cloudTasksClient = new v2beta3.CloudTasksClient();
    }
    return _cloudTasksClient;
}

function sanitizeTaskNamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9-_]/g, '-');
}

function isCloudTaskNotFoundError(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    const message = `${(error as { message?: unknown })?.message || ''}`;
    return code === 5
        || code === 'not-found'
        || code === 'NOT_FOUND'
        || message.includes('NOT_FOUND')
        || message.includes('not found');
}

async function cloudTaskExists(taskName: string): Promise<boolean> {
    try {
        await getCloudTasksClient().getTask({ name: taskName });
        return true;
    } catch (error) {
        if (isCloudTaskNotFoundError(error)) {
            return false;
        }
        throw error;
    }
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
    scheduleDelaySeconds?: number,
    options: EnqueueWorkoutTaskOptions = {},
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, workoutQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processWorkoutTask`;
    const parent = client.queuePath(projectId, location, workoutQueue);

    const sanitizedServiceName = sanitizeTaskNamePart(serviceName);

    // Use dateCreated to ensure uniqueness for re-created items (race condition fix)
    // while preserving deduplication for retries of the SAME item.
    const taskName = `${parent}/tasks/${sanitizedServiceName}-${queueItemId}-${dateCreated}`;

    const payload = { data: { queueItemId, serviceName } };

    const taskCreated = await enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[Dispatcher] Task already exists for ${serviceName}:${queueItemId}, skipping`,
        failedLogPrefix: `[Dispatcher] Failed to enqueue task for ${serviceName}:${queueItemId}:`,
    });
    if (taskCreated) {
        return true;
    }

    if (await cloudTaskExists(taskName)) {
        logger.info(`[Dispatcher] Existing task is still live for ${serviceName}:${queueItemId}; treating workout queue item as dispatched.`);
        return true;
    }

    const recoveryTaskKey = sanitizeTaskNamePart(`${options.recoveryTaskKey ?? 0}`);
    const recoveryTaskName = `${taskName}-dedupe-recovery-${recoveryTaskKey}`;
    logger.warn(`[Dispatcher] Task name for ${serviceName}:${queueItemId} is reserved but no live task was found; enqueueing recovery task.`);
    const recoveryTaskCreated = await enqueueTaskWithRetry({
        parent,
        taskName: recoveryTaskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[Dispatcher] Recovery task already exists for ${serviceName}:${queueItemId}, skipping`,
        failedLogPrefix: `[Dispatcher] Failed to enqueue recovery task for ${serviceName}:${queueItemId}:`,
    });
    if (recoveryTaskCreated) {
        return true;
    }

    if (await cloudTaskExists(recoveryTaskName)) {
        logger.info(`[Dispatcher] Existing recovery task is still live for ${serviceName}:${queueItemId}; treating workout queue item as dispatched.`);
        return true;
    }

    logger.warn(`[Dispatcher] Recovery task name for ${serviceName}:${queueItemId} is reserved but no live recovery task was found; leaving dispatch marker unchanged.`);
    return false;
}

/**
 * Enqueue an activity sync processing task to Cloud Tasks.
 * Uses deterministic task names for deduplication.
 */
export async function enqueueActivitySyncTask(
    queueItemId: string,
    dateCreated: number,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, activitySyncQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processActivitySyncTask`;
    const parent = client.queuePath(projectId, location, activitySyncQueue);

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskName = `${parent}/tasks/activity-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { data: { queueItemId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[ActivitySyncDispatcher] Task already exists for queue item ${queueItemId}, skipping`,
        failedLogPrefix: `[ActivitySyncDispatcher] Failed to enqueue activity sync task for ${queueItemId}:`,
    });
}

/**
 * Enqueue a route sync processing task to Cloud Tasks.
 * Uses deterministic task names for deduplication.
 */
export async function enqueueRouteSyncTask(
    queueItemId: string,
    dateCreated: number,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, routeSyncQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processRouteSyncTask`;
    const parent = client.queuePath(projectId, location, routeSyncQueue);

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskName = `${parent}/tasks/route-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { data: { queueItemId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[RouteSyncDispatcher] Task already exists for queue item ${queueItemId}, skipping`,
        failedLogPrefix: `[RouteSyncDispatcher] Failed to enqueue route sync task for ${queueItemId}:`,
    });
}

/**
 * Enqueue a route delivery sync processing task to Cloud Tasks.
 * Uses deterministic task names for deduplication.
 */
export async function enqueueRouteDeliverySyncTask(
    queueItemId: string,
    dateCreated: number,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, routeDeliverySyncQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processRouteDeliverySyncTask`;
    const parent = client.queuePath(projectId, location, routeDeliverySyncQueue);

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskName = `${parent}/tasks/route-delivery-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { data: { queueItemId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[RouteDeliverySyncDispatcher] Task already exists for queue item ${queueItemId}, skipping`,
        failedLogPrefix: `[RouteDeliverySyncDispatcher] Failed to enqueue route delivery sync task for ${queueItemId}:`,
    });
}

/**
 * Enqueue a sleep sync processing task to Cloud Tasks.
 * Uses deterministic task names for deduplication.
 */
export async function enqueueSleepSyncTask(
    queueItemId: string,
    dateCreated: number,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, sleepSyncQueue, serviceAccountEmail } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const url = `https://${location}-${projectId}.cloudfunctions.net/processSleepSyncTask`;
    const parent = client.queuePath(projectId, location, sleepSyncQueue);

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskName = `${parent}/tasks/sleep-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { data: { queueItemId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[SleepSyncDispatcher] Task already exists for queue item ${queueItemId}, skipping`,
        failedLogPrefix: `[SleepSyncDispatcher] Failed to enqueue sleep sync task for ${queueItemId}:`,
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
        dispatchDeadlineSeconds: SPORTS_LIB_REPARSE_TASK_DISPATCH_DEADLINE_SECONDS,
        alreadyExistsLogMessage: `[ReparseDispatcher] Task already exists for job ${jobId}, skipping`,
        failedLogPrefix: `[ReparseDispatcher] Failed to enqueue task for job ${jobId}:`,
    });
}

/**
 * Enqueue a single heavy sports-lib reparse job task.
 */
export async function enqueueSportsLibReparseHeavyTask(
    jobId: string,
    optionsOrScheduleDelaySeconds?: EnqueueSportsLibReparseHeavyTaskOptions | number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, sportsLibReparseHeavyQueue, serviceAccountEmail } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const options = typeof optionsOrScheduleDelaySeconds === 'number'
        ? { scheduleDelaySeconds: optionsOrScheduleDelaySeconds }
        : (optionsOrScheduleDelaySeconds || {});
    const parent = client.queuePath(projectId, location, sportsLibReparseHeavyQueue);
    const url = `https://${location}-${projectId}.cloudfunctions.net/${SPORTS_LIB_REPARSE_HEAVY_TASK_FUNCTION_NAME}`;
    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeTaskNameSuffix = options.taskNameSuffix
        ? `-${options.taskNameSuffix.replace(/[^a-zA-Z0-9-_]/g, '-')}`
        : '';
    const taskName = `${parent}/tasks/reparse-heavy-${safeJobId}${safeTaskNameSuffix}`;
    const payload = { data: { jobId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds: options.scheduleDelaySeconds,
        dispatchDeadlineSeconds: SPORTS_LIB_REPARSE_HEAVY_TASK_DISPATCH_DEADLINE_SECONDS,
        alreadyExistsLogMessage: `[ReparseHeavyDispatcher] Task already exists for job ${jobId}, skipping`,
        failedLogPrefix: `[ReparseHeavyDispatcher] Failed to enqueue task for job ${jobId}:`,
    });
}

/**
 * Enqueue a single route sports-lib reparse job task.
 */
export async function enqueueSportsLibRouteReparseTask(
    jobId: string,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, sportsLibRouteReparseQueue, serviceAccountEmail } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const parent = client.queuePath(projectId, location, sportsLibRouteReparseQueue);
    const url = `https://${location}-${projectId}.cloudfunctions.net/processSportsLibRouteReparseTask`;
    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const taskName = `${parent}/tasks/route-reparse-${safeJobId}`;
    const payload = { data: { jobId } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        dispatchDeadlineSeconds: SPORTS_LIB_REPARSE_TASK_DISPATCH_DEADLINE_SECONDS,
        alreadyExistsLogMessage: `[RouteReparseDispatcher] Task already exists for job ${jobId}, skipping`,
        failedLogPrefix: `[RouteReparseDispatcher] Failed to enqueue task for job ${jobId}:`,
    });
}

/**
 * Enqueue a single derived-metrics rebuild task for one user generation.
 * Task name is deterministic to guarantee one pending task per user generation.
 */
export async function enqueueDerivedMetricsTask(
    uid: string,
    generation: number,
    scheduleDelaySeconds?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const { projectId, location, derivedMetricsQueue, serviceAccountEmail } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const parent = client.queuePath(projectId, location, derivedMetricsQueue);
    const url = `https://${location}-${projectId}.cloudfunctions.net/processDerivedMetricsTask`;
    const safeUid = `${uid}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeGeneration = Number.isFinite(generation) ? Math.max(0, Math.floor(generation)) : 0;
    const taskName = `${parent}/tasks/derived-metrics-${safeUid}-${safeGeneration}`;
    const payload = { data: { uid, generation: safeGeneration } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[DerivedMetricsDispatcher] Task already exists for ${uid} generation ${safeGeneration}, skipping`,
        failedLogPrefix: `[DerivedMetricsDispatcher] Failed to enqueue derived metrics task for ${uid} generation ${safeGeneration}:`,
    });
}

/**
 * Enqueue a debounced derived-metrics ingress task for one uid + time bucket.
 * Task name is deterministic to guarantee at most one ingress task per bucket.
 */
export async function enqueueDerivedMetricsIngressTask(
    uid: string,
    scheduleDelaySeconds?: number,
    nowMs?: number,
): Promise<boolean> {
    const client = getCloudTasksClient();
    const {
        projectId,
        location,
        derivedMetricsQueue,
        derivedMetricsIngressBucketSeconds,
        serviceAccountEmail,
    } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const parent = client.queuePath(projectId, location, derivedMetricsQueue);
    const url = `https://${location}-${projectId}.cloudfunctions.net/processDerivedMetricsIngressTask`;
    const safeUid = `${uid}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const bucketSeconds = Math.max(1, Math.floor(Number(derivedMetricsIngressBucketSeconds) || 30));
    const currentEpochSeconds = Math.max(0, Math.floor(((Number.isFinite(nowMs) ? nowMs : Date.now()) as number) / 1000));
    const bucketStartEpochSec = currentEpochSeconds - (currentEpochSeconds % bucketSeconds);
    const ingressBufferSeconds = 2;
    const bucketCloseEpochSec = bucketStartEpochSec + bucketSeconds;
    const computedScheduleEpochSec = Math.max(currentEpochSeconds + 1, bucketCloseEpochSec + ingressBufferSeconds);
    const overrideScheduleDelaySeconds = Number.isFinite(scheduleDelaySeconds)
        ? Math.max(1, Math.floor(scheduleDelaySeconds as number))
        : null;
    const effectiveScheduleDelaySeconds = overrideScheduleDelaySeconds ?? (computedScheduleEpochSec - currentEpochSeconds);
    const effectiveScheduleEpochSeconds = overrideScheduleDelaySeconds === null
        ? computedScheduleEpochSec
        : (currentEpochSeconds + effectiveScheduleDelaySeconds);
    const taskName = `${parent}/tasks/derived-metrics-ingress-${safeUid}-${bucketStartEpochSec}`;
    const payload = { data: { uid, bucketStartEpochSec } };

    return enqueueTaskWithRetry({
        parent,
        taskName,
        payload,
        serviceAccountEmail,
        url,
        scheduleDelaySeconds: effectiveScheduleDelaySeconds,
        scheduleAtEpochSeconds: effectiveScheduleEpochSeconds,
        alreadyExistsLogMessage: `[DerivedMetricsIngressDispatcher] Task already exists for ${uid} bucket ${bucketStartEpochSec}, skipping`,
        failedLogPrefix: `[DerivedMetricsIngressDispatcher] Failed to enqueue derived metrics ingress task for ${uid} bucket ${bucketStartEpochSec}:`,
    });
}

interface EnqueueTaskParams {
    parent: string;
    taskName: string;
    payload: unknown;
    serviceAccountEmail: string;
    url: string;
    scheduleDelaySeconds?: number;
    scheduleAtEpochSeconds?: number;
    dispatchDeadlineSeconds?: number;
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
        scheduleAtEpochSeconds,
        dispatchDeadlineSeconds,
        alreadyExistsLogMessage,
        failedLogPrefix,
    } = params;

    const task: protos.google.cloud.tasks.v2beta3.ITask = {
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

    if (Number.isFinite(dispatchDeadlineSeconds)) {
        task.dispatchDeadline = {
            seconds: Math.max(1, Math.floor(dispatchDeadlineSeconds as number)),
        };
    }

    if (Number.isFinite(scheduleAtEpochSeconds)) {
        task.scheduleTime = {
            seconds: Math.max(1, Math.floor(scheduleAtEpochSeconds as number)),
        };
    } else {
        const minDelaySeconds = Math.max(scheduleDelaySeconds ?? 1, 1);
        task.scheduleTime = {
            seconds: Math.floor(Date.now() / 1000) + minDelaySeconds
        };
    }

    let attempt = 0;
    const MAX_RETRIES = 3;

    while (attempt < MAX_RETRIES) {
        try {
            const currentClient = getCloudTasksClient();
            const [response] = await currentClient.createTask({ parent, task });
            logger.info(`[Dispatcher] Enqueued task: ${response.name}`);
            return true;
        } catch (error) {
            const cloudTaskError = error as { code?: unknown; message?: unknown };
            const errorMessage = `${cloudTaskError.message || ''}`;

            if (cloudTaskError.code === 6) {
                logger.info(alreadyExistsLogMessage);
                return false;
            }

            const isRetryable = (cloudTaskError.code === 14) ||
                (errorMessage.includes('ECONNRESET') || errorMessage.includes('Unavailable'));

            if (isRetryable && attempt < MAX_RETRIES - 1) {
                logger.warn(`[Dispatcher] Transient error enqueueing task (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMessage}. Resetting client and retrying...`);
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
