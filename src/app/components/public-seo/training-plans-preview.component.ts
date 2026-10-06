import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, signal } from '@angular/core';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { formatManualWorkoutStructure } from '../../helpers/planned-workout-editor.helper';
import { trainingPlanAppearance } from '../../helpers/training-plan-appearance.helper';
import { resolveActivityTypeMaterialIcon } from '../../helpers/activity-type-presentation.helper';
import { PlanScheduleCalendarComponent } from '../plans/plan-schedule-calendar.component';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getDateTimeFormatter } from '../../helpers/date-time-format.helper';
import {
  buildTrainingPlansPreviewFixture,
} from './training-plans-preview.data';

interface TrainingPlansPreviewWorkoutRow {
  workout: ScheduledWorkoutV1;
  sport: string;
  icon: string;
  completed: boolean;
  summary: readonly string[];
  totals: string;
}

/** Public fixture adapter only. It never loads authentication, account data, schedule writes, or provider delivery. */
@Component({
  selector: 'app-training-plans-preview',
  standalone: true,
  imports: [MatIconModule, MatButtonToggleModule, MatFormFieldModule, MatSelectModule,
    PlanScheduleCalendarComponent, WorkoutProfileComponent],
  templateUrl: './training-plans-preview.component.html',
  styleUrls: ['./training-plans-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingPlansPreviewComponent {
  private readonly locale = inject(LOCALE_ID);
  private readonly haptics = inject(AppHapticsService);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly selectedView = signal<'calendar' | 'profile'>('calendar');
  readonly preview = buildTrainingPlansPreviewFixture();
  readonly plan = this.preview.plan;
  readonly workouts = this.preview.workouts;
  readonly today = this.preview.today;
  readonly completedWorkoutIds = this.preview.completedWorkoutIds;
  private readonly completedWorkoutIdSet = new Set(this.completedWorkoutIds);
  readonly appearance = trainingPlanAppearance(this.plan);
  readonly selectedDate = signal(this.today);
  readonly selectedWorkoutId = signal<string | null>(
    this.workouts.find(workout => workout.localDate === this.today)?.id ?? null,
  );
  readonly dateRangeLabel = `${this.formatDate(this.plan.startLocalDate, { day: 'numeric', month: 'short' })}–${this.formatDate(this.plan.endLocalDate, { day: 'numeric', month: 'short' })}`;
  readonly selectedDateLabel = computed(() => this.formatDate(this.selectedDate(), {
    weekday: 'long', day: 'numeric', month: 'long',
  }));
  readonly workoutRows = computed<readonly TrainingPlansPreviewWorkoutRow[]>(() => this.workouts
    .map(workout => ({
      workout,
      sport: this.formatSport(workout.structure.sport),
      icon: resolveActivityTypeMaterialIcon(workout.structure.sport),
      completed: this.completedWorkoutIdSet.has(workout.id),
      summary: formatManualWorkoutStructure(workout.structure, this.unitSettings(), this.locale),
      totals: formatWorkoutPrescriptionSummaryV1(workout.structure, this.unitSettings(), workout.structure.sport, this.locale),
    })));
  readonly selectedWorkoutRows = computed(() => this.workoutRows()
    .filter(row => row.workout.localDate === this.selectedDate()));
  readonly profileWorkout = computed(() => this.workoutRows()
    .find(row => row.workout.id === this.selectedWorkoutId()) ?? null);

  selectView(view: 'calendar' | 'profile'): void {
    if ((view !== 'calendar' && view !== 'profile') || view === this.selectedView()) return;
    this.selectedView.set(view);
    this.haptics.selection();
  }

  selectProfileWorkout(id: string): void {
    const workout = this.workouts.find(candidate => candidate.id === id);
    if (!workout || id === this.selectedWorkoutId()) return;
    this.selectWorkout(workout);
    this.haptics.selection();
  }

  selectDate(localDate: string): void {
    this.selectedDate.set(localDate);
    this.selectedWorkoutId.set(this.workouts.find(workout => workout.localDate === localDate)?.id ?? null);
  }

  selectWorkout(workout: ScheduledWorkoutV1): void {
    this.selectedDate.set(workout.localDate);
    this.selectedWorkoutId.set(workout.id);
  }

  private formatDate(localDate: string, options: Intl.DateTimeFormatOptions): string {
    const [year, month, day] = localDate.split('-').map(Number);
    return getDateTimeFormatter(this.locale, options).format(new Date(year, month - 1, day));
  }

  private formatSport(sport: string): string {
    return sport.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  }
}
