import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
    buildAdminAuthProviderChartOption,
    hasAdminAuthProviderData,
} from '../../../helpers/admin-user-charts.helper';
import { ECHARTS_SERIES_MERGE_UPDATE_SETTINGS, EChartsHostController } from '../../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
    selector: 'app-admin-auth-provider-chart',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
    templateUrl: './admin-auth-provider-chart.component.html',
    styleUrls: ['./admin-user-chart.shared.scss'],
})
export class AdminAuthProviderChartComponent implements AfterViewInit, OnDestroy {
    private readonly providersState = signal<Record<string, number>>({});
    private readonly destroy$ = new Subject<void>();
    private readonly chartHost: EChartsHostController;
    private isDark = false;

    @ViewChild('chart', { static: true }) chartRef!: ElementRef<HTMLDivElement>;

    @Input()
    set providers(value: Record<string, number> | null | undefined) {
        this.providersState.set(value || {});
        void this.renderChart();
    }

    @Input() loading = false;
    @Input() error: string | null = null;

    readonly hasData = computed(() => hasAdminAuthProviderData(this.providersState()));

    constructor(
        appThemeService: AppThemeService,
        eChartsLoader: EChartsLoaderService,
        logger: LoggerService,
    ) {
        this.chartHost = new EChartsHostController({
            eChartsLoader,
            logger,
            logPrefix: '[AdminAuthProviderChart]',
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

        const providers = this.providersState();
        const hasData = this.hasData();
        const option = hasData
            ? buildAdminAuthProviderChartOption(providers, this.isDark, element.clientWidth)
            : { backgroundColor: 'transparent', tooltip: { show: false }, legend: { show: false }, series: [], graphic: [] };
        this.chartHost.setOption(option, hasData ? ECHARTS_SERIES_MERGE_UPDATE_SETTINGS : { notMerge: true });
        this.chartHost.scheduleResize();
    }
}
