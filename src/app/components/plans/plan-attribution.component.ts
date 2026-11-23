import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PlanAttribution } from '@shared/training-plan-templates';

@Component({
  selector: 'app-plan-attribution',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host(.catalog-credit) {
      display: block;
      padding-block-start: 0.5rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    :host(.catalog-credit) p { max-width: 80ch; margin-block: 0.5rem; }
    :host(.catalog-credit) a { color: var(--mat-sys-on-surface); }
  `],
  template: `
    @if (credit(); as source) {
      <section aria-label="Plan attribution">
        <p><a [href]="source.sourceUrl">{{ source.title }}</a> by {{ source.originalAuthor }} ·
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
