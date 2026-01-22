import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminUserManagementComponent } from './admin-user-management.component';
import { AdminService, AdminUser, ListUsersResponse } from '../../../services/admin.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
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
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';

// Mock canvas for charts
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
        fillRect: () => { },
        clearRect: () => { },
        getImageData: () => ({ data: [] }),
        putImageData: () => { },
        createImageData: () => [],
        setTransform: () => { },
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
        canvas: { width: 0, height: 0, style: {} }
    }),
    configurable: true
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('AdminUserManagementComponent', () => {
    let component: AdminUserManagementComponent;
    let fixture: ComponentFixture<AdminUserManagementComponent>;
    let adminServiceSpy: any;
    let authServiceSpy: any;
    let routerSpy: any;
    let matDialogSpy: any;
    let appThemeServiceMock: any;
    let themeSubject: BehaviorSubject<AppThemes>;
    let mockLogger: any;

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

    beforeEach(async () => {
        adminServiceSpy = {
            getUsers: vi.fn().mockReturnValue(of(mockResponse)),
            getTotalUserCount: vi.fn().mockReturnValue(of({ total: 100, pro: 30, basic: 70, free: 0 })),
            impersonateUser: vi.fn().mockReturnValue(of({ token: 'test-token' })),
        };

        authServiceSpy = {
            loginWithCustomToken: vi.fn().mockResolvedValue({})
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
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: AppThemeService, useValue: appThemeServiceMock },
                { provide: LoggerService, useValue: mockLogger },
                { provide: Router, useValue: routerSpy },
                { provide: MatDialog, useValue: matDialogSpy },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
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
            .compileComponents();

        fixture = TestBed.createComponent(AdminUserManagementComponent);
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
            sortDirection: 'asc',
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

    describe('getSubscriptionDetails', () => {
        it('should return dash if no subscription', () => {
            const user = {} as any;
            expect(component.getSubscriptionDetails(user)).toBe('-');
        });

        it('should return status uppercase', () => {
            const user = { subscription: { status: 'active' } } as any;
            expect(component.getSubscriptionDetails(user)).toBe('ACTIVE');
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
});
