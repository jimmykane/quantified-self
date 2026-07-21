/**
 * Cloud Tasks Utilities
 *
 * This module centralizes all Cloud Tasks operations, including:
 * - Queue depth monitoring
 * - Task enqueuing with deduplication
 * - Singleton client management for performance
 */

import { v2beta3 } from '@google-cloud/tasks';
import { getFunctions, TaskOptions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';
import { config } from '../config';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS,
    REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS,
} from './activity-processing-config';
import {
    normalizeDerivedMetricKindsStrict,
    type DerivedMetricKind,
} from '../../../shared/derived-metrics';

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

export interface WorkoutTaskDispatchItem {
    id: string;
    dateCreated: number;
    retryCount?: number;
    totalRetryCount?: number;
    dispatchRecoveryGeneration?: number;
}

export interface EnqueueWorkoutTaskWithDispatchRecoveryParams<T extends WorkoutTaskDispatchItem> {
    serviceName: ServiceNames;
    queueItem: T;
    advanceDispatchRecoveryGeneration: (queueItem: T) => Promise<WorkoutTaskDispatchItem | null>;
    scheduleDelaySeconds?: number;
    /**
     * Allows legacy dispatchers to preserve their existing enqueue seam while
     * sharing the recovery algorithm. New callers should use the default.
     */
    enqueueTask?: (
        serviceName: ServiceNames,
        queueItemId: string,
        dateCreated: number,
        scheduleDelaySeconds?: number,
        options?: EnqueueWorkoutTaskOptions,
    ) => Promise<boolean>;
}

export interface MarkWorkoutTaskDispatchedWithRetryParams {
    serviceName: ServiceNames;
    queueItemId: string;
    markDispatched: () => Promise<boolean>;
}

const POST_ENQUEUE_DISPATCH_MARKER_MAX_ATTEMPTS = 3;
const POST_ENQUEUE_DISPATCH_MARKER_RETRY_BASE_DELAY_MS = 25;

function getCloudTasksClient(): v2beta3.CloudTasksClient {
    if (!_cloudTasksClient) {
        _cloudTasksClient = new v2beta3.CloudTasksClient();
    }
    return _cloudTasksClient;
}

function getCloudTasksEmulatorHost(): string | null {
    const host = process.env.CLOUD_TASKS_EMULATOR_HOST?.trim();
    return host || null;
}

function getTaskFunctionResource(projectId: string, location: string, functionName: string): string {
    return `projects/${projectId}/locations/${location}/functions/${functionName}`;
}

