import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppHapticsService } from '../../../services/app.haptics.service';

export type SummaryDisclosureTone = 'neutral' | 'positive' | 'caution' | 'error';

/** Presentation only: callers own the meaning, evidence and tone of their summaries. */
@Component({
  selector: 'app-summary-disclosure', standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './summary-disclosure.component.html', styleUrl: './summary-disclosure.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryDisclosureComponent {
  readonly title = input.required<string>();
  readonly headingLevel = input<2 | 3 | 4>(2);
  readonly summaryId = input.required<string>();
  readonly scopeKey = input.required<string>();
  readonly headline = input<string | null>(null);
  readonly variant = input<'flat' | 'rail' | 'plain'>('flat');
  readonly tone = input<SummaryDisclosureTone>('neutral');
  readonly detailsAvailable = input(false);
  readonly expanded = signal(false);
  private readonly haptics = inject(AppHapticsService);
  constructor() {
    effect(() => {
      this.scopeKey(); this.variant(); this.detailsAvailable();
      this.expanded.set(false);
    });
  }
  toggleDetails(): void {
    if (!this.detailsAvailable()) return;
    this.expanded.update(expanded => !expanded);
    this.haptics.selection();
  }
}
