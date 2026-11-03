import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DataDistance, DataDuration, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import type { TrainingGoalReviewFields } from '@shared/training-goal-review';
import type { TrainingGoalProgress } from '@shared/training-goal-progress';
import { getActivityTypeGroupLabel, resolveActivityTypeGroup } from '@shared/activity-type-group.metadata';

@Component({ selector: 'app-training-goal-details', standalone: true, imports: [DatePipe],
  templateUrl: './training-goal-details.component.html', styleUrl: './training-goals.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingGoalDetailsComponent {
  readonly goal = input.required<TrainingGoalReviewFields>();
  readonly units = input<UserUnitSettingsInterface | null>(null);
  readonly progress = input<TrainingGoalProgress | null>(null);
  readonly sportLabel = computed(() => this.goal().sportScope === 'all' ? 'All sports' : this.goal().sportScope === 'family'
    ? `${getActivityTypeGroupLabel(resolveActivityTypeGroup(this.goal().sport)!)} family` : this.goal().sport);
  readonly targetText = computed(() => {
    const target = this.goal().weeklyTarget;
    if (!target) return null;
    return `${this.display(target.kind, target.value)} per week`;
  });
  readonly progressText = computed(() => {
    const progress = this.progress();
    if (!progress) return null;
    if (!progress.complete) return 'Progress incomplete · history or metrics are still unavailable';
    return `${progress.kind === 'workouts' || progress.kind === 'days' ? progress.value : this.display(progress.kind, progress.value)} of ${this.display(progress.kind, progress.target)}${progress.met ? ' · target met' : ''}${progress.partialWeek ? ' · partial week' : ''}`;
  });
  private display(kind: 'days' | 'workouts' | 'duration' | 'distance', value: number): string {
    if (kind === 'days' || kind === 'workouts') return `${value} ${kind === 'days' ? 'training days' : 'workouts'}`;
    return formatUnitAwareDataValue(kind === 'duration' ? DataDuration.type : DataDistance.type, value, this.units()) ?? 'Unavailable';
  }
}
