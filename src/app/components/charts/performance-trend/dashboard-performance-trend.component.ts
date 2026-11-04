import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import type { DashboardPerformanceTrendContext } from '../../../helpers/dashboard-performance-trend.helper';
import { isDerivedMetricPendingStatus, type DashboardDerivedMetricStatus } from '../../../helpers/derived-metric-status.helper';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../../helpers/echarts-tooltip-interaction.helper';
import { AppChartSharedModule } from '../../../modules/app-chart-shared.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { TrainingPowerSystemsTrendChartComponent } from '../../training/training-power-systems-trend-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from '../../training/training-durability-trajectory-chart.component';

/** Dashboard chrome only. Training remains the single owner of these renderers. */
@Component({ selector: 'app-dashboard-performance-trend', standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, AppChartSharedModule,
    TrainingPowerSystemsTrendChartComponent, TrainingDurabilityTrajectoryChartComponent],
  templateUrl: './dashboard-performance-trend.component.html', styleUrl: './dashboard-performance-trend.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPerformanceTrendComponent {
  readonly context = input<DashboardPerformanceTrendContext | null>(null);
  readonly title = input('');
  readonly info = input<string | null>(null);
  readonly status = input<DashboardDerivedMetricStatus | null>(null);
  readonly darkTheme = input(false);
  readonly disabled = input(false);
  readonly saving = input(false);
  readonly reserveActions = input(false);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly contextChange = output<string>();
  readonly feedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
  readonly updating = computed(() => this.status() === 'missing' || isDerivedMetricPendingStatus(this.status()));
  readonly selectedLabel = computed(() => this.context()?.options.find(option => option.value === this.context()?.selectedKey)?.label || 'No recorded context');
  private readonly haptics = inject(AppHapticsService);

  selectContext(key: string): void {
    if (this.disabled() || key === this.context()?.selectedKey || !this.context()?.options.some(option => option.value === key)) return;
    this.haptics.selection();
    this.contextChange.emit(key);
  }
}
