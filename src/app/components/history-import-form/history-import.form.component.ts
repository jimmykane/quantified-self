import { Component, Inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
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

export class HistoryImportFormComponent implements OnInit, OnDestroy, OnChanges {
  @Input() serviceName: ServiceNames;
  @Input() userMetaForService: UserServiceMetaInterface;

  protected logger = Log.create('HistoryImportFormComponent');
  public formGroup: FormGroup;
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
        this.isAllowedToDoHistoryImport ? this.formGroup.enable() : this.formGroup.disable();
        break;
      case ServiceNames.GarminHealthAPI:
        this.isAllowedToDoHistoryImport = new Date(this.userMetaForService.didLastHistoryImport + (14 * 24 * 60 * 60 * 1000)) < new Date()
        this.nextImportAvailableDate = new Date(this.userMetaForService.didLastHistoryImport + (14 * 24 * 60 * 60 * 1000));
        break;
      default:
        Sentry.captureException(new Error(`Service name is not available ${this.serviceName} for history import`));
        this.formGroup.disable();
        this.isAllowedToDoHistoryImport = false;
        break;
    }
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
      await this.userService.importServiceHistoryForCurrentUser(this.serviceName, this.formGroup.get('formArray')['controls'][0].get('startDate').value, this.formGroup.get('formArray')['controls'][0].get('endDate').value)
      this.snackBar.open('History import has been queued', null, {
        duration: 2000,
      });
      this.afa.logEvent('imported_history', {method: this.serviceName});
    } catch (e) {
      // debugger;
      Sentry.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could not import history for ${this.serviceName} due to ${e.message}`, null, {
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

  }
}

