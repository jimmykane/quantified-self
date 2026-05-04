import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { AbstractControl, UntypedFormControl, UntypedFormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DateRanges } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppHapticsService } from '../../services/app.haptics.service';

interface DateRangeShortcutOption {
  ariaLabel: string;
  label: string;
  value: DateRanges;
}

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventSearchComponent extends LoadingAbstractDirective implements OnChanges, OnInit {
  @Input() selectedDateRange!: DateRanges;
  @Input() selectedStartDate!: Date;
  @Input() selectedEndDate!: Date;
  @Input() startOfTheWeek!: DaysOfTheWeek;
  @Input() selectedActivityTypes!: ActivityTypes[];
  @Input() showDatePicker = true;
  @Input() showActivityTypePicker = true;
  @Input() showMergedEventsToggle = false;
  @Input() includeMergedEvents = true;
  @Input() compact = false;
  @Input() toolbarRangeLayout = false;
  @Input() mergedEventsToggleDisabled = false;
  @Input() mergedEventsToggleLabel = 'Merged events';
  @Input() mergedEventsToggleHint = 'Merged events are excluded';
  @Input() dateRangesToShow: DateRanges[] = [
    DateRanges.thisWeek,
    DateRanges.lastWeek,
    DateRanges.lastSevenDays,
    DateRanges.lastThirtyDays,
    DateRanges.thisMonth,
    DateRanges.lastMonth,
    DateRanges.thisYear,
    DateRanges.lastYear,
    DateRanges.all,
    DateRanges.custom
  ];

  @Output() searchChange: EventEmitter<Search> = new EventEmitter<Search>();

  public searchFormGroup!: UntypedFormGroup;
  public dateRanges = DateRanges;
  public currentYear = new Date().getFullYear();
  public primaryToolbarDateRangeOptions: DateRangeShortcutOption[] = [];
  public secondaryToolbarDateRangeOptions: DateRangeShortcutOption[] = [];
  public secondaryDateRangeButtonLabel = 'More';
  constructor(
    changeDetector: ChangeDetectorRef,
    private dialog?: MatDialog,
    private hapticsService?: AppHapticsService,
  ) {
    super(changeDetector);
  }

  get startDateControl(): UntypedFormControl {
    return this.searchFormGroup.get('startDate') as UntypedFormControl;
  }

  get endDateControl(): UntypedFormControl {
    return this.searchFormGroup.get('endDate') as UntypedFormControl;
  }

  ngOnInit(): void {
    this.syncToolbarDateRangeOptions();
    const { startDate, endDate } = this.resolveCurrentRangeDates();
    this.searchFormGroup = new UntypedFormGroup({
      search: new UntypedFormControl(null, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      startDate: new UntypedFormControl(startDate, [
        // Validators.required,
      ]),
      endDate: new UntypedFormControl(endDate, [
        // Validators.required,
      ])
    }, {
      validators: [
        startDateToEndDateValidator,
        maxDateDistanceValidator,
      ],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedDateRange'] || changes['dateRangesToShow'] || changes['compact']) {
      this.syncToolbarDateRangeOptions();
    }

    if (!this.searchFormGroup) {
      return;
    }

    if (!changes['selectedDateRange']
      && !changes['selectedStartDate']
      && !changes['selectedEndDate']
      && !changes['startOfTheWeek']) {
      return;
    }

    const { startDate, endDate } = this.resolveCurrentRangeDates();
    this.startDateControl?.setValue(startDate, { emitEvent: false });
    this.endDateControl?.setValue(endDate, { emitEvent: false });
    this.searchFormGroup.updateValueAndValidity({ emitEvent: false });
  }


  hasError(field?: string) {
    if (!field) {
      return !this.searchFormGroup.valid;
    }
    const control = this.searchFormGroup.get(field);
    return !(control?.valid && control?.touched);
  }

  async search() {
    if (!this.searchFormGroup.valid) {
      this.validateAllFormFields(this.searchFormGroup);
      return;
    }

    const startDate = this.coerceDate(this.startDateControl.value);
    const endDate = this.coerceDate(this.endDateControl.value);

    this.selectedStartDate = startDate ? this.normalizeStartDate(startDate) : (null as any);
    this.selectedEndDate = endDate ? this.normalizeEndDate(endDate) : (null as any);

    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search')?.value,
      startDate: this.selectedStartDate,
      endDate: this.selectedEndDate,
      activityTypes: this.selectedActivityTypes,
      dateRange: this.selectedDateRange,
      includeMergedEvents: this.includeMergedEvents
    });
  }

  onSubmit(event) {
    event.preventDefault();
    this.selectedDateRange = this.dateRanges.custom;
    this.syncToolbarDateRangeOptions();
    this.search();
    this.searchFormGroup.markAsPristine();
  }

  async dateToggleChange(event: MatButtonToggleChange) {
    const nextRange = event.value ?? event.source?.value;
    return this.selectDateRange(nextRange);
  }

  async onSecondaryDateRangeSelection(dateRange: DateRanges) {
    return this.selectDateRange(dateRange);
  }

  private async selectDateRange(nextRange: DateRanges) {
    if (nextRange === undefined || nextRange === null) {
      return;
    }

    this.hapticsService?.selection();
    const previousRange = this.selectedDateRange;
    if (nextRange === DateRanges.all) {
      const confirmed = await this.confirmAllRangeSelection();
      if (!confirmed) {
        this.selectedDateRange = previousRange;
        const previousRangeDates = this.resolveCurrentRangeDates();
        this.startDateControl?.setValue(previousRangeDates.startDate);
        this.endDateControl?.setValue(previousRangeDates.endDate);
        this.syncToolbarDateRangeOptions();
        return;
      }
    }

    const computedRange = getDatesForDateRange(nextRange, this.startOfTheWeek);
    this.startDateControl?.setValue(computedRange.startDate);
    this.endDateControl?.setValue(computedRange.endDate);
    this.selectedDateRange = nextRange;
    this.syncToolbarDateRangeOptions();
    return this.search();
  }

  async onDateChange(event: MatDatepickerInputEvent<any>) {
    if (!event.value) {
      return;
    }
    if (!this.startDateControl?.value || !this.endDateControl?.value) {
      return;
    }
    if (this.startDateControl.hasError('matStartDateInvalid') || this.endDateControl.hasError('matEndDateInvalid')) {
      return;
    }
    if (this.searchFormGroup.hasError('endDateSmallerThanStartDate') || this.searchFormGroup.hasError('dateRange')) {
      return;
    }
    this.hapticsService?.selection();
    this.selectedDateRange = this.dateRanges.custom;
    this.syncToolbarDateRangeOptions();
    return this.search();
  }

  setCustomDateRange() {
    this.hapticsService?.selection();
    this.selectedDateRange = this.dateRanges.custom;
    this.syncToolbarDateRangeOptions();
  }

  async onActivityTypesChange(activityTypes) {
    this.hapticsService?.selection();
    this.selectedActivityTypes = activityTypes;
    return this.search();
  }

  async onMergedEventsToggleChange(event: MatButtonToggleChange) {
    if (this.mergedEventsToggleDisabled) {
      return;
    }
    this.hapticsService?.selection();
    const selected = Array.isArray(event.value) ? event.value : [];
    this.includeMergedEvents = selected.includes('merged');
    return this.search();
  }

  private resolveCurrentRangeDates(): { startDate: Date | null; endDate: Date | null } {
    if (this.selectedDateRange === DateRanges.custom) {
      return {
        startDate: this.selectedStartDate ?? null,
        endDate: this.selectedEndDate ?? null,
      };
    }
    const range = getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek);
    return {
      startDate: range.startDate ?? null,
      endDate: range.endDate ?? null,
    };
  }

  private syncToolbarDateRangeOptions(): void {
    const visibleDateRanges = new Set(this.dateRangesToShow ?? []);

    this.primaryToolbarDateRangeOptions = [
      this.createDateRangeShortcut(DateRanges.thisWeek, 'This week', 'This wk', 'This week'),
      this.createDateRangeShortcut(DateRanges.lastWeek, 'Last week', 'Last wk', 'Last week'),
      this.createDateRangeShortcut(DateRanges.lastSevenDays, '7 days', '7d', '7 days'),
      this.createDateRangeShortcut(DateRanges.thisMonth, 'This month', 'This mo', 'This month'),
      this.createDateRangeShortcut(DateRanges.lastMonth, 'Last month', 'Last mo', 'Last month'),
      this.createDateRangeShortcut(DateRanges.lastThirtyDays, '30 days', '30d', '30 days'),
    ].filter(option => visibleDateRanges.has(option.value));

    this.secondaryToolbarDateRangeOptions = [
      this.createDateRangeShortcut(DateRanges.thisYear, `${this.currentYear}`, `${this.currentYear}`, 'This year'),
      this.createDateRangeShortcut(DateRanges.lastYear, `${this.currentYear - 1}`, `${this.currentYear - 1}`, 'Last year'),
      this.createDateRangeShortcut(DateRanges.all, 'All', 'All', 'All'),
    ].filter(option => visibleDateRanges.has(option.value));

    this.secondaryDateRangeButtonLabel = this.secondaryToolbarDateRangeOptions.find(
      option => option.value === this.selectedDateRange,
    )?.label ?? 'More';
  }

  private createDateRangeShortcut(
    value: DateRanges,
    label: string,
    compactLabel: string,
    ariaLabel: string,
  ): DateRangeShortcutOption {
    return {
      ariaLabel,
      label: this.compact ? compactLabel : label,
      value,
    };
  }

  private coerceDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }
    if (dayjs.isDayjs(value)) {
      const dayJsValue = value as Dayjs;
      const dateValue = dayJsValue.toDate();
      return Number.isFinite(dateValue.getTime()) ? dateValue : null;
    }
    const dateValue = new Date(value as string | number);
    return Number.isFinite(dateValue.getTime()) ? dateValue : null;
  }

  private normalizeStartDate(date: Date): Date {
    const normalizedStartDate = new Date(date);
    normalizedStartDate.setHours(0, 0, 0, 0);
    return normalizedStartDate;
  }

  private normalizeEndDate(date: Date): Date {
    const normalizedEndDate = new Date(date);
    const isStartOfDay = normalizedEndDate.getHours() === 0
      && normalizedEndDate.getMinutes() === 0
      && normalizedEndDate.getSeconds() === 0
      && normalizedEndDate.getMilliseconds() === 0;

    if (this.selectedDateRange !== DateRanges.custom && isStartOfDay) {
      return normalizedEndDate;
    }
    normalizedEndDate.setHours(23, 59, 59, 999);
    return normalizedEndDate;
  }

  private async confirmAllRangeSelection(): Promise<boolean> {
    if (!this.dialog) {
      return true;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Load all events?',
        message: 'Selecting All may degrade app performance and increase loading times. Continue?',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
    return confirmed === true;
  }

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}

export const startDateToEndDateValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate && startDate && endDate.value < startDate.value) {
    return { 'endDateSmallerThanStartDate': true };
  }
  return null;
};

export const maxDateDistanceValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate && startDate && (endDate.value - startDate.value > new Date(365 * 5 * 24 * 3600 * 1000).getTime())) { // @todo improve this
    return { 'dateRange': true };
  }
  return null;
};

export interface Search {
  searchTerm?: string,
  startDate?: Date,
  endDate?: Date,
  dateRange: DateRanges,
  activityTypes?: ActivityTypes[],
  includeMergedEvents?: boolean
}
