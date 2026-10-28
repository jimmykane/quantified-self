import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  ElementRef,
  ViewChild,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { AbstractControl, UntypedFormControl, UntypedFormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { MatSelect } from '@angular/material/select';
import { activityExplorerSports } from '../../helpers/activity-explorer.helper';
import { getActivityTypeFamilyFilterOptions, isSameActivityTypeSelection, normalizeActivityTypeSelection } from '../../helpers/activity-type-family-filter.helper';
import type { ActivityFilterPickerOption, ActivityFilterPickerShortcut } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DateRanges } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { MatDatepickerInputEvent, MatDateRangePicker } from '@angular/material/datepicker';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppHapticsService } from '../../services/app.haptics.service';

interface DateRangeShortcutOption {
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
  @Input() availableActivityTypes: ActivityTypes[] | null | undefined;
  @Input() showDatePicker = true;
  @Input() showActivityTypePicker = true;
  @Input() showMergedEventsToggle = false;
  @Input() includeMergedEvents = true;
  @Input() compact = false;
  @Input() toolbarRangeLayout = false;
  @Input() mergedEventsToggleDisabled = false;
  @Input() mergedEventsToggleLabel = 'Merged activities';
  @Input() mergedEventsToggleHint = 'Merged activities are excluded';
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
  public toolbarDateRangeOptions: DateRangeShortcutOption[] = [];
  public toolbarSportOptions: ActivityFilterPickerOption[] = [];
  public toolbarSportShortcuts: ActivityFilterPickerShortcut[] = [];
  public toolbarSelectedSports: string[] = [];
  public customRangeOpen = false;
  private focusDateControl = false;
  private datePresetsControl?: MatSelect;
  private customStartDateControl?: ElementRef<HTMLInputElement>;
  @ViewChild('toolbarPicker') private toolbarPicker?: MatDateRangePicker<Dayjs>;
  @ViewChild('datePresets') set datePresets(control: MatSelect | undefined) {
    this.datePresetsControl = control;
    if (control && this.focusDateControl) { this.focusDateControl = false; control.focus(); }
  }
  @ViewChild('customStartDate') set customStartDate(control: ElementRef<HTMLInputElement> | undefined) {
    this.customStartDateControl = control;
    if (control && this.focusDateControl) { this.focusDateControl = false; control.nativeElement.focus(); }
  }
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

  openToolbarDateFilter(): void {
    if (this.isLoading || !this.showDatePicker || !this.toolbarRangeLayout) return;
    if (this.customRangeOpen || this.selectedDateRange === DateRanges.custom) {
      const picker = this.toolbarPicker;
      if (!picker || picker.disabled || picker.opened) return;
      this.customStartDateControl?.nativeElement.focus();
      picker.open(); // The existing opened handler owns feedback.
      return;
    }
    const presets = this.datePresetsControl;
    if (!presets || presets.disabled || presets.panelOpen) return;
    presets.focus();
    presets.open();
    if (presets.panelOpen) this.hapticsService?.selection();
  }

  get endDateControl(): UntypedFormControl {
    return this.searchFormGroup.get('endDate') as UntypedFormControl;
  }

