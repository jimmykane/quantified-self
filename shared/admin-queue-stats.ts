export interface GetQueueStatsRequest {
    includeAnalysis?: boolean;
}

export interface QueueRetryHistogram {
    '0-3': number;
    '4-7': number;
    '8-9': number;
}

export interface QueueTopError {
    error: string;
    count: number;
}

export interface QueueAdvancedStats {
    throughput: number;
    maxLagMs: number;
    retryHistogram: QueueRetryHistogram;
    topErrors: QueueTopError[];
}

export interface DLQStats {
    total: number;
    byContext: { context: string; count: number }[];
    byProvider: { provider: string; count: number }[];
}

export interface CloudTaskQueueStats {
    queueId: string;
    pending: number;
    state?: 'RUNNING' | 'PAUSED' | 'DISABLED' | 'UNKNOWN';
    enabled?: boolean | null;
}

export interface CloudTaskQueueBreakdown {
    workout: CloudTaskQueueStats;
    activitySync: CloudTaskQueueStats;
    routeDeliverySync: CloudTaskQueueStats;
    routeSync: CloudTaskQueueStats;
    sportsLibReparse: CloudTaskQueueStats;
    sportsLibReparseHeavy: CloudTaskQueueStats;
    sportsLibRouteReparse: CloudTaskQueueStats;
    derivedMetricsIngress: CloudTaskQueueStats;
    derivedMetrics: CloudTaskQueueStats;
    sleepSync: CloudTaskQueueStats;
}

export interface ReparseCheckpointBaseStats {
    lastScanAt: unknown;
    lastPassStartedAt: unknown;
    lastPassCompletedAt: unknown;
    lastScanCount: number;
    lastEnqueuedCount: number;
    overrideUsersInProgress: number;
}

export interface EventReparseCheckpointStats extends ReparseCheckpointBaseStats {
    cursorEventPath: string | null;
}

export interface RouteReparseCheckpointStats extends ReparseCheckpointBaseStats {
    cursorProcessingDocPath: string | null;
    cursorProcessingVersionCode: number | null;
}

export interface ReparseJobsStats {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

export interface EventReparseJobsStats extends ReparseJobsStats {
    currentTargetFailed?: number;
    historicalFailed?: number;
    superseded?: number;
}

export interface RouteReparseJobsStats extends ReparseJobsStats {
    skipped: number;
}

export interface EventReparseFailurePreview {
    jobId: string;
    uid: string;
    eventId: string;
    attemptCount: number;
    lastError: string;
    updatedAt: unknown;
    targetSportsLibVersion: string;
    outcome?: 'active_failure' | 'historical_failure' | 'superseded';
    supersededBySportsLibVersion?: string;
    processingTier?: string;
    heavyReason?: string;
    eventDurationMs?: number | null;
}

export interface RouteReparseFailurePreview {
    jobId: string;
    uid: string;
    routeId: string;
    attemptCount: number;
    lastError: string;
    updatedAt: unknown;
    targetSportsLibVersion: string;
}

export interface ReparseQueueStats<
    TCheckpoint extends ReparseCheckpointBaseStats,
    TFailure,
    TJobs extends ReparseJobsStats = ReparseJobsStats
> {
    /** Whether the automatic scanner may discover and enqueue new work; distinct from Cloud Tasks queue state. */
    automaticScanEnabled?: boolean;
    queuePending: number;
    targetSportsLibVersion: string;
    jobs: TJobs;
    checkpoint: TCheckpoint;
    recentFailures: TFailure[];
}

export type EventReparseStats = ReparseQueueStats<
    EventReparseCheckpointStats,
    EventReparseFailurePreview,
    EventReparseJobsStats
>;

export type RouteReparseStats = ReparseQueueStats<RouteReparseCheckpointStats, RouteReparseFailurePreview, RouteReparseJobsStats>;

export interface DerivedMetricsCoordinatorStats {
    idle: number;
    queued: number;
    processing: number;
    staleQueued: number;
    staleProcessing: number;
    failed: number;
    total: number;
}

export interface DerivedMetricsFailurePreview {
    uid: string;
    generation: number;
    dirtyMetricKinds: string[];
    lastError: string;
    updatedAtMs: number;
}

export interface DerivedMetricsStats {
    coordinators: DerivedMetricsCoordinatorStats;
    recentFailures: DerivedMetricsFailurePreview[];
}

export interface SyncPipelineQueueStats {
    pending: number;
    succeeded: number;
    stuck: number;
    dead: number;
    dlqByContext: { context: string; count: number }[];
    advanced: QueueAdvancedStats;
}

export type ActivitySyncQueueStats = SyncPipelineQueueStats;

export interface RouteDeliverySyncQueueStats extends SyncPipelineQueueStats {
    skipped: number;
}

export interface RouteSyncQueueStats extends SyncPipelineQueueStats {
    skipped: number;
}

export interface SleepSyncProviderQueueStats {
    provider: string;
    pending: number;
    succeeded: number;
    providerDisabled: number;
    stuck: number;
    dead: number;
}

export interface SleepSyncQueueStats extends SyncPipelineQueueStats {
    providerDisabled: number;
    disabledProviders: string[];
    providers: SleepSyncProviderQueueStats[];
}

export interface AdminQueueProviderStats {
    name: string;
    pending: number;
    succeeded: number;
    stuck: number;
    dead: number;
}

export interface AdminQueueStatsResponse {
    pending: number;
    succeeded: number;
    stuck: number;
    cloudTasks: {
        pending: number;
        queues: CloudTaskQueueBreakdown;
    };
    providers: AdminQueueProviderStats[];
    dlq: DLQStats | undefined;
    reparse: EventReparseStats;
    routeReparse: RouteReparseStats;
    derivedMetrics: DerivedMetricsStats;
    advanced: QueueAdvancedStats;
    activitySync: ActivitySyncQueueStats;
    routeDeliverySync: RouteDeliverySyncQueueStats;
    routeSync: RouteSyncQueueStats;
    sleepSync: SleepSyncQueueStats;
}

export type AdminQueueStatsSnapshot = Omit<
    AdminQueueStatsResponse,
    'cloudTasks' | 'dlq' | 'reparse' | 'routeReparse' | 'derivedMetrics' | 'advanced' | 'activitySync' | 'sleepSync'
> & {
    cloudTasks?: {
        pending: number;
        queues?: Partial<CloudTaskQueueBreakdown>;
    };
    dlq?: DLQStats;
    reparse?: EventReparseStats;
    routeReparse?: RouteReparseStats;
    derivedMetrics?: DerivedMetricsStats;
    advanced?: QueueAdvancedStats;
    activitySync?: ActivitySyncQueueStats;
    routeDeliverySync?: RouteDeliverySyncQueueStats;
    routeSync?: RouteSyncQueueStats;
    sleepSync?: SleepSyncQueueStats;
};
