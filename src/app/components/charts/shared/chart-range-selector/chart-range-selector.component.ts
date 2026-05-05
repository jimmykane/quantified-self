import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface ChartRangeSelectorOption {
  value: string;
  label: string;
  shortLabel?: string;
  menuLabel?: string;
}

@Component({
  selector: 'app-chart-range-selector',
  templateUrl: './chart-range-selector.component.html',
  styleUrls: ['./chart-range-selector.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartRangeSelectorComponent {
  @Input() options: ReadonlyArray<ChartRangeSelectorOption> = [];
  @Input() value: string | null | undefined;
  @Input() ariaLabel = 'Select chart range';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  get selectedLabel(): string {
    return this.selectedOption?.label || '';
  }

  get selectedShortLabel(): string {
    return this.selectedOption?.shortLabel || this.selectedOption?.label || '';
  }

  get hasDistinctShortLabel(): boolean {
    return this.selectedShortLabel !== this.selectedLabel;
  }

  get selectedAriaLabel(): string {
    const selectedMenuLabel = this.selectedOption?.menuLabel || this.selectedOption?.label || '';
    return selectedMenuLabel ? `${this.ariaLabel}: ${selectedMenuLabel}` : this.ariaLabel;
  }

  get selectedValue(): string | null {
    return this.selectedOption?.value || null;
  }

  private get selectedOption(): ChartRangeSelectorOption | undefined {
    return this.options.find(option => option.value === this.value) || this.options[0];
  }

  selectValue(nextValue: string): void {
    if (this.disabled || nextValue === this.selectedValue) {
      return;
    }
    this.valueChange.emit(nextValue);
  }
}
