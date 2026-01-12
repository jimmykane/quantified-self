import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { AdminService, AdminUser, ListUsersParams, QueueStats, FinancialStats } from '../../../services/admin.service';

import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AdminResolverData } from '../../../resolvers/admin.resolver';
import { AppThemes } from '@sports-alliance/sports-lib';

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
// import { MatSlideToggleModule } from '@angular/material/slide-toggle'; // Removed
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
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
        // MatSlideToggleModule, // Removed

        MatExpansionModule,
        MatDialogModule,
        MatTooltipModule,
        MatTooltipModule,
        BaseChartDirective,
        RouterModule
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

    // Financial stats
    financialStats: FinancialStats | null = null;
    isLoadingFinancials = true;

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

    // Color constants for theme switching
    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';
    private readonly CHART_GRID_DARK = 'rgba(255, 255, 255, 0.1)';
    private readonly CHART_GRID_LIGHT = 'rgba(0, 0, 0, 0.1)';

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

    // Maintenance mode removed (moved to AdminMaintenanceComponent)


    // Cleanup
    private destroy$ = new Subject<void>();

    @ViewChild(MatPaginator) paginator!: MatPaginator;
    @ViewChild(MatSort) sort!: MatSort;

    constructor(
        private adminService: AdminService,
        private authService: AppAuthService,
        private appThemeService: AppThemeService,
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

        // Handle theme changes for charts
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            const isDark = theme === AppThemes.Dark;
            const textColor = isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;
            const gridColor = isDark ? this.CHART_GRID_DARK : this.CHART_GRID_LIGHT;

            // Update Pie Chart Options
            this.authPieChartOptions = {
                ...this.authPieChartOptions,
                plugins: {
                    ...this.authPieChartOptions!.plugins,
                    legend: {
                        ...this.authPieChartOptions!.plugins!.legend,
                        labels: {
                            ...this.authPieChartOptions!.plugins!.legend!.labels,
                            color: textColor
                        }
                    }
                }
            };

            // Update Bar Chart Options
            this.barChartOptions = {
                ...this.barChartOptions,
                scales: {
                    x: {
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    },
                    y: {
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    }
                }
            };
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
        this.fetchFinancialStats();
        // this.fetchMaintenanceStatus(); // Removed

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
        // Fetch full stats (with analysis) once
        this.adminService.getQueueStats(true).pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.updateQueueStatsUI(stats);
                this.isLoadingStats = false;
            },
            error: (err) => {
                this.logger.error('Failed to load initial queue stats:', err);
                this.isLoadingStats = false;
            }
        });
    }

    private updateQueueStatsUI(stats: QueueStats, isPartial = false): void {
        if (isPartial && this.queueStats) {
            // Merge basic stats into existing stats to preserve analysis data (dlq, topErrors, etc.)
            this.queueStats = {
                ...this.queueStats,
                pending: stats.pending,
                succeeded: stats.succeeded,
                stuck: stats.stuck,
                cloudTasks: stats.cloudTasks ?? this.queueStats.cloudTasks,
                providers: stats.providers,
                advanced: this.queueStats.advanced ? {
                    ...this.queueStats.advanced,
                    throughput: stats.advanced?.throughput ?? this.queueStats.advanced.throughput,
                    maxLagMs: stats.advanced?.maxLagMs ?? this.queueStats.advanced.maxLagMs,
                    retryHistogram: stats.advanced?.retryHistogram ?? this.queueStats.advanced.retryHistogram
                } : stats.advanced
            };
        } else {
            this.queueStats = stats;
        }

        if (this.queueStats.advanced?.retryHistogram) {
            this.barChartData = {
                labels: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
                datasets: [
                    {
                        data: [
                            this.queueStats.advanced.retryHistogram['0-3'],
                            this.queueStats.advanced.retryHistogram['4-7'],
                            this.queueStats.advanced.retryHistogram['8-9']
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
    }

    fetchFinancialStats(): void {
        this.isLoadingFinancials = true;
        this.adminService.getFinancialStats().pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.financialStats = stats;
                this.isLoadingFinancials = false;
            },
            error: (err) => {
                this.logger.error('Failed to load financial stats:', err);
                this.isLoadingFinancials = false;
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

    formatCurrency(amountCents: number, currency: string): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency.toUpperCase()
        }).format(amountCents / 100);
    }

    openExternalLink(url: string | null): void {
        if (url) {
            window.open(url, '_blank');
        }
    }

    // Maintenance mode methods removed (moved to AdminMaintenanceComponent)


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
