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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartSourcePickerComponent {
  readonly choices = input.required<readonly ChartSourceChoice[]>();
  readonly selectedKey = input<string | null>(null);
  readonly chartTitle = input.required<string>();
  readonly disabled = input(false);
  readonly selected = output<string>();
  private readonly haptics = inject(AppHapticsService);
  private readonly trigger = viewChild(MatMenuTrigger);
  readonly choice = computed(() => this.choices().find(choice => choice.key === this.selectedKey()) || null);
  readonly label = computed(() => this.choice()?.shortLabel || (this.selectedKey() ? 'Source unavailable' : 'Choose source'));
  readonly canChoose = computed(() => this.choices().length > 1 || this.choices().length === 1 && !this.choice());
  readonly description = computed(() => this.choice()?.label || (this.selectedKey()
    ? 'The selected reading has no data in this period.' : 'Choose a source and reading.'));
  readonly ariaLabel = computed(() => `${this.chartTitle()} source: ${this.description()}${this.canChoose() ? ' Change source and reading.' : ''}`);
  constructor() {
    effect(() => { if (this.disabled() || !this.canChoose()) this.trigger()?.closeMenu(); });
  }
  opened(): void { this.haptics.selection(); }
  choose(key: string): void {
    if (this.disabled() || key === this.selectedKey() || !this.choices().some(choice => choice.key === key)) return;
    // The owning chart validates and applies the change, including its feedback.
    this.selected.emit(key);
  }
}
