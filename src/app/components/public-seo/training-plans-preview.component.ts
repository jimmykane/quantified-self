import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import { formatManualWorkoutStructure } from '../../helpers/planned-workout-editor.helper';
import { trainingPlanAppearance } from '../../helpers/training-plan-appearance.helper';
import { resolveActivityTypeMaterialIcon } from '../../helpers/activity-type-presentation.helper';
import { PlanScheduleCalendarComponent } from '../plans/plan-schedule-calendar.component';
import { getDateTimeFormatter } from '../../helpers/date-time-format.helper';
import {
  TRAINING_PLANS_PREVIEW_PLAN,
  TRAINING_PLANS_PREVIEW_TODAY,
  TRAINING_PLANS_PREVIEW_WORKOUTS,
} from './training-plans-preview.data';

interface TrainingPlansPreviewWorkoutRow {
  workout: ScheduledWorkoutV1;
  sport: string;
  icon: string;
  summary: readonly string[];
}

/** Public fixture adapter only. It never loads authentication, account data, schedule writes, or provider delivery. */
@Component({
  selector: 'app-training-plans-preview',
  standalone: true,
  imports: [MatIconModule, PlanScheduleCalendarComponent],
  templateUrl: './training-plans-preview.component.html',
  styleUrls: ['./training-plans-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingPlansPreviewComponent {
  private readonly locale = inject(LOCALE_ID);
  readonly plan = TRAINING_PLANS_PREVIEW_PLAN;
  readonly workouts = TRAINING_PLANS_PREVIEW_WORKOUTS;
  readonly today = TRAINING_PLANS_PREVIEW_TODAY;
  readonly appearance = trainingPlanAppearance(this.plan);
  readonly selectedDate = signal(TRAINING_PLANS_PREVIEW_TODAY);
  readonly selectedWorkoutId = signal<string | null>(
    this.workouts.find(workout => workout.localDate === TRAINING_PLANS_PREVIEW_TODAY)?.id ?? null,
  );
  readonly dateRangeLabel = `${this.formatDate(this.plan.startLocalDate, { day: 'numeric', month: 'short' })}–${this.formatDate(this.plan.endLocalDate, { day: 'numeric', month: 'short' })}`;
  readonly selectedDateLabel = computed(() => this.formatDate(this.selectedDate(), {
    weekday: 'long', day: 'numeric', month: 'long',
  }));
  readonly selectedWorkoutRows = computed<readonly TrainingPlansPreviewWorkoutRow[]>(() => this.workouts
    .filter(workout => workout.localDate === this.selectedDate())
    .map(workout => ({
      workout,
      sport: this.formatSport(workout.structure.sport),
      icon: resolveActivityTypeMaterialIcon(workout.structure.sport),
      summary: formatManualWorkoutStructure(workout.structure, null, this.locale),
    })));

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
