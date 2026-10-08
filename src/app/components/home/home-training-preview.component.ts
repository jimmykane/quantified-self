import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getDateTimeFormatter } from '../../helpers/date-time-format.helper';
import { buildTrainingPlansPreviewFixture } from '../public-seo/training-plans-preview.data';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';

/** Fixed public samples: no authentication, account reads, persistence, or provider actions. */
@Component({
  selector: 'app-home-training-preview',
  standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, WorkoutProfileComponent],
  templateUrl: './home-training-preview.component.html',
  styleUrl: './home-training-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeTrainingPreviewComponent {
  private readonly locale = inject(LOCALE_ID);
  private readonly haptics = inject(AppHapticsService);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly view = signal<'calendar' | 'profile'>('calendar');
  readonly selectedDay = signal(8);
  private readonly fixture = buildTrainingPlansPreviewFixture(new Date(2026, 9, 8));
  // Reuse the validated public recipes. Calendar placement is illustrative, rather than a user's schedule.
  readonly days = [
    { day: 5, workout: this.fixture.workouts[3], status: 'Skipped' },
    { day: 6, workout: this.fixture.workouts[0], status: 'Planned' },
    { day: 7, workout: null, status: 'Rest day' },
    { day: 8, workout: this.fixture.workouts[4], status: 'Completed · activity linked' },
    { day: 9, workout: this.fixture.workouts[5], status: 'Planned' },
    { day: 10, workout: this.fixture.workouts[7], status: 'Planned' },
    { day: 11, workout: null, status: 'Open date' },
  ].map(day => ({ ...day,
    icon: day.status.startsWith('Completed') ? 'check_circle' : day.workout ? 'event' : 'remove',
    weekday: getDateTimeFormatter(this.locale, { weekday: 'short' }).format(new Date(2026, 9, day.day)),
    label: getDateTimeFormatter(this.locale, { weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(2026, 9, day.day)),
  }));
  readonly selected = computed(() => this.days.find(day => day.day === this.selectedDay())!);
  readonly totals = computed(() => {
    const workout = this.selected().workout;
    return workout ? formatWorkoutPrescriptionSummaryV1(workout.structure, this.unitSettings(),
      workout.structure.sport, this.locale) : null;
  });
  readonly monthLabel = getDateTimeFormatter(this.locale, { month: 'long', year: 'numeric' })
    .format(new Date(2026, 9, 8));

  selectView(view: 'calendar' | 'profile'): void {
    if ((view !== 'calendar' && view !== 'profile') || view === this.view()) return;
    this.view.set(view);
    this.haptics.selection();
  }

  selectDay(day: number): void {
    if (day === this.selectedDay() || !this.days.some(candidate => candidate.day === day)) return;
    this.selectedDay.set(day);
    this.haptics.selection();
  }
}
