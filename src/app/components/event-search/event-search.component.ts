import { activityDateRangeAnchor, activityRangeDates, currentActivityDateRange, formatActivityRangeDate, sameActivityDateRange, shiftActivityDateRange, type ActivityDateRangeNavigation, type ActivityDateRangePreset, type ActivityDateRangeWindow } from '../../helpers/activity-date-range.helper';
import { dashboardDateRangeForNavigation, resolveDashboardEventTableNavigation, resolveDashboardEventTableRange } from '../../helpers/dashboard-tile-event-filters.helper';
import type { AppDashboardEventTableFiltersInterface } from '../../models/app-user.interface';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
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
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { TableDateFilterComponent } from '../shared/table-date-filter/table-date-filter.component';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppHapticsService } from '../../services/app.haptics.service';

interface DateRangeShortcutOption {
  label: string;
  value: ActivityDateRangePreset;
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
  @Input() rangeNavigation?: ActivityDateRangeNavigation | null;
  @Input() dateContext = '';
  @Input() dateSelection?: AppDashboardEventTableFiltersInterface;
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
  public toolbarRangePreset: ActivityDateRangePreset = 'month';
  public toolbarNavigationEnabled = false;
  public toolbarNextPeriodEnabled = false;
  public toolbarIsCurrentPeriod = false;
  public toolbarRangeStart: Date | null = null;
  public toolbarRangeEnd: Date | null = null;
  @ViewChild(TableDateFilterComponent) private tableDateFilter?: TableDateFilterComponent<ActivityDateRangePreset>;
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
    this.tableDateFilter?.open();
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
    if (changes.dateSelection && this.dateSelection) {
      this.selectedDateRange = this.dateSelection.dateRange;
      this.rangeNavigation = this.dateSelection.rangeNavigation;
      this.selectedStartDate = this.dateSelection.startDate == null ? null : new Date(this.dateSelection.startDate);
      this.selectedEndDate = this.dateSelection.endDate == null ? null : new Date(this.dateSelection.endDate);
    }
    // A clock/zone refresh updates navigation state without replacing calendar drafts.
    if (changes.dateContext) this.syncToolbarRange();
    if (changes.selectedActivityTypes || changes.availableActivityTypes) this.syncToolbarSports();
    if (changes['selectedDateRange'] || changes['dateRangesToShow'] || changes['compact'] || changes['rangeNavigation'] || changes['toolbarRangeLayout'] || changes.dateSelection) {
      this.syncToolbarDateRangeOptions();
    }

    if (!this.searchFormGroup) {
      return;
    }

    if (!changes['selectedDateRange']
      && !changes['selectedStartDate']
      && !changes['selectedEndDate']
      && !changes['startOfTheWeek'] && !changes['rangeNavigation'] && !changes.dateSelection) {
      return;
    }

    const { startDate, endDate } = this.resolveCurrentRangeDates();
    this.startDateControl?.setValue(startDate, { emitEvent: false });
    this.endDateControl?.setValue(endDate, { emitEvent: false });
    this.searchFormGroup.updateValueAndValidity({ emitEvent: false });
    this.syncToolbarRange();
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

    if (this.toolbarRangeLayout) {
      // Legacy Last week/month/year choices become fixed historical navigation
      // when saved through this toolbar, with a matching compatibility value.
      this.rangeNavigation = this.resolveToolbarNavigation();
      this.selectedDateRange = dashboardDateRangeForNavigation(this.rangeNavigation);
    }

    const { startDate, endDate } = this.toolbarRangeLayout ? this.resolveCurrentRangeDates() : {
      startDate: this.coerceDate(this.startDateControl.value), endDate: this.coerceDate(this.endDateControl.value),
    };

    this.selectedStartDate = startDate ? this.normalizeStartDate(startDate) : (null as any);
    this.selectedEndDate = endDate ? this.normalizeEndDate(endDate) : (null as any);

    this.syncToolbarRange();
    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search')?.value,
      startDate: this.selectedStartDate,
      endDate: this.selectedEndDate,
      activityTypes: this.selectedActivityTypes,
      dateRange: this.selectedDateRange,
      includeMergedEvents,
      ...(this.toolbarRangeLayout ? { rangeNavigation: this.resolveToolbarNavigation() } : {}),
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

