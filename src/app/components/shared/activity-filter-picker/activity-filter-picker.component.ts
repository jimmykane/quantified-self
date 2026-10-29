import { ChangeDetectionStrategy, Component, DestroyRef, TemplateRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatListModule, MatSelectionListChange } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { take } from 'rxjs';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { ActivityTypeIconComponent } from '../../activity-type-icon/activity-type-icon.component';

export interface ActivityFilterPickerOption {
  value: string;
  label: string;
  activityType?: string;
  icon?: string;
  disabled?: boolean;
  description?: string;
}

export interface ActivityFilterPickerShortcut {
  label: string;
  values: readonly string[];
}

@Component({
  selector: 'app-activity-filter-picker',
  standalone: true,
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatDividerModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatListModule, MatTooltipModule, ActivityTypeIconComponent],
  templateUrl: './activity-filter-picker.component.html',
  styleUrl: './activity-filter-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-text-button]': 'textButton()' },
})
export class ActivityFilterPickerComponent {
  readonly label = input.required<string>();
  readonly allLabel = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly options = input.required<readonly ActivityFilterPickerOption[]>();
  readonly multiple = input(true);
  readonly selectedValues = input<readonly string[]>([]);
  readonly shortcuts = input<readonly ActivityFilterPickerShortcut[]>([]);
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly compact = input(false);
  readonly textButton = input(false);
  readonly triggerIcon = input('filter_list');
  readonly triggerLabel = input<string>();
  readonly hint = input('');
  readonly canClear = computed(() => this.selectedValues().some(value => !this.options().find(option => option.value === value)?.disabled));
  readonly accessibleTriggerLabel = computed(() => `${this.triggerLabel() || this.label()}: ${this.summary()}`);
  // The owner validates the selection and owns its accepted-action feedback.
  readonly selectionChange = output<string[]>();
  readonly opened = output<void>();
  readonly search = signal('');
  readonly pickerOpen = signal(false);
  readonly summary = computed(() => this.selectedValues().length === 0 ? this.allLabel()
    : this.selectedValues().length === 1
      ? this.options().find(option => option.value === this.selectedValues()[0])?.label || this.selectedValues()[0]
      : `${this.selectedValues().length} selected`);
  readonly selectedLabels = computed(() => this.options().filter(option => this.selectedValues().includes(option.value)).map(option => option.label).join(', '));
  readonly textSummary = computed(() => this.selectedValues().length > 1 ? `${this.selectedValues().length} ${this.label().toLowerCase()}` : this.summary());
  readonly selectedSport = computed(() => this.options().find(option => this.selectedValues().includes(option.value) && option.activityType)?.activityType);
  readonly visibleOptions = computed(() => {
    const search = this.search().trim().toLowerCase();
    const selected = new Set(this.selectedValues());
    return this.options().filter(option => option.label.toLowerCase().includes(search))
      .map(option => ({ ...option, selected: selected.has(option.value) }));
  });
  readonly visibleShortcuts = computed(() => {
    const search = this.search().trim().toLowerCase();
    const selected = new Set(this.selectedValues());
    return this.shortcuts().filter(shortcut => shortcut.label.toLowerCase().includes(search)).map(shortcut => {
      const count = shortcut.values.filter(value => selected.has(value)).length;
      return { ...shortcut, selected: count === shortcut.values.length, partial: count > 0 && count < shortcut.values.length,
        disabled: !shortcut.values.some(value => !this.options().find(option => option.value === value)?.disabled) };
    });
  });
  private readonly dialog = inject(MatDialog);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly picker = viewChild.required<TemplateRef<unknown>>('picker');
  private dialogRef?: MatDialogRef<unknown>;
  dialogId?: string;

  constructor() {
    this.destroyRef.onDestroy(() => this.dialogRef?.close());
  }

  openPicker(event?: Event): void {
    event?.preventDefault();
    if (this.disabled() || this.dialogRef) return;
    this.search.set('');
    this.dialogRef = this.dialog.open(this.picker(), {
      width: '420px', maxWidth: 'calc(100vw - 32px)', ariaLabel: `Choose ${this.label().toLowerCase()}`,
    });
    this.dialogId = this.dialogRef.id;
    this.pickerOpen.set(true);
    this.opened.emit();
    this.haptics.selection();
    this.dialogRef.afterClosed().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dialogRef = undefined;
      this.pickerOpen.set(false);
    });
  }

  changeSelection(event: MatSelectionListChange): void {
    if (!this.multiple()) {
      const option = event.options.find(item => item.selected && !item.disabled);
      if (this.disabled() || !option || !this.options().some(choice => choice.value === option.value && !choice.disabled)) return;
      if (this.selectedValues().length !== 1 || this.selectedValues()[0] !== option.value) this.selectionChange.emit([option.value]);
      this.dialogRef?.close();
      return;
    }
    const selected = new Set(this.selectedValues());
    for (const option of event.options) {
      if (option.selected) selected.add(option.value);
      else selected.delete(option.value);
    }
    this.emitSelection([...selected]);
  }

  toggleShortcut(shortcut: ActivityFilterPickerShortcut, checked: boolean): void {
    if (!this.multiple()) return;
    const selected = new Set(this.selectedValues());
    for (const value of shortcut.values) {
      if (checked) selected.add(value);
      else selected.delete(value);
    }
    this.emitSelection([...selected]);
  }

  clearSelection(): void {
    if (this.multiple()) this.emitSelection([]);
  }

  private emitSelection(values: readonly string[]): void {
    if (this.disabled()) return;
    const current = new Set(this.selectedValues());
    const next = new Set(values);
    for (const option of this.options()) {
      if (!option.disabled) continue;
      if (current.has(option.value)) next.add(option.value);
      else next.delete(option.value);
    }
    if (next.size === current.size && [...next].every(value => current.has(value))) return;
    this.selectionChange.emit([...next]);
  }

  clearSearch(input: HTMLInputElement): void {
    if (!this.search()) return;
    this.search.set('');
    input.focus();
    this.haptics.selection();
  }

  closePicker(): void {
    this.haptics.selection();
    this.dialogRef?.close();
  }
}
