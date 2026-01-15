import { Component, Inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject, Output, EventEmitter } from '@angular/core';
import {
  AbstractControl,
  UntypedFormArray,
  UntypedFormControl,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { User } from '@sports-alliance/sports-lib';

import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS, GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS, HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT } from '../../../../functions/src/shared/history-import.constants';
import dayjs from 'dayjs';


@Component({
  selector: 'app-history-import-form',
  templateUrl: './history-import.form.component.html',
  styleUrls: ['./history-import.form.component.css'],
  providers: [],
  standalone: false
})

export class HistoryImportFormComponent implements OnInit, OnDestroy, OnChanges {
  @Input() serviceName: ServiceNames;
  @Input() userMetaForService: UserServiceMetaInterface;
  @Input() minDate: Date | null = null;
  @Input() missingPermissions: string[] = [];
  @Output() importInitiated = new EventEmitter<void>();


  public formGroup: UntypedFormGroup;
  public isAllowedToDoHistoryImport = false;
  public nextImportAvailableDate: Date;
  public isLoading: boolean;
  public serviceNames = ServiceNames
  public isPro = false;
  public corosHistoryLimitMonths = COROS_HISTORY_IMPORT_LIMIT_MONTHS;
  public activitiesPerDayLimit = HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT;
  public garminCooldownDays = GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS;
  private eventService = inject(AppEventService);
  private userService = inject(AppUserService);
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);

  async ngOnInit() {
    this.formGroup = new UntypedFormGroup({
      startDate: new UntypedFormControl(new Date(new Date().setHours(0, 0, 0, 0)), [
        Validators.required,
      ]),
      endDate: new UntypedFormControl(new Date(new Date().setHours(24, 0, 0, 0)), [
        Validators.required,
      ]),
      accepted: new UntypedFormControl(false, [
        Validators.requiredTrue,
      ]),
    });

    this.formGroup.disable();

    this.isPro = await this.userService.isPro();

    this.processChanges();
  }

  get isMissingGarminPermissions(): boolean {
    return this.serviceName === ServiceNames.GarminAPI &&
      (this.missingPermissions.includes('HISTORICAL_DATA_EXPORT') || this.missingPermissions.includes('ACTIVITY_EXPORT'));
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.serviceName) {
      throw new Error('Component needs serviceName')
    }
    if (this.formGroup) {
      this.processChanges()
    }
  }

  private processChanges() {
    this.isLoading = true;
    if (!this.userMetaForService || !this.userMetaForService.didLastHistoryImport) {
      this.isAllowedToDoHistoryImport = true;
      (this.isAllowedToDoHistoryImport && !this.isMissingGarminPermissions) ? this.formGroup.enable() : this.formGroup.disable();
      this.isLoading = false;
      return;
    }

    switch (this.serviceName) {
      case ServiceNames.SuuntoApp:
      case ServiceNames.COROSAPI:
        if (!this.userMetaForService.processedActivitiesFromLastHistoryImportCount) {
          this.isAllowedToDoHistoryImport = true;
          this.formGroup.enable();
          break;
        }
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + ((this.userMetaForService.processedActivitiesFromLastHistoryImportCount / HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
        this.isAllowedToDoHistoryImport =
          this.nextImportAvailableDate < (new Date())
          || this.userMetaForService.processedActivitiesFromLastHistoryImportCount === 0;
        break;
        break;
      case ServiceNames.GarminAPI:
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + (GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
        this.isAllowedToDoHistoryImport = this.nextImportAvailableDate < new Date()
        if (this.isMissingGarminPermissions) {
          this.isAllowedToDoHistoryImport = true; // Still allow showing the form
        }
        break;
      default:
        this.logger.error(new Error(`Service name is not available ${this.serviceName} for history import`));
        // this.formGroup.disable();
        // this.isAllowedToDoHistoryImport = false;
        break;
    }
    (this.isAllowedToDoHistoryImport && !this.isMissingGarminPermissions) ? this.formGroup.enable() : this.formGroup.disable();
    // Set this to done loading
    this.isLoading = false;
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (!this.formGroup.valid) {
      this.validateAllFormFields(this.formGroup);
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    try {
      this.analyticsService.logEvent('imported_history', { method: this.serviceName });
      await this.userService.importServiceHistoryForCurrentUser(
        this.serviceName,
        dayjs(this.formGroup.get('startDate')?.value).toDate(),
        dayjs(this.formGroup.get('endDate')?.value).toDate()
      );
      this.importInitiated.emit();
      this.snackBar.open('History import has been queued', undefined, {
        duration: 2000,
      });
    } catch (e: any) {
      // debugger;
      this.logger.error(e);

      this.snackBar.open(`Could not import history for ${this.serviceName} due to ${e.message}`, undefined, {
        duration: 2000,
      });
    } finally {
      this.isLoading = false;
    }
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

  ngOnDestroy(): void {

  }

  get cooldownDays(): number {
    if (!this.userMetaForService?.processedActivitiesFromLastHistoryImportCount) {
      return 0;
    }
    return Math.ceil(this.userMetaForService.processedActivitiesFromLastHistoryImportCount / this.activitiesPerDayLimit);
  }
}

