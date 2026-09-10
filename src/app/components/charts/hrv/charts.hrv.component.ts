import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { DashboardHrvContext } from '../../../helpers/dashboard-hrv-context.helper';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { AppHapticsService } from '../../../services/app.haptics.service';

@Component({
  selector: 'app-hrv-chart', standalone: true,
  imports: [MatTabsModule, MatProgressSpinnerModule, HealthMetricSeriesChartComponent],
  templateUrl: './charts.hrv.component.html', styleUrls: ['./charts.hrv.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsHrvComponent {
  readonly context = input<DashboardHrvContext | null>(null);
  readonly darkTheme = input(false);
  readonly isLoading = input(false);
  readonly reserveTitleActionSpace = input(false);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly preferredSource = input<string | null>(null);
  private readonly selectedSource = signal<string | null>(null);
  private readonly haptics = inject(AppHapticsService);
  readonly charts = computed(() => this.context()?.charts || []);
  readonly selectedIndex = computed(() => {
    const key = this.selectedSource() || this.preferredSource();
    return Math.max(0, this.charts().findIndex(chart => chart.key === key));
  });
  readonly chart = computed(() => this.charts()[this.selectedIndex()] || null);

  selectSource(index: number): void {
    const chart = this.charts()[index];
    if (!chart || index === this.selectedIndex() || this.context()?.loading || this.isLoading()) return;
    this.selectedSource.set(chart.key);
    this.haptics.selection();
  }
}
