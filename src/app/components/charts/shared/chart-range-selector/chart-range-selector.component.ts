import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface ChartRangeSelectorOption {
  value: string;
  label: string;
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
    return this.options.find(option => option.value === this.value)?.label || this.options[0]?.label || '';
  }

  selectValue(nextValue: string): void {
    if (this.disabled || nextValue === this.value) {
      return;
    }
    this.valueChange.emit(nextValue);
  }
}
