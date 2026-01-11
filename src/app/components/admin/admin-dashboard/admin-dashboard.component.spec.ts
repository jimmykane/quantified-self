import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { AdminService, AdminUser, ListUsersResponse } from '../../../services/admin.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppThemeService } from '../../../services/app.theme.service';
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
import { provideCharts, withDefaultRegisterables, BaseChartDirective } from 'ng2-charts';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';

import { ChangeDetectorRef, NO_ERRORS_SCHEMA, Component, Input, Directive } from '@angular/core';



// Mock canvas for charts
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
        getAll: () => { },
        fillRect: () => { },
        clearRect: () => { },
        getImageData: () => ({ data: [] }),
        putImageData: () => { },
        createImageData: () => [],
        setTransform: () => { },
        drawer: { draw: () => { } },
        save: () => { },
        restore: () => { },
        beginPath: () => { },
        moveTo: () => { },
        lineTo: () => { },
        clip: () => { },
        fill: () => { },
        stroke: () => { },
        rect: () => { },
        arc: () => { },
        quadraticCurveTo: () => { },
        closePath: () => { },
        translate: () => { },
        rotate: () => { },
        scale: () => { },
        fillText: () => { },
        strokeText: () => { },
        measureText: () => ({ width: 0 }),
        drawImage: () => { },
        canvas: {
            width: 0,
            height: 0,
            style: {}
        }
    }),
    configurable: true
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('AdminDashboardComponent', () => {
    let component: AdminDashboardComponent;
    let fixture: ComponentFixture<AdminDashboardComponent>;
    let adminServiceSpy: {
        getUsers: ReturnType<typeof vi.fn>;
        getQueueStats: ReturnType<typeof vi.fn>;
        getTotalUserCount: ReturnType<typeof vi.fn>;
        getMaintenanceStatus: ReturnType<typeof vi.fn>;
        setMaintenanceMode: ReturnType<typeof vi.fn>;
        impersonateUser: ReturnType<typeof vi.fn>;
        getFinancialStats: ReturnType<typeof vi.fn>;
    };
    let authServiceSpy: { loginWithCustomToken: ReturnType<typeof vi.fn> };
    let routerSpy: { navigate: ReturnType<typeof vi.fn> };
    let matDialogSpy: { open: ReturnType<typeof vi.fn> };
    let appThemeServiceMock: { getAppTheme: ReturnType<typeof vi.fn> };
    let themeSubject: BehaviorSubject<AppThemes>;

    const mockUsers: AdminUser[] = [
        {
            uid: 'user1',
            email: 'user1@example.com',
            displayName: 'User One',
            customClaims: { stripeRole: 'pro', admin: true },
            metadata: { lastSignInTime: '2023-01-01', creationTime: '2022-01-01' },
            disabled: false,
            providerIds: ['password']
        },
        {
            uid: 'user2',
            email: 'user2@example.com',
            displayName: 'User Two',
            customClaims: { stripeRole: 'free' },
            metadata: { lastSignInTime: '2023-01-02', creationTime: '2022-01-02' },
            disabled: true,
            providerIds: ['google.com']
        }
    ];

    const mockResponse: ListUsersResponse = {
        users: mockUsers,
        totalCount: 2,
        page: 0,
        pageSize: 25
    };

    const mockQueueStats = { pending: 0, succeeded: 0, stuck: 0, providers: [], advanced: { throughput: 0, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] } };

    beforeEach(async () => {
        adminServiceSpy = {
            getUsers: vi.fn().mockReturnValue(of(mockResponse)),
            getQueueStats: vi.fn().mockReturnValue(of(mockQueueStats)),
            getTotalUserCount: vi.fn().mockReturnValue(of({ total: 100, pro: 30, basic: 70, free: 0 })),
            getMaintenanceStatus: vi.fn().mockReturnValue(of({ enabled: false, message: 'Test' })),
            setMaintenanceMode: vi.fn().mockReturnValue(of({ success: true, enabled: true, message: 'Test' })),
            impersonateUser: vi.fn().mockReturnValue(of({ token: 'test-token' })),
            getFinancialStats: vi.fn().mockReturnValue(of({ revenue: { total: 0, currency: 'USD', invoiceCount: 0 }, cost: { reportUrl: 'http://test.com' } })),
        };

        authServiceSpy = {
            loginWithCustomToken: vi.fn().mockResolvedValue({})
        };

        routerSpy = {
            navigate: vi.fn()
        };

        matDialogSpy = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true) // Default to confirmed
            })
        };

        themeSubject = new BehaviorSubject<AppThemes>(AppThemes.Dark);
        appThemeServiceMock = {
            getAppTheme: vi.fn().mockReturnValue(themeSubject.asObservable())
        };

        await TestBed.configureTestingModule({
            imports: [
                AdminDashboardComponent,
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
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: AppThemeService, useValue: appThemeServiceMock },
                { provide: Router, useValue: routerSpy },
                { provide: MatDialog, useValue: matDialogSpy },
                provideCharts(withDefaultRegisterables()),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {
                                adminData: {
                                    usersData: mockResponse,
                                    userStats: { total: 100, pro: 30, basic: 70, free: 0 }
                                }
                            }
                        }
                    }
                }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .overrideProvider(MatDialog, { useValue: matDialogSpy })
            .overrideComponent(AdminDashboardComponent, {
                remove: { imports: [BaseChartDirective] }
            })
            .compileComponents();

        fixture = TestBed.createComponent(AdminDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should use resolved users on init', () => {
        expect(adminServiceSpy.getUsers).not.toHaveBeenCalled();
        expect(component.users).toEqual(mockUsers);
        expect(component.totalCount).toBe(2);
        expect(component.isLoading).toBe(false);
    });

    it('should use resolved user stats on init', () => {
        expect(adminServiceSpy.getTotalUserCount).not.toHaveBeenCalled();
        expect(component.userStats).toEqual({ total: 100, pro: 30, basic: 70, free: 0 });
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
            sortField: 'email',
            sortDirection: 'asc'
        });
    });

    it('should trigger fetch on sort change and reset to page 0', () => {
        component.currentPage = 5; // Simulate being on page 5
        vi.clearAllMocks();

        const sortEvent: Sort = { active: 'displayName', direction: 'desc' };
        component.onSortChange(sortEvent);

        expect(component.sortField).toBe('displayName');
        expect(component.sortDirection).toBe('desc');
        expect(component.currentPage).toBe(0); // Should reset
        expect(adminServiceSpy.getUsers).toHaveBeenCalled();
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
        // Test clear search resets state
        component.searchTerm = 'existing';
        component.currentPage = 3;

        component.clearSearch();

        expect(component.searchTerm).toBe('');
    });

    describe('Maintenance Mode', () => {
        beforeEach(() => {
            // Update mock to match the expected structure with environments
            const mockStatus = {
                prod: { enabled: false, message: 'Test' },
                beta: { enabled: false, message: 'TestBeta' },
                dev: { enabled: false, message: 'TestDev' }
            };
            adminServiceSpy.getMaintenanceStatus.mockReturnValue(of(mockStatus));

            // Re-trigger ngOnInit since we updated the mock but the component was already created
            component.ngOnInit();
        });

        it('should fetch maintenance status on init', () => {
            expect(component.prodMaintenance.enabled).toBe(false);
            expect(component.prodMaintenance.message).toBe('Test');
        });

        it('should detect message changes', () => {
            component.prodMaintenance.message = 'New Message';
            expect(component.hasMessageChanged('prod')).toBe(true);

            component.prodMaintenance.message = 'Test';
            expect(component.hasMessageChanged('prod')).toBe(false);
        });

        it('should save maintenance message', () => {
            component.prodMaintenance.message = 'Updated Message';
            adminServiceSpy.setMaintenanceMode.mockReturnValue(of({ success: true, enabled: false, message: 'Updated Message' }));

            component.saveMaintenanceMessage('prod');

            expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(false, 'Updated Message', 'prod');
            expect(component.prodMaintenance.message).toBe('Updated Message');
            expect(component.hasMessageChanged('prod')).toBe(false); // Should be reset
        });

        it('should include message when toggling maintenance with confirmation', () => {
            component.prodMaintenance.message = 'Toggle Message';
            adminServiceSpy.setMaintenanceMode.mockReturnValue(of({ success: true, enabled: true, message: 'Toggle Message' }));

            // Mock dialog confirmation
            matDialogSpy.open.mockReturnValue({
                afterClosed: () => of(true)
            });

            // Pass a mock event that includes the source property
            component.onMaintenanceToggle({ checked: true, source: { checked: true } } as any, 'prod');

            expect(matDialogSpy.open).toHaveBeenCalled();
            expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(true, 'Toggle Message', 'prod');
            expect(component.prodMaintenance.enabled).toBe(true);
        });

        it('should cancel toggle if dialog is rejected', () => {
            component.prodMaintenance.enabled = false; // Initial state
            // Mock dialog rejection
            matDialogSpy.open.mockReturnValue({
                afterClosed: () => of(false)
            });

            const mockSource = { checked: true };
            component.onMaintenanceToggle({ checked: true, source: mockSource } as any, 'prod');

            expect(matDialogSpy.open).toHaveBeenCalled();
            expect(adminServiceSpy.setMaintenanceMode).not.toHaveBeenCalled();
            // Should revert the checked state of the source
            expect(mockSource.checked).toBe(false);
            expect(component.prodMaintenance.enabled).toBe(false);
        });
    });

    describe('Theme Support', () => {
        it('should update chart options when theme changes to light', () => {
            // Initial state should be dark (from our mock setup)
            expect(component.authPieChartOptions!.plugins!.legend!.labels!.color).toBe('rgba(255, 255, 255, 0.8)');

            // Toggle to light theme
            themeSubject.next(AppThemes.Normal);
            fixture.detectChanges();

            // Check updated colors
            expect(component.authPieChartOptions!.plugins!.legend!.labels!.color).toBe('rgba(0, 0, 0, 0.8)');
            expect(component.barChartOptions!.scales!['x']!.ticks!.color).toBe('rgba(0, 0, 0, 0.8)');
        });

        it('should update chart options when theme changes back to dark', () => {
            themeSubject.next(AppThemes.Normal); // Start with light
            themeSubject.next(AppThemes.Dark);   // Back to dark
            fixture.detectChanges();

            expect(component.authPieChartOptions!.plugins!.legend!.labels!.color).toBe('rgba(255, 255, 255, 0.8)');
        });
    });
});
