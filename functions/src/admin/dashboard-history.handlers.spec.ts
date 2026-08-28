import type { CallableRequest } from 'firebase-functions/v2/https';
import type { ScheduledEvent } from 'firebase-functions/v2/scheduler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AdminDashboardHistoryResponse,
    GetAdminDashboardHistoryRequest,
} from './shared/types';
import type { UserPlanActivityMetrics } from './shared/user-metrics';

const mocks = vi.hoisted(() => ({
    auth: {},
    collection: vi.fn(),
    collectUserPlanActivityMetrics: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    scheduleOptions: null as Record<string, unknown> | null,
    onSchedule: vi.fn((options: Record<string, unknown>, handler: unknown) => {
        mocks.scheduleOptions = options;
        return handler;
    }),
}));

vi.mock('firebase-admin', () => ({
    auth: vi.fn(() => mocks.auth),
    firestore: vi.fn(() => ({ collection: mocks.collection })),
}));

vi.mock('firebase-admin/firestore', () => ({
    FieldPath: { documentId: vi.fn(() => '__name__') },
}));

vi.mock('firebase-functions/logger', () => ({
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
}));

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: mocks.onSchedule,
}));

vi.mock('../shared/auth', () => ({
    onAdminCall: vi.fn((_options: unknown, handler: unknown) => handler),
}));

vi.mock('./shared/user-metrics', () => ({
    collectUserPlanActivityMetrics: mocks.collectUserPlanActivityMetrics,
}));

import {
    getAdminDashboardHistory,
    scheduleAdminDashboardSnapshot,
} from './handlers/dashboard-history.handlers';

const invokeHistory = getAdminDashboardHistory as unknown as (
    request: CallableRequest<GetAdminDashboardHistoryRequest>,
) => Promise<AdminDashboardHistoryResponse>;
const invokeSchedule = scheduleAdminDashboardSnapshot as unknown as (
    event: ScheduledEvent,
) => Promise<void>;

function metrics(overrides: Partial<UserPlanActivityMetrics> = {}): UserPlanActivityMetrics {
    return {
        total: 10,
        pro: 2,
        basic: 3,
        free: 5,
        monthlyPaid: 3,
        yearlyPaid: 2,
        subscriptionCadence: {
            pro: { monthly: 1, yearly: 1, unknown: 0 },
            basic: { monthly: 2, yearly: 1, unknown: 0 },
        },
        cancelScheduled: 1,
        onboardingCompleted: 7,
        authActivity: {
            last24Hours: 2,
            last7Days: 5,
            last30Days: 8,
            computedAt: '2026-08-27T00:12:00.000Z',
        },
        eligibleAccounts: 9,
        providers: { 'google.com': 6 },
        ...overrides,
    };
}

function storedDocument(date: string, overrides: Record<string, unknown> = {}) {
    const computedAt = new Date(`${date}T00:12:00.000Z`);
    return {
        id: date,
        data: () => ({
            schemaVersion: 1,
            metricDefinitionVersion: 1,
            snapshotDate: date,
            scheduledFor: new Date(`${date}T00:10:00.000Z`),
            computedAt,
            expireAt: new Date(computedAt.getTime() + (730 * 24 * 60 * 60 * 1000)),
            users: {
                total: 10,
                free: 5,
                basic: 3,
                pro: 2,
                onboardingCompleted: 7,
            },
            authActivity: {
                eligibleAccounts: 9,
                last24Hours: 2,
                last7Days: 5,
                last30Days: 8,
            },
            subscriptionCadence: {
                pro: { monthly: 1, yearly: 1, unknown: 0 },
                basic: { monthly: 2, yearly: 1, unknown: 0 },
            },
            ...overrides,
        }),
    };
}

function historyRequest(days?: 30 | 90 | 365): CallableRequest<GetAdminDashboardHistoryRequest> {
    return {
        data: days === undefined ? {} : { days },
        auth: { uid: 'admin', token: { admin: true } },
        app: { appId: 'test-app' },
    } as unknown as CallableRequest<GetAdminDashboardHistoryRequest>;
}

