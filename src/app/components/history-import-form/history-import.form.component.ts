import { Component, Inject, Input, OnDestroy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {Log} from 'ng2-logger/browser';
import {AppUserService} from '../../services/app.user.service';
import {UserServiceMetaInterface} from '@sports-alliance/sports-lib/lib/users/user.service.meta.interface';
import {Subscription} from 'rxjs';
import {AngularFireAnalytics} from '@angular/fire/analytics';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';


@Component({
  selector: 'app-history-import-form',
  templateUrl: './history-import.form.component.html',
  styleUrls: ['./history-import.form.component.css'],
  providers: [],
})

export class HistoryImportFormComponent implements OnInit, OnDestroy {
  @Input() user: User;
  @Input() serviceName: ServiceNames;
  protected logger = Log.create('HistoryImportFormComponent');
  public formGroup: FormGroup;
  public userMetaForService: UserServiceMetaInterface;
  public userMetaForServiceSubscription: Subscription;
  public isAllowedToDoHistoryImport = false;
  public nextImportAvailableDate: Date;
  public isLoading: boolean;
  public serviceNames = ServiceNames

  constructor(
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private afa: AngularFireAnalytics,
  ) {
  }

  async ngOnInit() {
    if (!this.user) {
      throw new Error('Component needs a user')
    }
    // Set this to loading
    this.isLoading = true;

    // Now build the controls
    this.formGroup = new FormGroup({
      formArray: new FormArray([
        new FormGroup({
          startDate: new FormControl(new Date(new Date().setHours(0, 0, 0, 0)), [
            Validators.required,
          ]),
          endDate: new FormControl(new Date(new Date().setHours(24, 0, 0, 0)), [
            Validators.required,
          ])
        }),
        new FormGroup({
          accepted: new FormControl(false, [
            Validators.requiredTrue,
            // Validators.minLength(4),
          ]),
        })
      ])
    });

    this.formGroup.disable();

    this.userMetaForServiceSubscription = await this.userService
      .getUserMetaForService(this.user, this.serviceName)
      .subscribe((userMetaForService) => {
        this.userMetaForService = userMetaForService;
        if (!userMetaForService || !userMetaForService.didLastHistoryImport) {
          this.isAllowedToDoHistoryImport = true;
          this.formGroup.enable();
          return;
        }

        switch (this.serviceName) {
          case ServiceNames.SuuntoApp:
            if (!userMetaForService.processedActivitiesFromLastHistoryImportCount) {
              this.isAllowedToDoHistoryImport = true;
              this.formGroup.enable();
              return;
            }
            this.nextImportAvailableDate = new Date(userMetaForService.didLastHistoryImport + ((userMetaForService.processedActivitiesFromLastHistoryImportCount / 500) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
            this.isAllowedToDoHistoryImport =
              this.nextImportAvailableDate < (new Date())
              || this.userMetaForService.processedActivitiesFromLastHistoryImportCount === 0;
            this.isAllowedToDoHistoryImport ? this.formGroup.enable() : this.formGroup.disable();
            break;
          case ServiceNames.GarminHealthAPI:
            this.isAllowedToDoHistoryImport = new Date(this.userMetaForService.didLastHistoryImport + (14 * 24 * 60 * 60 * 1000)) < new Date()
            this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + (14 * 24 * 60 * 60 * 1000));
            break;
          default:
            const e = new Error(`Service name is not available ${this.serviceName} for history import`);
            Sentry.captureException(e);
            this.formGroup.disable();
            this.isAllowedToDoHistoryImport = false;
        }
      });

    // Set this to done loading
    this.isLoading = false;
  }

  /** Returns a FormArray with the name 'formArray'. */
  get formArray(): AbstractControl | null {
    return this.formGroup.get('formArray');
  }

  hasError(formGroupIndex?: number, field?: string) {
    if (!field) {
      return !this.formGroup.valid;
    }
    const formArray = <FormArray>this.formGroup.get('formArray');
    return !(formArray.controls[formGroupIndex].get(field).valid && formArray.controls[formGroupIndex].get(field).touched);
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
      this.serviceName === ServiceNames.SuuntoApp
        ? await this.userService.importSuuntoAppHistory(this.formGroup.get('formArray')['controls'][0].get('startDate').value, this.formGroup.get('formArray')['controls'][0].get('endDate').value)
        : await this.userService.backfillHealthAPIActivities(this.formGroup.get('formArray')['controls'][0].get('startDate').value, this.formGroup.get('formArray')['controls'][0].get('endDate').value);
      this.snackBar.open('History import has been queued', null, {
        duration: 2000,
      });
      this.afa.logEvent('imported_history', {method: this.serviceName});
    } catch (e) {
      // debugger;
      Sentry.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could import history for ${this.serviceName} due to ${e.message}`, null, {
        duration: 2000,
      });
    } finally {
      this.isLoading = false;
    }
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

  ngOnDestroy(): void {
    if (this.userMetaForServiceSubscription) {
      this.userMetaForServiceSubscription.unsubscribe();
    }
  }
}

