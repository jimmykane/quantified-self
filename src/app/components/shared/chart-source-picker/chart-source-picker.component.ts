import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ChartSourceChoice } from '../../../helpers/chart-source.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';

@Component({
  selector: 'app-chart-source-picker', standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './chart-source-picker.component.html', styleUrl: './chart-source-picker.component.scss',
  host: { '[class.chart-source-picker-compact]': 'compact()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartSourcePickerComponent {
  readonly choices = input.required<readonly ChartSourceChoice[]>();
  readonly selectedKey = input<string | null>(null);
  readonly chartTitle = input.required<string>();
  readonly disabled = input(false);
  readonly compact = input(false);
  readonly selected = output<string>();
  private readonly haptics = inject(AppHapticsService);
  private readonly trigger = viewChild<MatMenuTrigger>('sourceTrigger');
  private readonly measurementTrigger = viewChild<MatMenuTrigger>('measurementTrigger');
  readonly choice = computed(() => this.choices().find(choice => choice.key === this.selectedKey()) || null);
  readonly methodLabel = computed(() => this.choice()?.readingKey === 'daytime' && this.choice()?.readingMethod === 'Calculated by QS'
    ? 'Daily average · Calculated by QS' : this.choice()?.readingMethod);
  readonly measurements = computed(() => [...new Map(this.choices().filter(choice => choice.readingKey).map(choice =>
    [choice.readingKey!, { key: choice.readingKey!, label: choice.readingLabel!, order: choice.readingOrder ?? 99, secondary: !!choice.secondaryMeasurement }])).values()]
    .sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order)));
  readonly primaryMeasurements = computed(() => this.measurements().some(reading => !reading.secondary)
    ? this.measurements().filter(reading => !reading.secondary) : this.measurements());
  readonly secondaryMeasurements = computed(() => this.measurements().some(reading => !reading.secondary)
    ? this.measurements().filter(reading => reading.secondary) : []);
  readonly sourceChoices = computed(() => this.measurements().length
    ? this.choices().filter(choice => choice.readingKey === this.choice()?.readingKey) : this.choices());
  readonly label = computed(() => (this.choice()?.readingKey ? this.choice()?.sourceLabel : this.choice()?.shortLabel)
    || (this.selectedKey() ? 'Source unavailable' : 'Choose source'));
  readonly canChoose = computed(() => this.sourceChoices().length > 1 || this.sourceChoices().length === 1 && !this.choice());
  readonly description = computed(() => this.choice()?.label || (this.selectedKey()
    ? 'The selected reading has no data in this period.' : 'Choose a source and reading.'));
  readonly ariaLabel = computed(() => `${this.chartTitle()} source: ${this.description()}${this.canChoose() ? this.measurements().length ? ' Change source.' : ' Change source and reading.' : ''}`);
  constructor() {
    effect(() => {
      if (this.disabled() || !this.canChoose()) this.trigger()?.closeMenu();
      if (this.disabled() || !this.measurements().length || this.measurements().length === 1 && this.choice()) this.measurementTrigger()?.closeMenu();
    });
  }
  opened(): void { this.haptics.selection(); }
  chooseMeasurement(readingKey: string): void {
    if (this.disabled() || this.choice()?.readingKey === readingKey) return;
    const choices = this.choices().filter(choice => choice.readingKey === readingKey);
    const next = choices.find(choice => choice.sourceLabel === this.choice()?.sourceLabel) || choices[0];
    if (next) this.selected.emit(next.key);
  }
  choose(key: string): void {
    if (this.disabled() || key === this.selectedKey() || !this.sourceChoices().some(choice => choice.key === key)) return;
    // The owning chart validates and applies the change, including its feedback.
    this.selected.emit(key);
  }
}
