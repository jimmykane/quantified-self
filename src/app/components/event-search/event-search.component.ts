import {Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges} from '@angular/core';
import {FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators} from '@angular/forms';
import {MatButtonToggleChange} from '@angular/material';
import {DateRanges} from 'quantified-self-lib/lib/users/user.dashboard.settings.interface';

@Component({
  selector: 'app-event-search',
  templateUrl: './event-search.component.html',
  styleUrls: ['./event-search.component.css'],
})

export class EventSearchComponent implements OnInit, OnChanges {
  @Input() selectedDateRange: DateRanges;
  @Input() selectedStartDate: Date;
  @Input() selectedEndDate: Date;
  @Output() searchChange: EventEmitter<{ searchTerm: string, startDate: Date, endDate: Date, dateRange: DateRanges }> = new EventEmitter<{ searchTerm: string, startDate: Date, endDate: Date, dateRange: DateRanges }>();

  public searchFormGroup: FormGroup;
  public dateRanges = DateRanges;

  constructor() {
  }

  ngOnInit(): void {
    this.searchFormGroup = new FormGroup({
      search: new FormControl(null, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      startDate: new FormControl(this.selectedDateRange === DateRanges.custom ? this.selectedStartDate : getDatesForDateRange(this.selectedDateRange).startDate, [
        // Validators.required,
      ]),
      endDate: new FormControl(this.selectedDateRange === DateRanges.custom ? this.selectedEndDate : getDatesForDateRange(this.selectedDateRange).endDate, [
        // Validators.required,
      ]),
    }, [startDateToEndDateValidator, max3MonthsValidator]);
  }

  ngOnChanges(changes: SimpleChanges): void {

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
      dateRange: this.selectedDateRange,
    });
  }

  onSubmit() {
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
    this.searchFormGroup.get('startDate').setValue(getDatesForDateRange(event.source.value).startDate);
    this.searchFormGroup.get('endDate').setValue(getDatesForDateRange(event.source.value).endDate);
    this.selectedDateRange = event.source.value;
    this.search();
  }

  onDateChange(event) {
    this.selectedDateRange = this.dateRanges.custom;
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

export function getDatesForDateRange(dateRange: DateRanges): DateRangeStartDateAndEndDate {
  switch (dateRange) {
    case DateRanges.thisWeek: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - new Date().getDay() - 1, 24),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      };
    }
    case DateRanges.lastWeek: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - new Date().getDay() - 7, 24),
        endDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - new Date().getDay(), 23, 59, 59)
      }
    }
    case DateRanges.thisMonth: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
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

export const max3MonthsValidator: ValidatorFn = (control: FormGroup): ValidationErrors | null => {
  const startDate = control.get('startDate');
  const endDate = control.get('endDate');
  if ((endDate.value - startDate.value > new Date(0).setMonth(3))) { // @todo improve this
    return {'moreThan3Months': true};
  }
  return null;
};