function getCloudTaskName(projectId: string, location: string, queueId: string, taskId: string): string {
    return `projects/${projectId}/locations/${location}/queues/${queueId}/tasks/${taskId}`;
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
    // The task emulator does not expose an individual task lookup endpoint. A
    // duplicate enqueue there is sufficient evidence that the task is still
    // reserved, and avoids falling through to the production Cloud Tasks API.
    if (getCloudTasksEmulatorHost()) {
        return true;
    }

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
export type CloudTaskQueueState = 'RUNNING' | 'PAUSED' | 'DISABLED' | 'UNKNOWN';

export interface CloudTaskQueueRuntimeStats {
    pending: number;
    state: CloudTaskQueueState;
    enabled: boolean | null;
}

const cachedQueueStatsByQueue = new Map<string, { stats: CloudTaskQueueRuntimeStats; timestamp: number }>();

function normalizeCloudTaskQueueState(state: unknown): CloudTaskQueueState {
    if (state === 'RUNNING' || state === 'PAUSED' || state === 'DISABLED') {
        return state;
    }
    if (state === 1) {
        return 'RUNNING';
    }
    if (state === 2) {
        return 'PAUSED';
    }
    if (state === 3) {
        return 'DISABLED';
    }
    return 'UNKNOWN';
}

function isCloudTaskQueueEnabled(state: CloudTaskQueueState): boolean | null {
    if (state === 'RUNNING') {
        return true;
    }
    if (state === 'PAUSED' || state === 'DISABLED') {
        return false;
    }
    return null;
}

/**
 * Resets the Cloud Task queue depth cache.
 * Note: This is primarily used for unit testing.
 */
export function resetCloudTaskQueueDepthCache(): void {
    cachedQueueStatsByQueue.clear();
}

/**
 * Resets the Cloud Tasks client singleton.
 * Note: This is primarily used for unit testing.
 */
export function resetCloudTasksClient(): void {
    _cloudTasksClient = null;
}

/**
 * Get the current runtime stats for the specified Cloud Tasks queue.
 * Uses caching to reduce API calls unless forceRefresh is true.
 */
export async function getCloudTaskQueueStatsForQueue(queueId: string, forceRefresh = false): Promise<CloudTaskQueueRuntimeStats> {
    const cached = cachedQueueStatsByQueue.get(queueId);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.stats;
    }

    const { projectId, location } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const emulatorHost = getCloudTasksEmulatorHost();
    if (emulatorHost) {
        const response = await fetch(`http://${emulatorHost}/queueStats`);
        if (!response.ok) {
            throw new Error(`Cloud Tasks emulator queue stats request failed: ${response.status}`);
        }

        const queueStats = await response.json() as Record<string, { numberOfTasks?: unknown }>;
        const statsKey = `queue:${projectId}-${location}-${queueId}`;
        const reportedPending = Number(queueStats[statsKey]?.numberOfTasks || 0);
        const stats = {
            pending: Number.isFinite(reportedPending) ? Math.max(0, reportedPending) : 0,
            state: 'RUNNING' as const,
            enabled: true,
        };
        cachedQueueStatsByQueue.set(queueId, { stats, timestamp: Date.now() });
        return stats;
    }

    const client = getCloudTasksClient();
    const name = client.queuePath(projectId, location, queueId);

    const [response] = await client.getQueue({
        name,
        readMask: {
            paths: ['stats', 'state'],
        },
    });

    const tasksCount = Number(response.stats?.tasksCount || 0);
    const state = normalizeCloudTaskQueueState(response.state);
    const stats = {
        pending: tasksCount,
        state,
        enabled: isCloudTaskQueueEnabled(state),
    };
    cachedQueueStatsByQueue.set(queueId, { stats, timestamp: Date.now() });
    return stats;
}

/**
 * Get the current depth (number of tasks) in the specified Cloud Tasks queue.
 * Uses caching to reduce API calls unless forceRefresh is true.
 */
