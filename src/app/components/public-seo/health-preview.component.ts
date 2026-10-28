import { ChangeDetectionStrategy, Component, computed, inject, input, NgZone, TemplateRef, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { TIMELINE_NOTE_LABELS, timelineNoteDates, type TimelineNote } from '@shared/timeline-notes';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppThemes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { buildHealthChartModels, buildHealthHrvChartStatusOverlay, healthHrvChartStatusDescription } from '../../helpers/health-metric-chart.helper';
import { buildHealthHrvPersonalRangeStatus } from '../../helpers/health-workspace.helper';
import { AppThemeService } from '../../services/app.theme.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { HealthSleepStageSummaryComponent } from '../health/health-sleep-stage-summary.component';
import { ChartsSleepTrendComponent } from '../charts/sleep-trend/charts.sleep-trend.component';
import { buildHealthPreviewSeries, buildHealthPreviewSleepTrend, HEALTH_PREVIEW_END, HEALTH_PREVIEW_START, HEALTH_PREVIEW_NOTES, type HealthPreviewKind } from './health-preview.data';

/** Public data adapter only: Health owns the charts, formatting and interaction. */
@Component({
  selector: 'app-health-preview', standalone: true,
  imports: [HealthMetricSeriesChartComponent, HealthSleepStageSummaryComponent, ChartsSleepTrendComponent, MatButtonModule, MatDialogModule, AppChartSharedModule],
  templateUrl: './health-preview.component.html',
  styleUrls: ['./health-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthPreviewComponent {
  readonly kind = input.required<HealthPreviewKind>();
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  private readonly theme = inject(AppThemeService);
  private readonly dialogs = inject(MatDialog);
  private readonly haptics = inject(AppHapticsService);
  private readonly zone = inject(NgZone);
  @ViewChild('sampleNotes') private sampleNotes!: TemplateRef<unknown>;
  readonly timelineNotes = computed<TimelineNoteChartContext | null>(() => this.kind() === 'hrv' ? {
    notes: HEALTH_PREVIEW_NOTES,
    select: notes => this.openNotes(notes),
    // Public dates and fixtures are fixed; no workspace fetching is needed.
    reportRange: () => undefined,
  } : null);
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly start = HEALTH_PREVIEW_START;
  readonly end = HEALTH_PREVIEW_END;
  readonly sleepTrend = buildHealthPreviewSleepTrend();
  readonly sleepPoint = this.sleepTrend.latestPoint!;
  readonly series = computed(() => buildHealthPreviewSeries(this.kind()));
  readonly model = computed(() => buildHealthChartModels([{
    ...this.series(),
    points: this.series().points.filter(point => point.timestampMs >= this.start && point.timestampMs <= this.end),
  }], this.start, this.end, this.unitSettings())[0]);
  readonly status = computed(() => this.kind() === 'hrv'
    ? buildHealthHrvPersonalRangeStatus(this.series(), this.end, this.unitSettings(), this.model().displayedPoints.map(point => point.timestampMs)) : null);
  readonly overlay = computed(() => buildHealthHrvChartStatusOverlay(this.status()));
  readonly statusDescription = computed(() => healthHrvChartStatusDescription(this.status()));

  openNotes(notes: readonly TimelineNote[] = HEALTH_PREVIEW_NOTES): void {
    const rows = HEALTH_PREVIEW_NOTES.filter(note => notes.some(selected => selected.id === note.id))
      .map(note => ({ ...note, categoryLabel: TIMELINE_NOTE_LABELS[note.category], dates: timelineNoteDates(note) }));
    if (!rows.length || this.kind() !== 'hrv') return;
    // Shared ECharts callbacks run outside Angular; Material owns dialog/focus lifecycle inside it.
    this.zone.run(() => {
      this.haptics.selection();
      this.dialogs.open(this.sampleNotes, { width: '480px', maxWidth: 'calc(100vw - 32px)', data: rows });
    });
  }
}