describe('admin dashboard history', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-27T00:12:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('pins the daily UTC schedule and bounded retry policy', () => {
        expect(mocks.scheduleOptions).toMatchObject({
            region: 'europe-west2',
            schedule: '10 0 * * *',
            timeZone: 'UTC',
            retryCount: 3,
            minBackoffSeconds: 60,
            maxBackoffSeconds: 3600,
            maxRetrySeconds: 21_600,
        });
    });

    it('captures one idempotent aggregate-only snapshot for the scheduled UTC date', async () => {
        const set = vi.fn().mockResolvedValue(undefined);
        const doc = vi.fn(() => ({ set }));
        mocks.collection.mockReturnValue({ doc });
        mocks.collectUserPlanActivityMetrics.mockResolvedValue(metrics());

        await invokeSchedule({ scheduleTime: '2026-08-27T00:10:00.000Z' } as ScheduledEvent);

        expect(doc).toHaveBeenCalledWith('2026-08-27');
        expect(set).toHaveBeenCalledTimes(1);
        const payload = set.mock.calls[0][0];
        expect(payload).toMatchObject({
            schemaVersion: 1,
            metricDefinitionVersion: 1,
            snapshotDate: '2026-08-27',
            scheduledFor: new Date('2026-08-27T00:10:00.000Z'),
            computedAt: new Date('2026-08-27T00:12:00.000Z'),
            users: { total: 10, free: 5, basic: 3, pro: 2, onboardingCompleted: 7 },
            authActivity: { eligibleAccounts: 9, last24Hours: 2, last7Days: 5, last30Days: 8 },
        });
        expect(payload.expireAt.getTime() - payload.computedAt.getTime()).toBe(730 * 24 * 60 * 60 * 1000);
        expect(payload).not.toHaveProperty('providers');
        expect(JSON.stringify(payload)).not.toMatch(/uid|email/i);
    });

    it('rejects inconsistent metrics without writing a partial snapshot', async () => {
        const set = vi.fn();
        mocks.collection.mockReturnValue({ doc: vi.fn(() => ({ set })) });
        mocks.collectUserPlanActivityMetrics.mockResolvedValue(metrics({
            subscriptionCadence: {
                pro: { monthly: 1, yearly: 0, unknown: 0 },
                basic: { monthly: 2, yearly: 1, unknown: 0 },
            },
        }));

        await expect(invokeSchedule({ scheduleTime: '2026-08-27T00:10:00.000Z' } as ScheduledEvent))
            .rejects.toThrow('Pro cadence does not reconcile');
        expect(set).not.toHaveBeenCalled();
    });

    it('propagates snapshot write failures so the scheduler can retry', async () => {
        const set = vi.fn().mockRejectedValue(new Error('write failed'));
        mocks.collection.mockReturnValue({ doc: vi.fn(() => ({ set })) });
        mocks.collectUserPlanActivityMetrics.mockResolvedValue(metrics());

        await expect(invokeSchedule({ scheduleTime: '2026-08-27T00:10:00.000Z' } as ScheduledEvent))
            .rejects.toThrow('write failed');
    });

    it('returns valid snapshots oldest-first and omits malformed documents', async () => {
        const query = {
            orderBy: vi.fn().mockReturnThis(),
            startAt: vi.fn().mockReturnThis(),
            endAt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                docs: [
                    storedDocument('2026-08-27'),
                    storedDocument('2026-08-25'),
                    storedDocument('2026-08-26', {
                        authActivity: {
                            eligibleAccounts: 9,
                            last24Hours: 7,
                            last7Days: 6,
                            last30Days: 8,
                        },
                    }),
                ],
            }),
        };
        mocks.collection.mockReturnValue(query);

        const result = await invokeHistory(historyRequest(30));

        expect(query.orderBy).toHaveBeenCalledWith('__name__');
        expect(query.startAt).toHaveBeenCalledWith('2026-07-29');
        expect(query.endAt).toHaveBeenCalledWith('2026-08-27');
        expect(query.limit).toHaveBeenCalledWith(30);
        expect(result).toMatchObject({
            days: 30,
            startDate: '2026-07-29',
            endDate: '2026-08-27',
        });
        expect(result.snapshots.map(point => point.date)).toEqual(['2026-08-25', '2026-08-27']);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            'Skipped malformed admin dashboard snapshot.',
            expect.objectContaining({ snapshotDate: '2026-08-26' }),
        );
    });

    it('logs and skips malformed, incomplete, and unsupported snapshots', async () => {
        const query = {
            orderBy: vi.fn().mockReturnThis(),
            startAt: vi.fn().mockReturnThis(),
            endAt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                docs: [
                    storedDocument('2026-02-30'),
                    storedDocument('2026-08-27', { computedAt: 'not-a-time' }),
                    storedDocument('2026-08-26', { expireAt: undefined }),
                    storedDocument('2026-08-25', { schemaVersion: 2 }),
                ],
            }),
        };
        mocks.collection.mockReturnValue(query);

        await expect(invokeHistory(historyRequest(365))).resolves.toMatchObject({ snapshots: [] });
        expect(mocks.loggerWarn).toHaveBeenCalledTimes(4);
    });

    it('defaults to 90 days and rejects unsupported ranges', async () => {
        const query = {
            orderBy: vi.fn().mockReturnThis(),
            startAt: vi.fn().mockReturnThis(),
            endAt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ docs: [] }),
        };
        mocks.collection.mockReturnValue(query);

        await expect(invokeHistory(historyRequest())).resolves.toMatchObject({ days: 90 });
        await expect(invokeHistory({ data: { days: 31 } } as CallableRequest<GetAdminDashboardHistoryRequest>))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(invokeHistory({ data: { days: null } } as unknown as CallableRequest<GetAdminDashboardHistoryRequest>))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(query.get).toHaveBeenCalledTimes(1);
    });

    it('returns an internal error when history storage cannot be read', async () => {
        const query = {
            orderBy: vi.fn().mockReturnThis(),
            startAt: vi.fn().mockReturnThis(),
            endAt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockRejectedValue(new Error('read failed')),
        };
        mocks.collection.mockReturnValue(query);

        await expect(invokeHistory(historyRequest(365))).rejects.toMatchObject({ code: 'internal' });
        expect(mocks.loggerError).toHaveBeenCalled();
    });
});
