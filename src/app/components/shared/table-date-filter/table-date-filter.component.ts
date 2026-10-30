import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule, MatDateRangePicker } from '@angular/material/datepicker';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Dayjs } from 'dayjs';
import { AppHapticsService } from '../../../services/app.haptics.service';

export interface TableDateFilterOption<T extends string | number = string | number> {
  value: T;
  label: string;
}

@Component({
  selector: 'app-table-date-filter',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatDatepickerModule, MatDividerModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './table-date-filter.component.html',
  styleUrl: './table-date-filter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableDateFilterComponent<T extends string | number = string | number> {
  readonly options = input.required<readonly TableDateFilterOption<T>[]>();
  readonly value = input.required<T>();
  readonly customValue = input.required<T>();
  readonly allValue = input.required<T>();
  readonly rangeForm = input.required<FormGroup>();
  readonly startControlName = input('start');
  readonly endControlName = input('end');
  readonly startDate = input<Date | string | null>(null);
  readonly endDate = input<Date | string | null>(null);
  readonly disabled = input(false);
  readonly invalidRangeMessage = input('Choose valid start and end dates.');
  readonly selectionChange = output<T>();
  readonly applied = output<void>();
  readonly cancelled = output<void>();
  readonly cleared = output<void>();
  readonly calendarOpened = output<void>();
  readonly menuOpen = signal(false);
  readonly invalidRange = signal(false);
  readonly customSelected = computed(() => this.value() === this.customValue());
  readonly rangeLabel = computed(() => {
    const start = this.adapter.deserialize(this.startDate());
    const end = this.adapter.deserialize(this.endDate());
    if (!start || !end || !this.adapter.isValid(start) || !this.adapter.isValid(end)) return '';
    const sameYear = this.adapter.getYear(start) === this.adapter.getYear(end);
    const sameMonth = sameYear && this.adapter.getMonth(start) === this.adapter.getMonth(end);
    return `${this.adapter.format(start, sameMonth ? 'D' : sameYear ? 'D MMM' : 'D MMM YYYY')}${sameMonth ? '–' : ' – '}${this.adapter.format(end, 'D MMM YYYY')}`;
  });
  readonly label = computed(() => this.customSelected() && this.rangeLabel()
    ? this.rangeLabel() : this.options().find(option => option.value === this.value())?.label || 'Date range');
  private readonly adapter = inject<DateAdapter<Dayjs>>(DateAdapter);
  private readonly haptics = inject(AppHapticsService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild.required<MatMenuTrigger>('rangeTrigger');
  private readonly picker = viewChild.required<MatDateRangePicker<Dayjs>>('picker');
  private pendingChoice?: T;
  private applyClicked = false;

  open(): void {
    if (this.disabled() || this.pendingChoice !== undefined || this.trigger().menuOpen || this.picker().opened) return;
    this.focus();
    this.trigger().openMenu();
  }

  focus(): void { this.trigger().focus(); }

  onMenuOpened(): void { this.menuOpen.set(true); this.haptics.selection(); }

  choose(value: T): void {
    if (this.disabled()) return;
    this.invalidRange.set(false);
    this.pendingChoice = value;
  }

  onMenuClosed(): void {
    this.menuOpen.set(false);
    if (this.pendingChoice === undefined) return;
    // Let the menu restore focus before a selection can open a dialog. Dialogs must
    // remember this persistent button, rather than a menu item that is being removed.
    afterNextRender(() => {
      const value = this.pendingChoice;
      this.pendingChoice = undefined;
      if (value === undefined || this.destroyRef.destroyed || this.disabled()) return;
      this.selectionChange.emit(value);
      if (value !== this.customValue()) return;
      this.applyClicked = false;
      this.picker().open();
    }, { injector: this.injector });
  }

  apply(): void {
    this.applyClicked = true;
    const form = this.rangeForm();
    form.markAllAsTouched();
    const start = this.adapter.deserialize(form.get(this.startControlName())?.value);
    const end = this.adapter.deserialize(form.get(this.endControlName())?.value);
    const invalid = form.invalid || !start || !end || !this.adapter.isValid(start) || !this.adapter.isValid(end);
    this.invalidRange.set(!!invalid);
    if (!invalid && !this.disabled()) this.applied.emit();
  }

  onCalendarClosed(): void {
    if (this.destroyRef.destroyed) return;
    // Material's Apply directive closes before the button's click handler runs.
    afterNextRender(() => {
      if (this.destroyRef.destroyed) return;
      if (!this.applyClicked) { this.invalidRange.set(false); this.cancelled.emit(); }
      this.focus();
    }, { injector: this.injector });
  }

  clear(): void {
    if (this.disabled()) return;
    this.invalidRange.set(false);
    this.cleared.emit();
    this.focus();
  }
}
