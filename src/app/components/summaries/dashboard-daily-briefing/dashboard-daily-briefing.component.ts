import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { AppUserService } from '../../../services/app.user.service';
import { buildDashboardDailyBriefing } from '../../../helpers/dashboard-daily-briefing.helper';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import { SummaryDisclosureComponent } from '../../shared/summary-disclosure/summary-disclosure.component';

/** Owner-only presentation of already-loaded Today assessments; no independent readers or clock. */
@Component({
  selector: 'app-dashboard-daily-briefing', standalone: true, imports: [SummaryDisclosureComponent],
  templateUrl: './dashboard-daily-briefing.component.html', styleUrl: './dashboard-daily-briefing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardDailyBriefingComponent {
  readonly user = input.required<AppUserInterface>();
  readonly signals = input.required<readonly HealthChangeSignal[]>();
  private readonly users = inject(AppUserService);
  readonly owner = computed(() => this.user()?.uid && this.users.user()?.uid === this.user().uid ? this.user().uid : null);
  readonly briefing = computed(() => buildDashboardDailyBriefing(this.signals()));
}
