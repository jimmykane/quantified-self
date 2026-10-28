import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MetricIndicatorVariant = 'score' | 'deviation' | 'range' | 'segments' | 'status';
export type MetricIndicatorTone = 'positive' | 'negative' | 'neutral' | 'ready' | 'mixed' | 'recover';

@Component({
  selector: 'app-metric-indicator',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metric-indicator.component.html',
  styleUrl: './metric-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricIndicatorComponent implements OnChanges {
  @Input() variant: MetricIndicatorVariant = 'score';
  @Input() value: number | null = null;
  @Input() min = 0;
  @Input() max = 100;
  @Input() rangeMin: number | null = null;
  @Input() rangeMax: number | null = null;
  @Input() total = 4;
  @Input() label = 'Metric';
  @Input() valueText: string | null = null;
  @Input() rangeText: string | null = null;
  @Input() tone: MetricIndicatorTone = 'neutral';
  @Input() compact = false;
  @Input() showThresholds = false;

  protected normalizedPercent = 0;
  protected boundedDeviation: number | null = null;
  protected deviationPercent = 0;
  protected deviationStartsAt = 50;
  protected rangeStartPercent = 0;
  protected rangeWidthPercent = 0;
  protected rangeMarkerPercent = 0;
  protected hasRange = false;
  protected hasFiniteValue = false;
  protected segmentStates: boolean[] = [];
  protected accessibleValueText = 'Unavailable';

  ngOnChanges(): void {
    const finiteValue = Number.isFinite(this.value) ? Number(this.value) : null;
    const finiteMin = Number.isFinite(this.min) ? this.min : 0;
    const finiteMax = Number.isFinite(this.max) && this.max > finiteMin ? this.max : finiteMin + 1;
    const boundedValue = finiteValue === null ? finiteMin : Math.min(finiteMax, Math.max(finiteMin, finiteValue));
    this.hasFiniteValue = finiteValue !== null;
    this.normalizedPercent = ((boundedValue - finiteMin) / (finiteMax - finiteMin)) * 100;

    const finiteRangeMin = Number.isFinite(this.rangeMin) ? Number(this.rangeMin) : null;
    const finiteRangeMax = Number.isFinite(this.rangeMax) ? Number(this.rangeMax) : null;
    const hasRange = finiteRangeMin !== null && finiteRangeMax !== null && finiteRangeMax > finiteRangeMin;
    this.hasRange = hasRange;
    const boundedRangeMin = hasRange ? Math.min(finiteMax, Math.max(finiteMin, finiteRangeMin)) : finiteMin;
    const boundedRangeMax = hasRange ? Math.min(finiteMax, Math.max(finiteMin, finiteRangeMax)) : finiteMin;
    this.rangeStartPercent = ((boundedRangeMin - finiteMin) / (finiteMax - finiteMin)) * 100;
    this.rangeWidthPercent = ((boundedRangeMax - boundedRangeMin) / (finiteMax - finiteMin)) * 100;
    this.rangeMarkerPercent = this.normalizedPercent;
    const accessibleRangeText = this.rangeText || (hasRange
      ? `personal range ${finiteRangeMin.toFixed(0)} to ${finiteRangeMax.toFixed(0)}`
      : 'personal range unavailable');

    this.boundedDeviation = finiteValue === null ? null : Math.min(20, Math.max(-20, finiteValue));
    const displayedDeviation = this.boundedDeviation ?? 0;
    this.deviationPercent = (Math.abs(displayedDeviation) / 20) * 50;
    this.deviationStartsAt = displayedDeviation < 0 ? 50 - this.deviationPercent : 50;

    const total = Math.max(1, Math.round(Number.isFinite(this.total) ? this.total : 4));
    const active = finiteValue === null ? 0 : Math.min(total, Math.max(0, Math.round(finiteValue)));
    this.segmentStates = Array.from({ length: total }, (_, index) => index < active);
    this.accessibleValueText = finiteValue === null
      ? `${this.label} unavailable`
      : this.variant === 'segments'
        ? `${this.label}: ${active} of ${total}`
        : this.variant === 'deviation'
          ? `${this.label}: ${displayedDeviation > 0 ? '+' : ''}${displayedDeviation.toFixed(0)} percent versus baseline`
          : this.variant === 'range'
            ? `${this.label}: ${this.valueText || finiteValue.toFixed(0)}; ${accessibleRangeText}`
          : `${this.label}: ${finiteValue.toFixed(0)} of ${finiteMax.toFixed(0)}`;
  }
}