  async onToolbarDateRangeChange(value: ActivityDateRangePreset | DateRanges, source?: MatSelect): Promise<void> {
    if (this.isLoading) return;
    const navigation = typeof value === 'number' ? resolveDashboardEventTableNavigation({ dateRange: value }, new Date(), this.startOfTheWeek)
      : { preset: value, anchor: null };
    if (navigation.preset === 'custom') {
      if (this.customRangeOpen) return;
      const { startDate, endDate } = this.resolveCurrentRangeDates();
      const inclusiveEnd = endDate && endDate.getHours() === 0 && endDate.getMinutes() === 0
        && endDate.getSeconds() === 0 && endDate.getMilliseconds() === 0 ? new Date(+endDate - 1) : endDate;
      this.searchFormGroup.patchValue({ startDate, endDate: inclusiveEnd }, { emitEvent: false });
      this.customRangeOpen = true;
    } else {
      const previous = this.resolveToolbarNavigation();
      if (navigation.preset !== previous.preset || navigation.anchor !== previous.anchor) {
        this.hapticsService?.selection();
        if (navigation.preset !== 'all' || await this.confirmAllRangeSelection()) {
          this.customRangeOpen = false;
          const range = resolveDashboardEventTableRange({ dateRange: dashboardDateRangeForNavigation(navigation), rangeNavigation: navigation }, new Date(), this.startOfTheWeek);
          this.setToolbarRange(navigation, range);
          await this.search();
        }
      }
    }
    if (source) source.value = typeof value === 'number' ? this.selectedDateRange : this.toolbarRangePreset;
  }

  async applyToolbarCustomRange(): Promise<void> {
    const start = this.coerceDate(this.startDateControl.value);
    const end = this.coerceDate(this.endDateControl.value);
    if (!start || !end || !this.searchFormGroup.valid) {
      this.searchFormGroup.markAllAsTouched();
      return;
    }
    const unchanged = this.resolveToolbarNavigation().preset === 'custom'
      && this.normalizeStartDate(start).getTime() === this.selectedStartDate?.getTime()
      && this.normalizeEndDate(end).getTime() === this.selectedEndDate?.getTime();
    this.customRangeOpen = false;
    if (unchanged) return;
    this.selectedDateRange = DateRanges.custom;
    this.rangeNavigation = { preset: 'custom', anchor: null, customDates: { startDate: formatActivityRangeDate(start), endDate: formatActivityRangeDate(end) } };
    this.selectedStartDate = this.normalizeStartDate(start);
    this.selectedEndDate = this.normalizeEndDate(end);
    this.hapticsService?.selection();
    await this.search();
  }

  async shiftToolbarRange(direction: -1 | 1): Promise<void> {
    if (this.isLoading) return;
    const navigation = this.resolveToolbarNavigation();
    const range = this.resolveToolbarRange();
    const current = currentActivityDateRange(navigation.preset, new Date(), range, this.startOfTheWeek);
    const next = range && shiftActivityDateRange(navigation.preset, range, direction, current);
    if (!next) return;
    const anchor = navigation.preset === 'custom' || sameActivityDateRange(next, current) ? null : activityDateRangeAnchor(navigation.preset, next);
    this.setToolbarRange({ preset: navigation.preset, anchor }, next);
    this.hapticsService?.selection();
    await this.search();
  }

  async showToolbarCurrentPeriod(): Promise<void> {
    if (this.isLoading) return;
    const navigation = this.resolveToolbarNavigation();
    const range = this.resolveToolbarRange();
    const current = currentActivityDateRange(navigation.preset, new Date(), range, this.startOfTheWeek);
    if (!current || (sameActivityDateRange(range, current) && !navigation.anchor)) return;
    this.setToolbarRange({ preset: navigation.preset, anchor: null }, current);
    this.hapticsService?.selection();
    await this.search();
  }

  private resolveToolbarNavigation(): ActivityDateRangeNavigation {
    return resolveDashboardEventTableNavigation({ dateRange: this.selectedDateRange, rangeNavigation: this.rangeNavigation }, new Date(), this.startOfTheWeek);
  }

