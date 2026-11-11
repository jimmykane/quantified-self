import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { CalendarActivityRowComponent } from '../../calendar/calendar-activity-row/calendar-activity-row.component';
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
    RouterLink,
    CalendarActivityRowComponent,
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
  private readonly users = inject(AppUserService);
  private readonly router = inject(Router);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  private readonly haptics = inject(AppHapticsService);
  readonly showActivities = computed(() => this.settings().recordedActivities === true && this.owner()
    && !!this.account()?.uid && this.account().uid === this.users.user()?.uid);
  readonly recordedActivities = computed(() => {
    if (!this.showActivities()) return null;
    const state = this.data.activities();
    return state.ownerUid === this.account()?.uid && state.date === this.localDate() ? state : null;
  });
  readonly fullDayRoute = computed(() => ['/calendar/day', this.localDate()]);

  prepareActivityNavigation(): void {
    this.navigation.prepareReturn(this.router.url, this.localDate());
  }

  openDay(): void {
    this.haptics.selection();
    this.prepareActivityNavigation();
  }

  retryActivities(): void {
    if (this.showActivities() && this.data.retryActivities()) this.haptics.selection();
  }

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
