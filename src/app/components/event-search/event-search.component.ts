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
import { UntypedFormControl, UntypedFormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DateRanges } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import * as moment from 'moment';

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventSearchComponent extends LoadingAbstractDirective implements OnChanges, OnInit {
  @Input() selectedDateRange: DateRanges;
  @Input() selectedStartDate: Date;
  @Input() selectedEndDate: Date;
  @Input() startOfTheWeek: DaysOfTheWeek;
  @Input() selectedActivityTypes: ActivityTypes[];
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

  public searchFormGroup: UntypedFormGroup;
  public dateRanges = DateRanges;
  public currentYear = new Date().getFullYear();
  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();


  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
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
    this.searchFormGroup.get('startDate').setValue(startDate);
    this.searchFormGroup.get('endDate').setValue(endDate);
  }


  hasError(field?: string) {
    if (!field) {
      return !this.searchFormGroup.valid;
    }
    return (!this.searchFormGroup.get(field).valid && this.searchFormGroup.get(field).touched);
  }

  async search() {
    if (!this.searchFormGroup.valid) {
      this.validateAllFormFields(this.searchFormGroup);
      return;
    }

    let startDate: Date = this.searchFormGroup.get('startDate').value;
    let endDate: Date = this.searchFormGroup.get('endDate').value;
    if (moment.isMoment(this.searchFormGroup.get('startDate').value)) {
      startDate = this.searchFormGroup.get('startDate').value.toDate();
    }

    if (moment.isMoment(this.searchFormGroup.get('endDate').value)) {
      endDate = this.searchFormGroup.get('endDate').value.toDate();
    }

    this.selectedStartDate = startDate ? new Date(startDate.setHours(0, 0, 0)) : null;
    this.selectedEndDate = endDate ? new Date(endDate.setHours(23, 59, 59)) : null;

    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search').value,
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
    this.searchFormGroup.get('startDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).startDate);
    this.searchFormGroup.get('endDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).endDate);
    this.selectedDateRange = event.source.value;
    return this.search();
  }

  async onDateChange(event: MatDatepickerInputEvent<any>, isStartDate: boolean) {
    if (!event.value) {
      return;
    }
    if (!this.searchFormGroup.get('startDate').value || !this.searchFormGroup.get('endDate').value) {
      return;
    }
    this.selectedDateRange = this.dateRanges.custom;
    if (!isStartDate) {
      return this.search();
    }
  }

  setCustomDateRange(event) {
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

export const startDateToEndDateValidator: ValidatorFn = (control: UntypedFormGroup): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate.value < startDate.value) {
    return { 'endDateSmallerThanStartDate': true };
  }
  return null;
};

export const maxDateDistanceValidator: ValidatorFn = (control: UntypedFormGroup): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate.value - startDate.value > new Date(365 * 5 * 24 * 3600 * 1000).getTime()) { // @todo improve this
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