  private resolveToolbarRange(): ActivityDateRangeWindow | null | undefined {
    return resolveDashboardEventTableRange({ dateRange: this.selectedDateRange, rangeNavigation: this.rangeNavigation,
      startDate: this.selectedStartDate ? +this.selectedStartDate : null, endDate: this.selectedEndDate ? +this.selectedEndDate : null }, new Date(), this.startOfTheWeek);
  }

  private setToolbarRange(navigation: ActivityDateRangeNavigation, range: ActivityDateRangeWindow | null | undefined): void {
    this.rangeNavigation = navigation.preset === 'custom' && range ? { ...navigation, customDates: activityRangeDates(range) } : navigation;
    this.selectedDateRange = dashboardDateRangeForNavigation(navigation);
    this.selectedStartDate = range?.start ?? null;
    this.selectedEndDate = range ? new Date(+range.end - 1) : null;
    this.searchFormGroup.patchValue({ startDate: this.selectedStartDate, endDate: this.selectedEndDate }, { emitEvent: false });
    this.syncToolbarRange();
  }

  private syncToolbarRange(): void {
    const navigation = this.resolveToolbarNavigation();
    const range = this.resolveToolbarRange();
    this.toolbarRangePreset = navigation.preset;
    this.toolbarNavigationEnabled = !!range;
    this.toolbarRangeStart = range?.start ?? null;
    this.toolbarRangeEnd = range ? new Date(+range.end - 1) : null;
    const current = currentActivityDateRange(navigation.preset, new Date(), range, this.startOfTheWeek);
    this.toolbarIsCurrentPeriod = !navigation.anchor && sameActivityDateRange(range, current);
    this.toolbarNextPeriodEnabled = !!range && !!shiftActivityDateRange(navigation.preset, range, 1, current);
  }

  onToolbarPickerOpened(): void { this.hapticsService?.selection(); }

  cancelToolbarCustomRange(): void {
    this.customRangeOpen = false;
    const { startDate, endDate } = this.resolveCurrentRangeDates();
    this.searchFormGroup.patchValue({ startDate, endDate }, { emitEvent: false });
    this.hapticsService?.selection();
  }

  async clearToolbarCustomRange(): Promise<void> {
    if (this.customRangeOpen && this.resolveToolbarNavigation().preset !== 'custom') {
      this.cancelToolbarCustomRange();
      return;
    }
    this.customRangeOpen = false;
    const fallback = this.dateRangesToShow.includes(DateRanges.lastThirtyDays) ? DateRanges.lastThirtyDays
      : this.dateRangesToShow.find(value => value !== DateRanges.custom && value !== DateRanges.all) ?? DateRanges.lastThirtyDays;
    await this.onToolbarDateRangeChange(fallback);
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
    if (this.toolbarRangeLayout) {
      const range = this.resolveToolbarRange();
      return { startDate: range?.start ?? null, endDate: range ? new Date(+range.end - 1) : null };
    }
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

    const options: (DateRangeShortcutOption & { ranges: DateRanges[] })[] = [
      { value: 'month', label: '30 days', ranges: [DateRanges.lastThirtyDays] },
      { value: 'week', label: '7 days', ranges: [DateRanges.lastSevenDays] },
      { value: 'calendar-week', label: 'Week', ranges: [DateRanges.thisWeek, DateRanges.lastWeek] },
      { value: 'quarter', label: '90 days', ranges: [DateRanges.lastThirtyDays] },
      { value: 'calendar-month', label: 'Month', ranges: [DateRanges.thisMonth, DateRanges.lastMonth] },
      { value: 'year', label: 'Year', ranges: [DateRanges.thisYear, DateRanges.lastYear] },
      { value: 'custom', label: 'Custom dates', ranges: [DateRanges.custom] },
      { value: 'all', label: 'All dates', ranges: [DateRanges.all] },
    ];
    this.toolbarDateRangeOptions = options.filter(option => option.ranges.some(range => visibleDateRanges.has(range)))
      .map(({ value, label }) => ({ value, label }));
    this.syncToolbarRange();
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
  rangeNavigation?: ActivityDateRangeNavigation | null,
  activityTypes?: ActivityTypes[],
  includeMergedEvents?: boolean
}
