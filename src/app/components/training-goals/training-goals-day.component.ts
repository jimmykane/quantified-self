import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { trainingGoalMarkerDate } from '@shared/training-goals';
import { SharedModule } from '../../modules/shared.module';
import { TrainingGoalsService } from '../../services/training-goals.service';
@Component({ selector: 'app-training-goals-day', standalone: true, imports: [SharedModule],
  templateUrl: './training-goals-day.component.html', styleUrl: './training-goals-day.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingGoalsDayComponent {
  readonly uid = input.required<string>();
  readonly localDate = input.required<string>();
  readonly goals = inject(TrainingGoalsService);
  readonly isOwner = computed(() => this.goals.isOwner(this.uid()));
  readonly state = toSignal(toObservable(this.uid).pipe(switchMap(uid => this.goals.watch(uid))), { initialValue: { status: 'loading' as const, goals: [] } });
  readonly rows = computed(() => this.state().goals.filter(goal => goal.lifecycle !== 'archived' && trainingGoalMarkerDate(goal) === this.localDate()));
  readonly isEmpty = computed(() => !this.isOwner() || (this.state().status === 'ready' && !this.rows().length));
}
