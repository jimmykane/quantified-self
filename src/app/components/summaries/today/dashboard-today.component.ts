import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type {
  AppUserInterface,
  AppDashboardTodaySettings,
} from '../../../models/app-user.interface';
import { MetricIndicatorComponent } from '../../shared/metric-indicator/metric-indicator.component';
import { DailyWorkoutSuggestionComponent } from '../daily-workout-suggestion/daily-workout-suggestion.component';
import { CurrentPlanRestDayComponent } from '../../plans/current-plan-rest-day.component';
import { ActiveSicknessNoteComponent } from '../../timeline-notes/active-sickness-note.component';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { DASHBOARD_TODAY_METRICS } from '../../../helpers/dashboard-today-settings.helper';
import { AppColors } from '../../../services/color/app.colors';
import { DashboardTodayDataService } from '../../../services/dashboard-today-data.service';
import type {
  DashboardTodayReadinessViewModel,
  DashboardTodayTrainingStateViewModel,
} from './dashboard-today-view';

@Component({
  selector: 'app-dashboard-today',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MetricIndicatorComponent,
    DailyWorkoutSuggestionComponent,
    CurrentPlanRestDayComponent,
    ActiveSicknessNoteComponent,
  ],
  providers: [DashboardTodayDataService],
  templateUrl: './dashboard-today.component.html',
  styleUrl: './dashboard-today.component.css',
})
export class DashboardTodayComponent {
  readonly account = input<AppUserInterface | null>(null);
  readonly owner = input(false);
  readonly expanded = input(true);
  readonly settings = input.required<AppDashboardTodaySettings>();
  readonly readiness = input.required<DashboardTodayReadinessViewModel>();
  readonly trainingState =
    input.required<DashboardTodayTrainingStateViewModel>();
  readonly localDate = input.required<string>();
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly sleepRevision = input(0);
  readonly sleepKey = input<string | null>(null);
  readonly customize = output<void>();
  readonly todaySleepBaseColor = AppColors.Purple;
  readonly dashboardTodayTrainingStateScaleSegments = [0, 1, 2, 3, 4, 5];
  readonly labels = Object.fromEntries(
    DASHBOARD_TODAY_METRICS.map((item) => [item.id, item.label])
  );
  readonly data = inject(DashboardTodayDataService);
  constructor() {
    effect(() =>
      this.data.connect(
        this.owner() ? this.account() : null,
        this.settings(),
        this.localDate()
      )
    );
  }
}
