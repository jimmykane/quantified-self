import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { AppUserService } from '../../../services/app.user.service';
import { buildDashboardDailyBriefing } from '../../../helpers/dashboard-daily-briefing.helper';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import { MatButtonModule } from '@angular/material/button';
import { AppHapticsService } from '../../../services/app.haptics.service';

/** Owner-only presentation of already-loaded Today assessments; no independent readers or clock. */
@Component({
  selector: 'app-dashboard-daily-briefing', standalone: true, imports: [MatButtonModule],
  templateUrl: './dashboard-daily-briefing.component.html', styleUrl: './dashboard-daily-briefing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardDailyBriefingComponent {
  readonly user = input.required<AppUserInterface>();
  readonly signals = input.required<readonly HealthChangeSignal[]>();
  readonly greeting = input('');
  readonly detailsExpanded = input(true);
  readonly detailsId = input('dashboard-today-details');
  readonly detailsToggle = output<void>();
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  readonly owner = computed(() => this.user()?.uid && this.users.user()?.uid === this.user().uid ? this.user().uid : null);
  readonly briefing = computed(() => buildDashboardDailyBriefing(this.signals()));
  readonly sentenceParts = computed(() => this.briefing().parts.map((part, index) => this.greeting() && index === 0
    ? { ...part, text: part.text.charAt(0).toLowerCase() + part.text.slice(1) } : part));
  readonly sentence = computed(() => this.sentenceParts().map(part => part.text).join(''));
  readonly fullSentence = computed(() => this.greeting() ? `${this.greeting()} — ${this.sentence()}` : this.sentence());

  toggleDetails(): void {
    if (!this.owner()) return;
    this.haptics.selection();
    this.detailsToggle.emit();
  }
}
