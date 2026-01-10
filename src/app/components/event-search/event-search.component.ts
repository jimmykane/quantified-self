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
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DateRanges } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import dayjs from 'dayjs';

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
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
  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();


  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  get startDateControl(): UntypedFormControl {
    return this.searchFormGroup.get('startDate') as UntypedFormControl;
  }

  get endDateControl(): UntypedFormControl {
    return this.searchFormGroup.get('endDate') as UntypedFormControl;
  }

  ngOnInit(): void {
    this.searchFormGroup = new UntypedFormGroup({
      search: new UntypedFormControl(null, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      startDate: new UntypedFormControl(this.selectedDateRange === DateRanges.custom ? this.selectedStartDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).startDate, [
        // Validators.required,
      ]),
      endDate: new UntypedFormControl(this.selectedDateRange === DateRanges.custom ? this.selectedEndDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).endDate, [
        // Validators.required,
      ])
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.searchFormGroup) {
      return;
    }
    const startDate = this.selectedDateRange === DateRanges.custom ? this.selectedStartDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).startDate;
    const endDate = this.selectedDateRange === DateRanges.custom ? this.selectedEndDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).endDate;
    this.startDateControl?.setValue(startDate);
    this.endDateControl?.setValue(endDate);
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

    let startDate: Date = this.startDateControl.value;
    let endDate: Date = this.endDateControl.value;
    if (dayjs.isDayjs(startDate)) {
      startDate = (startDate as any).toDate();
    }

    if (dayjs.isDayjs(endDate)) {
      endDate = (endDate as any).toDate();
    }

    this.selectedStartDate = startDate ? new Date(new Date(startDate).setHours(0, 0, 0)) : (null as any);
    this.selectedEndDate = endDate ? new Date(new Date(endDate).setHours(23, 59, 59)) : (null as any);

    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search')?.value,
      startDate: this.selectedStartDate,
      endDate: this.selectedEndDate,
      activityTypes: this.selectedActivityTypes,
      dateRange: this.selectedDateRange
    });
  }

  onSubmit(event) {
    event.preventDefault();
    this.selectedDateRange = this.dateRanges.custom;
    this.search();
    this.searchFormGroup.markAsPristine();
  }

  dateToggleChange(event: MatButtonToggleChange) {
    this.startDateControl?.setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).startDate);
    this.endDateControl?.setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).endDate);
    this.selectedDateRange = event.source.value;
    return this.search();
  }

  async onDateChange(event: MatDatepickerInputEvent<any>, isStartDate: boolean) {
    if (!event.value) {
      return;
    }
    if (!this.startDateControl?.value || !this.endDateControl?.value) {
      return;
    }
    this.selectedDateRange = this.dateRanges.custom;
    if (!isStartDate) {
      return this.search();
    }
  }

  setCustomDateRange(event: any) {
    this.selectedDateRange = this.dateRanges.custom;
  }

  async onActivityTypesChange(activityTypes) {
    this.selectedActivityTypes = activityTypes;
    return this.search();
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
  activityTypes?: ActivityTypes[]
}
