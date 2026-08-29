import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppImpersonationService } from '../../../services/app.impersonation.service';
import { AdminService, AdminUser, ListUsersResponse } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminUserTableComponent } from './admin-user-table.component';

const firstUser = {
    uid: 'user-1',
    email: 'first@example.com',
    customClaims: {},
    metadata: { creationTime: '2026-01-01', lastSignInTime: '2026-02-01' },
    disabled: false,
    providerIds: ['password'],
} as AdminUser;

describe('AdminUserTableComponent', () => {
    let component: AdminUserTableComponent;
    let adminService: { getUsers: ReturnType<typeof vi.fn> };
    let impersonation: { startImpersonation: ReturnType<typeof vi.fn> };
    let dialog: { open: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        adminService = {
            getUsers: vi.fn(() => of({ users: [firstUser], totalCount: 1, page: 0, pageSize: 10 })),
        };
        impersonation = { startImpersonation: vi.fn(() => Promise.resolve()) };
        dialog = { open: vi.fn(() => ({ afterClosed: () => of(true) })) };

        await TestBed.configureTestingModule({
            imports: [AdminUserTableComponent],
            providers: [
                { provide: AdminService, useValue: adminService },
                { provide: AppImpersonationService, useValue: impersonation },
                { provide: MatDialog, useValue: dialog },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ],
        }).overrideComponent(AdminUserTableComponent, { set: { template: '' } }).compileComponents();

        component = TestBed.createComponent(AdminUserTableComponent).componentInstance;
        (component as unknown as { dialog: typeof dialog }).dialog = dialog;
        component.ngOnInit();
    });

    it('loads the first user page without route-resolved data', () => {
        expect(adminService.getUsers).toHaveBeenCalledWith({
            page: 0,
            pageSize: 10,
            searchTerm: undefined,
            sortField: 'created',
            sortDirection: 'desc',
            filterService: undefined,
        });
        expect(component.rows()[0].user).toBe(firstUser);
        expect(component.totalCount()).toBe(1);
        expect(component.loading()).toBe(false);
    });

    it('applies service filters and supported sort fields', () => {
        component.onFilterServiceChange('garmin');
        component.onSortChange({ active: 'email', direction: 'asc' });

        expect(adminService.getUsers).toHaveBeenLastCalledWith(expect.objectContaining({
            filterService: 'garmin',
            sortField: 'email',
            sortDirection: 'asc',
        }));
    });

    it('uses an explicit All Services selection while omitting the server filter', () => {
        component.onFilterServiceChange('garmin');
        expect(component.serviceSelection()).toBe('garmin');

        component.onFilterServiceChange('all');

        expect(component.serviceSelection()).toBe('all');
        expect(adminService.getUsers).toHaveBeenLastCalledWith(expect.objectContaining({
            filterService: undefined,
        }));
    });

    it('falls back from unsupported sort requests', () => {
        component.onSortChange({ active: 'unsupported', direction: 'asc' });
        expect(adminService.getUsers).toHaveBeenLastCalledWith(expect.objectContaining({
            sortField: 'created',
            sortDirection: 'desc',
        }));
    });

    it('ignores stale user-list responses', () => {
        const older = new Subject<ListUsersResponse>();
        const newer = new Subject<ListUsersResponse>();
        adminService.getUsers.mockReturnValueOnce(older).mockReturnValueOnce(newer);

        component.fetchUsers();
        component.fetchUsers();
        newer.next({ users: [firstUser], totalCount: 1, page: 0, pageSize: 10 });
        newer.complete();
        older.next({ users: [], totalCount: 0, page: 0, pageSize: 10 });
        older.complete();

        expect(component.rows()).toHaveLength(1);
        expect(component.totalCount()).toBe(1);
    });

    it('does not show an empty-result message when loading fails', () => {
        adminService.getUsers.mockReturnValueOnce(throwError(() => new Error('offline')));

        component.fetchUsers();

        expect(component.error()).toBe('Failed to load users. offline');
        expect(component.emptyStateMessage()).toBeNull();
    });

    it('confirms and starts impersonation for a non-admin user', async () => {
        component.onImpersonate(firstUser);
        await Promise.resolve();

        expect(dialog.open).toHaveBeenCalled();
        expect(impersonation.startImpersonation).toHaveBeenCalledWith({
            uid: firstUser.uid,
            email: firstUser.email,
            displayName: firstUser.displayName,
        });
    });
});
