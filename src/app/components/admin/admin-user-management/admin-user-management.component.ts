import {
    AfterViewInit,
    Component,
    ElementRef,
    Injector,
    LOCALE_ID,
    OnDestroy,
    OnInit,
    ViewChild,
    effect,
    inject,
    signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import {
    AdminService,
    AdminUser,
    ListUsersParams,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse
} from '../../../services/admin.service';
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
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];

const EMPTY_CHART_UPDATE_SETTINGS: ChartSetOptionSettings = {
    notMerge: true,
    lazyUpdate: false
};

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
    @ViewChild('userGrowthTrendChart', { static: true }) userGrowthTrendChartRef!: ElementRef<HTMLDivElement>;

    // Injected services
    private adminService = inject(AdminService);
    private appThemeService = inject(AppThemeService);
    private impersonationService = inject(AppImpersonationService);
    private route = inject(ActivatedRoute);
    private dialog = inject(MatDialog);
    private logger = inject(LoggerService);
    private eChartsLoader = inject(EChartsLoaderService);
    private locale = inject(LOCALE_ID);
    private injector = inject(Injector);

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
    private userGrowthTrendChartHost = new EChartsHostController({
        eChartsLoader: this.eChartsLoader,
        logger: this.logger,
        logPrefix: '[AdminUserManagementComponent]'
    });
    private isDark = false;
    private providerData: Record<string, number> | null = null;
    private readonly userGrowthTrend = signal<UserGrowthTrendResponse | null>(null);
    private readonly subscriptionHistoryTrend = signal<SubscriptionHistoryTrendResponse | null>(null);
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

    constructor() {
        effect(() => {
            this.renderUserGrowthTrendChart();
        });
    }

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
            this.updateUserGrowthTrendChart(resolvedData.userGrowthTrend);
            this.updateSubscriptionHistoryTrendChart(resolvedData.subscriptionHistoryTrend);
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
            const fallbackTrendSignal = toSignal(
                this.adminService.getUserGrowthTrend(12).pipe(
                    catchError((err) => {
                        this.logger.error('AdminUserManagement user growth trend fallback error:', err);
                        return of(null);
                    })
                ),
                {
                    initialValue: null,
                    injector: this.injector
                }
            );
            effect(() => {
                this.userGrowthTrend.set(fallbackTrendSignal());
            }, { injector: this.injector });

            const fallbackSubscriptionTrendSignal = toSignal(
                this.adminService.getSubscriptionHistoryTrend(12).pipe(
                    catchError((err) => {
                        this.logger.error('AdminUserManagement subscription trend fallback error:', err);
                        return of(null);
                    })
                ),
                {
                    initialValue: null,
                    injector: this.injector
                }
            );
            effect(() => {
                this.subscriptionHistoryTrend.set(fallbackSubscriptionTrendSignal());
            }, { injector: this.injector });
        }
    }

    async ngAfterViewInit(): Promise<void> {
        await this.initializeCharts();
        await this.updateChartTheme();
        this.updateAuthChart(this.providerData ?? {});
        this.renderUserGrowthTrendChart();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.chartHost.dispose();
        this.userGrowthTrendChartHost.dispose();
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

    private updateUserGrowthTrendChart(trendData: UserGrowthTrendResponse | null): void {
        this.userGrowthTrend.set(trendData);
    }

    private updateSubscriptionHistoryTrendChart(trendData: SubscriptionHistoryTrendResponse | null): void {
        this.subscriptionHistoryTrend.set(trendData);
    }

    get hasUserGrowthTrendData(): boolean {
        return !!this.userGrowthTrend()?.buckets?.length || !!this.subscriptionHistoryTrend()?.buckets?.length;
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

        if (this.userGrowthTrendChartRef?.nativeElement) {
            initializations.push(this.userGrowthTrendChartHost.init(this.userGrowthTrendChartRef.nativeElement, themeName));
        }

        await Promise.all(initializations);
    }

    private renderAuthChart(): void {
        if (!this.chartHost.getChart()) {
            return;
        }

        if (!this.providerData || Object.keys(this.providerData).length === 0) {
            this.chartHost.setOption({
                backgroundColor: 'transparent',
                tooltip: { show: false },
                legend: { show: false },
                series: [],
                graphic: []
            }, EMPTY_CHART_UPDATE_SETTINGS);
            this.chartHost.scheduleResize();
            return;
        }

        const option = this.buildAuthChartOption(this.providerData);
        this.chartHost.setOption(option, ECHARTS_SERIES_MERGE_UPDATE_SETTINGS);
        this.chartHost.scheduleResize();
    }

    private renderUserGrowthTrendChart(): void {
        if (!this.userGrowthTrendChartHost.getChart()) {
            return;
        }

        const userGrowthTrend = this.userGrowthTrend();
        const subscriptionHistoryTrend = this.subscriptionHistoryTrend();
        const hasUserGrowthData = !!userGrowthTrend?.buckets?.length;
        const hasSubscriptionData = !!subscriptionHistoryTrend?.buckets?.length;

        if (!hasUserGrowthData && !hasSubscriptionData) {
            this.userGrowthTrendChartHost.setOption({
                backgroundColor: 'transparent',
                tooltip: { show: false },
                legend: { show: false },
                xAxis: { type: 'category', data: [] },
                yAxis: { type: 'value' },
                series: [],
                graphic: []
            }, EMPTY_CHART_UPDATE_SETTINGS);
            this.userGrowthTrendChartHost.scheduleResize();
            return;
        }

        const option = this.buildUserGrowthTrendChartOption(
            userGrowthTrend,
            subscriptionHistoryTrend,
            this.getCurrentRegisteredUsers(),
            this.getCurrentOnboardedUsers(),
            this.getCurrentBasicSubscriptions(),
            this.getCurrentProSubscriptions()
        );
        this.userGrowthTrendChartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
        this.userGrowthTrendChartHost.scheduleResize();
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
            backgroundColor: 'transparent',
            tooltip: {
                show: true,
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)'
            },
            legend: {
                show: true,
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

    private buildUserGrowthTrendChartOption(
        userGrowthTrend: UserGrowthTrendResponse | null,
        subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null,
        currentRegisteredUsers: number,
        currentOnboardedUsers: number,
        currentBasicSubscriptions: number,
        currentProSubscriptions: number
    ): ChartOption {
        const userBuckets = userGrowthTrend?.buckets || [];
        const subscriptionBuckets = subscriptionHistoryTrend?.buckets || [];
        const monthKeys = [...new Set([
            ...userBuckets.map(bucket => bucket.key),
            ...subscriptionBuckets.map(bucket => bucket.key)
        ])].sort();
        const userBucketsByKey = new Map(userBuckets.map(bucket => [bucket.key, bucket]));
        const subscriptionBucketsByKey = new Map(subscriptionBuckets.map(bucket => [bucket.key, bucket]));

        const labels = monthKeys.map((key) => {
            const userBucket = userBucketsByKey.get(key);
            const subscriptionBucket = subscriptionBucketsByKey.get(key);
            return userBucket?.label || subscriptionBucket?.label || key;
        });
        const registeredUsersPerMonth = monthKeys.map((key) => Number(userBucketsByKey.get(key)?.registeredUsers ?? 0));
        const onboardedUsersPerMonth = monthKeys.map((key) => Number(userBucketsByKey.get(key)?.onboardedUsers ?? 0));
        const basicSubscriptionNetPerMonth = monthKeys.map((key) => Number(subscriptionBucketsByKey.get(key)?.basicNet ?? 0));
        const proSubscriptionNetPerMonth = monthKeys.map((key) => Number(subscriptionBucketsByKey.get(key)?.proNet ?? 0));

        const endingRegisteredUsers = Math.max(0, Number(currentRegisteredUsers) || 0);
        const endingOnboardedUsers = Math.max(0, Number(currentOnboardedUsers) || 0);
        const endingBasicSubscriptions = Math.max(0, Number(currentBasicSubscriptions) || 0);
        const endingProSubscriptions = Math.max(0, Number(currentProSubscriptions) || 0);
        const endingAllSubscriptions = endingBasicSubscriptions + endingProSubscriptions;

        const cumulativeRegisteredUsers = this.buildCumulativeSeriesFromEndingTotal(
            registeredUsersPerMonth,
            endingRegisteredUsers
        );
        const cumulativeOnboardedUsers = this.buildCumulativeSeriesFromEndingTotal(
            onboardedUsersPerMonth,
            endingOnboardedUsers
        );
        const cumulativeBasicSubscriptions = this.buildCumulativeSeriesFromEndingTotal(
            basicSubscriptionNetPerMonth,
            endingBasicSubscriptions
        );
        const cumulativeProSubscriptions = this.buildCumulativeSeriesFromEndingTotal(
            proSubscriptionNetPerMonth,
            endingProSubscriptions
        );
        const cumulativeAllSubscriptions = cumulativeBasicSubscriptions.map(
            (value, index) => value + (cumulativeProSubscriptions[index] || 0)
        );

        const themeTokens = buildOfficialEChartsThemeTokens(this.isDark);
        const textColor = themeTokens.textSecondary;
        const axisColor = themeTokens.axisLineColor;
        const splitLineColor = themeTokens.splitLineColor;
        const containerWidth = this.userGrowthTrendChartRef?.nativeElement?.clientWidth ?? 0;
        const isMobileLayout = containerWidth > 0 && containerWidth < 680;

        const primaryColor = this.resolveMaterialChartColor('--mat-sys-primary', '#1f8fff');
        const tertiaryColor = this.resolveMaterialChartColor('--mat-sys-tertiary', '#00a16a');
        const secondaryColor = this.resolveMaterialChartColor('--mat-sys-secondary', '#5f6abf');
        const warningColor = this.resolveMaterialChartColor('--mat-sys-warning', '#b45309');
        const neutralColor = this.resolveMaterialChartColor('--mat-sys-outline', '#7a8898');
        const hasUserGrowthData = userBuckets.length > 0;
        const hasSubscriptionData = subscriptionBuckets.length > 0;
        const summaryParts: string[] = [];
        if (hasUserGrowthData) {
            summaryParts.push(`Users ${endingRegisteredUsers} | Onboarded ${endingOnboardedUsers}`);
        }
        if (hasSubscriptionData) {
            summaryParts.push(`Totals (Pro+Basic) ${endingAllSubscriptions} (Basic ${endingBasicSubscriptions} | Pro ${endingProSubscriptions})`);
        }
        const totalsSummary = `Current  ${summaryParts.join('  ||  ')}`;
        const legendTop = isMobileLayout ? 8 : 34;
        const gridTop = isMobileLayout ? 56 : 86;

        const series: any[] = [];
        if (hasUserGrowthData) {
            series.push(
                {
                    name: 'Registered Users / month',
                    type: 'bar',
                    data: registeredUsersPerMonth,
                    barMaxWidth: 22,
                    itemStyle: {
                        color: primaryColor,
                        borderRadius: [4, 4, 0, 0]
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'Onboarded Users / month',
                    type: 'bar',
                    data: onboardedUsersPerMonth,
                    barMaxWidth: 22,
                    itemStyle: {
                        color: tertiaryColor,
                        borderRadius: [4, 4, 0, 0]
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'Total Registered',
                    type: 'line',
                    data: cumulativeRegisteredUsers,
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
                },
                {
                    name: 'Total Onboarded',
                    type: 'line',
                    data: cumulativeOnboardedUsers,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: this.resolveMaterialChartColor('--mat-sys-on-tertiary-container', '#7a4d00'),
                        width: 2.2
                    },
                    itemStyle: {
                        color: this.resolveMaterialChartColor('--mat-sys-on-tertiary-container', '#7a4d00')
                    },
                    emphasis: {
                        focus: 'series'
                    }
                }
            );
        }

        if (hasSubscriptionData) {
            series.push(
                {
                    name: 'Basic Totals',
                    type: 'line',
                    data: cumulativeBasicSubscriptions,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: neutralColor,
                        width: 2.2
                    },
                    itemStyle: {
                        color: neutralColor
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'Pro Totals',
                    type: 'line',
                    data: cumulativeProSubscriptions,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: warningColor,
                        width: 2.2
                    },
                    itemStyle: {
                        color: warningColor
                    },
                    emphasis: {
                        focus: 'series'
                    }
                },
                {
                    name: 'Totals (Pro+Basic)',
                    type: 'line',
                    data: cumulativeAllSubscriptions,
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        color: this.resolveMaterialChartColor('--mat-sys-primary-fixed-dim', '#4f46e5'),
                        width: 2.2
                    },
                    itemStyle: {
                        color: this.resolveMaterialChartColor('--mat-sys-primary-fixed-dim', '#4f46e5')
                    },
                    emphasis: {
                        focus: 'series'
                    }
                }
            );
        }

        const option: ChartOption = {
            backgroundColor: 'transparent',
            tooltip: {
                show: true,
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                textStyle: {
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
                }
            },
            legend: {
                show: true,
                top: legendTop,
                textStyle: {
                    color: textColor,
                    fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                    fontSize: isMobileLayout ? 11 : 12
                }
            },
            grid: {
                left: 18,
                right: 18,
                top: gridTop,
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
            series,
            graphic: isMobileLayout
                ? undefined
                : [
                    {
                        type: 'text',
                        left: 'center',
                        top: 2,
                        z: 10,
                        style: {
                            text: totalsSummary,
                            fill: textColor,
                            opacity: 0.9,
                            fontSize: 11,
                            fontWeight: 500,
                            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                            textAlign: 'center'
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

    private getCurrentRegisteredUsers(): number {
        const totalUsers = Number(this.userStats?.total ?? 0);
        return Math.max(0, totalUsers);
    }

    private getCurrentOnboardedUsers(): number {
        const onboardedUsers = Number(this.userStats?.onboardingCompleted ?? 0);
        return Math.max(0, onboardedUsers);
    }

    private getCurrentBasicSubscriptions(): number {
        const basicSubscriptions = Number(this.userStats?.basic ?? 0);
        return Math.max(0, basicSubscriptions);
    }

    private getCurrentProSubscriptions(): number {
        const proSubscriptions = Number(this.userStats?.pro ?? 0);
        return Math.max(0, proSubscriptions);
    }

    private resolveMaterialChartColor(tokenName: string, fallback: string): string {
        const hostElement = this.userGrowthTrendChartRef?.nativeElement || this.authChartRef?.nativeElement;
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

        if (this.userGrowthTrendChartRef?.nativeElement) {
            initializations.push(this.userGrowthTrendChartHost.init(this.userGrowthTrendChartRef.nativeElement, themeName));
        }

        await Promise.all(initializations);
        this.renderAuthChart();
        this.renderUserGrowthTrendChart();
    }
}
