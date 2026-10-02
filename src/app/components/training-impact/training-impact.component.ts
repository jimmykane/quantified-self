import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, linkedSignal } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import { getDateTimeFormatter } from '../../helpers/date-time-format.helper';
import { getNumberFormatter } from '../../helpers/number-format.helper';
import {
  trainingDayOutcomeHeadline,
  type TrainingDayImpactView,
  type TrainingSessionImpactView,
} from '../../helpers/training-impact.helper';

export type TrainingImpactVariant = 'card' | 'summary' | 'compact' | 'strip';

let nextCalculationDetailsId = 0;

@Component({
  selector: 'app-training-impact',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './training-impact.component.html',
  styleUrls: ['./training-impact.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.training-impact-host--strip]': "variant() === 'strip'" },
})
export class TrainingImpactComponent {
  private readonly locale = inject(LOCALE_ID);
  readonly impact = input.required<TrainingSessionImpactView | TrainingDayImpactView>();
  readonly variant = input<TrainingImpactVariant>('card');
  readonly title = input('Training impact');
  readonly modelExplanation = 'TSS-based model; CTL reflects sustained training load, not measured physiological adaptation.';
  readonly isReady = computed(() => this.impact().availability === 'ready');
  readonly isDayImpact = computed(() => 'sessions' in this.impact());
  readonly isSessionStrip = computed(() => this.variant() === 'strip' && !this.isDayImpact());
  readonly calculationDetailsId = `training-impact-calculation-${nextCalculationDetailsId++}`;
  readonly calculationToggleId = `${this.calculationDetailsId}-toggle`;
  private readonly calculationContext = computed(() => {
    const impact = this.impact();
    return this.isSessionStrip() && impact.availability === 'ready' && 'eventId' in impact
      ? `${impact.eventId}:${impact.dayMs}` : null;
  });
  readonly calculationExpanded = linkedSignal({ source: this.calculationContext, computation: () => false });
  readonly sessionDayResult = computed(() => {
    const impact = this.impact();
    if (impact.availability !== 'ready' || 'sessions' in impact || !impact.impact) return null;
    const change = impact.impact.day.ctlChange;
    if (Math.abs(change) < 0.005) return 'Fitness load stayed steady';
    return `Fitness load ${change > 0 ? 'increased' : 'decreased'} by ${this.formatNumber(Math.abs(change))} CTL`;
  });
  readonly compactText = computed(() => {
    const impact = this.impact();
    if (impact.availability !== 'ready') return impact.message;
    const values = this.values();
    return `${values.ctl} CTL · ${values.atl} ATL · ${values.form} Form`;
  });
  readonly compactAriaLabel = computed(() => {
    const impact = this.impact();
    if (impact.availability !== 'ready') return impact.message;
    const values = this.values();
    return [
      impact.headline,
      `Fitness load (CTL) ${values.ctl}`,
      `Fatigue load (ATL) ${values.atl}`,
      `Freshness (Form) ${values.form}`,
      ...('sessions' in impact ? this.outcomes().map(outcome => (
        `${outcome.date}: ${outcome.headline}, ${outcome.ctlChange} CTL`
      )) : []),
    ].filter(Boolean).join('. ');
  });
  readonly values = computed(() => {
    const impact = this.impact();
    if ('sessions' in impact) {
      return {
        tss: this.formatNumber(impact.trainingStressScore),
        ctl: this.formatSigned(impact.ctlContribution),
        atl: this.formatSigned(impact.atlContribution),
        form: this.formatSigned(impact.formContribution),
      };
    }
    const values = impact.impact;
    return {
      tss: values ? this.formatNumber(values.trainingStressScore) : '—',
      ctl: values ? this.formatSigned(values.ctlContribution) : '—',
      atl: values ? this.formatSigned(values.atlContribution) : '—',
      form: values ? this.formatSigned(values.formContribution) : '—',
    };
  });
  readonly outcomes = computed(() => {
    const impact = this.impact();
    const outcomes = 'sessions' in impact
      ? impact.outcomes
      : impact.impact ? [impact.impact.day] : [];
    return outcomes.map(day => ({
      dayMs: day.dayMs,
      date: getDateTimeFormatter(this.locale, {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      }).format(day.dayMs),
      headline: trainingDayOutcomeHeadline(day),
      ctlChange: this.formatSigned(day.ctlChange),
    }));
  });

  toggleCalculation(): void {
    this.calculationExpanded.update(expanded => !expanded);
  }

  private formatSigned(value: number): string {
    const normalized = Math.abs(value) < 0.005 ? 0 : value;
    if (normalized === 0) return this.formatNumber(0);
    return `${normalized > 0 ? '+' : '−'}${this.formatNumber(Math.abs(normalized))}`;
  }

  private formatNumber(value: number): string {
    return getNumberFormatter(this.locale, { maximumFractionDigits: 2 }).format(value);
  }
}
