import { CommonModule } from '@angular/common';
import { Component, LOCALE_ID, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { buildAdminUserTableRows } from '../../../helpers/admin-user-table.helper';
import { CompactCountPipe } from '../../../helpers/compact-count.pipe';
import { AppImpersonationService } from '../../../services/app.impersonation.service';
import { AdminService, AdminUser, ListUsersParams } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { ServiceSourceIconComponent } from '../../event-summary/service-source-icon/service-source-icon.component';
import {
    AdminSubscriptionGiftDialogComponent,
    AdminSubscriptionGiftDialogResult,
} from '../admin-subscription-gift-dialog/admin-subscription-gift-dialog.component';

const ADMIN_USER_SEARCH_DEBOUNCE_MS = 750;
type AdminServiceFilter = 'garmin' | 'suunto' | 'coros' | 'wahoo' | undefined;
type AdminServiceSelection = Exclude<AdminServiceFilter, undefined> | 'all';

@Component({
    selector: 'app-admin-user-table',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatCardModule,
        MatChipsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatPaginatorModule,
        MatProgressSpinnerModule,
        MatSelectModule,
        MatSnackBarModule,
        MatSortModule,
        MatTableModule,
        MatTooltipModule,
        CompactCountPipe,
        ServiceSourceIconComponent,
    ],
    templateUrl: './admin-user-table.component.html',
    styleUrls: ['./admin-user-table.component.scss'],
})
export class AdminUserTableComponent implements OnInit, OnDestroy {
    private readonly adminService = inject(AdminService);
    private readonly impersonationService = inject(AppImpersonationService);
    private readonly dialog = inject(MatDialog);
    private readonly snackBar = inject(MatSnackBar);
    private readonly logger = inject(LoggerService);
    private readonly locale = inject(LOCALE_ID);
    private readonly searchSubject = new Subject<string>();
    private readonly destroy$ = new Subject<void>();
    private userFetchRequestSequence = 0;
    private readonly usersState = signal<AdminUser[]>([]);
    private readonly supportedSortFields = new Set([
        'email', 'displayName', 'role', 'admin', 'created', 'lastLogin', 'status', 'providerIds',
    ]);

    readonly rows = computed(() => buildAdminUserTableRows(this.usersState(), this.locale));
    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly totalCount = signal(0);
    readonly currentPage = signal(0);
    readonly pageSize = signal(10);
    readonly searchTerm = signal('');
    readonly searchInputValue = signal('');
    readonly filterService = signal<AdminServiceFilter>(undefined);
    readonly serviceSelection = computed<AdminServiceSelection>(() => this.filterService() ?? 'all');
    readonly sortField = signal('created');
    readonly sortDirection = signal<'asc' | 'desc'>('desc');
    readonly pageSizeOptions = [10, 25, 50];
    readonly emptyStateMessage = computed(() => {
        if (this.loading() || this.error()) {
            return null;
        }
        return this.searchTerm() ? `No users found matching "${this.searchTerm()}"` : 'No users found';
    });
    readonly displayedColumns = [
        'photoURL', 'email', 'uid', 'providerIds', 'displayName', 'role', 'subscriptionHistory',
        'assistantRequestsUsed', 'eventStats', 'routeStats', 'services', 'created', 'lastLogin',
        'onboarding', 'status', 'actions',
    ];

    ngOnInit(): void {
        this.searchSubject.pipe(
            debounceTime(ADMIN_USER_SEARCH_DEBOUNCE_MS),
            distinctUntilChanged(),
            takeUntil(this.destroy$),
        ).subscribe(term => {
            this.searchTerm.set(term);
            this.currentPage.set(0);
            this.fetchUsers();
        });
        this.fetchUsers();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    fetchUsers(): void {
        const requestSequence = ++this.userFetchRequestSequence;
        this.loading.set(true);
        this.error.set(null);
        const params: ListUsersParams = {
            page: this.currentPage(),
            pageSize: this.pageSize(),
            searchTerm: this.searchTerm() || undefined,
            sortField: this.sortField(),
            sortDirection: this.sortDirection(),
            filterService: this.filterService(),
        };

        this.adminService.getUsers(params).pipe(takeUntil(this.destroy$)).subscribe({
            next: response => {
                if (requestSequence !== this.userFetchRequestSequence) {
                    return;
                }
                this.usersState.set(response.users);
                this.totalCount.set(response.totalCount);
                this.loading.set(false);
            },
            error: error => {
                if (requestSequence !== this.userFetchRequestSequence) {
                    return;
                }
                this.error.set(`Failed to load users. ${error?.message || ''}`.trim());
                this.loading.set(false);
                this.logger.error('Admin user table load failed:', error);
            },
        });
    }

    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.fetchUsers();
    }

    onSortChange(sort: Sort): void {
        const requestedField = sort.active || 'created';
        const supported = this.supportedSortFields.has(requestedField);
        this.sortField.set(supported ? requestedField : 'created');
        this.sortDirection.set(supported && sort.direction ? sort.direction : 'desc');
        this.currentPage.set(0);
        this.fetchUsers();
    }

    onSearchInput(event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        this.searchInputValue.set(target.value);
        this.searchSubject.next(target.value);
    }

    clearSearch(): void {
        this.searchInputValue.set('');
        this.searchTerm.set('');
        this.searchSubject.next('');
    }

    onFilterServiceChange(service: AdminServiceSelection): void {
        this.filterService.set(service === 'all' ? undefined : service);
        this.currentPage.set(0);
        this.fetchUsers();
    }

    onAvatarError(event: Event): void {
        if (event.target instanceof HTMLImageElement) {
            event.target.src = 'assets/icons/user.svg';
        }
    }

    onImpersonate(user: AdminUser): void {
        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            width: '400px',
            data: {
                title: 'Impersonate User?',
                message: `Are you sure you want to impersonate ${user.email}? You will switch into that user's session and see a persistent return-to-admin control while impersonating.`,
                confirmText: 'Impersonate',
                cancelText: 'Cancel',
                isDangerous: true,
            },
        });

        dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe(confirmed => {
            if (!confirmed) {
                return;
            }
            this.loading.set(true);
            void this.impersonationService.startImpersonation({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
            }).catch(() => undefined).finally(() => this.loading.set(false));
        });
    }

    onGiftSubscriptionTime(user: AdminUser): void {
        const dialogRef = this.dialog.open<
            AdminSubscriptionGiftDialogComponent,
            { user: AdminUser },
            AdminSubscriptionGiftDialogResult | null
        >(AdminSubscriptionGiftDialogComponent, {
            width: '720px',
            maxWidth: '96vw',
            maxHeight: '92vh',
            disableClose: true,
            data: { user },
        });

        dialogRef.afterClosed().pipe(takeUntil(this.destroy$)).subscribe(result => {
            if (!result) {
                return;
            }
            this.fetchUsers();
            const message = result.response.notificationStatus === 'failed'
                ? 'Subscription time was granted, but the optional email needs retrying.'
                : 'Subscription time was granted successfully.';
            this.snackBar.open(message, undefined, { duration: 5000 });
        });
    }
}
