import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppChartSharedModule } from '../../../modules/app-chart-shared.module';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { DashboardHrvContext } from '../../../helpers/dashboard-hrv-context.helper';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { ChartSourcePickerComponent } from '../../shared/chart-source-picker/chart-source-picker.component';
import { healthChartSourceChoice } from '../../../helpers/chart-source.helper';

@Component({
  selector: 'app-hrv-chart', standalone: true,
  imports: [MatTabsModule, MatProgressSpinnerModule, MatProgressBarModule, MatButtonModule, MatIconModule, MatTooltipModule, AppChartSharedModule, HealthMetricSeriesChartComponent, ChartSourcePickerComponent],
  templateUrl: './charts.hrv.component.html', styleUrls: ['./charts.hrv.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsHrvComponent {
  readonly context = input<DashboardHrvContext | null>(null);
  readonly darkTheme = input(false);
  readonly isLoading = input(false);
  readonly reserveTitleActionSpace = input(false);
  readonly infoTooltip = input('');
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly preferredSource = input<string | null>(null);
  private readonly selectedSource = signal<string | null>(null);
  private readonly haptics = inject(AppHapticsService);
  readonly charts = computed(() => this.context()?.charts || []);
  readonly selectedSourceKey = computed(() => this.selectedSource() || this.preferredSource());
  readonly sourceChoices = computed(() => this.charts().map(chart => ({ ...healthChartSourceChoice(chart.model.series), key: chart.key })));
  readonly selectedIndex = computed(() => {
    if (this.selectedSource()) return this.charts().findIndex(chart => chart.key === this.selectedSource());
    const preferred = this.preferredSource();
    return preferred ? this.charts().findIndex(chart => chart.key === preferred
      || chart.model.series.sourceSelectionKey === preferred) : 0;
  });
  readonly chart = computed(() => this.charts()[this.selectedIndex()] || null);
  readonly missingSource = computed(() => !!this.selectedSourceKey() && !this.chart());

  selectSourceKey(key: string): void {
    this.selectSource(this.charts().findIndex(chart => chart.key === key));
  }

  selectSource(index: number): void {
    const chart = this.charts()[index];
    if (!chart || index === this.selectedIndex() || this.context()?.loading || this.isLoading()) return;
    this.selectedSource.set(chart.key);
    this.haptics.selection();
  }
}
