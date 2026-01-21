import { Component, OnInit, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort, MatSort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { AdminService, AdminUser, ListUsersParams } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { AdminResolverData } from '../../../resolvers/admin.resolver';
import { AppThemes } from '@sports-alliance/sports-lib';

export interface UserStats {
    total: number;
    pro: number;
    basic: number;
    free: number;
    providers?: Record<string, number>;
}

@Component({
    selector: 'app-admin-user-management',
    templateUrl: './admin-user-management.component.html',
    styleUrls: ['./admin-user-management.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        MatTooltipModule,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule,
        MatInputModule,
        MatFormFieldModule,
        MatSelectModule,
        MatDialogModule,
        MatSnackBarModule,
        BaseChartDirective
    ],
    providers: [provideCharts(withDefaultRegisterables())]
})
export class AdminUserManagementComponent implements OnInit, OnDestroy {
    @ViewChild(MatSort) sort!: MatSort;

    // Injected services
    private adminService = inject(AdminService);
    private appThemeService = inject(AppThemeService);
    private authService = inject(AppAuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private logger = inject(LoggerService);

    // Data state
    users: AdminUser[] = [];
    userStats: UserStats | null = null;
    isLoading = true;
    error: string | null = null;
    totalCount = 0;
    currentPage = 0;
    pageSize = 10;
    pageSizeOptions: number[] = [10, 25, 50];
    filterService: 'garmin' | 'suunto' | 'coros' | undefined = undefined;

    // Search and sort state
    searchTerm = '';
    sortField = 'email';
    sortDirection: 'asc' | 'desc' = 'asc';

    displayedColumns: string[] = [
        'photoURL', 'email', 'providerIds', 'displayName', 'role', 'subscription',
        'services', 'created', 'lastLogin', 'status', 'actions'
    ];

    private searchSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    // Chart configuration
    public authPieChartData: ChartConfiguration<'pie'>['data'] = {
        labels: [],
        datasets: [{ data: [], backgroundColor: [] }]
    };
    public authPieChartOptions: ChartOptions<'pie'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'right', labels: { padding: 20 } }
        }
    };

    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';

    ngOnInit(): void {
        // Handle search debounce
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(term => {
            this.searchTerm = term;
            this.currentPage = 0;
            this.fetchUsers();
        });

        // Handle theme changes for chart
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.updateChartTheme(theme);
        });

        // Use resolved data if available
        const resolvedData = this.route.snapshot.data['adminData'] as AdminResolverData;
        if (resolvedData) {
            this.users = resolvedData.usersData.users;
            this.totalCount = resolvedData.usersData.totalCount;
            this.userStats = resolvedData.userStats;
            this.isLoading = false;
            if (this.userStats?.providers) {
                this.updateAuthChart(this.userStats.providers);
            }
        } else {
            // Fallback: fetch data directly
            this.fetchUsers();
            this.adminService.getTotalUserCount().pipe(takeUntil(this.destroy$)).subscribe(stats => {
                this.userStats = stats;
                if (stats.providers) {
                    this.updateAuthChart(stats.providers);
                }
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
            sortDirection: this.sortDirection,
            filterService: this.filterService
        };

        this.adminService.getUsers(params).pipe(takeUntil(this.destroy$)).subscribe({
            next: (response) => {
                this.users = response.users;
                this.totalCount = response.totalCount;
                this.isLoading = false;
            },
            error: (err) => {
                this.error = 'Failed to load users. ' + (err.message || '');
                this.isLoading = false;
                this.logger.error('AdminUserManagement error:', err);
            }
        });
    }

    private updateAuthChart(providers: Record<string, number>): void {
        const providerLabels: Record<string, string> = {
            'google.com': 'Google',
            'password': 'Email/Password',
            'apple.com': 'Apple',
            'facebook.com': 'Facebook'
        };
        const providerColors: Record<string, string> = {
            'google.com': '#4285F4',
            'password': '#34A853',
            'apple.com': '#555555',
            'facebook.com': '#1877F2'
        };

        this.authPieChartData = {
            labels: Object.keys(providers).map(p => providerLabels[p] || p),
            datasets: [{
                data: Object.values(providers),
                backgroundColor: Object.keys(providers).map(p => providerColors[p] || '#9E9E9E')
            }]
        };
    }

    private updateChartTheme(theme: AppThemes): void {
        const isDark = theme === AppThemes.Dark;
        const textColor = isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;

        this.authPieChartOptions = {
            ...this.authPieChartOptions,
            plugins: {
                ...this.authPieChartOptions!.plugins,
                legend: {
                    ...this.authPieChartOptions!.plugins!.legend,
                    labels: {
                        ...((this.authPieChartOptions!.plugins!.legend as any)?.labels || {}),
                        color: textColor
                    }
                }
            }
        };
    }

    onPageChange(event: PageEvent): void {
        this.currentPage = event.pageIndex;
        this.pageSize = event.pageSize;
        this.fetchUsers();
    }

    onSortChange(sort: Sort): void {
        this.sortField = sort.active || 'email';
        this.sortDirection = (sort.direction as 'asc' | 'desc') || 'asc';
        this.currentPage = 0;
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

    onFilterServiceChange(service: 'garmin' | 'suunto' | 'coros' | undefined): void {
        this.filterService = service;
        this.currentPage = 0;
        this.fetchUsers();
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
            if (!confirmed) return;

            this.isLoading = true;
            this.adminService.impersonateUser(user.uid).subscribe({
                next: async (res) => {
                    this.logger.log('Impersonation token received. Switching user...', res);
                    await this.authService.loginWithCustomToken(res.token);
                    window.location.href = '/dashboard';
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
        });
    }

    // Helper methods
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

    formatConnectionDate(timestamp: any): string {
        if (!timestamp) return 'Time unknown';
        const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    getServiceLogo(provider: string): string {
        switch (provider.toLowerCase()) {
            case 'garmin': return 'assets/logos/garmin.svg';
            case 'suunto': return 'assets/logos/suunto.svg';
            case 'coros': return 'assets/logos/coros.svg';
            default: return '';
        }
    }
}
