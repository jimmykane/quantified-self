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
import { DaysOfTheWeek } from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { MatButtonToggleChange } from '@angular/material/button-toggle';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DateRanges } from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import { getDatesForDateRange } from '../../helpers/date-range-helper';

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
      startDate: this.searchFormGroup.get('startDate').value ? new Date(this.searchFormGroup.get('startDate').value.toDate().setHours(0, 0, 0)) : null,
      endDate: this.searchFormGroup.get('endDate').value ? new Date(this.searchFormGroup.get('endDate').value.toDate().setHours(23, 59, 59)) : null,
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
    this.searchFormGroup.get('startDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).startDate);
    this.searchFormGroup.get('endDate').setValue(getDatesForDateRange(event.source.value, this.startOfTheWeek).endDate);
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
