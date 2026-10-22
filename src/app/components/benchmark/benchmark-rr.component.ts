import { ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ActivityInterface, RRAnalysis, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import type { TooltipComponentOption } from 'echarts/components';
import type { AppEventInterface } from '@shared/app-event.interface';
import { isBenchmarkEvent } from '@shared/event-classification';
import { MaterialModule } from '../../modules/material.module';
import { SharedModule } from '../../modules/shared.module';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppColors } from '../../services/color/app.colors';
import { AppHapticsService } from '../../services/app.haptics.service';
import { BenchmarkRRAnalysisService } from '../../services/benchmark-rr-analysis.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { EChartsHostController } from '../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { resolveDeviceChartColor } from '../../helpers/device-chart-appearance.helper';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS, resolveEChartsTooltipSurfaceConfig, resolveEChartsTooltipTriggerOn } from '../../helpers/echarts-tooltip-interaction.helper';
import { buildBenchmarkRRChartOptions } from '../../helpers/benchmark-rr-chart.helper';
import { BENCHMARK_RR_METRICS, buildBenchmarkRRAnalysisInput, buildBenchmarkRRRows, getBenchmarkRRIntervalSource, getBenchmarkRRLabels, hasBenchmarkRRStats, type BenchmarkRRIntervalSource } from '../../helpers/benchmark-rr.helper';

interface RRSource {
  key: string;
  column: string;
  label: string;
  color: string;
  activity: ActivityInterface;
  hasStats: boolean;
  raw: BenchmarkRRIntervalSource | null;
}

