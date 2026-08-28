import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { onAdminCall } from '../../shared/auth';
import { toEpochMillis } from '../shared/date.utils';
import type {
    AdminDashboardHistoryDays,
    AdminDashboardHistoryPoint,
    AdminDashboardHistoryResponse,
    GetAdminDashboardHistoryRequest,
    SubscriptionCadenceTierStats,
} from '../shared/types';
import {
    collectUserPlanActivityMetrics,
    type UserPlanActivityMetrics,
} from '../shared/user-metrics';

export const ADMIN_DASHBOARD_SNAPSHOTS_COLLECTION = 'adminDashboardSnapshots';
const ADMIN_DASHBOARD_SNAPSHOT_SCHEMA_VERSION = 1;
const ADMIN_DASHBOARD_METRIC_DEFINITION_VERSION = 1;
const ADMIN_DASHBOARD_SNAPSHOT_RETENTION_DAYS = 730;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_DAYS: AdminDashboardHistoryDays = 90;
const ALLOWED_HISTORY_DAYS = new Set<number>([30, 90, 365]);

interface StoredAdminDashboardSnapshot {
    schemaVersion: number;
    metricDefinitionVersion: number;
    snapshotDate: string;
    scheduledFor: Date;
    computedAt: Date;
    expireAt: Date;
    users: AdminDashboardHistoryPoint['users'];
    authActivity: AdminDashboardHistoryPoint['authActivity'];
    subscriptionCadence: AdminDashboardHistoryPoint['subscriptionCadence'];
}

interface StoredSnapshotDocument {
    id: string;
    data: () => Record<string, unknown>;
}

function toUtcDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function isUtcDateKey(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && toUtcDateKey(new Date(parsed)) === value;
}

function shiftUtcDate(date: Date, days: number): Date {
    return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + days,
    ));
}

function resolveHistoryDays(value: unknown): AdminDashboardHistoryDays {
    if (value === undefined) {
        return DEFAULT_HISTORY_DAYS;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || !ALLOWED_HISTORY_DAYS.has(value)) {
        throw new HttpsError('invalid-argument', 'days must be one of 30, 90, or 365.');
    }
    return value as AdminDashboardHistoryDays;
}

function requireSafeCount(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid admin dashboard snapshot count: ${field}`);
    }
    return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid admin dashboard snapshot object: ${field}`);
    }
    return value as Record<string, unknown>;
}

function requireCadenceTier(value: unknown, field: string): SubscriptionCadenceTierStats {
    const record = requireObject(value, field);
    return {
        monthly: requireSafeCount(record['monthly'], `${field}.monthly`),
        yearly: requireSafeCount(record['yearly'], `${field}.yearly`),
        unknown: requireSafeCount(record['unknown'], `${field}.unknown`),
    };
}

function cadenceTotal(value: SubscriptionCadenceTierStats): number {
    return value.monthly + value.yearly + value.unknown;
}

function validateSnapshotMetrics(metrics: UserPlanActivityMetrics): void {
    const counts = {
        total: requireSafeCount(metrics.total, 'users.total'),
        free: requireSafeCount(metrics.free, 'users.free'),
        basic: requireSafeCount(metrics.basic, 'users.basic'),
        pro: requireSafeCount(metrics.pro, 'users.pro'),
        onboardingCompleted: requireSafeCount(metrics.onboardingCompleted, 'users.onboardingCompleted'),
        eligibleAccounts: requireSafeCount(metrics.eligibleAccounts, 'authActivity.eligibleAccounts'),
        last24Hours: requireSafeCount(metrics.authActivity.last24Hours, 'authActivity.last24Hours'),
        last7Days: requireSafeCount(metrics.authActivity.last7Days, 'authActivity.last7Days'),
        last30Days: requireSafeCount(metrics.authActivity.last30Days, 'authActivity.last30Days'),
    };

    if (counts.free + counts.basic + counts.pro !== counts.total) {
        throw new Error('Admin dashboard user-plan totals do not reconcile.');
    }
    if (counts.onboardingCompleted > counts.total) {
        throw new Error('Admin dashboard onboarding total exceeds total users.');
    }
    if (
        counts.last24Hours > counts.last7Days
        || counts.last7Days > counts.last30Days
        || counts.last30Days > counts.eligibleAccounts
    ) {
        throw new Error('Admin dashboard authentication activity counts do not reconcile.');
    }
    if (cadenceTotal(metrics.subscriptionCadence.pro) !== counts.pro) {
        throw new Error('Admin dashboard Pro cadence does not reconcile.');
    }
    if (cadenceTotal(metrics.subscriptionCadence.basic) !== counts.basic) {
        throw new Error('Admin dashboard Basic cadence does not reconcile.');
    }
}

