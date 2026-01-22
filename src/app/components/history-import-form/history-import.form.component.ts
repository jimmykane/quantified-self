import { Component, Inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject, Output, EventEmitter, ChangeDetectorRef, signal } from '@angular/core';
import {
  AbstractControl,
  UntypedFormArray,
  UntypedFormControl,
  UntypedFormGroup,
  Validators,
  ValidatorFn,
  ValidationErrors,
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

/** Response from COROS/Suunto history import */
export interface HistoryImportResult {
  successCount: number;
  failureCount: number;
  processedBatches: number;
  failedBatches: number;
}


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
  @Input() isLoadingParent = false;
  @Output() importInitiated = new EventEmitter<void>();


  public formGroup: UntypedFormGroup;
  public isAllowedToDoHistoryImport = false;
  public nextImportAvailableDate: Date;
  public isSubmitting = false;
  public serviceNames = ServiceNames
  public isPro = false;
  public corosHistoryLimitMonths = COROS_HISTORY_IMPORT_LIMIT_MONTHS;
  public activitiesPerDayLimit = HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT;
  public garminCooldownDays = GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS;
  /** Optimistic UI flag - blocks re-submission immediately after success */
  public isHistoryImportPending = signal(false);
  /** stores the actual backend response for display (COROS/Suunto only) */
  public pendingImportResult = signal<HistoryImportResult | null>(null);
  /** Max date for any import is today (using dayjs for datepicker compatibility) */
  public today = dayjs().endOf('day');
  /** Expose Math for template calculations */
  public Math = Math;
  private eventService = inject(AppEventService);
  private userService = inject(AppUserService);
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private changeDetectorRef = inject(ChangeDetectorRef);

  async ngOnInit() {
    this.formGroup = new UntypedFormGroup({
      startDate: new UntypedFormControl(dayjs().startOf('day'), [
        Validators.required,
      ]),
      endDate: new UntypedFormControl(dayjs().endOf('day'), [
        Validators.required,
      ]),
      accepted: new UntypedFormControl(false, [
        Validators.requiredTrue,
      ]),
    }, { validators: this.dateRangeValidator });

    this.formGroup.disable();

    this.isPro = await this.userService.isPro();

    this.processChanges();
  }

  dateRangeValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const startControl = group.get('startDate');
    const endControl = group.get('endDate');
    const start = startControl?.value;
    const end = endControl?.value;

    if (start && end && dayjs(start).isAfter(dayjs(end))) {
      endControl?.setErrors({ dateRangeInvalid: true });
      return { dateRangeInvalid: true };
    }

    // If it was only invalid due to dateRangeInvalid, clear it. 
    // Note: this is a simple check, in a complex form we'd be more careful about other errors.
    if (endControl?.hasError('dateRangeInvalid')) {
      endControl.setErrors(null);
      // Re-trigger required validator if needed
      endControl.updateValueAndValidity({ emitEvent: false });
    }

    return null;
  };

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
    if (!this.userMetaForService || !this.userMetaForService.didLastHistoryImport) {
      this.isAllowedToDoHistoryImport = true;
      (this.isAllowedToDoHistoryImport && !this.isMissingGarminPermissions) ? this.formGroup.enable() : this.formGroup.disable();
      // Set min date for COROS if no previous import
      if (this.serviceName === ServiceNames.COROSAPI) {
        const limitDate = new Date();
        limitDate.setMonth(limitDate.getMonth() - this.corosHistoryLimitMonths);
        this.minDate = limitDate;
      }
      return;
    }

    switch (this.serviceName) {
      case ServiceNames.SuuntoApp:
      case ServiceNames.COROSAPI:
        if (!this.userMetaForService.processedActivitiesFromLastHistoryImportCount) {
          this.isAllowedToDoHistoryImport = true;
          this.formGroup.enable();
          // Set min date for COROS
          if (this.serviceName === ServiceNames.COROSAPI) {
            const limitDate = new Date();
            limitDate.setMonth(limitDate.getMonth() - this.corosHistoryLimitMonths);
            this.minDate = limitDate;
          }
          break;
        }
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + ((this.userMetaForService.processedActivitiesFromLastHistoryImportCount / HISTORY_IMPORT_ACTIVITIES_PER_DAY_LIMIT) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
        this.isAllowedToDoHistoryImport =
          this.nextImportAvailableDate < (new Date())
          || this.userMetaForService.processedActivitiesFromLastHistoryImportCount === 0;
        // Set min date for COROS
        if (this.serviceName === ServiceNames.COROSAPI) {
          const limitDate = new Date();
          limitDate.setMonth(limitDate.getMonth() - this.corosHistoryLimitMonths);
          this.minDate = limitDate;
        }
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
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (!this.formGroup.valid) {
      this.validateAllFormFields(this.formGroup);
      return;
    }

    if (this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;

    // Explicitly disable the form to force UI state update
    this.formGroup.disable({ emitEvent: false });
    this.changeDetectorRef.detectChanges();

    // Force UI render cycle
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      this.analyticsService.logEvent('imported_history', { method: this.serviceName });

      // Normalize dates: start = 00:00, end = 23:59
      const startDate = dayjs(this.formGroup.get('startDate')?.value).startOf('day').toDate();
      const endDate = dayjs(this.formGroup.get('endDate')?.value).endOf('day').toDate();

      const result = await this.userService.importServiceHistoryForCurrentUser(
        this.serviceName,
        startDate,
        endDate
      );
      this.importInitiated.emit(result);

      // Set optimistic flag immediately to prevent re-submission
      this.isHistoryImportPending.set(true);

      // Store result for display (COROS/Suunto return stats, Garmin doesn't)
      if (result?.stats) {
        this.pendingImportResult.set(result.stats);

        if (result.stats.successCount === 0) {
          this.snackBar.open('No new activities found to import.', undefined, {
            duration: 3000,
          });
        } else {
          this.snackBar.open(`History import queued: ${result.stats.successCount} activities found.`, undefined, {
            duration: 3000,
          });
        }
      } else {
        this.snackBar.open('History import has been queued', undefined, {
          duration: 2000,
        });
      }
    } catch (e: any) {
      this.logger.error(e);

      this.snackBar.open(`Could not import history for ${this.serviceName} due to ${e.message}`, undefined, {
        duration: 2000,
      });
    } finally {
      this.isSubmitting = false;
      // Re-evaluate form state
      this.processChanges();
      this.changeDetectorRef.detectChanges();
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