@Component({
  selector: 'app-benchmark-rr',
  templateUrl: './benchmark-rr.component.html',
  styleUrls: ['./benchmark-rr.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MaterialModule, SharedModule, AppChartSharedModule],
  providers: [BenchmarkRRAnalysisService],
})
export class BenchmarkRRComponent implements OnChanges, OnDestroy {
  @Input() event!: AppEventInterface;
  @Input() activities: ActivityInterface[] = [];
  @Input() unitSettings?: UserUnitSettingsInterface;
  @Input() darkTheme = false;

  private readonly colors = inject(AppEventColorService);
  private readonly haptics = inject(AppHapticsService);
  private readonly worker = inject(BenchmarkRRAnalysisService);
  private readonly loader = inject(EChartsLoaderService);
  private readonly logger = inject(LoggerService);
  private readonly units = signal<UserUnitSettingsInterface | undefined>(undefined);
  readonly visible = signal(false);
  readonly sources = signal<RRSource[]>([]);
  readonly metrics = BENCHMARK_RR_METRICS;
  readonly artifactColor = AppColors.Orange;
  readonly selectedStats = signal<string[]>(BENCHMARK_RR_METRICS.filter(metric => metric.primary).map(metric => metric.type));
  readonly columns = computed(() => ['metric', ...this.sources().map(source => source.column)]);
  readonly summaryRows = computed(() => buildBenchmarkRRRows(this.sources().map(source => source.activity), this.selectedStats(), this.units()));
  readonly hasAnyRR = computed(() => this.sources().some(source => source.hasStats || source.raw));
  readonly tab = signal(0);
  readonly selectedSourceKey = signal('');
  readonly selectedSource = computed(() => this.sources().find(source => source.key === this.selectedSourceKey()) ?? null);
  readonly analysis = signal<RRAnalysis | null>(null);
  readonly status = signal<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
  readonly errorMessage = signal('');
  readonly excludeFlagged = signal(false);
  readonly zoomed = signal(false);
  readonly markerSampling = signal(false);
  readonly hasDFA = computed(() => this.analysis()?.windows.some(window => window.dfaAlpha1 !== null) ?? false);
  private generation = 0;
  private analysisDurationMs = 0;
  private chartGeneration = 0;
  private destroyed = false;
  private rrElement?: HTMLElement;
  private dfaElement?: HTMLElement;
  private boundChart: EChartsType | null = null;
  private connectedCharts: EChartsType[] = [];
  private disconnectCharts?: () => void;
  private readonly rrHost = this.createHost();
  private readonly dfaHost = this.createHost();

  @ViewChild('rrChart') set rrChart(ref: ElementRef<HTMLElement> | undefined) { this.rrElement = ref?.nativeElement; this.scheduleCharts(); }
  @ViewChild('dfaChart') set dfaChart(ref: ElementRef<HTMLElement> | undefined) { this.dfaElement = ref?.nativeElement; this.scheduleCharts(); }

  ngOnChanges(changes: Record<string, unknown>): void {
    this.units.set(this.unitSettings);
    if (changes['event'] || changes['activities']) {
      this.generation++;
      this.worker.cancel();
      this.disposeCharts();
      this.analysis.set(null);
      this.status.set('idle');
      this.visible.set(isBenchmarkEvent(this.event) && this.activities.length > 0);
      const labels = getBenchmarkRRLabels(this.activities);
      const allActivities = this.event?.getActivities() ?? this.activities;
      const sources = this.visible() ? this.activities.map((activity, index): RRSource => {
        const id = activity.getID();
        const eventIndex = allActivities.indexOf(activity);
        return {
          key: id ? `activity:${id}` : `recording:${eventIndex >= 0 ? eventIndex : index}`,
          column: `recording-${index}`,
          label: labels[index], color: this.colors.getActivityColor(allActivities, activity), activity,
          hasStats: hasBenchmarkRRStats(activity), raw: getBenchmarkRRIntervalSource(activity),
        };
      }) : [];
      this.sources.set(sources);
      const source = sources.find(item => item.key === this.selectedSourceKey()) ?? sources.find(item => item.raw) ?? sources[0];
      this.selectedSourceKey.set(source?.key ?? '');
      if (this.tab() === 1) void this.loadAnalysis();
    } else {
      this.scheduleCharts();
    }
  }

  onTabChange(index: number): void {
    if (index === this.tab()) return;
    this.tab.set(index); this.haptics.selection();
    if (index === 1 && this.status() === 'idle') void this.loadAnalysis();
    else if (index === 1) this.scheduleCharts();
  }

  onStatsChange(types: string[]): void {
    const next = BENCHMARK_RR_METRICS.filter(metric => types.includes(metric.type)).map(metric => metric.type);
    if (next.join('|') === this.selectedStats().join('|')) return;
    this.selectedStats.set(next); this.haptics.selection();
  }

  onSourceChange(key: string): void {
    if (key === this.selectedSourceKey() || !this.sources().some(source => source.key === key)) return;
    this.selectedSourceKey.set(key); this.haptics.selection();
    void this.loadAnalysis();
  }

  onExcludeFlagged(value: boolean): void {
    if (value === this.excludeFlagged()) return;
    this.excludeFlagged.set(value); this.haptics.selection(); this.scheduleCharts();
  }

  resetZoom(): void {
    if (!this.zoomed()) return;
    this.rrHost.getChart()?.dispatchAction({ type: 'dataZoom', start: 0, end: 100, $from: 'benchmark-rr-reset-sync' });
    this.zoomed.set(false); this.haptics.selection();
  }

  plotColor(color: string): string { return resolveDeviceChartColor(color, this.darkTheme); }

  async loadAnalysis(): Promise<void> {
    const generation = ++this.generation;
    this.worker.cancel(); this.disposeCharts(); this.analysis.set(null); this.errorMessage.set('');
    const source = this.selectedSource();
    if (!source?.raw) { this.status.set('unavailable'); return; }
    this.status.set('loading');
    try {
      const input = buildBenchmarkRRAnalysisInput(source.activity);
      if (!input) { this.status.set('unavailable'); return; }
      const analysis = await this.worker.analyze(input);
      if (generation !== this.generation || this.destroyed) return;
      this.analysisDurationMs = input.durationMs;
      this.analysis.set(analysis); this.status.set(analysis ? 'ready' : 'unavailable');
      this.scheduleCharts();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.errorMessage.set(error instanceof Error ? error.message : 'R–R chart calculation failed. Please try again.');
      this.status.set('error');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.generation++; this.worker.cancel(); this.disposeCharts();
  }

  private createHost(): EChartsHostController {
    return new EChartsHostController({ eChartsLoader: this.loader, logger: this.logger,
      logPrefix: '[BenchmarkRR]', enableMobileTapFeedback: true,
      mobileTapFeedbackOptions: DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
      onContainerResize: () => this.scheduleCharts() });
  }

  private scheduleCharts(): void {
    const generation = ++this.chartGeneration;
    void this.renderCharts(generation).catch(error => {
      if (this.destroyed || generation !== this.chartGeneration) return;
      this.disposeCharts();
      this.logger.error('[BenchmarkRR] Chart rendering failed', error instanceof Error ? error : new Error('Chart rendering failed'));
      this.errorMessage.set('R–R charts could not be displayed. Please try again.'); this.status.set('error');
    });
  }

  private zoomRange(): { start: number; end: number } {
    const zoom = (this.rrHost.getChart()?.getOption()?.['dataZoom'] as { start?: number; end?: number }[] | undefined)?.[0];
    return { start: zoom?.start ?? 0, end: zoom?.end ?? 100 };
  }

  private async renderCharts(generation: number): Promise<void> {
    const analysis = this.analysis(); const source = this.selectedSource();
    if (!analysis || !source?.raw || this.tab() !== 1 || !this.rrElement || !this.dfaElement || this.destroyed) return;
    const zoom = this.zoomRange();
    const charts = await Promise.all([this.rrHost.init(this.rrElement, resolveEChartsThemeName(this.darkTheme)), this.dfaHost.init(this.dfaElement, resolveEChartsThemeName(this.darkTheme))]);
    if (generation !== this.chartGeneration || this.destroyed) return;
    if (charts.some(chart => !chart)) throw new Error('R–R chart initialization failed');
    const options = buildBenchmarkRRChartOptions({ analysis, durationMs: this.analysisDurationMs,
      excludeFlagged: this.excludeFlagged(), darkTheme: this.darkTheme, color: this.plotColor(source.color),
      artifactColor: this.plotColor(AppColors.Orange), width: this.rrElement.clientWidth, unitSettings: this.units(), zoom });
    const tooltip = { ...resolveEChartsTooltipSurfaceConfig(), triggerOn: resolveEChartsTooltipTriggerOn() };
    options.rr.tooltip = { ...options.rr.tooltip as TooltipComponentOption, ...tooltip };
    options.dfa.tooltip = { ...options.dfa.tooltip as TooltipComponentOption, ...tooltip };
    this.rrHost.setOption(options.rr, { notMerge: false, replaceMerge: ['series'], lazyUpdate: false });
    this.dfaHost.setOption(options.dfa, { notMerge: false, replaceMerge: ['series'], lazyUpdate: false });
    this.markerSampling.set(options.markerSampling);
    if (this.boundChart !== charts[0]) {
      this.boundChart = charts[0];
      charts[0]!.on('datazoom', () => { const range = this.zoomRange(); this.zoomed.set(range.start > 0 || range.end < 100); });
    }
    if (this.connectedCharts.some((chart, index) => chart !== charts[index]) || !this.connectedCharts.length) {
      const core = await this.loader.load();
      if (generation !== this.chartGeneration || this.destroyed) return;
      this.disconnectCharts?.();
      const group = core.connect(charts as EChartsType[]);
      this.disconnectCharts = () => core.disconnect(group);
      this.connectedCharts = charts as EChartsType[];
    }
  }

  private disposeCharts(): void {
    this.chartGeneration++; this.disconnectCharts?.(); this.disconnectCharts = undefined;
    this.connectedCharts = []; this.boundChart = null;
    this.rrHost.dispose(); this.dfaHost.dispose(); this.zoomed.set(false);
  }
}
