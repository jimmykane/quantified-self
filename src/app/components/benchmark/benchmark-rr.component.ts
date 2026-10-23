import { ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ActivityInterface, RRAnalysis, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import type { TooltipComponentOption } from 'echarts/components';
import type { AppEventInterface } from '@shared/app-event.interface';
import { isBenchmarkEvent } from '@shared/event-classification';
import { RR_STAT_LABELS } from '../../constants/rr-metrics';
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
import { buildBenchmarkRRChartOptions, type BenchmarkRRChartRecording } from '../../helpers/benchmark-rr-chart.helper';
import { BENCHMARK_RR_METRICS, buildBenchmarkRRAnalysisInput, buildBenchmarkRRRows, getBenchmarkRRIntervalSource, getBenchmarkRRLabels, hasBenchmarkRRStats, type BenchmarkRRIntervalSource } from '../../helpers/benchmark-rr.helper';

interface RRSource {
  key: string;
  column: string;
  label: string;
  color: string;
  lineStyle: BenchmarkRRChartRecording['lineStyle'];
  activity: ActivityInterface;
  hasStats: boolean;
  raw: BenchmarkRRIntervalSource | null;
}

@Component({
  selector: 'app-benchmark-rr',
  templateUrl: './benchmark-rr.component.html',
  styleUrls: ['./benchmark-rr.component.scss'],
  host: { '[class.benchmark-rr-collapsed]': 'visible() && !expanded()' },
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
  private static nextId = 0;
  readonly contentId = `benchmark-rr-${BenchmarkRRComponent.nextId++}`;
  readonly expanded = signal(false);
  readonly showSummary = signal(false);
  private readonly themeIsDark = signal(false);
  private cache = new WeakMap<ActivityInterface, RRAnalysis | null>();
  readonly selectedStats = signal<string[]>(BENCHMARK_RR_METRICS.filter(metric => metric.primary).map(metric => metric.type));
  readonly columns = computed(() => ['metric', ...this.selectedSources().map(source => source.column)]);
  readonly summaryRows = computed(() => buildBenchmarkRRRows(this.selectedSources().map(source => source.activity), this.selectedStats(), this.units()));
  readonly hasAnyRR = computed(() => this.sources().some(source => source.hasStats || source.raw));
  readonly selectedSourceKeys = signal<string[]>([]);
  readonly selectedSources = computed(() => this.sources().filter(source => this.selectedSourceKeys().includes(source.key)));
  readonly analyses = signal<ReadonlyMap<string, RRAnalysis>>(new Map());
  readonly sourceErrors = signal<{ key: string; label: string; message: string }[]>([]);
  readonly status = signal<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
  readonly errorMessage = signal('');
  readonly excludeFlagged = signal(false);
  readonly zoomed = signal(false);
  readonly markerSampling = signal(false);
  readonly artifactColor = computed(() => resolveDeviceChartColor(AppColors.Orange, this.themeIsDark()));
  readonly sourceLegends = computed(() => this.selectedSources().filter(source => this.analyses().has(source.key)).map(source => ({
    ...source,
    plotColor: resolveDeviceChartColor(source.color, this.themeIsDark()),
    metrics: buildBenchmarkRRRows([source.activity], BENCHMARK_RR_METRICS.filter(metric => metric.primary).map(metric => metric.type), this.units())
      .filter(row => row.cells[0].display !== null)
      .map(row => ({ ...row, label: RR_STAT_LABELS[row.type] ?? row.label, cell: row.cells[0] })),
  })));
  readonly chartRecordings = computed<BenchmarkRRChartRecording[]>(() => this.sourceLegends().flatMap(source => {
    const analysis = this.analyses().get(source.key);
    return analysis && source.raw ? [{ key: source.key, label: source.label, analysis, color: source.plotColor,
      lineStyle: source.lineStyle, startTimeMs: source.activity.startDate.getTime(), durationMs: source.raw.durationMs }] : [];
  }));
  readonly hasDFA = computed(() => this.chartRecordings().some(source => source.analysis.windows.some(window => window.dfaAlpha1 !== null)));
  private generation = 0;
  private eventScope: string | AppEventInterface | undefined;
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
    this.themeIsDark.set(this.darkTheme);
    if (changes['event'] || changes['activities']) {
      const eventScope = this.event?.getID?.() || this.event;
      const differentEvent = eventScope !== this.eventScope;
      this.eventScope = eventScope;
      const previousSources = this.sources();
      const previousKeys = this.selectedSourceKeys();
      const selectedAll = previousSources.length === previousKeys.length;
      this.generation++;
      this.worker.cancel(); this.disposeCharts();
      this.cache = new WeakMap(); this.analyses.set(new Map()); this.sourceErrors.set([]);
      this.status.set('idle'); this.errorMessage.set('');
      this.visible.set(isBenchmarkEvent(this.event) && this.activities.length > 0);
      if (differentEvent || !this.visible()) { this.expanded.set(false); this.showSummary.set(false); }
      const labels = getBenchmarkRRLabels(this.activities);
      const allActivities = this.event?.getActivities() ?? this.activities;
      const patterns: RRSource['lineStyle'][] = ['solid', 'dashed', 'dotted', 'dash-dot'];
      const sources = this.visible() ? this.activities.map((activity, index): RRSource => {
        const id = activity.getID();
        const eventIndex = allActivities.indexOf(activity);
        const position = eventIndex >= 0 ? eventIndex : index;
        const uniqueID = id && allActivities.filter(item => item.getID() === id).length === 1;
        return {
          key: uniqueID ? `activity:${id}` : `recording:${position}`,
          column: `recording-${index}`, label: labels[index],
          color: this.colors.getActivityColor(allActivities, activity), lineStyle: patterns[position % patterns.length], activity,
          hasStats: hasBenchmarkRRStats(activity), raw: getBenchmarkRRIntervalSource(activity),
        };
      }).filter(source => source.hasStats || source.raw) : [];
      this.sources.set(sources);
      const retained = sources.filter(source => differentEvent || !previousSources.length || selectedAll || previousKeys.includes(source.key));
      // A parent selection can remove every locally selected source. Recover to the
      // remaining event sources, while preserving a deliberate local clear.
      this.selectedSourceKeys.set((retained.length || !previousKeys.length ? retained : sources).map(source => source.key));
      if (this.expanded()) void this.loadAnalysis();
    } else {
      this.scheduleCharts();
    }
  }

  toggleExpanded(): void {
    this.expanded.update(value => !value); this.haptics.selection();
    if (this.expanded()) { void this.loadAnalysis(); return; }
    this.generation++; this.worker.cancel(); this.disposeCharts(); this.status.set('idle');
  }

  toggleSummary(): void {
    this.showSummary.update(value => !value); this.haptics.selection();
  }

  onStatsChange(types: string[]): void {
    const next = BENCHMARK_RR_METRICS.filter(metric => types.includes(metric.type)).map(metric => metric.type);
    if (next.join('|') === this.selectedStats().join('|')) return;
    this.selectedStats.set(next); this.haptics.selection();
  }

  onSourcesChange(keys: string[]): void {
    const next = this.sources().filter(source => keys.includes(source.key)).map(source => source.key);
    if (next.join('|') === this.selectedSourceKeys().join('|')) return;
    this.selectedSourceKeys.set(next); this.haptics.selection();
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
    if (!this.expanded()) return;
    const generation = ++this.generation;
    this.worker.cancel(); this.disposeCharts(); this.analyses.set(new Map()); this.sourceErrors.set([]); this.errorMessage.set('');
    const sources = this.selectedSources().filter(source => source.raw);
    if (!sources.length) { this.status.set('unavailable'); return; }
    this.status.set('loading');
    const analyses = new Map<string, RRAnalysis>();
    const errors: { key: string; label: string; message: string }[] = [];
    // The worker owns one request at a time. Sequential source analysis bounds memory
    // and keeps cancellation effective without combining beats across devices.
    for (const source of sources) {
      try {
        let analysis = this.cache.get(source.activity);
        if (!this.cache.has(source.activity)) {
          const input = buildBenchmarkRRAnalysisInput(source.activity);
          analysis = input ? await this.worker.analyze(input) : null;
          if (generation !== this.generation || this.destroyed) return;
          this.cache.set(source.activity, analysis);
        }
        if (analysis) analyses.set(source.key, analysis);
      } catch (error) {
        if (generation !== this.generation || this.destroyed) return;
        errors.push({ key: source.key, label: source.label, message: error instanceof Error ? error.message : 'R–R chart calculation failed. Please try again.' });
      }
    }
    if (generation !== this.generation || this.destroyed) return;
    this.analyses.set(analyses); this.sourceErrors.set(errors);
    this.status.set(analyses.size ? 'ready' : errors.length ? 'error' : 'unavailable');
    this.scheduleCharts();
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
    const recordings = this.chartRecordings();
    if (!recordings.length || !this.expanded() || this.status() !== 'ready' || !this.rrElement || !this.dfaElement || this.destroyed) return;
    const zoom = this.zoomRange();
    const charts = await Promise.all([this.rrHost.init(this.rrElement, resolveEChartsThemeName(this.darkTheme)), this.dfaHost.init(this.dfaElement, resolveEChartsThemeName(this.darkTheme))]);
    if (generation !== this.chartGeneration || this.destroyed) return;
    if (charts.some(chart => !chart)) throw new Error('R–R chart initialization failed');
    const options = buildBenchmarkRRChartOptions({ recordings,
      excludeFlagged: this.excludeFlagged(), darkTheme: this.darkTheme,
      artifactColor: this.artifactColor(), width: this.rrElement.clientWidth, unitSettings: this.units(), zoom });
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
