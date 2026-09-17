import { buildDashboardHealthExample } from '../../../helpers/dashboard-health-preview.helper';
import { DashboardChartThumbnailComponent } from '../../summaries/dashboard-chart-library/dashboard-chart-thumbnail.component';
import { buildDashboardManagerPresetTile } from '../../../helpers/dashboard-manager-presets.helper';
import type { DashboardChartPreview } from '../../../helpers/dashboard-chart-preview.helper';
import { ChartSourcePickerComponent } from '../../shared/chart-source-picker/chart-source-picker.component';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { HealthProvider } from '@shared/health';
import { HEALTH_METRIC_CATALOG } from '@shared/health';
import type { AppDashboardHealthMetricSettings, AppHealthWorkspaceRange, AppUserInterface } from '../../../models/app-user.interface';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { buildDashboardHealthContext, DashboardHealthContext, DashboardHealthEvidence } from '../../../helpers/dashboard-health-context.helper';
import { HEALTH_WORKSPACE_SAMPLE_RANGE, localCalendarDate, navigateHealthWorkspaceWindow, resolveHealthWorkspaceWindow } from '../../../helpers/health-workspace.helper';
import { DashboardHealthService } from '../../../services/dashboard-health.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { ChartsSleepTrendComponent } from '../sleep-trend/charts.sleep-trend.component';
import { chartViewportObserverOptions, shouldPreloadChartInBackground } from '../../../helpers/chart-viewport-queue';
/** Same projection, source identity and chart renderer as Health; navigation belongs to this tile. */
@Component({ selector: 'app-dashboard-health-chart', standalone: true,
    imports: [DashboardChartThumbnailComponent, ChartSourcePickerComponent, MatButtonModule, MatIconModule, MatSelectModule, MatProgressBarModule, HealthMetricSeriesChartComponent, ChartsSleepTrendComponent],
    templateUrl: './dashboard-health-chart.component.html', styleUrls: ['./dashboard-health-chart.component.css'], changeDetection: ChangeDetectionStrategy.OnPush })
