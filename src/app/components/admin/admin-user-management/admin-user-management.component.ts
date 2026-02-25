import { AfterViewInit, Component, ElementRef, LOCALE_ID, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
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
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { AdminService, AdminUser, ListUsersParams } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { AdminResolverData } from '../../../resolvers/admin.resolver';
import { AppThemes } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(localizedFormat);

export interface UserStats {
    total: number;
    pro: number;
    basic: number;
    free: number;
    onboardingCompleted: number;
    providers?: Record<string, number>;
}

type ChartOption = Parameters<EChartsType['setOption']>[0];

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
    ]
})
export class AdminUserManagementComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild(MatSort) sort!: MatSort;
    @ViewChild('authChart', { static: true }) authChartRef!: ElementRef<HTMLDivElement>;

    // Injected services
    private adminService = inject(AdminService);
    private appThemeService = inject(AppThemeService);
    private authService = inject(AppAuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private logger = inject(LoggerService);
    private eChartsLoader = inject(EChartsLoaderService);
    private locale = inject(LOCALE_ID);

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
    sortField = 'created';
    sortDirection: 'asc' | 'desc' = 'desc';

    displayedColumns: string[] = [
        'photoURL', 'email', 'uid', 'providerIds', 'displayName', 'role', 'subscription',
        'services', 'created', 'lastLogin', 'onboarding', 'status', 'actions'
    ];

    private searchSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    private chart: EChartsType | null = null;
    private isDark = false;
    private resizeObserver: ResizeObserver | null = null;
    private providerData: Record<string, number> | null = null;
    private readonly dayjsLocale = this.normalizeDayjsLocale(this.locale);

    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';

    async ngOnInit(): Promise<void> {
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
            this.isDark = theme === AppThemes.Dark;
            this.updateChartTheme();
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

    async ngAfterViewInit(): Promise<void> {
        await this.initializeChart();
        this.updateChartTheme();
        this.updateAuthChart(this.providerData ?? {});
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.eChartsLoader.dispose(this.chart);
        this.chart = null;
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
        this.providerData = providers;
        this.renderAuthChart();
    }

    onPageChange(event: PageEvent): void {
        this.currentPage = event.pageIndex;
        this.pageSize = event.pageSize;
        this.fetchUsers();
    }

    onSortChange(sort: Sort): void {
        this.sortField = sort.active || 'created';
        this.sortDirection = (sort.direction as 'asc' | 'desc') || 'desc';
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
        return this.formatLocalizedDate(timestamp, false);
    }

    formatConnectionDate(timestamp: any): string {
        return this.formatLocalizedDate(timestamp, false) || 'Time unknown';
    }

    formatCreatedDate(timestamp: any): string {
        return this.formatLocalizedDate(timestamp, false);
    }

    formatLastLoginDate(timestamp: any): string {
        return this.formatLocalizedDate(timestamp, true);
    }

    getServiceLogo(provider: string): string {
        switch (provider.toLowerCase()) {
            case 'garmin': return 'assets/logos/garmin.svg';
            case 'suunto': return 'assets/logos/suunto.svg';
            case 'coros': return 'assets/logos/coros.svg';
            default: return '';
        }
    }

    private formatLocalizedDate(timestamp: any, includeTime: boolean): string {
        if (!timestamp) return '';

        const value = timestamp.seconds ? timestamp.seconds * 1000 : timestamp;
        const parsed = dayjs(value);
        if (!parsed.isValid()) {
            return '';
        }

        return parsed.locale(this.dayjsLocale).format(includeTime ? 'L LT' : 'L');
    }

    private normalizeDayjsLocale(locale: string): string {
        if (!locale) return 'en';

        const lowerLocale = locale.toLowerCase();
        const localeMap: Record<string, string> = {
            'en-us': 'en',
            'en-gb': 'en-gb',
            'el-gr': 'el',
            'de-de': 'de',
            'fr-fr': 'fr',
            'es-es': 'es',
            'it-it': 'it',
            'nl-nl': 'nl',
            'pl-pl': 'pl',
        };

        if (localeMap[lowerLocale]) {
            return localeMap[lowerLocale];
        }

        return lowerLocale.split('-')[0];
    }

    private async initializeChart(): Promise<void> {
        if (!this.authChartRef?.nativeElement) {
            return;
        }
        try {
            this.chart = await this.eChartsLoader.init(this.authChartRef.nativeElement);
            this.setupResizeObserver();
        } catch (error) {
            this.logger.error('[AdminUserManagementComponent] Failed to initialize ECharts', error);
        }
    }

    private setupResizeObserver(): void {
        if (typeof ResizeObserver === 'undefined' || !this.authChartRef?.nativeElement) {
            return;
        }
        this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
        this.resizeObserver.observe(this.authChartRef.nativeElement);
    }

    private scheduleResize(): void {
        if (!this.chart) return;
        if (typeof requestAnimationFrame === 'undefined') {
            this.eChartsLoader.resize(this.chart);
            return;
        }
        requestAnimationFrame(() => this.eChartsLoader.resize(this.chart!));
    }

    private renderAuthChart(): void {
        if (!this.chart || !this.providerData || Object.keys(this.providerData).length === 0) {
            return;
        }

        const option = this.buildAuthChartOption(this.providerData);
        this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
        this.scheduleResize();
    }

    private buildAuthChartOption(providers: Record<string, number>): ChartOption {
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

        const entries = Object.entries(providers);
        const total = entries.reduce((sum, [, value]) => sum + value, 0);
        const sorted = [...entries].sort((a, b) => b[1] - a[1]);
        const topProvider = sorted[0]?.[0];

        const textColor = this.isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;
        const borderColor = this.isDark ? 'rgba(255,255,255,0.05)' : '#ffffff';
        const containerWidth = this.authChartRef?.nativeElement?.clientWidth ?? 0;
        const isMobileLayout = containerWidth > 0 && containerWidth < 680;

        const seriesData = entries.map(([key, value]) => ({
            name: providerLabels[key] || key,
            value,
            itemStyle: { color: providerColors[key] || '#9E9E9E' }
        }));

        const centerText = total > 0 ? `${total}` : '0';
        const centerSubtitle = topProvider ? `${providerLabels[topProvider] || topProvider}` : 'No data';

        const option: ChartOption = {
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)'
            },
            legend: {
                orient: isMobileLayout ? 'horizontal' : 'vertical',
                left: isMobileLayout ? 'center' : undefined,
                right: isMobileLayout ? undefined : 10,
                top: isMobileLayout ? 'bottom' : 'center',
                textStyle: {
                    color: textColor,
                    fontSize: isMobileLayout ? 11 : 12
                },
                itemGap: isMobileLayout ? 10 : 8
            },
            series: [
                {
                    name: 'Auth Provider Breakdown',
                    type: 'pie',
                    radius: isMobileLayout ? ['42%', '64%'] : ['55%', '72%'],
                    center: isMobileLayout ? ['50%', '40%'] : ['38%', '50%'],
                    avoidLabelOverlap: true,
                    label: { show: false },
                    labelLine: { show: false },
                    itemStyle: {
                        borderColor,
                        borderWidth: 2
                    },
                    data: seriesData
                }
            ],
            graphic: [
                {
                    type: 'group',
                    left: isMobileLayout ? '50%' : '38%',
                    top: isMobileLayout ? '40%' : 'center',
                    bounding: 'raw',
                    children: [
                        {
                            type: 'text',
                            style: {
                                text: centerText,
                                fontSize: isMobileLayout ? 20 : 24,
                                fontWeight: 700,
                                fill: textColor,
                                textAlign: 'center'
                            },
                            left: 'center',
                            top: isMobileLayout ? -10 : -12
                        },
                        {
                            type: 'text',
                            style: {
                                text: 'accounts',
                                fontSize: isMobileLayout ? 11 : 12,
                                fontWeight: 400,
                                fill: textColor,
                                opacity: 0.75,
                                textAlign: 'center'
                            },
                            left: 'center',
                            top: 10
                        },
                        {
                            type: 'text',
                            style: {
                                text: centerSubtitle,
                                fontSize: isMobileLayout ? 11 : 12,
                                fontWeight: 500,
                                fill: textColor,
                                opacity: 0.9,
                                textAlign: 'center'
                            },
                            left: 'center',
                            top: 28
                        }
                    ]
                }
            ]
        };

        return option;
    }

    private updateChartTheme(): void {
        if (!this.chart) {
            return;
        }
        this.renderAuthChart();
    }
}
