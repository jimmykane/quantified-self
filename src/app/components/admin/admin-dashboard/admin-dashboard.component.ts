import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { AdminService, AdminUser, ListUsersParams, QueueStats } from '../../../services/admin.service';
import { MatSort, Sort } from '@angular/material/sort';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-admin-dashboard',
    templateUrl: './admin-dashboard.component.html',
    styleUrls: ['./admin-dashboard.component.css'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule,
        MatInputModule,
        MatFormFieldModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule
    ]
})
export class AdminDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
    displayedColumns: string[] = [
        'photoURL', 'email', 'providerIds', 'displayName', 'role', 'subscription',
        'services', 'created', 'lastLogin', 'status'
    ];

    // Data
    users: AdminUser[] = [];
    totalCount = 0;

    // Pagination state
    currentPage = 0;
    pageSize = 10;
    pageSizeOptions = [10, 25, 50];

    // Search state
    searchTerm = '';
    private searchSubject = new Subject<string>();

    // Sort state
    sortField = 'email';
    sortDirection: 'asc' | 'desc' = 'asc';

    isLoading = true;
    error: string | null = null;

    // Queue stats
    queueStats: QueueStats | null = null;
    isLoadingStats = false;

    // Cleanup
    private destroy$ = new Subject<void>();

    @ViewChild(MatPaginator) paginator!: MatPaginator;
    @ViewChild(MatSort) sort!: MatSort;

    constructor(private adminService: AdminService) { }

    ngOnInit(): void {
        // Setup debounced search
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(term => {
            this.searchTerm = term;
            this.currentPage = 0; // Reset to first page on search
            this.fetchUsers();
        });

        // Initial fetch
        this.fetchUsers();
        this.fetchQueueStats();
    }

    fetchQueueStats(): void {
        this.isLoadingStats = true;
        this.adminService.getQueueStatsDirect().subscribe({
            next: (stats) => {
                this.queueStats = stats;
                this.isLoadingStats = false;
            },
            error: (err) => {
                console.error('Failed to load queue stats (direct):', err);
                // Fallback to function if direct fails or retry
                this.isLoadingStats = false;
            }
        });
    }

    ngAfterViewInit(): void {
        // MatSort is available after view init
        if (this.sort) {
            this.sort.sortChange.pipe(takeUntil(this.destroy$)).subscribe((sortState: Sort) => {
                this.onSortChange(sortState);
            });
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    fetchUsers(): void {
        this.isLoading = true;
        this.error = null;

        const params: ListUsersParams = {
            page: this.currentPage,
            pageSize: this.pageSize,
            searchTerm: this.searchTerm || undefined,
            sortField: this.sortField,
            sortDirection: this.sortDirection
        };

        this.adminService.getUsers(params).subscribe({
            next: (response) => {
                let users = response.users;

                this.users = users;
                this.totalCount = response.totalCount;
                this.isLoading = false;
            },
            error: (err) => {
                this.error = 'Failed to load users. ' + (err.message || '');
                this.isLoading = false;
                console.error('AdminDashboard error:', err);
            }
        });
    }

    onPageChange(event: PageEvent): void {
        this.currentPage = event.pageIndex;
        this.pageSize = event.pageSize;
        this.fetchUsers();
    }

    onSortChange(sort: Sort): void {
        this.sortField = sort.active || 'email';
        this.sortDirection = (sort.direction as 'asc' | 'desc') || 'asc';
        this.currentPage = 0; // Reset to first page on sort change
        this.fetchUsers();
    }

    onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.searchSubject.next(value);
    }

    clearSearch(): void {
        this.searchTerm = '';
        this.searchSubject.next('');
    }

    // Helper methods
    getServiceLogo(provider: string): string {
        switch (provider.toLowerCase()) {
            case 'garmin': return 'assets/logos/garmin.svg';
            case 'suunto': return 'assets/logos/suunto.svg';
            case 'coros': return 'assets/logos/coros.svg';
            default: return '';
        }
    }

    formatConnectionDate(timestamp: any): string {
        if (!timestamp) return 'Time unknown';
        const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    getRole(user: AdminUser): string {
        return user.customClaims?.stripeRole || 'free';
    }

    isAdmin(user: AdminUser): boolean {
        return user.customClaims?.admin === true;
    }

    getSubscriptionDetails(user: AdminUser): string {
        if (!user.subscription) return '-';

        let details = user.subscription.status.toUpperCase();

        if (user.subscription.cancel_at_period_end && user.subscription.current_period_end) {
            const date = this.formatDate(user.subscription.current_period_end);
            details += ` (Ends ${date})`;
        }

        return details;
    }

    private formatDate(timestamp: any): string {
        if (!timestamp) return '';
        const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
}
