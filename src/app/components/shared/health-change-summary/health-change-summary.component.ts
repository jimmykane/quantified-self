import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildHealthChangeSummary, type HealthChangeSignal } from '../../../helpers/health-change-summary.helper';

@Component({
  selector: 'app-health-change-summary', standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './health-change-summary.component.html',
  styleUrls: ['./health-change-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthChangeSummaryComponent {
  readonly signals = input.required<readonly HealthChangeSignal[]>();
  readonly summaryId = input.required<string>();
  /** Clear private disclosure state when the account or overview scope changes. */
  readonly scopeKey = input.required<string>();
  readonly expanded = signal(false);
  readonly summary = computed(() => buildHealthChangeSummary(this.signals()));
  private readonly haptics = inject(AppHapticsService);

  constructor() {
    effect(() => { this.scopeKey(); this.expanded.set(false); });
  }

  toggleDetails(): void {
    this.haptics.selection();
    this.expanded.update(expanded => !expanded);
  }
}
