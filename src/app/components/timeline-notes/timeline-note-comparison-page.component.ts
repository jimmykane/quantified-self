import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { AppThemes } from '@sports-alliance/sports-lib';
import { timelineToday, type TimelineNote } from '@shared/timeline-notes';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { buildHealthChartModels } from '../../helpers/health-metric-chart.helper';
import { healthChartSourceChoice } from '../../helpers/chart-source.helper';
import { NOTE_COMPARISON_METRICS, NOTE_COMPARISON_WINDOWS, buildNoteComparisonRows, comparisonDateCarrier,
  comparisonDateLabel, comparisonValueText, addComparisonDays, type NoteComparisonDays, type NoteComparisonMetric } from '../../helpers/timeline-note-comparison.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { HealthMetricQueryService } from '../../services/health-metric-query.service';
import { TimelineNoteComparisonNavigationService } from '../../services/timeline-note-comparison-navigation.service';
import { TimelineNoteComparisonService, type TimelineNoteComparisonEvidence } from '../../services/timeline-note-comparison.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { ChartSourcePickerComponent } from '../shared/chart-source-picker/chart-source-picker.component';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { TimelineNotesDialogComponent } from './timeline-notes-dialog.component';

@Component({
  selector: 'app-timeline-note-comparison-page', standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatProgressBarModule,
    MatSelectModule, AppChartSharedModule, PageHeaderComponent, ChartSourcePickerComponent, HealthMetricSeriesChartComponent],
  templateUrl: './timeline-note-comparison-page.component.html', styleUrl: './timeline-note-comparison-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineNoteComparisonPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly notes = inject(AppTimelineNotesService);
  private readonly comparisons = inject(TimelineNoteComparisonService);
  private readonly queries = inject(HealthMetricQueryService);
  private readonly navigation = inject(TimelineNoteComparisonNavigationService);
  private readonly dialogs = inject(MatDialog);
  private readonly destroy = inject(DestroyRef);
  private readonly theme = inject(AppThemeService);
  protected readonly haptics = inject(AppHapticsService);
  readonly units = inject(AppUserSettingsQueryService).unitSettings;
  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly noteId = computed(() => this.params().get('noteId'));
  readonly note = signal<TimelineNote | null>(null);
  readonly evidence = signal<TimelineNoteComparisonEvidence | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly returning = signal(false);
  readonly returnError = signal<string | null>(null);
  readonly days = signal<NoteComparisonDays>(14);
  readonly methodExpanded = signal(false);
  readonly selectedSources = signal<Partial<Record<NoteComparisonMetric, string>>>({});
  readonly historyMetric = signal<NoteComparisonMetric>('heart_rate_variability');
  readonly windowOptions = NOTE_COMPARISON_WINDOWS;
  readonly metrics = NOTE_COMPARISON_METRICS;
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly window = computed(() => this.evidence()?.window || null);
  readonly subtitle = computed(() => {
    const note = this.note();
    return note ? `${note.startDate <= timelineToday(note.timeZone) ? 'Started' : 'Starts'} ${comparisonDateLabel(note.startDate)} · ${note.endDate === null ? 'Ongoing' : note.endDate === note.startDate ? 'Single-day note' : `Through ${comparisonDateLabel(note.endDate)}`} · Private note` : null;
  });
  readonly periods = computed(() => {
    const window = this.window();
    return window ? { before: `${comparisonDateLabel(window.before.startDate)} – ${comparisonDateLabel(window.before.endDate)}`,
      after: `${comparisonDateLabel(window.after.startDate)} – ${comparisonDateLabel(window.after.endDate)}` } : null;
  });
  readonly rows = computed(() => {
    const evidence = this.evidence();
    const pending = this.loading(), failed = !!this.error();
    return evidence ? buildNoteComparisonRows(evidence.series, evidence.window, pending || failed ? {} : evidence.complete, this.selectedSources()).map(row => ({
      ...row, choices: row.choices.map(healthChartSourceChoice),
      reason: pending ? 'Updating readings' : failed ? 'Refresh failed' : row.reason,
      beforeText: comparisonValueText(row.metricId, row.before, this.units()),
      afterText: comparisonValueText(row.metricId, row.after, this.units()),
      differenceText: comparisonValueText(row.metricId, row.difference, this.units(), true),
    })) : [];
  });
  readonly chart = computed(() => {
    const row = this.rows().find(row => row.metricId === this.historyMetric()), window = this.window();
    if (!row?.dailySeries?.points.length || !window) return null;
    const start = comparisonDateCarrier(window.before.startDate);
    const end = comparisonDateCarrier(window.after.endDate < window.today ? window.after.endDate : addComparisonDays(window.today, -1));
    return { model: buildHealthChartModels([row.dailySeries], start, end, this.units())[0], start, end, window,
      source: healthChartSourceChoice(row.series).shortLabel, status: row.status === 'comparable' ? null : row.reason };
  });
  private version = 0;
  private contextKey = '';
  private controller: AbortController | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      const uid = this.notes.uid(), id = this.noteId(), days = this.days();
      untracked(() => { void this.load(uid, id, days); });
    });
    this.notes.changes$.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const returned = () => { if (document.visibilityState === 'visible' && !this.loading()) this.reload(); };
      const timer = setInterval(() => {
        const note = this.note(), window = this.window();
        if (note && window && !this.loading() && document.visibilityState === 'visible' && timelineToday(note.timeZone) !== window.today) this.reload();
      }, 60_000);
      window.addEventListener('focus', returned); document.addEventListener('visibilitychange', returned);
      this.destroy.onDestroy(() => { clearInterval(timer); window.removeEventListener('focus', returned); document.removeEventListener('visibilitychange', returned); });
    }
    this.destroy.onDestroy(() => { this.destroyed = true; this.version++; this.controller?.abort(); this.note.set(null); this.evidence.set(null); });
  }
  chooseWindow(value: number): void {
    if (!NOTE_COMPARISON_WINDOWS.includes(value as NoteComparisonDays) || value === this.days()) return;
    this.haptics.selection(); this.days.set(value as NoteComparisonDays);
  }
  chooseSource(metric: NoteComparisonMetric, key: string): void {
    const row = this.rows().find(row => row.metricId === metric);
    if (this.loading() || row?.selectedKey === key || !row?.choices.some(choice => choice.key === key)) return;
    this.haptics.selection(); this.selectedSources.update(values => ({ ...values, [metric]: key }));
  }
  chooseMetric(metric: NoteComparisonMetric): void {
    if (metric === this.historyMetric() || !NOTE_COMPARISON_METRICS.some(value => value.id === metric)) return;
    this.haptics.selection(); this.historyMetric.set(metric);
  }
  retry(): void {
    const uid = this.notes.uid();
    if (!uid || this.loading()) return;
    this.queries.invalidate(uid); this.reload();
  }
  async back(): Promise<void> {
    const uid = this.notes.uid();
    if (!uid || this.returning()) return;
    this.returnError.set(null);
    this.returning.set(true);
    try {
      const restoreList = await this.navigation.returnToNotes(uid);
      if (restoreList && this.notes.isOwner(uid)) this.dialogs.open(TimelineNotesDialogComponent,
        { width: '560px', maxWidth: 'calc(100vw - 32px)', data: { uid, restoreList } });
      else if (!this.destroyed && this.notes.isOwner(uid)) {
        this.returnError.set('Could not return to Timeline notes. Please try again.'); this.haptics.error();
      }
    } catch { if (!this.destroyed && this.notes.isOwner(uid)) {
      this.returnError.set('Could not return to Timeline notes. Please try again.'); this.haptics.error();
    } }
    finally { this.returning.set(false); }
  }
  private reload(): void { void this.load(this.notes.uid(), this.noteId(), this.days()); }
  private async load(uid: string | null, id: string | null, days: NoteComparisonDays): Promise<void> {
    if (this.destroyed) return;
    const version = ++this.version;
    this.controller?.abort(); this.controller = new AbortController();
    const key = `${uid}:${id}`;
    if (key !== this.contextKey) {
      this.contextKey = key; this.note.set(null); this.evidence.set(null); this.returnError.set(null); this.selectedSources.set({}); this.methodExpanded.set(false);
      this.historyMetric.set('heart_rate_variability');
    }
    this.error.set(null); this.loading.set(false);
    if (!uid || !id || !this.notes.isOwner(uid)) { this.note.set(null); this.evidence.set(null); this.selectedSources.set({}); return; }
    if (!/^[a-f0-9]{64}$/.test(id)) { this.error.set('This Timeline note is unavailable.'); return; }
    const current = () => !this.destroyed && version === this.version && this.notes.isOwner(uid);
    this.loading.set(true);
    try {
      const note = await this.notes.get(uid, id);
      if (!current()) return;
      if (!note || note.revision !== this.note()?.revision) this.evidence.set(null);
      this.note.set(note);
      if (!note) { this.error.set('This Timeline note no longer exists or is unavailable.'); return; }
      const result = await this.comparisons.load(uid, note, days, this.controller.signal);
      if (!current()) return;
      const selected = { ...this.selectedSources() };
      for (const row of buildNoteComparisonRows(result.series, result.window, result.complete, selected)) {
        if (!selected[row.metricId] && row.selectedKey) selected[row.metricId] = row.selectedKey;
      }
      this.selectedSources.set(selected); this.evidence.set(result);
    } catch { if (current()) this.error.set('Comparison readings could not be loaded. No result is inferred. Please retry.'); }
    finally { if (current()) this.loading.set(false); }
  }
}
