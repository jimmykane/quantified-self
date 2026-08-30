import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppImpersonationService } from '../../../services/app.impersonation.service';
import { AdminService, AdminUser, ListUsersResponse } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminUserTableComponent } from './admin-user-table.component';
import { AdminSubscriptionGiftDialogComponent } from '../admin-subscription-gift-dialog/admin-subscription-gift-dialog.component';

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
    let snackBar: { open: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        adminService = {
            getUsers: vi.fn(() => of({ users: [firstUser], totalCount: 1, page: 0, pageSize: 10 })),
        };
        impersonation = { startImpersonation: vi.fn(() => Promise.resolve()) };
        dialog = { open: vi.fn(() => ({ afterClosed: () => of(true) })) };
        snackBar = { open: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [AdminUserTableComponent],
            providers: [
                { provide: AdminService, useValue: adminService },
                { provide: AppImpersonationService, useValue: impersonation },
                { provide: MatDialog, useValue: dialog },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ],
        }).overrideComponent(AdminUserTableComponent, { set: { template: '' } }).compileComponents();

        component = TestBed.createComponent(AdminUserTableComponent).componentInstance;
        (component as unknown as { dialog: typeof dialog }).dialog = dialog;
        (component as unknown as { snackBar: typeof snackBar }).snackBar = snackBar;
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

    it('opens the subscription gift dialog and refreshes the current row page after success', () => {
        const paidUser: AdminUser = {
            ...firstUser,
            customClaims: { stripeRole: 'pro' },
            subscription: { status: 'active' },
        };
        adminService.getUsers.mockClear();
        dialog.open.mockReturnValueOnce({
            afterClosed: () => of({
                uid: paidUser.uid,
                response: {
                    operationId: '123e4567-e89b-42d3-a456-426614174000',
                    status: 'succeeded',
                    previousAccessEnd: '2026-09-01T00:00:00.000Z',
                    newAccessEnd: '2026-10-01T00:00:00.000Z',
                    cancelAtPeriodEnd: false,
                    notificationStatus: 'queued',
                },
            }),
        });

        component.onGiftSubscriptionTime(paidUser);

        expect(dialog.open).toHaveBeenCalledWith(AdminSubscriptionGiftDialogComponent, expect.objectContaining({
            disableClose: true,
            data: { user: paidUser },
        }));
        expect(adminService.getUsers).toHaveBeenCalledTimes(1);
        expect(snackBar.open).toHaveBeenCalledWith(
            'Subscription time was granted successfully.',
            undefined,
            { duration: 5000 },
        );
    });

    it('clearly reports an email failure without treating the gift as failed', () => {
        dialog.open.mockReturnValueOnce({
            afterClosed: () => of({
                uid: firstUser.uid,
                response: {
                    operationId: '123e4567-e89b-42d3-a456-426614174000',
                    status: 'succeeded',
                    previousAccessEnd: '2026-09-01T00:00:00.000Z',
                    newAccessEnd: '2026-10-01T00:00:00.000Z',
                    cancelAtPeriodEnd: false,
                    notificationStatus: 'failed',
                },
            }),
        });

        component.onGiftSubscriptionTime(firstUser);

        expect(snackBar.open).toHaveBeenCalledWith(
            'Subscription time was granted, but the optional email needs retrying.',
            undefined,
            { duration: 5000 },
        );
    });
});
