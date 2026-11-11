import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AppHapticsService } from '../../../services/app.haptics.service';

export interface CompactSelectOption<T extends string | null = string | null> { value: T; label: string; disabled?: boolean }

@Component({ selector: 'app-compact-select', standalone: true, imports: [MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './compact-select.component.html', styleUrl: './compact-select.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class CompactSelectComponent<T extends string | null = string | null> {
  readonly label = input.required<string>();
  readonly hideLabel = input(false);
  readonly value = input.required<T>();
  readonly options = input.required<readonly CompactSelectOption<T>[]>();
  readonly disabled = input(false);
  readonly selectionChange = output<T>();
  private readonly haptics = inject(AppHapticsService);
  readonly selectedLabel = computed(() => this.options().find(option => option.value === this.value())?.label ?? 'Choose');
  opened(): void { if (!this.disabled()) this.haptics.selection(); }
  select(value: T): void {
    if (this.disabled() || value === this.value() || !this.options().some(option => option.value === value && !option.disabled)) return;
    // The caller commits the choice and owns accepted-change feedback.
    this.selectionChange.emit(value);
  }
}
