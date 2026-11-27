import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input } from '@angular/core';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { TRAINING_PLAN_CATALOG } from '@shared/training-plan-templates';

@Component({
  selector: 'app-public-plan-week',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plan(); as template) {
      <p>{{ template.sessions.length }} workouts · {{ template.author }}</p>
      <ul>
        @for (session of week(); track session) {
          <li><strong>Day {{ session.day }} · {{ session.title }}</strong><br>{{ session.summary }}</li>
        }
      </ul>
    }
  `,
  styleUrl: './public-plan-week.component.scss',
})
export class PublicPlanWeekComponent {
  readonly planId = input.required<string>();
  private readonly locale = inject(LOCALE_ID);
  protected readonly plan = computed(() => TRAINING_PLAN_CATALOG.find(plan => plan.id === this.planId()));
  protected readonly week = computed(() => this.plan()?.sessions.filter(session => session.day < 7).map(session => ({
    day: session.day + 1,
    title: session.title,
    summary: formatWorkoutPrescriptionSummaryV1(session.structure, null, session.structure.sport, this.locale),
  })));
}
