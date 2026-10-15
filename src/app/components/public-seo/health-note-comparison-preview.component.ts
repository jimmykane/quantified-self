import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AppThemes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { buildHealthChartModels } from '../../helpers/health-metric-chart.helper';
import { NOTE_COMPARISON_METRICS, buildNoteComparisonRows, comparisonDateCarrier, comparisonDateLabel,
  comparisonValueText, type NoteComparisonMetric } from '../../helpers/timeline-note-comparison.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { buildHealthNoteComparisonExample } from './health-preview.data';

/** Public fixture adapter only. Saved-note comparison rules and the Health renderer own the result. */
@Component({
  selector: 'app-health-note-comparison-preview', standalone: true,
  imports: [MatFormFieldModule, MatSelectModule, HealthMetricSeriesChartComponent],
  templateUrl: './health-note-comparison-preview.component.html',
  styleUrl: './health-note-comparison-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthNoteComparisonPreviewComponent {
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  private readonly theme = inject(AppThemeService);
  protected readonly haptics = inject(AppHapticsService);
  readonly example = buildHealthNoteComparisonExample();
  readonly metrics = NOTE_COMPARISON_METRICS;
  readonly selectedMetric = signal<NoteComparisonMetric>('heart_rate_variability');
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly start = comparisonDateCarrier(this.example.window.before.startDate);
  readonly end = comparisonDateCarrier(this.example.window.after.endDate);
  readonly anchorLabel = comparisonDateLabel(this.example.window.anchor);
  readonly beforeLabel = `${comparisonDateLabel(this.example.window.before.startDate)} – ${comparisonDateLabel(this.example.window.before.endDate)}`;
  readonly afterLabel = `${comparisonDateLabel(this.example.window.after.startDate)} – ${comparisonDateLabel(this.example.window.after.endDate)}`;
  readonly row = computed(() => {
    const row = buildNoteComparisonRows(this.example.series, this.example.window, this.example.complete)
      .find(row => row.metricId === this.selectedMetric())!;
    return { ...row, beforeText: comparisonValueText(row.metricId, row.before, this.unitSettings()),
      afterText: comparisonValueText(row.metricId, row.after, this.unitSettings()),
      differenceText: comparisonValueText(row.metricId, row.difference, this.unitSettings(), true) };
  });
  readonly model = computed(() => buildHealthChartModels([this.row().dailySeries!], this.start, this.end,
    this.unitSettings(), { includeTwoReadingComparison: false })[0]);

  chooseMetric(metric: NoteComparisonMetric): void {
    if (metric === this.selectedMetric() || !this.metrics.some(candidate => candidate.id === metric)) return;
    this.selectedMetric.set(metric);
    this.haptics.selection();
  }
}
