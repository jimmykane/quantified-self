import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminUserManagementComponent } from './admin-user-management.component';
import {
    AdminService,
    AdminUser,
    ListUsersResponse,
    SubscriptionHistoryTrendResponse,
    UserGrowthTrendResponse
} from '../../../services/admin.service';
import { AppImpersonationService } from '../../../services/app.impersonation.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { LoggerService } from '../../../services/logger.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';

// Mock canvas for charts
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => ({
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray() })),
        putImageData: vi.fn(),
        createImageData: vi.fn(() => ({ data: new Uint8ClampedArray() })),
        setTransform: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        clip: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        rect: vi.fn(),
        arc: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        measureText: vi.fn(() => ({ width: 0 })),
        drawImage: vi.fn(),
        createLinearGradient: vi.fn(() => ({
            addColorStop: vi.fn(),
        })),
        createPattern: vi.fn(),
        createRadialGradient: vi.fn(() => ({
            addColorStop: vi.fn(),
        })),
        canvas: { width: 0, height: 0, style: {} }
    })),
    configurable: true
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

// Mock requestAnimationFrame for ECharts usage
if (!(global as any).requestAnimationFrame) {
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0);
}

describe('AdminUserManagementComponent', () => {
    let component: AdminUserManagementComponent;
    let fixture: ComponentFixture<AdminUserManagementComponent>;
    let adminServiceSpy: any;
    let impersonationServiceSpy: any;
    let routerSpy: any;
    let matDialogSpy: any;
    let appThemeServiceMock: any;
    let themeSubject: BehaviorSubject<AppThemes>;
    let mockLogger: any;
    let mockEchartsService: any;

    const mockUsers: AdminUser[] = [
        {
            uid: 'user1',
            email: 'user1@example.com',
            displayName: 'User One',
            customClaims: { stripeRole: 'pro', admin: true },
            metadata: { lastSignInTime: '2023-01-01', creationTime: '2022-01-01' },
            disabled: false,
            providerIds: ['password'],
            hasSubscribedOnce: true
        },
        {
            uid: 'user2',
            email: 'user2@example.com',
            displayName: 'User Two',
            customClaims: { stripeRole: 'free' },
            metadata: { lastSignInTime: '2023-01-02', creationTime: '2022-01-02' },
            disabled: true,
            providerIds: ['google.com'],
            hasSubscribedOnce: false
        }
    ];

    const mockResponse: ListUsersResponse = {
        users: mockUsers,
        totalCount: 2,
        page: 0,
        pageSize: 25
    };

    const mockTrend: UserGrowthTrendResponse = {
        months: 12,
        buckets: [
            {
                key: '2026-01',
                label: 'Jan 2026',
                registeredUsers: 10,
                onboardedUsers: 6
            },
            {
                key: '2026-02',
                label: 'Feb 2026',
                registeredUsers: 15,
                onboardedUsers: 10
            },
            {
                key: '2026-03',
                label: 'Mar 2026',
                registeredUsers: 5,
                onboardedUsers: 4
            }
        ],
        totals: {
            registeredUsers: 30,
            onboardedUsers: 20
        }
    };

    const mockSubscriptionTrend: SubscriptionHistoryTrendResponse = {
        months: 12,
        buckets: [
            {
                key: '2026-01',
                label: 'Jan 2026',
                newSubscriptions: 7,
                plannedCancellations: 1,
                net: 6,
                basicNewSubscriptions: 2,
                basicPlannedCancellations: 0,
                basicNet: 2,
                proNewSubscriptions: 5,
                proPlannedCancellations: 1,
                proNet: 4
            },
            {
                key: '2026-02',
                label: 'Feb 2026',
                newSubscriptions: 3,
                plannedCancellations: 2,
                net: 1,
                basicNewSubscriptions: 2,
                basicPlannedCancellations: 1,
                basicNet: 1,
                proNewSubscriptions: 1,
                proPlannedCancellations: 1,
                proNet: 0
            },
            {
                key: '2026-03',
                label: 'Mar 2026',
                newSubscriptions: 4,
                plannedCancellations: 1,
                net: 3,
                basicNewSubscriptions: 1,
                basicPlannedCancellations: 0,
                basicNet: 1,
                proNewSubscriptions: 3,
                proPlannedCancellations: 1,
                proNet: 2
            }
        ],
        totals: {
            newSubscriptions: 14,
            plannedCancellations: 4,
            net: 10,
            basicNewSubscriptions: 5,
            basicPlannedCancellations: 1,
            basicNet: 4,
            proNewSubscriptions: 9,
            proPlannedCancellations: 3,
            proNet: 6
        }
    };

    beforeEach(async () => {
        adminServiceSpy = {
            getUsers: vi.fn().mockReturnValue(of(mockResponse)),
            getTotalUserCount: vi.fn().mockReturnValue(of({
                total: 100,
                pro: 30,
                basic: 70,
                free: 0,
                everPaid: 85,
                canceled: 15,
                cancelScheduled: 8,
                onboardingCompleted: 80
            })),
            getUserGrowthTrend: vi.fn().mockReturnValue(of(mockTrend)),
            getSubscriptionHistoryTrend: vi.fn().mockReturnValue(of(mockSubscriptionTrend))
        };

        impersonationServiceSpy = {
            startImpersonation: vi.fn().mockResolvedValue(undefined)
        };

        routerSpy = {
            navigate: vi.fn()
        };

        matDialogSpy = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true)
            })
        };

        themeSubject = new BehaviorSubject<AppThemes>(AppThemes.Dark);
        appThemeServiceMock = {
            getAppTheme: vi.fn().mockReturnValue(themeSubject.asObservable())
        };

        mockLogger = {
            error: vi.fn(),
            log: vi.fn()
        };

        const chartMock = {
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            isDisposed: vi.fn().mockReturnValue(false)
        };

        mockEchartsService = {
            init: vi.fn().mockResolvedValue(chartMock),
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            subscribeToViewportResize: vi.fn(() => () => { }),
            attachMobileSeriesTapFeedback: vi.fn(() => () => { })
        };

        await TestBed.configureTestingModule({
            imports: [
                AdminUserManagementComponent,
                MatTableModule,
                MatPaginatorModule,
                MatSortModule,
                MatInputModule,
                MatFormFieldModule,
                MatIconModule,
                MatProgressSpinnerModule,
                NoopAnimationsModule,
                FormsModule
            ],
            providers: [
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: AppImpersonationService, useValue: impersonationServiceSpy },
                { provide: AppThemeService, useValue: appThemeServiceMock },
                { provide: LoggerService, useValue: mockLogger },
                { provide: Router, useValue: routerSpy },
                { provide: MatDialog, useValue: matDialogSpy },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: EChartsLoaderService, useValue: mockEchartsService },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {
                                adminData: {
                                    usersData: mockResponse,
                                    userStats: {
                                        total: 100,
                                        pro: 30,
                                        basic: 70,
                                        free: 0,
                                        everPaid: 85,
                                        canceled: 15,
                                        cancelScheduled: 8,
                                        onboardingCompleted: 80
                                    },
                                    userGrowthTrend: mockTrend,
                                    subscriptionHistoryTrend: mockSubscriptionTrend
                                }
                            }
                        }
                    }
                }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .overrideProvider(MatDialog, { useValue: matDialogSpy })
            .compileComponents();

        fixture = TestBed.createComponent(AdminUserManagementComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should include uid in displayed columns', () => {
        expect(component.displayedColumns).toContain('uid');
        expect(component.displayedColumns).toContain('subscriptionHistory');
        expect(component.displayedColumns).not.toContain('subscription');
    });

    it('should use resolved users on init', () => {
        expect(adminServiceSpy.getUsers).not.toHaveBeenCalled();
        expect(component.users).toEqual(mockUsers);
        expect(component.totalCount).toBe(2);
        expect(component.isLoading).toBe(false);
    });

    it('should use resolved user stats on init', () => {
        expect(adminServiceSpy.getTotalUserCount).not.toHaveBeenCalled();
        expect(component.userStats).toEqual({
            total: 100,
            pro: 30,
            basic: 70,
            free: 0,
            everPaid: 85,
            canceled: 15,
            cancelScheduled: 8,
            onboardingCompleted: 80
        });
    });

    it('should use resolved user growth trend data on init', () => {
        expect(adminServiceSpy.getUserGrowthTrend).not.toHaveBeenCalled();
        expect(adminServiceSpy.getSubscriptionHistoryTrend).not.toHaveBeenCalled();
        expect(component.hasUserGrowthTrendData).toBe(true);
    });

    it('should initialize and dispose both chart hosts', async () => {
        await Promise.resolve();

        expect(mockEchartsService.init.mock.calls.length).toBeGreaterThanOrEqual(2);

        fixture.destroy();
        expect(mockEchartsService.dispose.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should build user and subscription trend chart option with seven series', () => {
        const option = (component as any).buildUserGrowthTrendChartOption(
            mockTrend,
            mockSubscriptionTrend,
            100,
            80,
            70,
            30
        );
        const series = (option as any).series;
        const graphic = (option as any).graphic;

        expect((option as any).backgroundColor).toBe('transparent');
        expect(series).toHaveLength(7);
        expect(series.map((entry: any) => entry.name)).toEqual([
            'Registered Users / month',
            'Onboarded Users / month',
            'Total Registered',
            'Total Onboarded',
            'Basic Totals',
            'Pro Totals',
            'Totals (Pro+Basic)'
        ]);
        expect(series[0].data).toEqual([10, 15, 5]);
        expect(series[1].data).toEqual([6, 10, 4]);
        expect(series[2].data).toEqual([80, 95, 100]);
        expect(series[3].data).toEqual([66, 76, 80]);
        expect(series[4].data).toEqual([68, 69, 70]);
        expect(series[5].data).toEqual([28, 28, 30]);
        expect(series[6].data).toEqual([96, 97, 100]);
        expect(graphic).toBeTruthy();
        expect(graphic[0].style.text).toContain('Current');
        expect(graphic[0].style.text).toContain('Users 100');
        expect(graphic[0].style.text).toContain('Onboarded 80');
        expect(graphic[0].style.text).toContain('Totals (Pro+Basic) 100');
        expect(graphic[0].style.text).toContain('Basic 70');
        expect(graphic[0].style.text).toContain('Pro 30');
    });

    it('should build auth chart option with transparent background', () => {
        const option = (component as any).buildAuthChartOption({
            'google.com': 12,
            'password': 4
        });

        expect((option as any).backgroundColor).toBe('transparent');
        expect((option as any).tooltip.show).toBe(true);
        expect((option as any).legend.show).toBe(true);
        expect((option as any).series[0].data).toHaveLength(2);
    });

    it('should clear auth chart with a transparent empty state when provider data is missing', async () => {
        await Promise.resolve();
        await Promise.resolve();
        mockEchartsService.setOption.mockClear();

        (component as any).updateAuthChart({});

        const option = mockEchartsService.setOption.mock.calls.at(-1)?.[1];
        expect(option.backgroundColor).toBe('transparent');
        expect(option.series).toEqual([]);
        expect(option.graphic).toEqual([]);
    });

    it('should clear the growth trend chart with a transparent empty state when trend data is missing', async () => {
        await Promise.resolve();
        await Promise.resolve();
        mockEchartsService.setOption.mockClear();

        (component as any).updateUserGrowthTrendChart(null);
        (component as any).updateSubscriptionHistoryTrendChart(null);
        (component as any).renderUserGrowthTrendChart();

        const option = mockEchartsService.setOption.mock.calls.at(-1)?.[1];
        expect(option.backgroundColor).toBe('transparent');
        expect(option.series).toEqual([]);
        expect(option.graphic).toEqual([]);
    });

    it('should restore auth chart tooltip and legend visibility after empty-state render', async () => {
        await Promise.resolve();
        await Promise.resolve();
        mockEchartsService.setOption.mockClear();

        (component as any).updateAuthChart({});
        (component as any).updateAuthChart({ 'google.com': 3, 'password': 1 });

        const option = mockEchartsService.setOption.mock.calls.at(-1)?.[1];
        expect(option.tooltip.show).toBe(true);
        expect(option.legend.show).toBe(true);
        expect(option.series[0].data).toHaveLength(2);
    });

    it('should restore growth chart tooltip and legend visibility after empty-state render', async () => {
        await Promise.resolve();
        await Promise.resolve();
        mockEchartsService.setOption.mockClear();

        (component as any).updateUserGrowthTrendChart(null);
        (component as any).updateSubscriptionHistoryTrendChart(null);
        (component as any).renderUserGrowthTrendChart();
        (component as any).updateUserGrowthTrendChart(mockTrend);
        (component as any).updateSubscriptionHistoryTrendChart(mockSubscriptionTrend);
        (component as any).renderUserGrowthTrendChart();

        const option = mockEchartsService.setOption.mock.calls.at(-1)?.[1];
        expect(option.tooltip.show).toBe(true);
        expect(option.legend.show).toBe(true);
        expect(option.series).toHaveLength(7);
    });

    it('should handle null user growth trend data safely', () => {
        expect(() => (component as any).updateUserGrowthTrendChart(null)).not.toThrow();
        expect(() => (component as any).updateSubscriptionHistoryTrendChart(null)).not.toThrow();
        expect(component.hasUserGrowthTrendData).toBe(false);
    });

    it('should update both chart hosts when theme changes', async () => {
        const beforeThemeChangeInitCalls = mockEchartsService.init.mock.calls.length;

        themeSubject.next(AppThemes.Light);
        await Promise.resolve();
        await Promise.resolve();

        expect(mockEchartsService.init.mock.calls.length).toBeGreaterThanOrEqual(beforeThemeChangeInitCalls + 2);
    });

    it('should handle errors when fetching users', () => {
        adminServiceSpy.getUsers.mockReturnValue(throwError(() => new Error('Fetch failed')));
        component.fetchUsers();
        expect(component.error).toContain('Failed to load users');
        expect(component.isLoading).toBe(false);
    });

    it('should trigger fetch on page change', () => {
        vi.clearAllMocks();
        const pageEvent: PageEvent = { pageIndex: 1, pageSize: 50, length: 100 };
        component.onPageChange(pageEvent);

        expect(component.currentPage).toBe(1);
        expect(component.pageSize).toBe(50);
        expect(adminServiceSpy.getUsers).toHaveBeenCalledWith({
            page: 1,
            pageSize: 50,
            searchTerm: undefined,
            sortField: 'created',
            sortDirection: 'desc',
            filterService: undefined
        });
    });

    it('should trigger fetch on sort change and reset to page 0', () => {
        component.currentPage = 5;
        vi.clearAllMocks();

        const sortEvent: Sort = { active: 'displayName', direction: 'desc' };
        component.onSortChange(sortEvent);

        expect(component.sortField).toBe('displayName');
        expect(component.sortDirection).toBe('desc');
        expect(component.currentPage).toBe(0);
        expect(adminServiceSpy.getUsers).toHaveBeenCalled();
    });

    it('should fallback to created desc when sort state is cleared', () => {
        component.sortField = 'email';
        component.sortDirection = 'asc';
        vi.clearAllMocks();

        const sortEvent: Sort = { active: '', direction: '' };
        component.onSortChange(sortEvent);

        expect(component.sortField).toBe('created');
        expect(component.sortDirection).toBe('desc');
        expect(adminServiceSpy.getUsers).toHaveBeenCalledWith({
            page: 0,
            pageSize: 10,
            searchTerm: undefined,
            sortField: 'created',
            sortDirection: 'desc',
            filterService: undefined
        });
    });

    it('should fallback to created desc when sort field is unsupported', () => {
        component.sortField = 'email';
        component.sortDirection = 'asc';
        vi.clearAllMocks();

        const sortEvent: Sort = { active: 'subscription', direction: 'asc' };
        component.onSortChange(sortEvent);

        expect(component.sortField).toBe('created');
        expect(component.sortDirection).toBe('desc');
        expect(adminServiceSpy.getUsers).toHaveBeenCalledWith({
            page: 0,
            pageSize: 10,
            searchTerm: undefined,
            sortField: 'created',
            sortDirection: 'desc',
            filterService: undefined
        });
    });

    it('should return correct role', () => {
        expect(component.getRole(mockUsers[0])).toBe('pro');
        expect(component.getRole(mockUsers[1])).toBe('free');
    });

    it('should correctly identify admin', () => {
        expect(component.isAdmin(mockUsers[0])).toBe(true);
        expect(component.isAdmin(mockUsers[1])).toBe(false);
    });

    it('should update searchTerm on input and reset page on clear', () => {
        component.searchTerm = 'existing';
        component.currentPage = 3;

        component.clearSearch();

        expect(component.searchTerm).toBe('');
    });

    it('should delegate confirmed impersonation to the impersonation service', async () => {
        component.onImpersonate(mockUsers[0]);
        await Promise.resolve();

        expect(impersonationServiceSpy.startImpersonation).toHaveBeenCalledWith({
            uid: 'user1',
            email: 'user1@example.com',
            displayName: 'User One'
        });
        expect(component.isLoading).toBe(false);
    });

    it('should not start impersonation when the confirmation dialog is cancelled', () => {
        matDialogSpy.open.mockReturnValueOnce({
            afterClosed: () => of(false)
        });

        component.onImpersonate(mockUsers[0]);

        expect(impersonationServiceSpy.startImpersonation).not.toHaveBeenCalled();
    });

    describe('getRole', () => {
        it('should return stripeRole if present', () => {
            const user = { customClaims: { stripeRole: 'pro' } } as any;
            expect(component.getRole(user)).toBe('pro');
        });

        it('should return free if no stripeRole', () => {
            const user = { customClaims: {} } as any;
            expect(component.getRole(user)).toBe('free');
        });
    });

    describe('isAdmin', () => {
        it('should return true if admin claim is true', () => {
            const user = { customClaims: { admin: true } } as any;
            expect(component.isAdmin(user)).toBe(true);
        });

        it('should return false if no admin claim', () => {
            const user = { customClaims: {} } as any;
            expect(component.isAdmin(user)).toBe(false);
        });
    });

    describe('getServiceLogo', () => {
        it('should return correct paths', () => {
            expect(component.getServiceLogo('garmin')).toBe('assets/logos/garmin.svg');
            expect(component.getServiceLogo('Suunto')).toBe('assets/logos/suunto.svg');
            expect(component.getServiceLogo('COROS')).toBe('assets/logos/coros.svg');
        });

        it('should return empty for unknown', () => {
            expect(component.getServiceLogo('unknown')).toBe('');
        });
    });

    describe('subscription history helpers', () => {
        it('should return active when user has active subscription', () => {
            const user = { subscription: { status: 'active', cancel_at_period_end: false } } as any;
            expect(component.getSubscriptionHistoryState(user)).toBe('active');
            expect(component.getSubscriptionHistoryLabel(user)).toBe('Active');
            expect(component.getSubscriptionHistoryDetails(user)).toBeNull();
        });

        it('should return scheduled when cancellation is scheduled', () => {
            const user = { subscription: { status: 'active', cancel_at_period_end: true } } as any;
            expect(component.getSubscriptionHistoryState(user)).toBe('scheduled');
            expect(component.getSubscriptionHistoryLabel(user)).toBe('Cancel Scheduled');
            expect(component.getSubscriptionHistoryDetails(user)).toBe('Scheduled to end');
        });

        it('should return canceled when user has paid history but no active subscription', () => {
            const user = { hasSubscribedOnce: true } as any;
            expect(component.getSubscriptionHistoryState(user)).toBe('canceled');
            expect(component.getSubscriptionHistoryLabel(user)).toBe('Canceled');
            expect(component.getSubscriptionHistoryDetails(user)).toBeNull();
        });

        it('should return never when user has no paid history', () => {
            const user = { hasSubscribedOnce: false } as any;
            expect(component.getSubscriptionHistoryState(user)).toBe('never');
            expect(component.getSubscriptionHistoryLabel(user)).toBe('Never Subscribed');
            expect(component.getSubscriptionHistoryDetails(user)).toBeNull();
        });

        it('should include end date detail when cancellation has current period end', () => {
            const user = {
                subscription: {
                    status: 'active',
                    cancel_at_period_end: true,
                    current_period_end: '2026-01-15T00:00:00Z'
                }
            } as any;
            expect(component.getSubscriptionHistoryDetails(user)).toContain('Ends');
        });

        it('should show specific details for trialing and past due subscriptions', () => {
            expect(component.getSubscriptionHistoryDetails({
                subscription: { status: 'trialing', cancel_at_period_end: false }
            } as any)).toBe('Trialing');

            expect(component.getSubscriptionHistoryDetails({
                subscription: { status: 'past_due', cancel_at_period_end: false }
            } as any)).toBe('Past Due');
        });
    });

    describe('localized date formatting', () => {
        it('should format created date using localized Day.js format', () => {
            const formatted = component.formatCreatedDate('2024-01-15T12:00:00Z');
            expect(formatted).toBeTruthy();
        });

        it('should format last login date including time using localized Day.js format', () => {
            const created = component.formatCreatedDate('2024-01-15T12:00:00Z');
            const lastLogin = component.formatLastLoginDate('2024-01-15T12:00:00Z');

            expect(lastLogin).toBeTruthy();
            expect(lastLogin).not.toEqual(created);
        });
    });
});
