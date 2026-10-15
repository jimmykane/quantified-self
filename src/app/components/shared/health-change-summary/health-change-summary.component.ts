import { ChangeDetectionStrategy, Component, computed, input, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { buildDashboardGlanceSummary, buildHealthChangeSummary, type HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import { SummaryDisclosureComponent, type SummaryDisclosureTone } from '../summary-disclosure/summary-disclosure.component';

@Component({
  selector: 'app-health-change-summary', standalone: true,
  imports: [MatIconModule, SummaryDisclosureComponent],
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
  readonly summary = computed(() => buildHealthChangeSummary(this.signals()));
  readonly glance = computed(() => buildDashboardGlanceSummary(this.signals()));
  readonly detailsAvailable = computed(() => !this.compact() || this.glance().attentionSignals.length > 0);
  readonly detailSignals = computed(() => this.compact() ? this.glance().attentionSignals : this.signals());
  readonly tone = computed<SummaryDisclosureTone>(() => {
    const state = this.glance().state;
    return state === 'within-range' || state === 'available' ? 'positive'
      : state === 'outside-range' || state === 'attention' ? 'caution'
      : state === 'unavailable' ? 'error' : 'neutral';
  });
  private readonly disclosure = viewChild(SummaryDisclosureComponent);
  readonly expanded = computed(() => this.disclosure()?.expanded() ?? false);

  toggleDetails(): void {
    this.disclosure()?.toggleDetails();
  }
}