export async function getCloudTaskQueueDepthForQueue(queueId: string, forceRefresh = false): Promise<number> {
    return (await getCloudTaskQueueStatsForQueue(queueId, forceRefresh)).pending;
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
    const { projectId, location, workoutQueue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const sanitizedServiceName = sanitizeTaskNamePart(serviceName);
    const safeQueueItemId = sanitizeTaskNamePart(`${queueItemId}`);
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;

    // Use dateCreated to ensure uniqueness for re-created items (race condition fix)
    // while preserving deduplication for retries of the SAME item.
    const taskId = `${sanitizedServiceName}-${safeQueueItemId}-${safeDateCreated}`;
    const taskName = getCloudTaskName(projectId, location, workoutQueue, taskId);

    const payload = { queueItemId, serviceName };

    const taskCreated = await enqueueTaskWithRetry({
        projectId,
        location,
        functionName: workoutQueue,
        taskId,
        payload,
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
    const recoveryTaskId = `${taskId}-dedupe-recovery-${recoveryTaskKey}`;
    const recoveryTaskName = getCloudTaskName(projectId, location, workoutQueue, recoveryTaskId);
    logger.warn(`[Dispatcher] Task name for ${serviceName}:${queueItemId} is reserved but no live task was found; enqueueing recovery task.`);
    const recoveryTaskCreated = await enqueueTaskWithRetry({
        projectId,
        location,
        functionName: workoutQueue,
        taskId: recoveryTaskId,
        payload,
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

function workoutTaskRetryGeneration(queueItem: Pick<WorkoutTaskDispatchItem, 'totalRetryCount' | 'retryCount'>): number {
    if (typeof queueItem.totalRetryCount === 'number' && Number.isFinite(queueItem.totalRetryCount)) {
        return Math.max(0, Math.floor(queueItem.totalRetryCount));
    }
    if (typeof queueItem.retryCount === 'number' && Number.isFinite(queueItem.retryCount)) {
        return Math.max(0, Math.floor(queueItem.retryCount));
    }
    return 0;
}

function workoutTaskDispatchRecoveryGeneration(queueItem: Pick<WorkoutTaskDispatchItem, 'dispatchRecoveryGeneration'>): number {
    return typeof queueItem.dispatchRecoveryGeneration === 'number' && Number.isFinite(queueItem.dispatchRecoveryGeneration)
        ? Math.max(0, Math.floor(queueItem.dispatchRecoveryGeneration))
        : 0;
}

function workoutTaskRecoveryKey(queueItem: WorkoutTaskDispatchItem): number | string {
    const retryGeneration = workoutTaskRetryGeneration(queueItem);
    const dispatchGeneration = workoutTaskDispatchRecoveryGeneration(queueItem);
    return dispatchGeneration > 0 ? `${retryGeneration}-${dispatchGeneration}` : retryGeneration;
}

/**
 * Dispatch a durable workout queue item while recovering from Cloud Tasks'
 * temporary task-name reservation. The queue-specific callback advances a
 * persistent recovery generation only when the item is still current.
 */
export async function enqueueWorkoutTaskWithDispatchRecovery<T extends WorkoutTaskDispatchItem>(
    params: EnqueueWorkoutTaskWithDispatchRecoveryParams<T>,
): Promise<boolean> {
    const enqueueTask = params.enqueueTask || enqueueWorkoutTask;
    const taskCreated = await enqueueTask(
        params.serviceName,
        params.queueItem.id,
        params.queueItem.dateCreated,
        params.scheduleDelaySeconds,
        { recoveryTaskKey: workoutTaskRecoveryKey(params.queueItem) },
    );
    if (taskCreated) return true;

    const nextQueueItem = await params.advanceDispatchRecoveryGeneration(params.queueItem);
    if (!nextQueueItem) {
        logger.info(`[Dispatcher] Could not advance dispatch recovery generation for ${params.serviceName}:${params.queueItem.id}; leaving dispatch marker unchanged.`);
        return false;
    }

    logger.warn(`[Dispatcher] Advanced dispatch recovery generation for ${params.serviceName}:${params.queueItem.id} to ${nextQueueItem.dispatchRecoveryGeneration}; retrying deterministic Cloud Task enqueue.`);
    return enqueueTask(
        params.serviceName,
        nextQueueItem.id,
        nextQueueItem.dateCreated,
        params.scheduleDelaySeconds,
        { recoveryTaskKey: workoutTaskRecoveryKey(nextQueueItem) },
    );
}

function getRetryableDispatchMarkerCause(error: unknown): unknown {
    if (error instanceof Error && error.name === 'UserDeletionGuardReadError' && 'originalError' in error) {
        return (error as Error & { originalError: unknown }).originalError;
    }
    return error;
}

function isRetryableFirestoreDispatchMarkerError(error: unknown): boolean {
    const cause = getRetryableDispatchMarkerCause(error);
    const code = (cause as { code?: unknown } | null | undefined)?.code;
    const details = `${(cause as { details?: unknown } | null | undefined)?.details || ''}`.toLowerCase();
    const message = `${(cause as { message?: unknown } | null | undefined)?.message || ''}`.toLowerCase();
    const normalizedCode = typeof code === 'string' ? code.toLowerCase() : code;

    return normalizedCode === 10
        || normalizedCode === 14
        || normalizedCode === 4
        || normalizedCode === 'aborted'
        || normalizedCode === 'unavailable'
        || normalizedCode === 'deadline-exceeded'
        || details.includes('too much contention')
        || message.includes('too much contention');
}

function waitForDispatchMarkerRetry(attempt: number): Promise<void> {
    const delayMs = (POST_ENQUEUE_DISPATCH_MARKER_RETRY_BASE_DELAY_MS * attempt)
        + Math.floor(Math.random() * POST_ENQUEUE_DISPATCH_MARKER_RETRY_BASE_DELAY_MS);
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * A task can be accepted before its Firestore dispatch marker is persisted.
 * Retry only transient marker writes; the caller decides whether its queue
 * item is still current before each write.
 */
export async function markWorkoutTaskDispatchedWithRetry(
    params: MarkWorkoutTaskDispatchedWithRetryParams,
): Promise<boolean> {
    for (let attempt = 1; attempt <= POST_ENQUEUE_DISPATCH_MARKER_MAX_ATTEMPTS; attempt++) {
        try {
            return await params.markDispatched();
        } catch (error) {
            if (!isRetryableFirestoreDispatchMarkerError(error)) throw error;

            if (attempt < POST_ENQUEUE_DISPATCH_MARKER_MAX_ATTEMPTS) {
                logger.warn(`[Dispatcher] Retryable dispatch marker write failure after Cloud Task enqueue for ${params.serviceName}:${params.queueItemId}; retrying marker write (${attempt}/${POST_ENQUEUE_DISPATCH_MARKER_MAX_ATTEMPTS}).`, error);
                await waitForDispatchMarkerRetry(attempt);
                continue;
            }

            logger.warn(`[Dispatcher] Retryable dispatch marker write failure after Cloud Task enqueue for ${params.serviceName}:${params.queueItemId}; leaving marker untouched because the task was already accepted.`, error);
            return true;
        }
    }

    return true;
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
    const { projectId, location, activitySyncQueue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskId = `activity-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { queueItemId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: activitySyncQueue,
        taskId,
        payload,
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
    const { projectId, location, routeSyncQueue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskId = `route-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { queueItemId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: routeSyncQueue,
        taskId,
        payload,
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
    const { projectId, location, routeDeliverySyncQueue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskId = `route-delivery-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { queueItemId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: routeDeliverySyncQueue,
        taskId,
        payload,
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
    const { projectId, location, sleepSyncQueue } = config.cloudtasks;

    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeQueueItemId = `${queueItemId}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeDateCreated = Number.isFinite(dateCreated) ? Math.max(0, Math.floor(dateCreated)) : 0;
    const taskId = `sleep-sync-${safeQueueItemId}-${safeDateCreated}`;
    const payload = { queueItemId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: sleepSyncQueue,
        taskId,
        payload,
        scheduleDelaySeconds,
        alreadyExistsLogMessage: `[SleepSyncDispatcher] Task already exists for queue item ${queueItemId}, skipping`,
        failedLogPrefix: `[SleepSyncDispatcher] Failed to enqueue sleep sync task for ${queueItemId}:`,
    });
}

/**
 * Enqueue a single sports-lib reparse job task.
 */
export async function enqueueSportsLibReparseTask(jobId: string, scheduleDelaySeconds?: number): Promise<boolean> {
    const { projectId, location, sportsLibReparseQueue } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const taskId = `reparse-${safeJobId}`;
    const payload = { jobId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: sportsLibReparseQueue,
        taskId,
        payload,
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
    const { projectId, location, sportsLibReparseHeavyQueue } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const options = typeof optionsOrScheduleDelaySeconds === 'number'
        ? { scheduleDelaySeconds: optionsOrScheduleDelaySeconds }
        : (optionsOrScheduleDelaySeconds || {});
    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeTaskNameSuffix = options.taskNameSuffix
        ? `-${options.taskNameSuffix.replace(/[^a-zA-Z0-9-_]/g, '-')}`
        : '';
    const taskId = `reparse-heavy-${safeJobId}${safeTaskNameSuffix}`;
    const payload = { jobId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: sportsLibReparseHeavyQueue,
        taskId,
        payload,
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
    const { projectId, location, sportsLibRouteReparseQueue } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeJobId = jobId.replace(/[^a-zA-Z0-9-_]/g, '-');
    const taskId = `route-reparse-${safeJobId}`;
    const payload = { jobId };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: sportsLibRouteReparseQueue,
        taskId,
        payload,
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
    const { projectId, location, derivedMetricsQueue } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeUid = `${uid}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const safeGeneration = Number.isFinite(generation) ? Math.max(0, Math.floor(generation)) : 0;
    const taskId = `derived-metrics-${safeUid}-${safeGeneration}`;
    const payload = { uid, generation: safeGeneration };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: derivedMetricsQueue,
        taskId,
        payload,
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
    options?: {
        taskScope?: string;
        metricKinds?: readonly DerivedMetricKind[];
        incrementEventMutationVersion?: boolean;
    },
): Promise<boolean> {
    const {
        projectId,
        location,
        derivedMetricsIngressQueue,
        derivedMetricsIngressBucketSeconds,
    } = config.cloudtasks;
    if (!projectId) {
        throw new Error('Project ID is not defined in config');
    }

    const safeUid = `${uid}`.replace(/[^a-zA-Z0-9-_]/g, '-');
    const taskScope = `${options?.taskScope || ''}`.trim();
    if (taskScope && !/^[a-zA-Z0-9-_]+$/.test(taskScope)) {
        throw new Error('Derived metrics ingress task scope is invalid');
    }
    const hasTargetedMetricKinds = options?.metricKinds !== undefined;
    const metricKinds = hasTargetedMetricKinds
        ? normalizeDerivedMetricKindsStrict(options.metricKinds)
        : [];
    if (hasTargetedMetricKinds && !metricKinds.length) {
        throw new Error('Derived metrics ingress metric kinds are invalid');
    }
    if (hasTargetedMetricKinds && !taskScope) {
        throw new Error('Targeted derived metrics ingress requires a task scope');
    }
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
    const taskId = `derived-metrics-ingress-${safeUid}-${bucketStartEpochSec}${taskScope ? `-${taskScope}` : ''}`;
    const payload = {
        uid,
        bucketStartEpochSec,
        ...(hasTargetedMetricKinds ? { metricKinds } : {}),
        ...(options?.incrementEventMutationVersion === false ? { incrementEventMutationVersion: false } : {}),
    };

    return enqueueTaskWithRetry({
        projectId,
        location,
        functionName: derivedMetricsIngressQueue,
        taskId,
        payload,
        scheduleDelaySeconds: effectiveScheduleDelaySeconds,
        scheduleAtEpochSeconds: effectiveScheduleEpochSeconds,
        alreadyExistsLogMessage: `[DerivedMetricsIngressDispatcher] Task already exists for ${uid} bucket ${bucketStartEpochSec}, skipping`,
        failedLogPrefix: `[DerivedMetricsIngressDispatcher] Failed to enqueue derived metrics ingress task for ${uid} bucket ${bucketStartEpochSec}:`,
    });
}

interface EnqueueTaskParams {
    projectId: string;
    location: string;
    functionName: string;
    taskId: string;
    payload: Record<string, unknown>;
    scheduleDelaySeconds?: number;
    scheduleAtEpochSeconds?: number;
    dispatchDeadlineSeconds?: number;
    alreadyExistsLogMessage: string;
    failedLogPrefix: string;
}

async function enqueueTaskWithRetry(params: EnqueueTaskParams): Promise<boolean> {
    const {
        projectId,
        location,
        functionName,
        taskId,
        payload,
        scheduleDelaySeconds,
        scheduleAtEpochSeconds,
        dispatchDeadlineSeconds,
        alreadyExistsLogMessage,
        failedLogPrefix,
    } = params;

    const taskOptions: TaskOptions = { id: taskId };
    if (Number.isFinite(dispatchDeadlineSeconds)) {
        taskOptions.dispatchDeadlineSeconds = Math.max(1, Math.floor(dispatchDeadlineSeconds as number));
    }

    if (Number.isFinite(scheduleAtEpochSeconds)) {
        taskOptions.scheduleTime = new Date(Math.max(1, Math.floor(scheduleAtEpochSeconds as number)) * 1000);
    } else {
        taskOptions.scheduleDelaySeconds = Math.max(scheduleDelaySeconds ?? 1, 1);
    }

    const taskName = getCloudTaskName(projectId, location, functionName, taskId);
    const taskQueue = getFunctions().taskQueue<Record<string, unknown>>(
        getTaskFunctionResource(projectId, location, functionName),
    );

    let attempt = 0;
    const MAX_RETRIES = 3;

    while (attempt < MAX_RETRIES) {
        try {
            await taskQueue.enqueue(payload, taskOptions);
            logger.info(`[Dispatcher] Enqueued task: ${taskName}`);
            return true;
        } catch (error) {
            const cloudTaskError = error as { code?: unknown; message?: unknown };
            const errorMessage = `${cloudTaskError.message || ''}`;

            if (cloudTaskError.code === 6 || cloudTaskError.code === 'functions/task-already-exists') {
                logger.info(alreadyExistsLogMessage);
                return false;
            }

            const isRetryable = (cloudTaskError.code === 14)
                || cloudTaskError.code === 'functions/unavailable'
                || cloudTaskError.code === 'functions/internal-error'
                ||
                (errorMessage.includes('ECONNRESET') || errorMessage.includes('Unavailable'));

            if (isRetryable && attempt < MAX_RETRIES - 1) {
                logger.warn(`[Dispatcher] Transient error enqueueing task (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMessage}. Retrying...`);
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
