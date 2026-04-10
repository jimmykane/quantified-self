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
                    sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 2 },
                    derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 6 },
                },
            },
            derivedMetrics: {
                coordinators: { idle: 1, queued: 2, processing: 3, failed: 4, total: 10 },
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
            everPaid: 160,
            canceled: 20,
            cancelScheduled: 12,
            onboardingCompleted: 160,
            providers: {}
        };
        functionsServiceMock.call.mockResolvedValue({ data: mockData });

        const stats$ = service.getTotalUserCount();
        const stats = await firstValueFrom(stats$);

        expect(functionsServiceMock.call).toHaveBeenCalledWith('getUserCount');
        expect(stats).toEqual(mockData);
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
});
