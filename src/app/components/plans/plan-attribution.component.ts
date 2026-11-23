import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PlanAttribution } from '@shared/training-plan-templates';

@Component({
  selector: 'app-plan-attribution',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (credit(); as source) {
      <section aria-label="Plan attribution">
        <p><a [href]="source.sourceUrl">{{ source.title }}</a> by {{ source.creator }} ·
          <a [href]="source.licenseUrl" rel="license">{{ source.license }}</a></p>
        <p>{{ source.changes }}</p>
        @if (source.privateCopy) { <p>This copy was saved from a personal schedule and may include the athlete’s changes.</p> }
        <p><strong>Publisher’s note</strong> · {{ source.notice }}</p>
      </section>
    }
  `,
})
export class PlanAttributionComponent {
  readonly credit = input<PlanAttribution | null | undefined>(null);
}
