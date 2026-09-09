import { ChangeDetectionStrategy, Component, ElementRef, LOCALE_ID, afterRenderEffect, computed, inject, input, output, signal } from '@angular/core';
import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import { buildPlanScheduleMonth } from '../../helpers/plan-schedule-calendar.helper';
import { formatActivityCalendarDateParam, navigateActivityCalendarDate, parseActivityCalendarDate } from '../../helpers/activity-calendar.helper';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({
  selector: 'app-plan-schedule-calendar',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './plan-schedule-calendar.component.html',
  styleUrls: ['./plan-schedule-calendar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanScheduleCalendarComponent {
  readonly plan = input.required<TrainingPlanV1>();
  readonly workouts = input.required<readonly ScheduledWorkoutV1[]>();
  readonly selectedDate = input.required<string>();
  readonly today = input.required<string>();
  readonly startOfWeek = input<number | null>(null);
  readonly disabled = input(false);
  readonly dateSelected = output<string>();
  readonly workoutSelected = output<ScheduledWorkoutV1>();
  private readonly locale = inject(LOCALE_ID);
  private readonly haptics = inject(AppHapticsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focusDate = signal<string | null>(null);
  readonly month = computed(() => buildPlanScheduleMonth(this.plan(), this.workouts(), this.selectedDate(), {
    today: this.today(), locale: this.locale, startOfWeek: this.startOfWeek(),
  }));

  private readonly keyboardFocus = afterRenderEffect(() => {
    const date = this.focusDate();
    if (!date) return;
    this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-plan-date="${date}"]`)?.focus();
    this.focusDate.set(null);
  });

  selectDate(date: string | null): void {
    if (!date || this.disabled() || date === this.selectedDate()
      || date < this.plan().startLocalDate || date > this.plan().endLocalDate) return;
    this.haptics.selection();
    this.dateSelected.emit(date);
    this.focusDate.set(date);
  }

  editWorkout(workout: ScheduledWorkoutV1): void {
    if (this.disabled()) return;
    this.haptics.selection();
    this.workoutSelected.emit(workout);
  }

  onDayKeydown(event: KeyboardEvent, date: string): void {
    if (this.disabled()) return;
    const parsed = parseActivityCalendarDate(date);
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: Date;
    if (event.key in offsets) {
      target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + offsets[event.key]);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      target = navigateActivityCalendarDate(parsed, 'month', event.key === 'PageUp' ? -1 : 1);
    } else {
      return;
    }
    event.preventDefault();
    const key = formatActivityCalendarDateParam(target);
    const bounded = key < this.plan().startLocalDate ? this.plan().startLocalDate
      : key > this.plan().endLocalDate ? this.plan().endLocalDate : key;
    this.selectDate(bounded);
    this.focusDate.set(bounded);
  }
}
