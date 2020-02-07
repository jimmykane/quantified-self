import {Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges} from '@angular/core';
import {FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators} from '@angular/forms';
import {DateRanges} from 'quantified-self-lib/lib/users/user.dashboard.settings.interface';
import {DaysOfTheWeek} from 'quantified-self-lib/lib/users/user.unit.settings.interface';
import {ActivityTypes, ActivityTypesHelper} from 'quantified-self-lib/lib/activities/activity.types';
import {MatSelectChange} from '@angular/material/select';
import { MatButtonToggleChange } from '@angular/material/button-toggle';

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
})

export class EventSearchComponent implements OnChanges, OnInit {
  @Input() selectedDateRange: DateRanges;
  @Input() selectedStartDate: Date;
  @Input() selectedEndDate: Date;
  @Input() startOfTheWeek: DaysOfTheWeek;
  @Input() selectedActivityTypes: ActivityTypes[];

  @Output() searchChange: EventEmitter<Search> = new EventEmitter<Search>();

  public searchFormGroup: FormGroup;
  public dateRanges = DateRanges;
  public currentYear = new Date().getFullYear();
  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();

  constructor() {
  }

  ngOnInit(): void {

  }

  ngOnChanges(changes: SimpleChanges): void {
    this.searchFormGroup = new FormGroup({
      search: new FormControl(null, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      startDate: new FormControl(this.selectedDateRange === DateRanges.custom ? this.selectedStartDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).startDate, [
        // Validators.required,
      ]),
      endDate: new FormControl(this.selectedDateRange === DateRanges.custom ? this.selectedEndDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).endDate, [
        // Validators.required,
      ]),
      activityTypes: new FormControl(this.selectedActivityTypes, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
    });
  }


  hasError(field?: string) {
    if (!field) {
      return !this.searchFormGroup.valid;
    }
    return !(this.searchFormGroup.get(field).valid && this.searchFormGroup.get(field).touched);
  }

  async search() {
    if (!this.searchFormGroup.valid) {
      this.validateAllFormFields(this.searchFormGroup);
      return;
    }
    this.searchChange.emit({
      searchTerm: this.searchFormGroup.get('search').value,
      startDate: this.searchFormGroup.get('startDate').value,
      endDate: this.searchFormGroup.get('endDate').value,
      activityTypes: this.searchFormGroup.get('activityTypes').value,
      dateRange: this.selectedDateRange,
    });
  }

  onSubmit(event) {
    event.preventDefault();
    this.selectedDateRange = this.dateRanges.custom;
    this.search();
    this.searchFormGroup.markAsPristine();
  }

  dateToggleChange(event: MatButtonToggleChange) {
    // if (event.source.value === DateRanges.custom){
    //   this.selectedDateRange = event.source.value;
    //   return;
    // }
    this.searchFormGroup.get('startDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).startDate);
    this.searchFormGroup.get('endDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).endDate);
    this.selectedDateRange = event.source.value;
    this.search();
  }

  onDateChange(event) {
    this.selectedDateRange = this.dateRanges.custom;
    // Start date should be on 00:00:00 but end date needs fix
    if (this.searchFormGroup.get('endDate').value) {
      this.searchFormGroup.get('endDate').setValue(new Date(this.searchFormGroup.get('endDate').value.setHours(23, 59, 59)));
    }
  }

  onActivityTypesChange(event: MatSelectChange) {
    if (event.value.indexOf(undefined) !== -1) {
      this.searchFormGroup.get('activityTypes').setValue([]);
    }
   this.search()
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}

export interface DateRangeStartDateAndEndDate {
  startDate: Date;
  endDate: Date;
}

export function getDatesForDateRange(dateRange: DateRanges, startOfTheWeek): DateRangeStartDateAndEndDate {
  const daysBack = new Date().getDay() >= startOfTheWeek ? 0 : 7;
  const firstDayOfTheWeek = (new Date().getDate() - new Date().getDay()) + startOfTheWeek; // Remove + 1 if sunday is first day of the week.
  const lastDayOfTheWeek = firstDayOfTheWeek + 6;

  // First day of this week

  const fistDayOfTheWeekDate = new Date(new Date().setDate(firstDayOfTheWeek - daysBack));
  fistDayOfTheWeekDate.setHours(0, 0, 0);

  // Last day if this week
  const lastDayOfTheWeekDate = new Date(new Date().setDate(lastDayOfTheWeek - daysBack));
  lastDayOfTheWeekDate.setHours(23, 59, 59);

  // Take the first day of this week and go back 7 days
  const firstDayOfLastWeekDate = new Date(new Date(fistDayOfTheWeekDate).setDate(fistDayOfTheWeekDate.getDate() - 7)); // Needs to base on fistDayOfTheWeekDate for new Date()
  firstDayOfLastWeekDate.setHours(0, 0, 0);

  // Take the first day of this week and go back 1second
  const lastDayOfLastWeekDate = new Date(new Date(fistDayOfTheWeekDate.getTime()).setHours(0, 0, -1));

  switch (dateRange) {
    case DateRanges.thisWeek: {
      return {
        startDate: fistDayOfTheWeekDate,
        endDate: lastDayOfTheWeekDate
      };
    }
    case DateRanges.lastWeek: {
      return {
        startDate: firstDayOfLastWeekDate,
        endDate: lastDayOfLastWeekDate,
      }
    }
    case DateRanges.lastSevenDays: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 6),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastThirtyDays: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 30),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.thisMonth: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastMonth: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
        endDate: new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 0).setHours(23, 59, 59))
      }
    }
    case DateRanges.thisYear: {
      return {
        startDate: new Date(new Date().getFullYear(), 0, 1),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastYear: {
      return {
        startDate: new Date(new Date().getFullYear() - 1, 0, 1),
        endDate: new Date(new Date(new Date().getFullYear(), 0, 0).setHours(23, 59, 59))
      }
    }
    case DateRanges.custom: {
      return {
        startDate: null,
        endDate: null
      }
    }
    default: {
      return {
        startDate: null,
        endDate: null
      }
    }
  }
}

export const startDateToEndDateValidator: ValidatorFn = (control: FormGroup): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate.value < startDate.value) {
    return {'endDateSmallerThanStartDate': true};
  }
  return null;
};

export const maxDateDistanceValidator: ValidatorFn = (control: FormGroup): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if (endDate.value - startDate.value > new Date(365 * 5 * 24 * 3600 * 1000).getTime()) { // @todo improve this
    return {'dateRange': true};
  }
  return null;
};

export interface Search {
  searchTerm: string,
  startDate: Date,
  endDate: Date,
  dateRange: DateRanges,
  activityTypes: ActivityTypes[]
}
