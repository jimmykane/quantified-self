import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { AppFunctionsService } from './app.functions.service';
import { Firestore } from 'app/firebase/firestore';
import { EnvironmentInjector } from '@angular/core';

describe('AdminService', () => {
    let service: AdminService;
    let functionsServiceMock: any;

    beforeEach(() => {
        functionsServiceMock = {
            call: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AdminService,
                { provide: AppFunctionsService, useValue: functionsServiceMock },
                { provide: Firestore, useValue: {} },
                { provide: EnvironmentInjector, useValue: { get: () => { } } }
            ]
        });
        service = TestBed.inject(AdminService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should call listUsers Cloud Function and return users', async () => {
        const mockUsers = [
            { uid: '1', email: 'test@test.com', customClaims: { admin: true }, metadata: { lastSignInTime: 'now', creationTime: 'then' }, disabled: false }
        ];

        functionsServiceMock.call.mockResolvedValue({ data: { users: mockUsers } });

        const users$ = service.getUsers();
        const users = await firstValueFrom(users$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('listUsers', expect.objectContaining({
            page: 0,
            pageSize: 25
        }));
        expect(users.users).toEqual(mockUsers);
    });

    it('should call getQueueStats Cloud Function', async () => {
        const mockStats = {
            pending: 5,
            succeeded: 10,
            stuck: 2,
            providers: [],
            cloudTasks: {
                pending: 18,
                queues: {
                    workout: { queueId: 'processWorkoutTask', pending: 10 },
                    activitySync: { queueId: 'processActivitySyncTask', pending: 0 },
                    sleepSync: { queueId: 'processSleepSyncTask', pending: 0 },
                    sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 2 },
                    sportsLibRouteReparse: { queueId: 'processSportsLibRouteReparseTask', pending: 1 },
                    derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 6 },
                },
            },
            derivedMetrics: {
                coordinators: { idle: 1, queued: 2, processing: 3, staleQueued: 0, staleProcessing: 0, failed: 4, total: 10 },
                recentFailures: [
                    {
                        uid: 'user-1',
                        generation: 7,
                        dirtyMetricKinds: ['form'],
                        lastError: 'Coordinator failed',
                        updatedAtMs: 1700000000000,
                    },
                ],
            },
        };
        functionsServiceMock.call.mockResolvedValue({ data: mockStats });

        const stats$ = service.getQueueStats();
        const stats = await firstValueFrom(stats$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getQueueStats', { includeAnalysis: true });
        expect(stats).toEqual(mockStats);
    });

    it('should return total user count with breakdown from Cloud Function', async () => {
        const mockData = {
            total: 180,
            pro: 50,
            basic: 130,
            free: 0,
            monthlyPaid: 120,
            yearlyPaid: 60,
            subscriptionCadence: {
                pro: { monthly: 35, yearly: 15, unknown: 0 },
                basic: { monthly: 85, yearly: 45, unknown: 0 },
            },
            everPaid: 160,
            canceled: 20,
            cancelScheduled: 12,
            onboardingCompleted: 160,
            events: {
                total: 1_000_000,
            },
            routes: {
                total: 25_000,
            },
            connections: {
                serviceUsers: 90,
                mcpUsers: 12,
                both: 8,
                providers: { Garmin: 50, Suunto: 20, COROS: 10, Wahoo: 10 },
                cacheStatus: 'fresh' as const,
                computedAt: '2026-08-07T13:00:00.000Z',
                expireAt: '2026-08-07T14:00:00.000Z',
            },
            authActivity: {
                last24Hours: 14,
                last7Days: 42,
                last30Days: 60,
                computedAt: '2026-08-07T13:15:00.000Z',
            },
            providers: {}
        };
        functionsServiceMock.call.mockResolvedValue({ data: mockData });

        const stats$ = service.getTotalUserCount();
        const stats = await firstValueFrom(stats$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserCount');
        expect(stats).toEqual(mockData);
    });

    it('should mark missing count fields from getUserCount as unavailable', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 2,
                providers: {}
            }
        });

        const stats = await firstValueFrom(service.getTotalUserCount());

        expect(stats.events).toEqual({ total: null });
        expect(stats.routes).toEqual({ total: null });
        expect(stats.authActivity).toBeUndefined();
        expect(stats.subscriptionCadence).toBeUndefined();
    });

    it('should mark malformed subscription cadence counts as unavailable', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 8,
                providers: {},
                subscriptionCadence: {
                    pro: { monthly: 4.5, yearly: -1, unknown: Number.NaN },
                    basic: { monthly: 3, yearly: 2, unknown: 0 },
                },
            },
        });

        const stats = await firstValueFrom(service.getTotalUserCount());

        expect(stats.subscriptionCadence).toEqual({
            pro: { monthly: null, yearly: null, unknown: null },
            basic: { monthly: 3, yearly: 2, unknown: 0 },
        });
    });

    it('should mark malformed authentication activity counts as unavailable', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 2,
                providers: {},
                authActivity: {
                    last24Hours: 4.9,
                    last7Days: -2,
                    last30Days: Number.NaN,
                    computedAt: 'not-a-date',
                },
            },
        });

        const stats = await firstValueFrom(service.getTotalUserCount());

        expect(stats.authActivity).toEqual({
            last24Hours: null,
            last7Days: null,
            last30Days: null,
            computedAt: null,
        });
    });

    it('should mark impossible authentication activity window ordering as unavailable', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 20,
                providers: {},
                authActivity: {
                    last24Hours: 12,
                    last7Days: 8,
                    last30Days: 10,
                    computedAt: '2026-08-07T13:15:00.000Z',
                },
            },
        });

        const stats = await firstValueFrom(service.getTotalUserCount());

        expect(stats.authActivity).toEqual({
            last24Hours: null,
            last7Days: null,
            last30Days: null,
            computedAt: '2026-08-07T13:15:00.000Z',
        });
    });

    it('should request a forced event count refresh when asked', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 2,
                total: 2,
                providers: {},
                events: {
                    total: 123,
                    cacheStatus: 'refreshed',
                    computedAt: '2026-05-07T05:00:00.000Z',
                    expireAt: '2026-05-07T06:00:00.000Z',
                },
                routes: {
                    total: 7,
                },
            }
        });

        const stats = await firstValueFrom(service.getTotalUserCount({ refreshEventCount: true }));

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserCount', { refreshEventCount: true });
        expect(stats.events).toEqual({
            total: 123,
            cacheStatus: 'refreshed',
            computedAt: '2026-05-07T05:00:00.000Z',
            expireAt: '2026-05-07T06:00:00.000Z',
        });
    });

    it('should request a forced route count refresh when asked', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                count: 2,
                total: 2,
                providers: {},
                events: {
                    total: 123,
                },
                routes: {
                    total: 456,
                    cacheStatus: 'refreshed',
                    computedAt: '2026-05-07T05:00:00.000Z',
                    expireAt: '2026-05-07T06:00:00.000Z',
                },
            }
        });

        const stats = await firstValueFrom(service.getTotalUserCount({ refreshRouteCount: true }));

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserCount', { refreshRouteCount: true });
        expect(stats.routes).toEqual({
            total: 456,
            cacheStatus: 'refreshed',
            computedAt: '2026-05-07T05:00:00.000Z',
            expireAt: '2026-05-07T06:00:00.000Z',
        });
    });

    it('should call impersonateUser Cloud Function and return token', async () => {
        const mockResponse = { token: 'custom-token-123' };
        functionsServiceMock.call.mockResolvedValue({ data: mockResponse });
        const uid = 'target-user-uid';

        const result$ = service.impersonateUser(uid);
        const result = await firstValueFrom(result$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('impersonateUser', { uid });
        expect(result).toEqual(mockResponse);
    });

    it('should call getSubscriptionHistoryTrend Cloud Function with bounded months', async () => {
        const mockTrend = {
            months: 24,
            buckets: [{ key: '2026-01', label: 'Jan 2026', newSubscriptions: 3, plannedCancellations: 1, net: 2 }],
            totals: { newSubscriptions: 3, plannedCancellations: 1, net: 2 }
        };
        functionsServiceMock.call.mockResolvedValue({ data: mockTrend });

        const result = await firstValueFrom(service.getSubscriptionHistoryTrend(99));

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getSubscriptionHistoryTrend', { months: 24 });
        expect(result).toEqual(mockTrend);
    });

    it('should call getUserGrowthTrend Cloud Function with bounded months', async () => {
        const mockTrend = {
            months: 24,
            buckets: [{ key: '2026-01', label: 'Jan 2026', registeredUsers: 8, onboardedUsers: 5 }],
            totals: { registeredUsers: 8, onboardedUsers: 5 }
        };
        functionsServiceMock.call.mockResolvedValue({ data: mockTrend });

        const result = await firstValueFrom(service.getUserGrowthTrend(99));

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserGrowthTrend', { months: 24 });
        expect(result).toEqual(mockTrend);
    });

    it('should request and map 365 days of aggregate dashboard history by default', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                days: 365,
                startDate: '2025-08-28',
                endDate: '2026-08-27',
                snapshots: [
                    {
                        date: '2026-08-27',
                        computedAt: '2026-08-27T00:12:00.000Z',
                        users: { total: 10, free: 5, basic: 3, pro: 2, onboardingCompleted: 7 },
                        authActivity: { eligibleAccounts: 9, last24Hours: 2, last7Days: 5, last30Days: 8 },
                        subscriptionCadence: {
                            pro: { monthly: 1, yearly: 1, unknown: 0 },
                            basic: { monthly: 2, yearly: 1, unknown: 0 },
                        },
                    },
                ],
            },
        });

        const history = await firstValueFrom(service.getAdminDashboardHistory());

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getAdminDashboardHistory', { days: 365 });
        expect(history.snapshots).toHaveLength(1);
        expect(history.snapshots[0].authActivity.last30Days).toBe(8);
    });

    it('should reject malformed dashboard history instead of charting inconsistent totals', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                days: 30,
                startDate: '2026-07-29',
                endDate: '2026-08-27',
                snapshots: [
                    {
                        date: '2026-08-27',
                        computedAt: '2026-08-27T00:12:00.000Z',
                        users: { total: 10, free: 6, basic: 3, pro: 2, onboardingCompleted: 7 },
                        authActivity: { eligibleAccounts: 9, last24Hours: 2, last7Days: 5, last30Days: 8 },
                        subscriptionCadence: {
                            pro: { monthly: 1, yearly: 1, unknown: 0 },
                            basic: { monthly: 2, yearly: 1, unknown: 0 },
                        },
                    },
                ],
            },
        });

        await expect(firstValueFrom(service.getAdminDashboardHistory(30)))
            .rejects.toThrow('inconsistent user totals');
    });

    it('should reject non-canonical history timestamps', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                days: 30,
                startDate: '2026-07-29',
                endDate: '2026-08-27',
                snapshots: [
                    {
                        date: '2026-08-27',
                        computedAt: 'August 27, 2026 00:12 UTC',
                        users: { total: 10, free: 5, basic: 3, pro: 2, onboardingCompleted: 7 },
                        authActivity: { eligibleAccounts: 9, last24Hours: 2, last7Days: 5, last30Days: 8 },
                        subscriptionCadence: {
                            pro: { monthly: 1, yearly: 1, unknown: 0 },
                            basic: { monthly: 2, yearly: 1, unknown: 0 },
                        },
                    },
                ],
            },
        });

        await expect(firstValueFrom(service.getAdminDashboardHistory(30)))
            .rejects.toThrow('must be an ISO timestamp');
    });

    it('should reject history bounds that do not span the requested number of days', async () => {
        functionsServiceMock.call.mockResolvedValue({
            data: {
                days: 30,
                startDate: '2026-07-01',
                endDate: '2026-08-27',
                snapshots: [],
            },
        });

        await expect(firstValueFrom(service.getAdminDashboardHistory(30)))
            .rejects.toThrow('date range does not match the requested days');
    });
});