function buildStoredSnapshot(
    metrics: UserPlanActivityMetrics,
    snapshotDate: string,
    scheduledFor: Date,
    computedAt: Date,
): StoredAdminDashboardSnapshot {
    validateSnapshotMetrics(metrics);
    return {
        schemaVersion: ADMIN_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
        metricDefinitionVersion: ADMIN_DASHBOARD_METRIC_DEFINITION_VERSION,
        snapshotDate,
        scheduledFor,
        computedAt,
        expireAt: new Date(computedAt.getTime() + (ADMIN_DASHBOARD_SNAPSHOT_RETENTION_DAYS * MILLISECONDS_PER_DAY)),
        users: {
            total: metrics.total,
            free: metrics.free,
            basic: metrics.basic,
            pro: metrics.pro,
            onboardingCompleted: metrics.onboardingCompleted,
        },
        authActivity: {
            eligibleAccounts: metrics.eligibleAccounts,
            last24Hours: metrics.authActivity.last24Hours,
            last7Days: metrics.authActivity.last7Days,
            last30Days: metrics.authActivity.last30Days,
        },
        subscriptionCadence: metrics.subscriptionCadence,
    };
}

function parseStoredSnapshot(document: StoredSnapshotDocument): AdminDashboardHistoryPoint | null {
    try {
        const data = document.data();
        if (
            data['schemaVersion'] !== ADMIN_DASHBOARD_SNAPSHOT_SCHEMA_VERSION
            || data['metricDefinitionVersion'] !== ADMIN_DASHBOARD_METRIC_DEFINITION_VERSION
        ) {
            throw new Error('Snapshot schema or metric-definition version is unsupported.');
        }
        if (data['snapshotDate'] !== document.id || !isUtcDateKey(document.id)) {
            throw new Error('Snapshot date does not match a valid UTC document ID.');
        }

        const scheduledForMs = toEpochMillis(data['scheduledFor']);
        const computedAtMs = toEpochMillis(data['computedAt']);
        const expireAtMs = toEpochMillis(data['expireAt']);
        if (scheduledForMs === null || computedAtMs === null || expireAtMs === null) {
            throw new Error('Snapshot timestamps are invalid.');
        }
        if (toUtcDateKey(new Date(scheduledForMs)) !== document.id) {
            throw new Error('Snapshot scheduledFor does not match its UTC date.');
        }
        if (
            computedAtMs < scheduledForMs
            || expireAtMs - computedAtMs !== ADMIN_DASHBOARD_SNAPSHOT_RETENTION_DAYS * MILLISECONDS_PER_DAY
        ) {
            throw new Error('Snapshot timestamp ordering or retention is invalid.');
        }

        const usersRecord = requireObject(data['users'], 'users');
        const authRecord = requireObject(data['authActivity'], 'authActivity');
        const cadenceRecord = requireObject(data['subscriptionCadence'], 'subscriptionCadence');
        const point: AdminDashboardHistoryPoint = {
            date: document.id,
            computedAt: new Date(computedAtMs).toISOString(),
            users: {
                total: requireSafeCount(usersRecord['total'], 'users.total'),
                free: requireSafeCount(usersRecord['free'], 'users.free'),
                basic: requireSafeCount(usersRecord['basic'], 'users.basic'),
                pro: requireSafeCount(usersRecord['pro'], 'users.pro'),
                onboardingCompleted: requireSafeCount(usersRecord['onboardingCompleted'], 'users.onboardingCompleted'),
            },
            authActivity: {
                eligibleAccounts: requireSafeCount(authRecord['eligibleAccounts'], 'authActivity.eligibleAccounts'),
                last24Hours: requireSafeCount(authRecord['last24Hours'], 'authActivity.last24Hours'),
                last7Days: requireSafeCount(authRecord['last7Days'], 'authActivity.last7Days'),
                last30Days: requireSafeCount(authRecord['last30Days'], 'authActivity.last30Days'),
            },
            subscriptionCadence: {
                pro: requireCadenceTier(cadenceRecord['pro'], 'subscriptionCadence.pro'),
                basic: requireCadenceTier(cadenceRecord['basic'], 'subscriptionCadence.basic'),
            },
        };

        validateSnapshotMetrics({
            ...point.users,
            monthlyPaid: point.subscriptionCadence.pro.monthly + point.subscriptionCadence.basic.monthly,
            yearlyPaid: point.subscriptionCadence.pro.yearly + point.subscriptionCadence.basic.yearly,
            subscriptionCadence: point.subscriptionCadence,
            cancelScheduled: 0,
            authActivity: {
                last24Hours: point.authActivity.last24Hours,
                last7Days: point.authActivity.last7Days,
                last30Days: point.authActivity.last30Days,
                computedAt: point.computedAt,
            },
            eligibleAccounts: point.authActivity.eligibleAccounts,
            providers: {},
        });
        return point;
    } catch (error) {
        logger.warn('Skipped malformed admin dashboard snapshot.', {
            snapshotDate: document.id,
            reason: error instanceof Error ? error.message : 'unknown',
        });
        return null;
    }
}