export class DashboardHealthChartComponent {
    readonly user = input.required<AppUserInterface>();
    readonly settings = input.required<AppDashboardHealthMetricSettings>();
    readonly darkTheme = input(false);
    readonly thumbnail = input(false);
    /** Reuse the browser's completed evidence while a visible row subscribes. */
    readonly thumbnailContext = input<{ uid: string; context: DashboardHealthContext } | null>(null);
    /** Library-only illustrations; saved tiles always render account evidence. */
    readonly preview = input(false);
    readonly hideTitle = input(false);
    readonly reserveActions = input(false);
    readonly disabled = input(false);
    readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
    readonly providerFilter = input<readonly HealthProvider[]>([]);
    readonly priority = input(20);
    readonly settingsChange = output<{
        settings: AppDashboardHealthMetricSettings;
        initial: boolean;
    }>();
    readonly contextChange = output<DashboardHealthContext>();
    readonly context = signal<DashboardHealthContext | null>(null);
    readonly loading = signal(false);
    readonly error = signal(false);
    private readonly visible = signal(false);
    private readonly endDate = signal(localCalendarDate());
    private readonly initialSource = signal<string | null>(null);
    private readonly retry = signal(0);
    private readonly data = inject(DashboardHealthService);
    private readonly haptics = inject(AppHapticsService);
    private readonly element = inject(ElementRef<HTMLElement>);
    private readonly destroy = inject(DestroyRef);
    private version = 0;
    private identity = '';
    private evidence: DashboardHealthEvidence | null = null;
    private projectionKey: string | null = null;
    private sampleRangeCorrectionPending = false;
    readonly sleepThumbnail = computed(() => ({
        tile: { ...buildDashboardManagerPresetTile({ presetId: 'curated-sleep', order: 0, size: { columns: 1, rows: 1 } }), sleepTrend: this.displayContext()?.sleep },
        source: 'user', loading: false, note: '', calendarEvents: [], anchorMs: Date.now(),
    }) as DashboardChartPreview);
    readonly title = computed(() => this.settings().metric === 'sleep' ? 'Sleep' : HEALTH_METRIC_CATALOG[this.settings().metric]?.label || 'Health');
    readonly showSleepSourcePicker = computed(() => this.settings().metric === 'sleep'
        && ((this.context()?.sources.length || 0) > 1 || !!this.context()?.missingSource));
    readonly effectiveSettings = computed(() => ({ ...this.settings(), ...(this.settings().sourceKey || !this.initialSource() ? {} : { sourceKey: this.initialSource()! }) }));
    readonly window = computed(() => resolveHealthWorkspaceWindow({ ...this.settings(), endDate: this.endDate() }));
    private readonly previewEvidence = computed(() => {
        const shared = this.thumbnailContext(), settings = this.settings();
        return this.thumbnail() && this.preview() && shared?.uid === this.user().uid && this.data.isOwner(this.user().uid)
            && shared.context.window.metric === settings.metric && shared.context.window.range === settings.range
            && shared.context.window.endDate === this.window().endDate
            && (!settings.sourceKey || shared.context.selectedKey === settings.sourceKey)
            ? shared.context : this.context();
    });
    readonly showingExample = computed(() => this.preview() && !this.previewEvidence()?.hasData);
    readonly displayContext = computed(() => this.showingExample()
        ? buildDashboardHealthExample(this.settings(), this.window(), this.user().settings.unitSettings)
        : this.previewEvidence());
    readonly previewNotice = computed(() => this.showingExample()
        ? this.loading() ? 'Showing an example while your readings load.'
            : this.error() ? 'Your readings could not be loaded. This is an example.'
                : this.context()?.availability.state === 'no-data' && !this.context()?.missingSource && !this.context()?.sampleOnly
                    ? 'No readings in this period yet. This example shows how the chart will look.'
                    : 'Illustration only. ' + (this.context()?.availability.reason || 'These are not your readings.')
        : this.loading() ? 'Updating your readings…' : 'Recorded readings from the selected source.');
    readonly ranges: readonly {
        value: AppHealthWorkspaceRange;
        label: string;
    }[] = [{ value: 'today', label: '1d' }, { value: '14d', label: '14d' }, { value: '30d', label: '30d' }, { value: '90d', label: '90d' }, { value: '1y', label: '1y' }];
    isRangeDisabled(range: AppHealthWorkspaceRange): boolean {
        return range === '1y' && this.context()?.sampleRangeLimited === true;
    }
    // Source and formatting changes select from the same bounded evidence.
    private readonly viewKey = computed(() => JSON.stringify([this.user().settings.unitSettings,
        this.user().settings.appSettings?.healthWorkspace?.highlightSources?.heart_rate_variability,
        this.effectiveSettings().sourceKey, this.providerFilter()]));
    private readonly requestKey = computed(() => JSON.stringify([this.user().uid, this.data.isOwner(this.user().uid),
        this.settings().metric, this.settings().range, this.endDate(), this.visible(), this.priority(), this.retry()]));
    constructor() {
        // Embedded views are detached during construction. Resolve their dashboard
        // scope and scroll root only after Angular has attached the completed view.
        afterNextRender(() => this.startLoading());
        effect(onCleanup => {
            this.requestKey();
            untracked(() => {
                const user = this.user(), settings = this.settings(), endDate = this.endDate();
                if (settings.range !== '1y') this.sampleRangeCorrectionPending = false;
                const identity = `${user.uid}:${settings.metric}`;
                const visible = this.visible(), priority = this.priority();
                if (identity !== this.identity) {
                    this.identity = identity;
                    this.context.set(null);
                    this.initialSource.set(null);
                    this.evidence = null;
                    this.sampleRangeCorrectionPending = false;
                }
                const version = ++this.version;
                if (!visible || !this.data.isOwner(user.uid)) {
                    this.context.set(null);
                    this.evidence = null;
                    this.sampleRangeCorrectionPending = false;
                    this.loading.set(false);
                    return;
                }
                this.loading.set(true);
                this.error.set(false);
                const subscription = this.data.watch(user.uid, settings, endDate, priority, () => {
                    if (version === this.version) {
                        this.loading.set(true);
                        this.error.set(false);
                    }
                }).subscribe({
                    next: evidence => {
                        if (version !== this.version)
                            return;
                        this.evidence = evidence;
                        this.updateContext(true);
                        this.loading.set(false);
                    }, error: () => { if (version === this.version) {
                        this.error.set(true);
                        this.loading.set(false);
                    } },
                });
                onCleanup(() => subscription.unsubscribe());
            });
        });
        effect(() => {
            this.viewKey();
            untracked(() => this.updateContext());
        });
        this.destroy.onDestroy(() => this.version++);
    }
    private startLoading(): void {
        if (typeof IntersectionObserver === 'undefined' || shouldPreloadChartInBackground(this.element.nativeElement)) {
            this.visible.set(true);
            return;
        }
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) {
            this.visible.set(true);
            observer.disconnect();
        } }, chartViewportObserverOptions(this.element.nativeElement));
        observer.observe(this.element.nativeElement);
        this.destroy.onDestroy(() => observer.disconnect());
    }
    private updateContext(newEvidence = false): void {
        if (!this.evidence || !this.data.isOwner(this.user().uid)
            || !newEvidence && this.projectionKey === this.viewKey()) return;
        const user = this.user(), settings = this.settings();
        const preferred = user.settings.appSettings?.healthWorkspace?.highlightSources?.heart_rate_variability;
        const context = buildDashboardHealthContext(this.evidence, this.effectiveSettings(), user.settings.unitSettings, preferred, this.providerFilter());
        if (!settings.sourceKey && !this.initialSource() && context.selectedKey) {
            this.initialSource.set(context.selectedKey);
            this.settingsChange.emit({ settings: { ...settings, sourceKey: context.selectedKey }, initial: true });
        }
        // Persisting the automatically chosen source must not rebuild or redraw it.
        this.projectionKey = this.viewKey();
        this.context.set(context);
        this.contextChange.emit(context);
        if (settings.range === '1y' && context.sampleRangeLimited) {
            if (!this.sampleRangeCorrectionPending) {
                this.sampleRangeCorrectionPending = true;
                this.endDate.set(localCalendarDate());
                this.settingsChange.emit({ settings: { ...this.effectiveSettings(), range: HEALTH_WORKSPACE_SAMPLE_RANGE }, initial: false });
            }
        } else {
            this.sampleRangeCorrectionPending = false;
        }
    }
    selectSource(sourceKey: string): void {
        if (this.disabled() || sourceKey === this.effectiveSettings().sourceKey || !this.context()?.sources.some(source => source.key === sourceKey))
            return;
        this.haptics.selection();
        this.settingsChange.emit({ settings: { ...this.settings(), sourceKey }, initial: false });
    }
    selectRange(range: AppHealthWorkspaceRange): void {
        if (this.disabled() || this.isRangeDisabled(range) || range === this.settings().range)
            return;
        this.haptics.selection();
        this.endDate.set(localCalendarDate());
        this.settingsChange.emit({ settings: { ...this.effectiveSettings(), range }, initial: false });
    }
    navigate(direction: 'older' | 'newer'): void {
        if (this.disabled() || direction === 'newer' && !this.window().canNavigateNewer)
            return;
        this.haptics.selection();
        this.endDate.set(navigateHealthWorkspaceWindow(this.window(), direction).endDate);
    }
    reload(): void {
        if (this.loading() || this.disabled()) return;
        this.haptics.selection();
        this.data.invalidate(this.user().uid);
        // An errored observable is closed, so invalidation alone cannot restart it.
        if (this.error()) this.retry.update(value => value + 1);
    }
}
