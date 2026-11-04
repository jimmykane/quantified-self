import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { AppHapticsService } from '../../services/app.haptics.service';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';

/** Synthetic public example only: no account reads, model calls, saves or provider actions. */
@Component({
  selector: 'app-daily-workout-preview', standalone: true,
  imports: [MatButtonModule, MatButtonToggleModule, CompactRowComponent, WorkoutProfileComponent],
  templateUrl: './daily-workout-preview.component.html', styleUrl: './daily-workout-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailyWorkoutPreviewComponent {
  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(LOCALE_ID);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly example = signal<'workout' | 'rest'>('workout');
  readonly reviewExpanded = signal(false);
  readonly structure = parseWorkoutStructureV1({ version: 1, sport: ActivityTypes.Running, nodes: [
    { kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 300 }, targets: [] },
    { kind: 'step', id: 'easy', purpose: 'work', ending: { kind: 'time', seconds: 1200 }, targets: [
      { kind: 'speed', mode: 'absolute', minimumMetersPerSecond: 2.5, maximumMetersPerSecond: 3, presentation: 'pace' },
    ] },
    { kind: 'step', id: 'cooldown', purpose: 'cooldown', ending: { kind: 'time', seconds: 300 }, targets: [] },
  ] });
  readonly summary = computed(() => this.example() === 'rest' ? 'Rest day suggested' : `Easy run · ${
    formatWorkoutPrescriptionSummaryV1(this.structure, this.unitSettings(), this.structure.sport, this.locale)}`);

  selectExample(value: 'workout' | 'rest'): void {
    if (!['workout', 'rest'].includes(value) || value === this.example()) return;
    this.example.set(value); this.reviewExpanded.set(false); this.haptics.selection();
  }
  toggleReview(): void { this.reviewExpanded.update(value => !value); this.haptics.selection(); }
}
