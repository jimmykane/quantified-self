import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
    AdminUserGrowthPalette,
    buildAdminUserGrowthChartOption,
} from '../../../helpers/admin-user-charts.helper';
import { ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS, EChartsHostController } from '../../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import type {
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
    selector: 'app-admin-user-growth-chart',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
    templateUrl: './admin-user-growth-chart.component.html',
    styleUrls: ['./admin-user-chart.shared.scss'],
})
export class AdminUserGrowthChartComponent implements AfterViewInit, OnDestroy {
    private readonly statsState = signal<UserCountStats | null>(null);
    private readonly growthState = signal<UserGrowthTrendResponse | null>(null);
    private readonly subscriptionsState = signal<SubscriptionHistoryTrendResponse | null>(null);
    private readonly destroy$ = new Subject<void>();
    private readonly chartHost: EChartsHostController;
    private isDark = false;

    @ViewChild('chart', { static: true }) chartRef!: ElementRef<HTMLDivElement>;

    @Input() set stats(value: UserCountStats | null) { this.statsState.set(value); void this.renderChart(); }
    @Input() set userGrowthTrend(value: UserGrowthTrendResponse | null) { this.growthState.set(value); void this.renderChart(); }
    @Input() set subscriptionHistoryTrend(value: SubscriptionHistoryTrendResponse | null) { this.subscriptionsState.set(value); void this.renderChart(); }
    @Input() loading = false;
    @Input() error: string | null = null;

    readonly hasData = computed(() => (
        (this.growthState()?.buckets?.length || 0) > 0
        || (this.subscriptionsState()?.buckets?.length || 0) > 0
    ));

    constructor(
        appThemeService: AppThemeService,
        eChartsLoader: EChartsLoaderService,
        logger: LoggerService,
    ) {
        this.chartHost = new EChartsHostController({
            eChartsLoader,
            logger,
            logPrefix: '[AdminUserGrowthChart]',
        });
        appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.isDark = theme === AppThemes.Dark;
            this.chartHost.dispose();
            void this.renderChart();
        });
    }

    ngAfterViewInit(): void {
        void this.renderChart();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.chartHost.dispose();
    }

    private async renderChart(): Promise<void> {
        const element = this.chartRef?.nativeElement;
        if (!element) {
            return;
        }
        const chart = await this.chartHost.init(element, resolveEChartsThemeName(this.isDark));
        if (!chart) {
            return;
        }

        const stats = this.statsState();
        const option = this.hasData()
            ? buildAdminUserGrowthChartOption(
                this.growthState(),
                this.subscriptionsState(),
                {
                    registeredUsers: stats?.total ?? 0,
                    onboardedUsers: stats?.onboardingCompleted ?? 0,
                    basicSubscriptions: stats?.basic ?? 0,
                    proSubscriptions: stats?.pro ?? 0,
                },
                this.isDark,
                element.clientWidth,
                this.resolvePalette(element),
            )
            : {
                backgroundColor: 'transparent',
                tooltip: { show: false },
                legend: { show: false },
                xAxis: { type: 'category', data: [] },
                yAxis: { type: 'value' },
                series: [],
                graphic: [],
            };
        this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
        this.chartHost.scheduleResize();
    }

    private resolvePalette(element: HTMLElement): AdminUserGrowthPalette {
        const color = (token: string, fallback: string): string => {
            if (typeof getComputedStyle !== 'function') {
                return fallback;
            }
            return getComputedStyle(element).getPropertyValue(token).trim() || fallback;
        };
        return {
            primary: color('--mat-sys-primary', '#1f8fff'),
            tertiary: color('--mat-sys-tertiary', '#00a16a'),
            secondary: color('--mat-sys-secondary', '#5f6abf'),
            warning: color('--mat-sys-warning', '#b45309'),
            neutral: color('--mat-sys-outline', '#7a8898'),
            onboarded: color('--mat-sys-on-tertiary-container', '#7a4d00'),
            combined: color('--mat-sys-primary-fixed-dim', '#4f46e5'),
        };
    }
}
