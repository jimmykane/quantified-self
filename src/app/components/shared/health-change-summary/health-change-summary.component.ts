import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildDashboardGlanceSummary, buildHealthChangeSummary, type HealthChangeSignal } from '../../../helpers/health-change-summary.helper';

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
  /** Dashboard keeps ordinary days to one sentence; Health retains its full overview. */
  readonly compact = input(false);
  /** Clear private disclosure state when the account or overview scope changes. */
  readonly scopeKey = input.required<string>();
  readonly expanded = signal(false);
  readonly summary = computed(() => buildHealthChangeSummary(this.signals()));
  readonly glance = computed(() => buildDashboardGlanceSummary(this.signals()));
  readonly glanceIcon = computed(() => {
    switch (this.glance().state) {
      case 'within-range': return 'check_circle_outline';
      case 'outside-range': return 'error_outline';
      case 'unavailable': return 'cloud_off';
      case 'loading': return 'hourglass_empty';
      default: return 'info_outline';
    }
  });
  readonly detailsAvailable = computed(() => !this.compact() || this.glance().attentionSignals.length > 0);
  readonly detailSignals = computed(() => this.compact() ? this.glance().attentionSignals : this.signals());
  private readonly haptics = inject(AppHapticsService);

  constructor() {
    effect(() => {
      this.scopeKey();
      this.compact();
      this.detailsAvailable();
      this.expanded.set(false);
    });
  }

  toggleDetails(): void {
    if (!this.detailsAvailable()) return;
    this.haptics.selection();
    this.expanded.update(expanded => !expanded);
  }
}
