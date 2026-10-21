import { ChangeDetectionStrategy, Component, DestroyRef, TemplateRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSelectionListChange } from '@angular/material/list';
import { take } from 'rxjs';
import { MaterialModule } from '../../../modules/material.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { ActivityTypeIconComponent } from '../../activity-type-icon/activity-type-icon.component';

export interface ActivityFilterPickerOption {
  value: string;
  label: string;
  activityType?: string;
  icon?: string;
}

export interface ActivityFilterPickerShortcut {
  label: string;
  values: readonly string[];
}

@Component({
  selector: 'app-activity-filter-picker',
  standalone: true,
  imports: [MaterialModule, ActivityTypeIconComponent],
  templateUrl: './activity-filter-picker.component.html',
  styleUrl: './activity-filter-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityFilterPickerComponent {
  readonly label = input.required<string>();
  readonly allLabel = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly options = input.required<readonly ActivityFilterPickerOption[]>();
  readonly selectedValues = input<readonly string[]>([]);
  readonly shortcuts = input<readonly ActivityFilterPickerShortcut[]>([]);
  readonly loading = input(false);
  // The filter owner validates the selection and owns its accepted-action feedback.
  readonly selectionChange = output<string[]>();
  readonly search = signal('');
  readonly pickerOpen = signal(false);
  readonly summary = computed(() => this.selectedValues().length === 0 ? this.allLabel()
    : this.selectedValues().length === 1
      ? this.options().find(option => option.value === this.selectedValues()[0])?.label || this.selectedValues()[0]
      : `${this.selectedValues().length} selected`);
  readonly selectedLabels = computed(() => this.options().filter(option => this.selectedValues().includes(option.value)).map(option => option.label).join(', '));
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
      return { ...shortcut, selected: count === shortcut.values.length, partial: count > 0 && count < shortcut.values.length };
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
    if (this.dialogRef) return;
    this.search.set('');
    this.dialogRef = this.dialog.open(this.picker(), {
      width: '420px', maxWidth: 'calc(100vw - 32px)', ariaLabel: `Choose ${this.label().toLowerCase()}`,
    });
    this.dialogId = this.dialogRef.id;
    this.pickerOpen.set(true);
    this.haptics.selection();
    this.dialogRef.afterClosed().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dialogRef = undefined;
      this.pickerOpen.set(false);
    });
  }

  changeSelection(event: MatSelectionListChange): void {
    const selected = new Set(this.selectedValues());
    for (const option of event.options) {
      if (option.selected) selected.add(option.value);
      else selected.delete(option.value);
    }
    this.selectionChange.emit([...selected]);
  }

  toggleShortcut(shortcut: ActivityFilterPickerShortcut, checked: boolean): void {
    const selected = new Set(this.selectedValues());
    for (const value of shortcut.values) {
      if (checked) selected.add(value);
      else selected.delete(value);
    }
    this.selectionChange.emit([...selected]);
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
