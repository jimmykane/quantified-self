import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { AdminService, AdminUser, ListUsersParams, QueueStats } from '../../../services/admin.service';

import { ActivatedRoute, Router } from '@angular/router';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AdminResolverData } from '../../../resolvers/admin.resolver';

import { MatSort, Sort } from '@angular/material/sort';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

@Component({
    selector: 'app-admin-dashboard',
    templateUrl: './admin-dashboard.component.html',
    styleUrls: ['./admin-dashboard.component.scss'],
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
        MatButtonModule,
        MatSlideToggleModule,
        MatExpansionModule,
        MatDialogModule,
        BaseChartDirective
    ],
    providers: [provideCharts(withDefaultRegisterables())]
})
export class AdminDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
    displayedColumns: string[] = [
        'photoURL', 'email', 'providerIds', 'displayName', 'role', 'subscription',
        'services', 'created', 'lastLogin', 'status', 'actions'
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
    isLoadingStats = true;
    userStats: { total: number; pro: number; basic: number; free: number; providers: Record<string, number> } | null = null;

    // Auth Chart
    public authPieChartData: ChartConfiguration<'pie'>['data'] = {
        labels: [],
        datasets: [{
            data: [],
            backgroundColor: [
                'rgba(255, 99, 132, 0.6)',
                'rgba(54, 162, 235, 0.6)',
                'rgba(255, 206, 86, 0.6)',
                'rgba(75, 192, 192, 0.6)',
                'rgba(153, 102, 255, 0.6)',
                'rgba(255, 159, 64, 0.6)'
            ],
            borderColor: 'transparent'
        }]
    };
    public authPieChartOptions: ChartConfiguration<'pie'>['options'] = {
        responsive: true,
        plugins: {
            legend: {
                position: 'right',
                labels: {
                    color: 'rgba(255, 255, 255, 0.8)',
                    font: {
                        size: 12
                    }
                }
            }
        },
        maintainAspectRatio: false
    };

    // Charts
    public barChartLegend = true;
    public barChartPlugins = [];
    public barChartData: ChartConfiguration<'bar'>['data'] = {
        labels: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
        datasets: [
            { data: [0, 0, 0], label: 'Pending Items' }
        ]
    };
    public barChartOptions: ChartConfiguration<'bar'>['options'] = {
        responsive: true,
        maintainAspectRatio: false
    };

    // Maintenance mode
    prodMaintenance = { enabled: false, message: '', originalMessage: '' };
    betaMaintenance = { enabled: false, message: '', originalMessage: '' };
    devMaintenance = { enabled: false, message: '', originalMessage: '' };
    isUpdatingMaintenance = false;

    // Cleanup
    private destroy$ = new Subject<void>();

    @ViewChild(MatPaginator) paginator!: MatPaginator;
    @ViewChild(MatSort) sort!: MatSort;

    constructor(
        private adminService: AdminService,
        private authService: AppAuthService,
        private router: Router,
        private snackBar: MatSnackBar,
        private logger: LoggerService,
        private dialog: MatDialog,
        private route: ActivatedRoute
    ) { }

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

        // Use resolved data
        const resolvedData = this.route.snapshot.data['adminData'] as AdminResolverData;
        if (resolvedData) {
            this.users = resolvedData.usersData.users;
            this.totalCount = resolvedData.usersData.totalCount;
            this.userStats = resolvedData.userStats;
            this.isLoading = false;
            if (this.userStats) {
                this.updateAuthChart(this.userStats.providers);
            }
        } else {
            // Fallback if no resolver (though with guard it shouldn't happen)
            this.fetchUsers();
            this.adminService.getTotalUserCount().subscribe(stats => {
                this.userStats = stats;
                this.updateAuthChart(stats.providers);
            });
        }

        // Stats and Maintenance are "secondary" data, can fetch separately or via resolver if improved later.
        // For now, let's keep them async or we could have added them to resolver.
        // Given "Resolvers for Layout", the user list is the layout. Queue stats are a widget.
        this.fetchQueueStats();
        this.fetchMaintenanceStatus();
    }

    updateAuthChart(providers: Record<string, number>): void {
        if (!providers) return;

        const labels = Object.keys(providers).map(label => {
            // Prettify label
            if (label === 'google.com') return 'Google';
            if (label === 'password') return 'Email';
            if (label === 'apple.com') return 'Apple';
            if (label === 'facebook.com') return 'Facebook';
            if (label === 'github.com') return 'GitHub';
            return label;
        });
        const data = Object.values(providers);

        this.authPieChartData = {
            labels,
            datasets: [{
                ...this.authPieChartData.datasets[0],
                data
            }]
        };
    }

    fetchQueueStats(): void {
        this.isLoadingStats = true;
        this.adminService.getQueueStatsDirect().pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.queueStats = stats;
                this.isLoadingStats = false;

                if (stats.advanced?.retryHistogram) {
                    this.barChartData = {
                        labels: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
                        datasets: [
                            {
                                data: [
                                    stats.advanced.retryHistogram['0-3'],
                                    stats.advanced.retryHistogram['4-7'],
                                    stats.advanced.retryHistogram['8-9']
                                ],
                                label: 'Pending Items',
                                backgroundColor: [
                                    'rgba(75, 192, 192, 0.6)', // Greenish
                                    'rgba(255, 206, 86, 0.6)', // Yellowish
                                    'rgba(255, 99, 132, 0.6)'  // Reddish
                                ]
                            }
                        ]
                    };
                }
            },
            error: (err) => {
                this.logger.error('Failed to load queue stats (direct):', err);
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
                const users = response.users;

                this.users = users;
                this.totalCount = response.totalCount;
                this.isLoading = false;
            },
            error: (err) => {
                this.error = 'Failed to load users. ' + (err.message || '');
                this.isLoading = false;
                this.logger.error('AdminDashboard error:', err);
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

    formatDuration(ms: number): string {
        if (!ms) return '0s';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    // Maintenance mode methods
    fetchMaintenanceStatus(): void {
        this.adminService.getMaintenanceStatus().subscribe({
            next: (status) => {
                this.prodMaintenance = {
                    enabled: status.prod.enabled,
                    message: status.prod.message || "",
                    originalMessage: status.prod.message || ""
                };
                this.betaMaintenance = {
                    enabled: status.beta.enabled,
                    message: status.beta.message || "",
                    originalMessage: status.beta.message || ""
                };
                this.devMaintenance = {
                    enabled: status.dev.enabled,
                    message: status.dev.message || "",
                    originalMessage: status.dev.message || ""
                };
            },
            error: (err) => {
                this.logger.error('Failed to fetch maintenance status:', err);
            }
        });
    }

    hasMessageChanged(env: 'prod' | 'beta' | 'dev'): boolean {
        const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);
        return m.message !== m.originalMessage;
    }

    saveMaintenanceMessage(env: 'prod' | 'beta' | 'dev'): void {
        if (!this.hasMessageChanged(env)) return;

        const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);
        this.isUpdatingMaintenance = true;
        this.adminService.setMaintenanceMode(m.enabled, m.message, env).subscribe({
            next: (result) => {
                const updated = {
                    enabled: result.enabled,
                    message: result.message,
                    originalMessage: result.message
                };
                if (env === 'prod') this.prodMaintenance = updated;
                else if (env === 'beta') this.betaMaintenance = updated;
                else this.devMaintenance = updated;
                this.isUpdatingMaintenance = false;
            },
            error: (err) => {
                this.logger.error(`Failed to save ${env} maintenance message:`, err);
                this.isUpdatingMaintenance = false;
            }
        });
    }

    onMaintenanceToggle(event: MatSlideToggleChange, env: 'prod' | 'beta' | 'dev'): void {
        const isEnable = event.checked;
        const envLabels = { prod: 'PRODUCTION', beta: 'BETA', dev: 'DEV' };
        const envLabel = envLabels[env];
        const confirmMessage = isEnable
            ? `Are you sure you want to ENABLE maintenance mode for ${envLabel}? This will prevent all non-admin users in that environment from accessing the app.`
            : `Are you sure you want to DISABLE maintenance mode for ${envLabel}? All users in that environment will regain access immediately.`;

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            width: '400px',
            data: {
                title: isEnable ? `Enable ${envLabel} Maintenance?` : `Disable ${envLabel} Maintenance?`,
                message: confirmMessage,
                confirmText: isEnable ? 'Enable' : 'Disable',
                cancelText: 'Cancel'
            }
        });

        dialogRef.afterClosed().subscribe(result => {
            if (!result) {
                // Revert the toggle UI if cancelled
                event.source.checked = !isEnable;
                if (env === 'prod') this.prodMaintenance.enabled = !isEnable;
                else if (env === 'beta') this.betaMaintenance.enabled = !isEnable;
                else this.devMaintenance.enabled = !isEnable;
                return;
            }

            this.isUpdatingMaintenance = true;
            const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);

            this.adminService.setMaintenanceMode(isEnable, m.message, env).subscribe({
                next: (result) => {
                    const updated = {
                        enabled: result.enabled,
                        message: result.message,
                        originalMessage: result.message
                    };
                    if (env === 'prod') this.prodMaintenance = updated;
                    else if (env === 'beta') this.betaMaintenance = updated;
                    else this.devMaintenance = updated;
                    this.isUpdatingMaintenance = false;
                    this.logger.log(`Maintenance mode [${env}] ${result.enabled ? 'ENABLED' : 'DISABLED'}`);
                },
                error: (err) => {
                    this.logger.error(`Failed to update ${env} maintenance mode:`, err);
                    this.isUpdatingMaintenance = false;
                    // Revert the toggle
                    if (env === 'prod') this.prodMaintenance.enabled = !isEnable;
                    else if (env === 'beta') this.betaMaintenance.enabled = !isEnable;
                    else this.devMaintenance.enabled = !isEnable;
                    event.source.checked = !isEnable;
                }
            });
        });
    }

    onImpersonate(user: AdminUser): void {
        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            width: '400px',
            data: {
                title: 'Impersonate User?',
                message: `Are you sure you want to impersonate ${user.email}? You will be logged out of your admin account and logged in as this user.`,
                confirmText: 'Impersonate',
                cancelText: 'Cancel',
                isDangerous: true
            }
        });

        dialogRef.afterClosed().subscribe(confirmed => {
            if (confirmed) {
                this.isLoading = true;
                this.adminService.impersonateUser(user.uid).subscribe({
                    next: async (res) => {
                        this.logger.log('Impersonation token received. Switching user...', res);
                        await this.authService.loginWithCustomToken(res.token);
                        this.router.navigate(['/']);
                    },
                    error: (err) => {
                        this.logger.error('Impersonation failed', err);
                        this.isLoading = false;

                        let errorMessage = 'Impersonation failed. ';
                        if (err.message && err.message.includes('CORS')) {
                            errorMessage += 'This usually happens if the backend function is not deployed or accessible.';
                        } else if (err.status === 0 || (err.name && err.name === 'FirebaseError' && err.code === 'internal')) {
                            errorMessage += 'Network or Server Error. Please ensure the backend is deployed.';
                        } else {
                            errorMessage += err.message || 'Unknown error';
                        }

                        this.snackBar.open(errorMessage, 'Close', {
                            duration: 5000,
                            panelClass: ['error-snackbar']
                        });
                    }
                });
            }
        });
    }
}
