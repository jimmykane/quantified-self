import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { AssistantWorkoutReview } from '@shared/assistant-workout-review';
import { assistantWorkoutReviewModel } from '../../helpers/assistant-workout-review.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';

let nextReviewId = 0;
@Component({
  selector: 'app-assistant-workout-review', standalone: true, imports: [MatButtonModule, WorkoutProfileComponent],
  templateUrl: './assistant-workout-review.component.html', styleUrls: ['./assistant-workout-review.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantWorkoutReviewComponent {
  readonly review = input.required<AssistantWorkoutReview>();
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly contextKey = input.required<string>();
  readonly compact = input(false);
  private readonly locale = inject(LOCALE_ID);
  private readonly haptics = inject(AppHapticsService);
  readonly model = computed(() => assistantWorkoutReviewModel(this.review(), this.unitSettings(), this.locale));
  readonly changesExpanded = signal(true);
  readonly mappingExpanded = signal(false);
  readonly selectedStepId = signal<string | null>(null);
  readonly regionId = `assistant-workout-changes-${++nextReviewId}`;
  readonly mappingRegionId = `${this.regionId}-mapping`;
  constructor() {
    effect(() => { this.contextKey(); this.changesExpanded.set(!this.compact() && this.model().changes.length <= 8); this.mappingExpanded.set(false); this.selectedStepId.set(null); });
  }
  toggleChanges(): void { this.changesExpanded.update(value => !value); this.haptics.selection(); }
  toggleMapping(): void { this.mappingExpanded.update(value => !value); this.haptics.selection(); }
}