  ngOnInit(): void {
    this.syncToolbarDateRangeOptions();
    this.syncToolbarSports();
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
    if (changes.selectedActivityTypes || changes.availableActivityTypes) this.syncToolbarSports();
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

  async search(includeMergedEvents = this.includeMergedEvents) {
    if (!this.toolbarRangeLayout && !this.searchFormGroup.valid) {
      this.validateAllFormFields(this.searchFormGroup);
      return;
    }

    const { startDate, endDate } = this.toolbarRangeLayout ? this.resolveCurrentRangeDates() : {
      startDate: this.coerceDate(this.startDateControl.value), endDate: this.coerceDate(this.endDateControl.value),
    };

    this.selectedStartDate = startDate ? this.normalizeStartDate(startDate) : (null as any);
    this.selectedEndDate = endDate ? this.normalizeEndDate(endDate) : (null as any);

    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search')?.value,
      startDate: this.selectedStartDate,
      endDate: this.selectedEndDate,
      activityTypes: this.selectedActivityTypes,
      dateRange: this.selectedDateRange,
      includeMergedEvents
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

  private syncToolbarSports(): void {
    this.toolbarSelectedSports = normalizeActivityTypeSelection(this.selectedActivityTypes || []);
    const sports = Array.isArray(this.availableActivityTypes)
      ? normalizeActivityTypeSelection([...this.availableActivityTypes, ...this.toolbarSelectedSports])
      : activityExplorerSports([], this.toolbarSelectedSports, true);
    this.toolbarSportOptions = sports.map(sport => ({ value: sport, label: sport, activityType: sport }));
    this.toolbarSportShortcuts = getActivityTypeFamilyFilterOptions(this.toolbarSelectedSports, sports)
      .map(family => ({ label: family.label, values: family.activityTypes }));
  }

  async onToolbarSportsChange(values: string[]): Promise<void> {
    const next = normalizeActivityTypeSelection(values);
    if (isSameActivityTypeSelection(next, normalizeActivityTypeSelection(this.selectedActivityTypes || []))) return;
    this.hapticsService?.selection();
    await this.onActivityTypesChange(next);
    this.syncToolbarSports();
  }

  async onToolbarDateRangeChange(value: DateRanges, source?: MatSelect): Promise<void> {
    if (value === DateRanges.custom) {
      if (this.customRangeOpen || this.selectedDateRange === DateRanges.custom) return;
      const { startDate, endDate } = this.resolveCurrentRangeDates();
      // Presets use an exclusive midnight bound; the editor shows inclusive calendar dates.
      const inclusiveEnd = endDate && endDate.getHours() === 0 && endDate.getMinutes() === 0
        && endDate.getSeconds() === 0 && endDate.getMilliseconds() === 0 ? new Date(endDate.getTime() - 1) : endDate;
      this.searchFormGroup.patchValue({ startDate, endDate: inclusiveEnd }, { emitEvent: false });
      this.customRangeOpen = true;
      this.focusDateControl = true;
      this.hapticsService?.selection();
    } else if (value !== this.selectedDateRange) {
      await this.selectDateRange(value);
    }
    if (source) source.value = this.selectedDateRange;
  }

  async applyToolbarCustomRange(): Promise<void> {
    const start = this.coerceDate(this.startDateControl.value);
    const end = this.coerceDate(this.endDateControl.value);
    if (!start || !end || !this.searchFormGroup.valid) {
      this.searchFormGroup.markAllAsTouched();
      return;
    }
    const unchanged = this.selectedDateRange === DateRanges.custom
      && this.normalizeStartDate(start).getTime() === this.selectedStartDate?.getTime()
      && this.normalizeEndDate(end).getTime() === this.selectedEndDate?.getTime();
    this.customRangeOpen = false;
    if (unchanged) return;
    this.selectedDateRange = DateRanges.custom;
    this.selectedStartDate = this.normalizeStartDate(start);
    this.selectedEndDate = this.normalizeEndDate(end);
    this.hapticsService?.selection();
    await this.search();
  }

  onToolbarPickerOpened(): void { this.hapticsService?.selection(); }

  cancelToolbarCustomRange(): void {
    this.customRangeOpen = false;
    this.focusDateControl = this.selectedDateRange !== DateRanges.custom;
    const { startDate, endDate } = this.resolveCurrentRangeDates();
    this.searchFormGroup.patchValue({ startDate, endDate }, { emitEvent: false });
    this.hapticsService?.selection();
  }

  async clearToolbarCustomRange(): Promise<void> {
    if (this.customRangeOpen && this.selectedDateRange !== DateRanges.custom) {
      this.cancelToolbarCustomRange();
      return;
    }
    this.customRangeOpen = false;
    this.focusDateControl = true;
    const fallback = this.dateRangesToShow.includes(DateRanges.lastThirtyDays) ? DateRanges.lastThirtyDays
      : this.dateRangesToShow.find(value => value !== DateRanges.custom && value !== DateRanges.all) ?? DateRanges.lastThirtyDays;
    await this.selectDateRange(fallback);
  }

  async onActivityTypesChange(activityTypes) {
    this.selectedActivityTypes = activityTypes;
    return this.search();
  }

  async onMergedEventsToggleChange(event: MatButtonToggleChange) {
    const selected = Array.isArray(event.value) ? event.value : [];
    return this.onMergedEventsChange(selected.includes('merged'));
  }

  async onMergedEventsChange(includeMergedEvents: boolean) {
    if (this.mergedEventsToggleDisabled || this.includeMergedEvents === includeMergedEvents) {
      return;
    }
    this.hapticsService?.selection();
    // The parent owns the accepted filter state, including save-failure rollback.
    return this.search(includeMergedEvents);
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

    this.toolbarDateRangeOptions = [
      { value: DateRanges.lastThirtyDays, label: 'Last 30 days' },
      { value: DateRanges.lastSevenDays, label: 'Last 7 days' },
      { value: DateRanges.thisWeek, label: 'This week' },
      { value: DateRanges.lastWeek, label: 'Last week' },
      { value: DateRanges.thisMonth, label: 'This month' },
      { value: DateRanges.lastMonth, label: 'Last month' },
      { value: DateRanges.thisYear, label: 'This year' },
      { value: DateRanges.lastYear, label: 'Last year' },
      { value: DateRanges.custom, label: 'Custom dates' },
      { value: DateRanges.all, label: 'All dates' },
    ].filter(option => visibleDateRanges.has(option.value));
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
        title: 'Load all activities?',
        message: 'Loading every activity may slow down the app and take longer. Continue?',
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
