import { AfterViewInit, Component, ElementRef, LOCALE_ID, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
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
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { AdminService, AdminUser, ListUsersParams, SubscriptionHistoryTrendResponse, UserCountStats } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppImpersonationService } from '../../../services/app.impersonation.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { AdminResolverData } from '../../../resolvers/admin.resolver';
import { AppThemes } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import {
    ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
    ECHARTS_SERIES_MERGE_UPDATE_SETTINGS,
    EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(localizedFormat);

type SubscriptionHistoryState = 'active' | 'scheduled' | 'canceled' | 'never';

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
        MatCardModule,
        MatDialogModule,
        MatSnackBarModule,
    ]
})
export class AdminUserManagementComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild(MatSort) sort!: MatSort;
    @ViewChild('authChart', { static: true }) authChartRef!: ElementRef<HTMLDivElement>;
    @ViewChild('subscriptionTrendChart', { static: true }) subscriptionTrendChartRef!: ElementRef<HTMLDivElement>;

    // Injected services
    private adminService = inject(AdminService);
    private appThemeService = inject(AppThemeService);
    private impersonationService = inject(AppImpersonationService);
    private route = inject(ActivatedRoute);
    private dialog = inject(MatDialog);
    private logger = inject(LoggerService);
    private eChartsLoader = inject(EChartsLoaderService);
    private locale = inject(LOCALE_ID);

    // Data state
    users: AdminUser[] = [];
    userStats: UserCountStats | null = null;
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
        'photoURL', 'email', 'uid', 'providerIds', 'displayName', 'role', 'subscriptionHistory',
        'services', 'created', 'lastLogin', 'onboarding', 'status', 'actions'
    ];

    private searchSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    private chartHost = new EChartsHostController({
        eChartsLoader: this.eChartsLoader,
        logger: this.logger,
        logPrefix: '[AdminUserManagementComponent]'
    });
    private subscriptionTrendChartHost = new EChartsHostController({
        eChartsLoader: this.eChartsLoader,
        logger: this.logger,
        logPrefix: '[AdminUserManagementComponent]'
    });
    private isDark = false;
    private providerData: Record<string, number> | null = null;
    private subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null = null;
    private readonly dayjsLocale = this.normalizeDayjsLocale(this.locale);
    private readonly supportedSortFields = new Set([
        'email',
        'displayName',
        'role',
        'admin',
        'created',
        'lastLogin',
        'status',
        'providerIds'
    ]);

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
            void this.updateChartTheme();
        });

        // Use resolved data if available
        const resolvedData = this.route.snapshot.data['adminData'] as AdminResolverData;
        if (resolvedData) {
            this.users = resolvedData.usersData.users;
            this.totalCount = resolvedData.usersData.totalCount;
            this.userStats = resolvedData.userStats;
            this.updateSubscriptionTrendChart(resolvedData.subscriptionHistoryTrend);
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
            this.adminService.getSubscriptionHistoryTrend(12).pipe(takeUntil(this.destroy$)).subscribe({
                next: (trendData) => this.updateSubscriptionTrendChart(trendData),
                error: (err) => {
                    this.updateSubscriptionTrendChart(null);
                    this.logger.error('AdminUserManagement subscription trend fallback error:', err);
                }
            });
        }
    }

    async ngAfterViewInit(): Promise<void> {
        await this.initializeCharts();
        await this.updateChartTheme();
        this.updateAuthChart(this.providerData ?? {});
        this.updateSubscriptionTrendChart(this.subscriptionHistoryTrend);
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.chartHost.dispose();
        this.subscriptionTrendChartHost.dispose();
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

    private updateSubscriptionTrendChart(trendData: SubscriptionHistoryTrendResponse | null): void {
        this.subscriptionHistoryTrend = trendData;
        this.renderSubscriptionTrendChart();
    }

    get hasSubscriptionTrendData(): boolean {
        return !!this.subscriptionHistoryTrend?.buckets?.length;
    }

    onPageChange(event: PageEvent): void {
        this.currentPage = event.pageIndex;
        this.pageSize = event.pageSize;
        this.fetchUsers();
    }

    onSortChange(sort: Sort): void {
        const requestedField = sort.active || 'created';
        const requestedDirection = (sort.direction as 'asc' | 'desc') || 'desc';
        const isSupportedField = this.supportedSortFields.has(requestedField);
        this.sortField = isSupportedField ? requestedField : 'created';
        this.sortDirection = isSupportedField ? requestedDirection : 'desc';
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
                message: `Are you sure you want to impersonate ${user.email}? You will switch into that user's session and see a persistent return-to-admin control while impersonating.`,
                confirmText: 'Impersonate',
                cancelText: 'Cancel',
                isDangerous: true
            }
        });

        dialogRef.afterClosed().subscribe(confirmed => {
            if (!confirmed) return;

            this.isLoading = true;
            void this.impersonationService.startImpersonation({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName
            }).catch(() => undefined).finally(() => {
                this.isLoading = false;
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

    getSubscriptionHistoryState(user: AdminUser): SubscriptionHistoryState {
        const status = user.subscription?.status?.toLowerCase();
        const hasActiveSubscription = status === 'active' || status === 'trialing' || status === 'past_due';

        if (hasActiveSubscription && user.subscription?.cancel_at_period_end) {
            return 'scheduled';
        }

        if (hasActiveSubscription) {
            return 'active';
        }

        if (user.hasSubscribedOnce === true) {
            return 'canceled';
        }

        return 'never';
    }

    getSubscriptionHistoryLabel(user: AdminUser): string {
        const state = this.getSubscriptionHistoryState(user);
        if (state === 'scheduled') return 'Cancel Scheduled';
        if (state === 'active') return 'Active';
        if (state === 'canceled') return 'Canceled';
        return 'Never Subscribed';
    }

    getSubscriptionHistoryDetails(user: AdminUser): string | null {
        const state = this.getSubscriptionHistoryState(user);
        const status = user.subscription?.status?.toLowerCase();

        if (state === 'scheduled') {
            if (user.subscription?.current_period_end) {
                return `Ends ${this.formatDate(user.subscription.current_period_end)}`;
            }
            return 'Scheduled to end';
        }

        if (state === 'active') {
            if (status === 'trialing') {
                return 'Trialing';
            }

            if (status === 'past_due') {
                return 'Past Due';
            }

            return null;
        }

        return null;
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

    private async initializeCharts(): Promise<void> {
        const themeName = resolveEChartsThemeName(this.isDark);
        const initializations: Array<Promise<unknown>> = [];

        if (this.authChartRef?.nativeElement) {
            initializations.push(this.chartHost.init(this.authChartRef.nativeElement, themeName));
        }

        if (this.subscriptionTrendChartRef?.nativeElement) {
            initializations.push(this.subscriptionTrendChartHost.init(this.subscriptionTrendChartRef.nativeElement, themeName));
        }

        await Promise.all(initializations);
    }

    private renderAuthChart(): void {
        if (!this.chartHost.getChart() || !this.providerData || Object.keys(this.providerData).length === 0) {
            return;
        }

        const option = this.buildAuthChartOption(this.providerData);
        this.chartHost.setOption(option, ECHARTS_SERIES_MERGE_UPDATE_SETTINGS);
        this.chartHost.scheduleResize();
    }

    private renderSubscriptionTrendChart(): void {
        if (!this.subscriptionTrendChartHost.getChart()) {
            return;
        }

        if (!this.subscriptionHistoryTrend?.buckets?.length) {
            this.subscriptionTrendChartHost.setOption({
                xAxis: { type: 'category', data: [] },
                yAxis: { type: 'value' },
                series: []
            }, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
            this.subscriptionTrendChartHost.scheduleResize();
            return;
        }

        const option = this.buildSubscriptionTrendChartOption(
            this.subscriptionHistoryTrend,
            this.getCurrentBasicSubscriptions(),
            this.getCurrentProSubscriptions()
        );
        this.subscriptionTrendChartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
        this.subscriptionTrendChartHost.scheduleResize();
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

        const themeTokens = buildOfficialEChartsThemeTokens(this.isDark);
        const textColor = themeTokens.textSecondary;
        const borderColor = themeTokens.subtleBorderColor;
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
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
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
                                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
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
                                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
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
                                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
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

    private buildSubscriptionTrendChartOption(
        trendData: SubscriptionHistoryTrendResponse,
        currentBasicSubscriptions: number,
        currentProSubscriptions: number
    ): ChartOption {
        const buckets = trendData.buckets || [];
        const labels = buckets.map(bucket => bucket.label);
        const basicNetValues = buckets.map(bucket => Number(bucket.basicNet ?? 0));
        const proNetValues = buckets.map(bucket => Number(bucket.proNet ?? 0));
        const endingBasic = Math.max(0, Number(currentBasicSubscriptions) || 0);
        const endingPro = Math.max(0, Number(currentProSubscriptions) || 0);
        const endingAll = endingBasic + endingPro;

        const cumulativeBasicTotal = this.buildCumulativeSeriesFromEndingTotal(basicNetValues, endingBasic);
        const cumulativeProTotal = this.buildCumulativeSeriesFromEndingTotal(proNetValues, endingPro);
        const cumulativeAllTotal = cumulativeBasicTotal.map((value, index) => value + (cumulativeProTotal[index] || 0));

        const themeTokens = buildOfficialEChartsThemeTokens(this.isDark);
        const textColor = themeTokens.textSecondary;
        const axisColor = themeTokens.axisLineColor;
        const splitLineColor = themeTokens.splitLineColor;
        const containerWidth = this.subscriptionTrendChartRef?.nativeElement?.clientWidth ?? 0;
        const isMobileLayout = containerWidth > 0 && containerWidth < 680;

        const primaryColor = this.resolveMaterialChartColor('--mat-sys-primary', '#1976d2');
        const tertiaryColor = this.resolveMaterialChartColor('--mat-sys-tertiary', '#00796b');
        const secondaryColor = this.resolveMaterialChartColor('--mat-sys-secondary', '#5f6abf');
        const totalsSummary = `Current  Basic ${endingBasic}  |  Pro ${endingPro}  |  All ${endingAll}`;

        const option: ChartOption = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                textStyle: {
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
                }
            },
            legend: {
                top: 8,
                textStyle: {
                    color: textColor,
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                    fontSize: isMobileLayout ? 11 : 12
                }
            },
            grid: {
                left: 18,
                right: 18,
                top: 44,
                bottom: isMobileLayout ? 56 : 32,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: labels,
                axisLabel: {
                    color: textColor,
                    rotate: isMobileLayout ? 40 : 0,
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                    fontSize: isMobileLayout ? 10 : 11
                },
                axisLine: {
                    lineStyle: {
                        color: axisColor
                    }
                },
                axisTick: {
                    alignWithLabel: true
                }
            },
            yAxis: {
                type: 'value',
                minInterval: 1,
                axisLabel: {
                    color: textColor,
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
                },
                splitLine: {
                    lineStyle: {
                        color: splitLineColor
                    }
                }
            },
            series: [
                {
                    name: 'Basic Totals',
                    type: 'line',
                    data: cumulativeBasicTotal,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: primaryColor,
                        width: 2.2
                    },
                    itemStyle: {
                        color: primaryColor
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'Pro Totals',
                    type: 'line',
                    data: cumulativeProTotal,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: tertiaryColor,
                        width: 2.2
                    },
                    itemStyle: {
                        color: tertiaryColor
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'All Totals',
                    type: 'line',
                    data: cumulativeAllTotal,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: secondaryColor,
                        width: 2.2
                    },
                    itemStyle: {
                        color: secondaryColor
                    },
                    emphasis: {
                        focus: 'series'
                    }
                }
            ],
            graphic: isMobileLayout
                ? undefined
                : [
                    {
                        type: 'text',
                        right: 12,
                        top: 10,
                        z: 10,
                        style: {
                            text: totalsSummary,
                            fill: textColor,
                            opacity: 0.9,
                            fontSize: 11,
                            fontWeight: 500,
                            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
                        }
                    }
                ]
        };

        return option;
    }

    private buildCumulativeSeriesFromEndingTotal(netValues: number[], endingTotal: number): number[] {
        const safeEndingTotal = Math.max(0, Number(endingTotal) || 0);
        const windowNetTotal = netValues.reduce((sum, value) => sum + (Number(value) || 0), 0);
        let runningTotal = safeEndingTotal - windowNetTotal;

        return netValues.map((value) => {
            runningTotal += Number(value) || 0;
            return Math.max(0, Math.round(runningTotal));
        });
    }

    private getCurrentBasicSubscriptions(): number {
        const basic = Number(this.userStats?.basic ?? 0);
        return Math.max(0, basic);
    }

    private getCurrentProSubscriptions(): number {
        const pro = Number(this.userStats?.pro ?? 0);
        return Math.max(0, pro);
    }

    private resolveMaterialChartColor(tokenName: string, fallback: string): string {
        const hostElement = this.subscriptionTrendChartRef?.nativeElement || this.authChartRef?.nativeElement;
        if (!hostElement || typeof getComputedStyle !== 'function') {
            return fallback;
        }

        const tokenValue = getComputedStyle(hostElement).getPropertyValue(tokenName).trim();
        return tokenValue || fallback;
    }

    private async updateChartTheme(): Promise<void> {
        const themeName = resolveEChartsThemeName(this.isDark);
        const initializations: Array<Promise<unknown>> = [];

        if (this.authChartRef?.nativeElement) {
            initializations.push(this.chartHost.init(this.authChartRef.nativeElement, themeName));
        }

        if (this.subscriptionTrendChartRef?.nativeElement) {
            initializations.push(this.subscriptionTrendChartHost.init(this.subscriptionTrendChartRef.nativeElement, themeName));
        }

        await Promise.all(initializations);
        this.renderAuthChart();
        this.renderSubscriptionTrendChart();
    }
}
