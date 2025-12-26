import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { AdminService, AdminUser, ListUsersResponse } from '../../../services/admin.service';
import { of, throwError } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AdminDashboardComponent', () => {
    let component: AdminDashboardComponent;
    let fixture: ComponentFixture<AdminDashboardComponent>;
    let adminServiceSpy: {
        getUsers: ReturnType<typeof vi.fn>;
        getQueueStatsDirect: ReturnType<typeof vi.fn>;
        getTotalUserCount: ReturnType<typeof vi.fn>;
        getMaintenanceStatus: ReturnType<typeof vi.fn>;
        setMaintenanceMode: ReturnType<typeof vi.fn>;
    };

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
            getQueueStatsDirect: vi.fn().mockReturnValue(of({ pending: 0, succeeded: 0, failed: 0, providers: [] })),
            getTotalUserCount: vi.fn().mockReturnValue(of(100)),
            getMaintenanceStatus: vi.fn().mockReturnValue(of({ enabled: false, message: 'Test' })),
            setMaintenanceMode: vi.fn().mockReturnValue(of({ success: true, enabled: true, message: 'Test' }))
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
                { provide: AdminService, useValue: adminServiceSpy }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should fetch users on init with correct parameters', () => {
        expect(adminServiceSpy.getUsers).toHaveBeenCalledWith({
            page: 0,
            pageSize: 10,
            searchTerm: undefined,
            sortField: 'email',
            sortDirection: 'asc'
        });
        expect(component.users).toEqual(mockUsers);
        expect(component.totalCount).toBe(2);
        expect(component.isLoading).toBe(false);
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
        it('should fetch maintenance status on init', () => {
            expect(component.maintenanceEnabled).toBe(false);
            expect(component.maintenanceMessage).toBe('Test');
        });

        it('should detect message changes', () => {
            component.maintenanceMessage = 'New Message';
            expect(component.hasMessageChanged()).toBe(true);

            component.maintenanceMessage = 'Test';
            expect(component.hasMessageChanged()).toBe(false);
        });

        it('should save maintenance message', () => {
            component.maintenanceMessage = 'Updated Message';
            adminServiceSpy.setMaintenanceMode.mockReturnValue(of({ success: true, enabled: false, message: 'Updated Message' }));

            component.saveMaintenanceMessage();

            expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(false, 'Updated Message');
            expect(component.maintenanceMessage).toBe('Updated Message');
            expect(component.hasMessageChanged()).toBe(false); // Should be reset
        });

        it('should include message when toggling maintenance', () => {
            component.maintenanceMessage = 'Toggle Message';
            adminServiceSpy.setMaintenanceMode.mockReturnValue(of({ success: true, enabled: true, message: 'Toggle Message' }));

            component.onMaintenanceToggle({ checked: true } as any);

            expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(true, 'Toggle Message');
            expect(component.maintenanceEnabled).toBe(true);
        });
    });
});