async function captureSnapshot(event: ScheduledEvent): Promise<void> {
    const scheduledForMs = Date.parse(event.scheduleTime);
    if (!Number.isFinite(scheduledForMs)) {
        throw new Error('Scheduled admin dashboard snapshot is missing a valid scheduleTime.');
    }

    const scheduledFor = new Date(scheduledForMs);
    const snapshotDate = toUtcDateKey(scheduledFor);
    const computedAt = new Date();
    const db = admin.firestore();
    const metrics = await collectUserPlanActivityMetrics(db, admin.auth(), computedAt);
    const snapshot = buildStoredSnapshot(metrics, snapshotDate, scheduledFor, computedAt);
    await db.collection(ADMIN_DASHBOARD_SNAPSHOTS_COLLECTION).doc(snapshotDate).set(snapshot);

    logger.info('Captured daily admin dashboard snapshot.', {
        snapshotDate,
        computedAt: computedAt.toISOString(),
        totalUsers: snapshot.users.total,
        eligibleAccounts: snapshot.authActivity.eligibleAccounts,
    });
}

export const scheduleAdminDashboardSnapshot = onSchedule({
    region: FUNCTIONS_MANIFEST.scheduleAdminDashboardSnapshot.region,
    schedule: '10 0 * * *',
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 300,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3600,
    maxRetrySeconds: 6 * 60 * 60,
}, captureSnapshot);

export const getAdminDashboardHistory = onAdminCall<GetAdminDashboardHistoryRequest, AdminDashboardHistoryResponse>({
    region: FUNCTIONS_MANIFEST.getAdminDashboardHistory.region,
    memory: '256MiB',
}, async (request) => {
    const days = resolveHistoryDays(request.data?.days);
    const endDateValue = new Date();
    const endDate = toUtcDateKey(endDateValue);
    const startDate = toUtcDateKey(shiftUtcDate(endDateValue, -(days - 1)));

    try {
        const snapshot = await admin.firestore()
            .collection(ADMIN_DASHBOARD_SNAPSHOTS_COLLECTION)
            .orderBy(FieldPath.documentId())
            .startAt(startDate)
            .endAt(endDate)
            .limit(days)
            .get();
        const snapshots = snapshot.docs
            .map((document: StoredSnapshotDocument) => parseStoredSnapshot(document))
            .filter((point): point is AdminDashboardHistoryPoint => point !== null)
            .sort((left, right) => left.date.localeCompare(right.date));

        return { days, startDate, endDate, snapshots };
    } catch (error) {
        logger.error('Failed to read admin dashboard history.', error);
        throw new HttpsError('internal', 'Failed to get admin dashboard history.');
    }
});

export const adminDashboardHistoryTestInternals = {
    buildStoredSnapshot,
    parseStoredSnapshot,
    resolveHistoryDays,
    toUtcDateKey,
};
