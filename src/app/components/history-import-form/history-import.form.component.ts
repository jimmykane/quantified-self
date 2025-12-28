import { Component, Inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject } from '@angular/core';
import {
  AbstractControl,
  UntypedFormArray,
  UntypedFormControl,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { User } from '@sports-alliance/sports-lib';

import { AppUserService } from '../../services/app.user.service';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { ServiceNames } from '@sports-alliance/sports-lib';


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


  public formGroup: UntypedFormGroup;
  public isAllowedToDoHistoryImport = false;
  public nextImportAvailableDate: Date;
  public isLoading: boolean;
  public serviceNames = ServiceNames
  public isPro = false;
  private analytics = inject(Analytics);

  constructor(
    private userService: AppUserService,
    private snackBar: MatSnackBar,
  ) {
  }

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
      this.formGroup.enable();
      // Set this to done loading
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
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + ((this.userMetaForService.processedActivitiesFromLastHistoryImportCount / 500) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
        this.isAllowedToDoHistoryImport =
          this.nextImportAvailableDate < (new Date())
          || this.userMetaForService.processedActivitiesFromLastHistoryImportCount === 0;
        break;
      case ServiceNames.GarminHealthAPI:
        this.isAllowedToDoHistoryImport = new Date(this.userMetaForService.didLastHistoryImport + (3 * 24 * 60 * 60 * 1000)) < new Date()
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + (3 * 24 * 60 * 60 * 1000));
        break;
      default:
        Sentry.captureException(new Error(`Service name is not available ${this.serviceName} for history import`));
        // this.formGroup.disable();
        // this.isAllowedToDoHistoryImport = false;
        break;
    }
    this.isAllowedToDoHistoryImport ? this.formGroup.enable() : this.formGroup.disable();
    // Set this to done loading
    this.isLoading = false;
  }

  async onSubmit(event) {
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
      await this.userService.importServiceHistoryForCurrentUser(
        this.serviceName,
        this.formGroup.get('startDate')?.value,
        this.formGroup.get('endDate')?.value
      );
      this.snackBar.open('History import has been queued', null, {
        duration: 2000,
      });
      logEvent(this.analytics, 'imported_history', { method: this.serviceName });
    } catch (e) {
      // debugger;
      Sentry.captureException(e);

      this.snackBar.open(`Could not import history for ${this.serviceName} due to ${e.message}`, null, {
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
}

