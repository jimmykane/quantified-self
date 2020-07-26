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
import { FormControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DateRanges } from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventSearchComponent extends LoadingAbstractDirective implements OnChanges, OnInit {
  @Input() selectedDateRange: DateRanges;
  @Input() selectedStartDate: Date;
  @Input() selectedEndDate: Date;
  @Input() startOfTheWeek: DaysOfTheWeek;
  @Input() selectedActivityTypes: ActivityTypes[];
  @Input() isLoading: boolean;

  @Output() searchChange: EventEmitter<Search> = new EventEmitter<Search>();

  public searchFormGroup: FormGroup;
  public dateRanges = DateRanges;
  public currentYear = new Date().getFullYear();
  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();


  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  ngOnInit(): void {
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
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.searchFormGroup) {
      return;
    }
    const startDate = this.selectedDateRange === DateRanges.custom ? this.selectedStartDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).startDate
    const endDate = this.selectedDateRange === DateRanges.custom ? this.selectedEndDate : getDatesForDateRange(this.selectedDateRange, this.startOfTheWeek).endDate;
    this.searchFormGroup.get('startDate').setValue(startDate)
    this.searchFormGroup.get('endDate').setValue(endDate)
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
      startDate: this.searchFormGroup.get('startDate').value ? new Date(this.searchFormGroup.get('startDate').value.setHours(0, 0, 0)) : null,
      endDate: this.searchFormGroup.get('endDate').value ? new Date(this.searchFormGroup.get('endDate').value.setHours(23, 59, 59)) : null,
      activityTypes: this.selectedActivityTypes,
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
    this.searchFormGroup.get('startDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).startDate, {emmitEvent: false});
    this.searchFormGroup.get('endDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).endDate, {emmitEvent: false});
    this.selectedDateRange = event.source.value;
    this.search();
  }

  onDateChange(event) {
  }

  setCustomDateRange(event) {
    this.selectedDateRange = this.dateRanges.custom;
  }

  onActivityTypesChange(activityTypes) {
    this.selectedActivityTypes = activityTypes;
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
  searchTerm?: string,
  startDate?: Date,
  endDate?: Date,
  dateRange: DateRanges,
  activityTypes?: ActivityTypes[]
}
