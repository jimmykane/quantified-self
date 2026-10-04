import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { ErrorStateMatcher } from '@angular/material/core';
import {
  formatWorkoutEditorPace, parseWorkoutEditorPace, splitWorkoutEditorMinutes,
  workoutDurationPartsToSeconds, type WorkoutDurationParts,
} from '../../helpers/workout-time-input.helper';

let nextDurationErrorId = 0;

@Component({
  selector: 'app-workout-time-input',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule],
  templateUrl: './workout-time-input.component.html',
  styleUrls: ['./workout-time-input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkoutTimeInputComponent {
  /** The existing editor boundary uses minutes; canonical storage remains seconds / m/s. */
  readonly value = input.required<number | null>();
  readonly mode = input<'duration' | 'pace'>('duration');
  readonly label = input('Duration');
  readonly disabled = input(false);
  readonly valueChange = output<number | null>();
  /** Preserve authored seconds without a lossy seconds → editor minutes → seconds round trip. */
  readonly durationChange = output<{ minutes: number; seconds: number }>();
  readonly parts = signal<WorkoutDurationParts>({ hours: 0, minutes: 0, seconds: 0 });
  readonly paceText = signal('');
  readonly error = signal<string | null>(null);
  readonly errorId = `workout-duration-error-${nextDurationErrorId++}`;
  readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => this.error() !== null };
  private echo: { value: number | null; mode: string; label: string } | null = null;

  constructor() {
    effect(() => {
      const value = this.value(), mode = this.mode(), label = this.label();
      // Do not normalize partial typing or cleared fields when the parent echoes our change.
      if (this.echo && Object.is(value, this.echo.value) && mode === this.echo.mode && label === this.echo.label) {
        this.echo = null;
        return;
      }
      this.echo = null;
      this.parts.set(splitWorkoutEditorMinutes(value));
      this.paceText.set(formatWorkoutEditorPace(value));
      this.error.set(null);
    });
  }

  changePart(part: keyof WorkoutDurationParts, value: number | null): void {
    if (this.disabled() || Object.is(this.parts()[part], value)) return;
    const parts = { ...this.parts(), [part]: value };
    this.parts.set(parts);
    const seconds = workoutDurationPartsToSeconds(parts);
    const minutes = seconds / 60;
    this.error.set(Number.isFinite(minutes) ? null : 'Enter a positive duration. Minutes and seconds must be below 60.');
    this.emit(minutes);
    this.durationChange.emit({ minutes, seconds });
  }

  changePace(text: string): void {
    if (this.disabled() || text === this.paceText()) return;
    this.paceText.set(text);
    const minutes = parseWorkoutEditorPace(text);
    this.error.set(minutes !== null && Number.isFinite(minutes) ? null : 'Enter a positive pace as m:ss, for example 4:30.');
    this.emit(minutes);
  }

  private emit(value: number | null): void {
    this.echo = { value, mode: this.mode(), label: this.label() };
    this.valueChange.emit(value);
  }
}
