import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MetricIndicatorVariant = 'score' | 'deviation' | 'segments' | 'status';
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
  @Input() total = 4;
  @Input() label = 'Metric';
  @Input() tone: MetricIndicatorTone = 'neutral';
  @Input() compact = false;
  @Input() showThresholds = false;

  protected normalizedPercent = 0;
  protected deviationPercent = 0;
  protected deviationStartsAt = 50;
  protected segmentStates: boolean[] = [];
  protected accessibleValueText = 'Unavailable';

  ngOnChanges(): void {
    const finiteValue = Number.isFinite(this.value) ? Number(this.value) : null;
    const finiteMin = Number.isFinite(this.min) ? this.min : 0;
    const finiteMax = Number.isFinite(this.max) && this.max > finiteMin ? this.max : finiteMin + 1;
    const boundedValue = finiteValue === null ? finiteMin : Math.min(finiteMax, Math.max(finiteMin, finiteValue));
    this.normalizedPercent = ((boundedValue - finiteMin) / (finiteMax - finiteMin)) * 100;

    const boundedDeviation = finiteValue === null ? 0 : Math.min(20, Math.max(-20, finiteValue));
    this.deviationPercent = (Math.abs(boundedDeviation) / 20) * 50;
    this.deviationStartsAt = boundedDeviation < 0 ? 50 - this.deviationPercent : 50;

    const total = Math.max(1, Math.round(Number.isFinite(this.total) ? this.total : 4));
    const active = finiteValue === null ? 0 : Math.min(total, Math.max(0, Math.round(finiteValue)));
    this.segmentStates = Array.from({ length: total }, (_, index) => index < active);
    this.accessibleValueText = finiteValue === null
      ? `${this.label} unavailable`
      : this.variant === 'segments'
        ? `${this.label}: ${active} of ${total}`
        : this.variant === 'deviation'
          ? `${this.label}: ${finiteValue > 0 ? '+' : ''}${finiteValue.toFixed(0)} percent versus baseline`
          : `${this.label}: ${finiteValue.toFixed(0)} of ${finiteMax.toFixed(0)}`;
  }
}
